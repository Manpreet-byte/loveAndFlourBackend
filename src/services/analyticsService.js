import { pool } from '../config/db.js';
import { cacheWrap } from './cacheService.js';

function toDateOnly(d) {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

function rangeDefaults({ from, to, days = 30 } = {}) {
  const now = new Date();
  const toDate = to ? new Date(String(to)) : now;
  const fromDate = from ? new Date(String(from)) : new Date(toDate.getTime() - days * 24 * 60 * 60 * 1000);
  const fromISO = toDateOnly(fromDate);
  const toISO = toDateOnly(toDate);
  if (!fromISO || !toISO) return null;
  return { from: fromISO, to: toISO };
}

export async function getDashboardAnalytics() {
  return cacheWrap({
    ns: 'analytics_dashboard',
    key: 'v1',
    ttlSeconds: 30,
    compute: async () => {
      const [[rev]] = await pool.query(
        `SELECT
            COALESCE(SUM(CASE WHEN p.status = 'captured' THEN p.amount_cents ELSE 0 END), 0) AS total_revenue_cents,
            COALESCE(SUM(CASE WHEN p.status = 'captured' AND DATE(p.captured_at) = CURDATE() THEN p.amount_cents ELSE 0 END), 0) AS revenue_today_cents,
            COALESCE(SUM(CASE WHEN p.status = 'captured' AND DATE_FORMAT(p.captured_at, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m') THEN p.amount_cents ELSE 0 END), 0) AS revenue_month_cents,
            COALESCE(SUM(CASE WHEN p.status = 'refunded' THEN p.amount_cents ELSE 0 END), 0) AS refunded_cents
           FROM payments p`,
      );

      const [[users]] = await pool.query(
        `SELECT
            (SELECT COUNT(*) FROM users) AS total_users,
            (SELECT COUNT(*) FROM users WHERE last_login_at IS NOT NULL AND last_login_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)) AS active_users_30d`,
      );

      const [[enrollments]] = await pool.query(
        `SELECT
            (SELECT COUNT(*) FROM enrollments) AS total_enrollments,
            (SELECT COUNT(*) FROM enrollments WHERE status = 'active' AND expiry_date >= CURDATE()) AS active_enrollments,
            (SELECT COUNT(*) FROM enrollments WHERE DATE(created_at) = CURDATE()) AS new_enrollments_today,
            (SELECT COUNT(*) FROM enrollments WHERE DATE_FORMAT(created_at, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')) AS new_enrollments_month,
            (SELECT COUNT(DISTINCT user_id) FROM enrollments WHERE status = 'active' AND expiry_date >= CURDATE()) AS active_students`,
      );

      const [topRevenue] = await pool.query(
        `SELECT oi.course_id, c.title,
                COALESCE(SUM(oi.line_total_cents), 0) AS revenue_cents
           FROM order_items oi
           JOIN orders o ON o.id = oi.order_id
           JOIN payments p ON p.order_id = o.id AND p.status = 'captured'
           JOIN courses c ON c.id = oi.course_id
          WHERE oi.item_type = 'course'
       GROUP BY oi.course_id, c.title
       ORDER BY revenue_cents DESC
          LIMIT 5`,
      );

      const [topEnrollments] = await pool.query(
        `SELECT e.course_id, c.title, COUNT(*) AS enrollments
           FROM enrollments e
           JOIN courses c ON c.id = e.course_id
       GROUP BY e.course_id, c.title
       ORDER BY enrollments DESC
          LIMIT 5`,
      );

      const [orderSummary] = await pool.query(
        `SELECT o.status, COUNT(*) AS orders, COALESCE(SUM(o.total_cents), 0) AS total_cents
           FROM orders o
       GROUP BY o.status
       ORDER BY orders DESC`,
      );

      const [[orderTotals]] = await pool.query(
        `SELECT
            COUNT(*) AS total_orders,
            COALESCE(SUM(CASE WHEN DATE(o.created_at) = CURDATE() THEN 1 ELSE 0 END), 0) AS orders_today,
            COALESCE(SUM(CASE WHEN DATE_FORMAT(o.created_at, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m') THEN 1 ELSE 0 END), 0) AS orders_month
           FROM orders o`,
      );

      // Funnel events (anonymous-friendly): based on analytics_events session_id metadata.
      // We compute distinct session_id per step over last 30 days.
      const [[funnel]] = await pool.query(
        `SELECT
          COALESCE(COUNT(DISTINCT CASE WHEN event_type = 'page_view' THEN JSON_UNQUOTE(JSON_EXTRACT(CAST(metadata_json AS JSON), '$.session_id')) END), 0) AS visitors,
          COALESCE(COUNT(DISTINCT CASE WHEN event_type = 'cart_add' THEN JSON_UNQUOTE(JSON_EXTRACT(CAST(metadata_json AS JSON), '$.session_id')) END), 0) AS carts,
          COALESCE(COUNT(DISTINCT CASE WHEN event_type = 'checkout_started' THEN JSON_UNQUOTE(JSON_EXTRACT(CAST(metadata_json AS JSON), '$.session_id')) END), 0) AS checkouts,
          COALESCE(COUNT(DISTINCT CASE WHEN event_type = 'purchase_verified' THEN JSON_UNQUOTE(JSON_EXTRACT(CAST(metadata_json AS JSON), '$.session_id')) END), 0) AS purchases
         FROM analytics_events
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
      );

      const visitors = Number(funnel.visitors ?? 0);
      const purchases = Number(funnel.purchases ?? 0);
      const visitorsToPurchaseRate = visitors > 0 ? Math.round((purchases / visitors) * 10000) / 100 : null;

      return {
        revenue: {
          total_revenue_cents: Number(rev.total_revenue_cents),
          revenue_today_cents: Number(rev.revenue_today_cents),
          revenue_month_cents: Number(rev.revenue_month_cents),
          refunded_cents: Number(rev.refunded_cents),
        },
        users: {
          total_users: Number(users.total_users),
          active_users_30d: Number(users.active_users_30d),
        },
        enrollments: {
          total_enrollments: Number(enrollments.total_enrollments),
          active_enrollments: Number(enrollments.active_enrollments),
          new_enrollments_today: Number(enrollments.new_enrollments_today),
          new_enrollments_month: Number(enrollments.new_enrollments_month),
          active_students: Number(enrollments.active_students),
        },
        conversion: {
          range: { days: 30 },
          visitors: visitors,
          carts: Number(funnel.carts ?? 0),
          checkouts: Number(funnel.checkouts ?? 0),
          purchases: purchases,
          visitors_to_purchase_rate: visitorsToPurchaseRate,
        },
        orders: {
          summary: orderSummary,
          totals: {
            total_orders: Number(orderTotals.total_orders ?? 0),
            orders_today: Number(orderTotals.orders_today ?? 0),
            orders_month: Number(orderTotals.orders_month ?? 0),
          },
          note: 'WooCommerce summary is represented as internal orders summary (no Woo integration configured).',
        },
        top_courses: {
          by_revenue: topRevenue,
          by_enrollments: topEnrollments,
        },
      };
    },
  });
}

export async function getRevenueAnalytics({ from, to }) {
  const range = rangeDefaults({ from, to, days: 90 });
  if (!range) {
    const err = new Error('Invalid date range');
    err.status = 400;
    throw err;
  }

  const [daily] = await pool.query(
    `SELECT DATE(p.captured_at) AS day, COALESCE(SUM(p.amount_cents), 0) AS revenue_cents, COUNT(*) AS payments
       FROM payments p
      WHERE p.status = 'captured'
        AND p.captured_at >= ? AND p.captured_at < DATE_ADD(?, INTERVAL 1 DAY)
   GROUP BY DATE(p.captured_at)
   ORDER BY day ASC`,
    [range.from, range.to],
  );

  const [monthly] = await pool.query(
    `SELECT DATE_FORMAT(p.captured_at, '%Y-%m') AS month, COALESCE(SUM(p.amount_cents), 0) AS revenue_cents, COUNT(*) AS payments
       FROM payments p
      WHERE p.status = 'captured'
        AND p.captured_at >= ? AND p.captured_at < DATE_ADD(?, INTERVAL 1 DAY)
   GROUP BY DATE_FORMAT(p.captured_at, '%Y-%m')
   ORDER BY month ASC`,
    [range.from, range.to],
  );

  const [[totals]] = await pool.query(
    `SELECT COALESCE(SUM(p.amount_cents), 0) AS total_sales_cents, COUNT(*) AS payments
       FROM payments p
      WHERE p.status = 'captured'
        AND p.captured_at >= ? AND p.captured_at < DATE_ADD(?, INTERVAL 1 DAY)`,
    [range.from, range.to],
  );

  const [[ref]] = await pool.query(
    `SELECT COALESCE(SUM(p.amount_cents), 0) AS refunded_cents, COUNT(*) AS refunds
       FROM payments p
      WHERE p.status = 'refunded'
        AND COALESCE(p.refunded_at, p.updated_at) >= ? AND COALESCE(p.refunded_at, p.updated_at) < DATE_ADD(?, INTERVAL 1 DAY)`,
    [range.from, range.to],
  );

  return {
    range,
    totals,
    daily,
    monthly,
    refunded: { refunded_cents: Number(ref?.refunded_cents ?? 0), refunds: Number(ref?.refunds ?? 0) },
  };
}

export async function getOrdersSummaryAnalytics({ from, to }) {
  const range = rangeDefaults({ from, to, days: 30 });
  if (!range) {
    const err = new Error('Invalid date range');
    err.status = 400;
    throw err;
  }
  const [rows] = await pool.query(
    `SELECT o.status, COUNT(*) AS orders, COALESCE(SUM(o.total_cents), 0) AS total_cents
       FROM orders o
      WHERE o.created_at >= ? AND o.created_at < DATE_ADD(?, INTERVAL 1 DAY)
   GROUP BY o.status
   ORDER BY orders DESC`,
    [range.from, range.to],
  );
  return { range, summary: rows, note: 'WooCommerce summary maps to internal orders (no Woo integration configured).' };
}

export async function getConversionAnalytics({ from, to }) {
  const range = rangeDefaults({ from, to, days: 30 });
  if (!range) {
    const err = new Error('Invalid date range');
    err.status = 400;
    throw err;
  }
  const [[row]] = await pool.query(
    `SELECT
      COALESCE(COUNT(DISTINCT CASE WHEN event_type = 'page_view' THEN JSON_UNQUOTE(JSON_EXTRACT(CAST(metadata_json AS JSON), '$.session_id')) END), 0) AS visitors,
      COALESCE(COUNT(DISTINCT CASE WHEN event_type = 'cart_add' THEN JSON_UNQUOTE(JSON_EXTRACT(CAST(metadata_json AS JSON), '$.session_id')) END), 0) AS carts,
      COALESCE(COUNT(DISTINCT CASE WHEN event_type = 'checkout_started' THEN JSON_UNQUOTE(JSON_EXTRACT(CAST(metadata_json AS JSON), '$.session_id')) END), 0) AS checkouts,
      COALESCE(COUNT(DISTINCT CASE WHEN event_type = 'purchase_verified' THEN JSON_UNQUOTE(JSON_EXTRACT(CAST(metadata_json AS JSON), '$.session_id')) END), 0) AS purchases
     FROM analytics_events
    WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)`,
    [range.from, range.to],
  );
  const visitors = Number(row.visitors ?? 0);
  const purchases = Number(row.purchases ?? 0);
  const rate = visitors > 0 ? Math.round((purchases / visitors) * 10000) / 100 : null;

  // Last-touch attribution based on the most recent `page_view` before each `purchase_verified` per session_id.
  // This keeps attribution anonymous and session-based.
  const [attribRows] = await pool.query(
    `WITH purchases AS (
        SELECT
          JSON_UNQUOTE(JSON_EXTRACT(CAST(metadata_json AS JSON), '$.session_id')) AS session_id,
          MAX(created_at) AS purchased_at
        FROM analytics_events
        WHERE event_type = 'purchase_verified'
          AND created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
          AND JSON_EXTRACT(CAST(metadata_json AS JSON), '$.session_id') IS NOT NULL
        GROUP BY JSON_UNQUOTE(JSON_EXTRACT(CAST(metadata_json AS JSON), '$.session_id'))
      ),
      last_touch AS (
        SELECT
          p.session_id,
          (
            SELECT ae.metadata_json
              FROM analytics_events ae
             WHERE ae.event_type = 'page_view'
               AND JSON_UNQUOTE(JSON_EXTRACT(CAST(ae.metadata_json AS JSON), '$.session_id')) = p.session_id
               AND ae.created_at <= p.purchased_at
             ORDER BY ae.created_at DESC
             LIMIT 1
          ) AS meta_json
        FROM purchases p
      )
      SELECT
        COALESCE(JSON_UNQUOTE(JSON_EXTRACT(CAST(meta_json AS JSON), '$.utm_source')), '(direct)') AS utm_source,
        COALESCE(JSON_UNQUOTE(JSON_EXTRACT(CAST(meta_json AS JSON), '$.utm_medium')), '(none)') AS utm_medium,
        COALESCE(JSON_UNQUOTE(JSON_EXTRACT(CAST(meta_json AS JSON), '$.referrer_host')), '(none)') AS referrer_host,
        COUNT(*) AS purchases
      FROM last_touch
      GROUP BY utm_source, utm_medium, referrer_host
      ORDER BY purchases DESC
      LIMIT 25`,
    [range.from, range.to],
  );

  // Multi-touch: count purchases attributed to any touchpoint (utm_source/utm_medium/referrer_host)
  // that occurred before purchase in the same session. Uses DISTINCT session->touchpoint to avoid overcounting.
  const [multiRows] = await pool.query(
    `WITH purchases AS (
        SELECT
          JSON_UNQUOTE(JSON_EXTRACT(CAST(metadata_json AS JSON), '$.session_id')) AS session_id,
          MAX(created_at) AS purchased_at
        FROM analytics_events
        WHERE event_type = 'purchase_verified'
          AND created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
          AND JSON_EXTRACT(CAST(metadata_json AS JSON), '$.session_id') IS NOT NULL
        GROUP BY JSON_UNQUOTE(JSON_EXTRACT(CAST(metadata_json AS JSON), '$.session_id'))
      ),
      touches AS (
        SELECT DISTINCT
          p.session_id,
          COALESCE(JSON_UNQUOTE(JSON_EXTRACT(CAST(ae.metadata_json AS JSON), '$.utm_source')), '(direct)') AS utm_source,
          COALESCE(JSON_UNQUOTE(JSON_EXTRACT(CAST(ae.metadata_json AS JSON), '$.utm_medium')), '(none)') AS utm_medium,
          COALESCE(JSON_UNQUOTE(JSON_EXTRACT(CAST(ae.metadata_json AS JSON), '$.referrer_host')), '(none)') AS referrer_host
        FROM purchases p
        JOIN analytics_events ae
          ON ae.event_type = 'page_view'
         AND JSON_UNQUOTE(JSON_EXTRACT(CAST(ae.metadata_json AS JSON), '$.session_id')) = p.session_id
         AND ae.created_at <= p.purchased_at
      )
      SELECT utm_source, utm_medium, referrer_host, COUNT(*) AS purchases
      FROM touches
      GROUP BY utm_source, utm_medium, referrer_host
      ORDER BY purchases DESC
      LIMIT 50`,
    [range.from, range.to],
  );

  function channelGroup({ utm_source, utm_medium, referrer_host }) {
    const source = String(utm_source ?? '').toLowerCase();
    const medium = String(utm_medium ?? '').toLowerCase();
    const ref = String(referrer_host ?? '').toLowerCase();
    if (source === '(direct)' && (medium === '(none)' || !medium)) return 'Direct';
    if (medium.includes('email')) return 'Email';
    if (medium.includes('cpc') || medium.includes('ppc') || medium.includes('paid') || medium.includes('ads')) return 'Paid';
    if (medium.includes('social') || ['instagram', 'facebook', 'youtube', 'tiktok', 'x.com', 'twitter'].some((d) => source.includes(d) || ref.includes(d))) {
      return medium.includes('paid') ? 'Paid Social' : 'Organic Social';
    }
    if (medium.includes('organic') || medium.includes('seo')) return 'Organic Search';
    if (medium.includes('referral') || (ref && ref !== '(none)')) return 'Referral';
    return 'Other';
  }

  const channelCounts = new Map();
  for (const r of multiRows ?? []) {
    const grp = channelGroup(r);
    channelCounts.set(grp, (channelCounts.get(grp) ?? 0) + Number(r.purchases ?? 0));
  }
  const channelTop = [...channelCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([channel, count]) => ({ channel, purchases: count }));

  return {
    range,
    visitors,
    carts: Number(row.carts ?? 0),
    checkouts: Number(row.checkouts ?? 0),
    purchases,
    visitors_to_purchase_rate: rate,
    attribution: {
      last_touch_top: (attribRows ?? []).map((r) => ({
        utm_source: r.utm_source,
        utm_medium: r.utm_medium,
        referrer_host: r.referrer_host,
        purchases: Number(r.purchases ?? 0),
      })),
      multi_touch_top: (multiRows ?? []).map((r) => ({
        utm_source: r.utm_source,
        utm_medium: r.utm_medium,
        referrer_host: r.referrer_host,
        purchases: Number(r.purchases ?? 0),
      })),
      channel_top: channelTop,
    },
  };
}

export async function getTopCoursesAnalytics({ from, to }) {
  const range = rangeDefaults({ from, to, days: 30 });
  if (!range) {
    const err = new Error('Invalid date range');
    err.status = 400;
    throw err;
  }

  const [byRevenue] = await pool.query(
    `SELECT oi.course_id, c.title,
            COALESCE(SUM(oi.line_total_cents), 0) AS revenue_cents,
            COUNT(DISTINCT o.id) AS orders
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN payments p ON p.order_id = o.id AND p.status = 'captured'
       JOIN courses c ON c.id = oi.course_id
      WHERE oi.item_type = 'course'
        AND o.created_at >= ? AND o.created_at < DATE_ADD(?, INTERVAL 1 DAY)
   GROUP BY oi.course_id, c.title
   ORDER BY revenue_cents DESC
      LIMIT 20`,
    [range.from, range.to],
  );

  const [byEnrollments] = await pool.query(
    `SELECT e.course_id, c.title, COUNT(*) AS enrollments
       FROM enrollments e
       JOIN courses c ON c.id = e.course_id
      WHERE e.created_at >= ? AND e.created_at < DATE_ADD(?, INTERVAL 1 DAY)
   GROUP BY e.course_id, c.title
   ORDER BY enrollments DESC
      LIMIT 20`,
    [range.from, range.to],
  );

  return { range, by_revenue: byRevenue, by_enrollments: byEnrollments };
}

export async function getEnrollmentAnalytics({ from, to }) {
  const range = rangeDefaults({ from, to, days: 30 });
  if (!range) {
    const err = new Error('Invalid date range');
    err.status = 400;
    throw err;
  }

  const [daily] = await pool.query(
    `SELECT DATE(e.created_at) AS day, COUNT(*) AS enrollments
       FROM enrollments e
      WHERE e.created_at >= ? AND e.created_at < DATE_ADD(?, INTERVAL 1 DAY)
   GROUP BY DATE(e.created_at)
   ORDER BY day ASC`,
    [range.from, range.to],
  );

  const [monthly] = await pool.query(
    `SELECT DATE_FORMAT(e.created_at, '%Y-%m') AS month, COUNT(*) AS enrollments
       FROM enrollments e
      WHERE e.created_at >= ? AND e.created_at < DATE_ADD(?, INTERVAL 1 DAY)
   GROUP BY DATE_FORMAT(e.created_at, '%Y-%m')
   ORDER BY month ASC`,
    [range.from, range.to],
  );

  const [[totals]] = await pool.query(
    `SELECT COUNT(*) AS total_enrollments,
            COUNT(DISTINCT CASE WHEN e.status = 'active' AND e.expiry_date >= CURDATE() THEN e.user_id END) AS active_students
       FROM enrollments e
      WHERE e.created_at >= ? AND e.created_at < DATE_ADD(?, INTERVAL 1 DAY)`,
    [range.from, range.to],
  );

  return {
    range,
    totals: {
      total_enrollments: Number(totals.total_enrollments ?? 0),
      active_students: Number(totals.active_students ?? 0),
    },
    daily,
    monthly,
  };
}

export async function getCourseAnalytics({ courseId }) {
  const [[enr]] = await pool.query(
    `SELECT COUNT(*) AS total_enrollments
       FROM enrollments
      WHERE course_id = ?`,
    [courseId],
  );

  const [[rev]] = await pool.query(
    `SELECT COALESCE(SUM(oi.line_total_cents), 0) AS revenue_cents
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN payments p ON p.order_id = o.id AND p.status = 'captured'
      WHERE oi.item_type = 'course' AND oi.course_id = ?`,
    [courseId],
  );

  const [[completion]] = await pool.query(
    `SELECT
        (SELECT COUNT(*) FROM user_course_completions ucc WHERE ucc.course_id = ?) AS completions,
        (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = ?) AS enrollments`,
    [courseId, courseId],
  );
  const enrollmentsCount = Number(completion.enrollments ?? 0);
  const completionsCount = Number(completion.completions ?? 0);
  const completionRate = enrollmentsCount === 0 ? 0 : Math.round((completionsCount / enrollmentsCount) * 10000) / 100;

  // Avg progress: average per-user completion ratio across published lessons.
  const [avgRows] = await pool.query(
    `SELECT AVG(u.progress_pct) AS avg_progress_pct
       FROM (
         SELECT e.user_id,
                CASE
                  WHEN t.total_lessons = 0 THEN 0
                  ELSE (c.completed_lessons / t.total_lessons) * 100
                END AS progress_pct
           FROM enrollments e
           CROSS JOIN (SELECT COUNT(*) AS total_lessons FROM lessons WHERE course_id = ? AND is_published = 1) t
           LEFT JOIN (
             SELECT ulp.user_id, COUNT(*) AS completed_lessons
               FROM user_lesson_progress ulp
               JOIN lessons l ON l.id = ulp.lesson_id
              WHERE ulp.course_id = ? AND ulp.completed_at IS NOT NULL AND l.is_published = 1
           GROUP BY ulp.user_id
           ) c ON c.user_id = e.user_id
          WHERE e.course_id = ?
       ) u`,
    [courseId, courseId, courseId],
  );

  return {
    course_id: courseId,
    revenue_cents: Number(rev.revenue_cents),
    total_enrollments: Number(enr.total_enrollments),
    completion: { completions: completionsCount, enrollments: enrollmentsCount, completion_rate_pct: completionRate },
    progress: { average_progress_pct: Number(avgRows?.[0]?.avg_progress_pct ?? 0) },
    dropoff: { note: 'Drop-off requires event tracking (lesson_started/lesson_completed) via analytics_events.' },
  };
}

export async function getUserAnalytics({ from, to }) {
  const range = rangeDefaults({ from, to, days: 60 });
  if (!range) {
    const err = new Error('Invalid date range');
    err.status = 400;
    throw err;
  }

  const [newUsersDaily] = await pool.query(
    `SELECT DATE(created_at) AS day, COUNT(*) AS users
       FROM users
      WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
   GROUP BY DATE(created_at)
   ORDER BY day ASC`,
    [range.from, range.to],
  );

  const [[active]] = await pool.query(
    `SELECT COUNT(*) AS active_users_30d
       FROM users
      WHERE last_login_at IS NOT NULL AND last_login_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
  );

  const [activeDaily] = await pool.query(
    `SELECT DATE(last_login_at) AS day, COUNT(DISTINCT id) AS users
       FROM users
      WHERE last_login_at IS NOT NULL
        AND last_login_at >= ? AND last_login_at < DATE_ADD(?, INTERVAL 1 DAY)
   GROUP BY DATE(last_login_at)
   ORDER BY day ASC`,
    [range.from, range.to],
  );

  const [topUsers] = await pool.query(
    `SELECT u.id AS user_id, u.email, u.name,
            COALESCE(SUM(p.amount_cents), 0) AS spend_cents,
            COUNT(DISTINCT p.order_id) AS orders
       FROM payments p
       JOIN users u ON u.id = p.user_id
      WHERE p.status = 'captured'
   GROUP BY u.id, u.email, u.name
   ORDER BY spend_cents DESC
      LIMIT 20`,
  );

  return {
    range,
    new_users_daily: newUsersDaily,
    active_users_30d: Number(active.active_users_30d),
    active_users_daily: activeDaily,
    top_users_by_spend: topUsers,
    engagement: { note: 'Engagement score should be computed from analytics_events (lesson_started/completed).' },
  };
}

export async function getRetentionAnalytics({ from, to }) {
  const range = rangeDefaults({ from, to, days: 120 });
  if (!range) {
    const err = new Error('Invalid date range');
    err.status = 400;
    throw err;
  }

  // Cohort retention proxy: signup cohorts grouped by ISO year-week; retained if last_login_at is at least N days after signup.
  const [rows] = await pool.query(
    `SELECT
        DATE_FORMAT(created_at, '%x-W%v') AS cohort,
        COUNT(*) AS users,
        SUM(CASE WHEN last_login_at IS NOT NULL AND last_login_at >= DATE_ADD(created_at, INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS retained_7d,
        SUM(CASE WHEN last_login_at IS NOT NULL AND last_login_at >= DATE_ADD(created_at, INTERVAL 30 DAY) THEN 1 ELSE 0 END) AS retained_30d
       FROM users
      WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
   GROUP BY DATE_FORMAT(created_at, '%x-W%v')
   ORDER BY cohort ASC`,
    [range.from, range.to],
  );

  const cohorts = (rows ?? []).map((r) => {
    const users = Number(r.users ?? 0);
    const retained7 = Number(r.retained_7d ?? 0);
    const retained30 = Number(r.retained_30d ?? 0);
    const rate7 = users > 0 ? Math.round((retained7 / users) * 10000) / 100 : null;
    const rate30 = users > 0 ? Math.round((retained30 / users) * 10000) / 100 : null;
    return { cohort: r.cohort, users, retained_7d: retained7, rate_7d: rate7, retained_30d: retained30, rate_30d: rate30 };
  });

  return {
    range,
    cohorts,
    note: 'Retention is a proxy based on last_login_at compared to signup date (not event-level return visits).',
  };
}
