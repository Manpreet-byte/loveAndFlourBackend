import { pool } from '../config/db.js';

function uniqById(list) {
  const seen = new Set();
  const out = [];
  for (const item of list ?? []) {
    const id = Number(item?.id ?? item?.course_id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(item);
  }
  return out;
}

export async function myRecommendations(req, res, next) {
  try {
    const userId = req.user.id;

    // Build simple heuristics:
    // - Continue: last started but incomplete course
    // - Complementary: top-selling not enrolled
    // - Trending: last 7 days paid orders
    const [[continueRow]] = await pool.query(
      `SELECT ulp.course_id, MAX(ulp.updated_at) AS last_seen
         FROM user_lesson_progress ulp
         JOIN enrollments e ON e.course_id = ulp.course_id AND e.user_id = ulp.user_id
        WHERE ulp.user_id = ? AND ulp.completed_at IS NULL
     GROUP BY ulp.course_id
     ORDER BY last_seen DESC
        LIMIT 1`,
      [userId],
    );

    const continueCourseId = continueRow?.course_id ? Number(continueRow.course_id) : null;
    let continueCourse = null;
    if (continueCourseId) {
      const [[c]] = await pool.query(
        `SELECT c.id, c.title, c.slug, c.summary, c.featured_image_url,
                (SELECT cp.amount_cents
                   FROM course_prices cp
                  WHERE cp.course_id = c.id
                    AND cp.currency = 'INR'
                    AND cp.is_active = 1
               ORDER BY cp.valid_from DESC, cp.id DESC
                  LIMIT 1) AS price_inr_cents
           FROM courses c
          WHERE c.id = ?
          LIMIT 1`,
        [continueCourseId],
      );
      continueCourse = c ?? null;
    }

    const [enrolledRows] = await pool.query(`SELECT course_id FROM enrollments WHERE user_id = ?`, [userId]);
    const enrolledIds = new Set(enrolledRows.map((r) => Number(r.course_id)));

    const [trending] = await pool.query(
      `SELECT c.id, c.title, c.slug, c.summary, c.featured_image_url,
              COALESCE(SUM(oi.line_total_cents), 0) AS revenue_cents
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
         JOIN courses c ON c.id = oi.course_id
        WHERE o.status IN ('paid','fulfilled')
          AND o.created_at >= (NOW() - INTERVAL 7 DAY)
     GROUP BY c.id
     ORDER BY revenue_cents DESC
        LIMIT 12`,
    );

    const [topAllTime] = await pool.query(
      `SELECT c.id, c.title, c.slug, c.summary, c.featured_image_url,
              COALESCE(SUM(oi.line_total_cents), 0) AS revenue_cents
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
         JOIN courses c ON c.id = oi.course_id
        WHERE o.status IN ('paid','fulfilled')
     GROUP BY c.id
     ORDER BY revenue_cents DESC
        LIMIT 30`,
    );

    const complementary = uniqById(topAllTime).filter((c) => !enrolledIds.has(Number(c.id))).slice(0, 12);
    const trendingFiltered = uniqById(trending).filter((c) => !enrolledIds.has(Number(c.id))).slice(0, 12);

    return res.json({
      continue_learning: continueCourse ? { course: continueCourse } : null,
      trending: trendingFiltered,
      recommended: complementary,
    });
  } catch (err) {
    return next(err);
  }
}

export async function trendingCourses(_req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT c.id, c.title, c.slug, c.summary, c.featured_image_url,
              COALESCE(SUM(oi.line_total_cents), 0) AS revenue_cents
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
         JOIN courses c ON c.id = oi.course_id
        WHERE o.status IN ('paid','fulfilled')
          AND o.created_at >= (NOW() - INTERVAL 7 DAY)
     GROUP BY c.id
     ORDER BY revenue_cents DESC
        LIMIT 12`,
    );
    return res.json({ trending: rows });
  } catch (err) {
    return next(err);
  }
}
