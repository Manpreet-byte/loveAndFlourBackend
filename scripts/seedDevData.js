import bcrypt from 'bcrypt';
import { pool } from '../src/config/db.js';
import { env } from '../src/utils/env.js';
import { logger } from '../src/utils/logger.js';
import { ensureCmsTables, ensureCreatorCollaborationColumns, ensureSupportTables, ensureUsersAuthColumns } from '../src/utils/dbCompat.js';

function daysFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function tableExists(tableName) {
  const [rows] = await pool.query(
    `SELECT 1 AS ok
       FROM information_schema.tables
      WHERE table_schema = ? AND table_name = ?
      LIMIT 1`,
    [env.DB_NAME, tableName],
  );
  return Boolean(rows?.[0]?.ok);
}

async function upsertUser({ name, email, password, role }) {
  const [existing] = await pool.query('SELECT id, email, role FROM users WHERE email = ? LIMIT 1', [email]);
  if (existing?.[0]) {
    const id = existing[0].id;
    if (role && existing[0].role !== role) await pool.query('UPDATE users SET role = ? WHERE id = ?', [role, id]);
    return id;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const [result] = await pool.query('INSERT INTO users (name, email, password, role, email_verified_at) VALUES (?, ?, ?, ?, NOW())', [
    name,
    email,
    passwordHash,
    role,
  ]);
  return result.insertId;
}

async function ensureSeedContent() {
  await ensureUsersAuthColumns({ pool });
  await ensureCreatorCollaborationColumns({ pool });
  await ensureCmsTables({ pool });
  await ensureSupportTables({ pool });
}

async function seedCategories() {
  const course = [
    { name: 'Hands-On Classes', slug: 'hands-on-classes', description: 'Practical workshops to bake together.' },
    { name: 'Recorded Workshops', slug: 'recorded-live-workshop', description: 'Replayable workshops.' },
    { name: 'E-Books', slug: 'e-book', description: 'Digital downloads.' },
  ];
  const recipe = [
    { name: 'Cakes', slug: 'cakes', description: 'Layered cakes and sponges.' },
    { name: 'Cookies', slug: 'cookies', description: 'Cookies, biscuits, and bars.' },
    { name: 'Breads', slug: 'breads', description: 'Fermented and quick breads.' },
  ];

  const insert = async (type, item) => {
    const [rows] = await pool.query('SELECT id FROM categories WHERE type = ? AND slug = ? LIMIT 1', [type, item.slug]);
    if (rows?.[0]) return rows[0].id;
    const [res] = await pool.query('INSERT INTO categories (type, name, slug, description) VALUES (?, ?, ?, ?)', [
      type,
      item.name,
      item.slug,
      item.description,
    ]);
    return res.insertId;
  };

  const courseIds = [];
  for (const c of course) courseIds.push(await insert('course', c));
  const recipeIds = [];
  for (const c of recipe) recipeIds.push(await insert('recipe', c));
  return { courseIds, recipeIds };
}

async function seedCourses({ courseCategoryId }) {
  const items = [
    {
      title: 'Buttercream Masterclass',
      slug: 'buttercream-masterclass',
      summary: 'Smooth, sharp edges, and piping basics.',
      content: '<p>Learn buttercream techniques with guided practice.</p>',
      featured_image_url: '/seed-media/course-1.jpg',
      amount_cents: 129900,
    },
    {
      title: 'Chocolate Ganache Secrets',
      slug: 'chocolate-ganache-secrets',
      summary: 'Consistency, drip control, and flavor pairings.',
      content: '<p>Everything ganache: ratios, temps, and troubleshooting.</p>',
      featured_image_url: '/seed-media/course-2.jpg',
      amount_cents: 99900,
    },
    {
      title: 'Bento Cakes for Beginners',
      slug: 'bento-cakes-for-beginners',
      summary: 'Small cakes, big impact—design and assembly.',
      content: '<p>Create cute bento cakes with clean finishes.</p>',
      featured_image_url: '/seed-media/course-3.jpg',
      amount_cents: 79900,
    },
  ];

  const courseIds = [];
  for (const c of items) {
    const [rows] = await pool.query('SELECT id FROM courses WHERE slug = ? LIMIT 1', [c.slug]);
    let id = rows?.[0]?.id;
    if (!id) {
      const [res] = await pool.query(
        'INSERT INTO courses (title, slug, summary, content, featured_image_url, level, language, is_published, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, NOW())',
        [c.title, c.slug, c.summary, c.content, c.featured_image_url, 'beginner', 'en',],
      );
      id = res.insertId;
    }
    courseIds.push(id);

    // Category link.
    await pool.query('INSERT IGNORE INTO course_categories (course_id, category_id) VALUES (?, ?)', [id, courseCategoryId]);

    // Active price.
    const [p] = await pool.query(
      'SELECT id FROM course_prices WHERE course_id = ? AND currency = ? AND is_active = 1 LIMIT 1',
      [id, 'INR'],
    );
    if (!p?.[0]) {
      await pool.query(
        'INSERT INTO course_prices (course_id, currency, amount_cents, is_active, valid_from) VALUES (?, ?, ?, 1, NOW())',
        [id, 'INR', c.amount_cents],
      );
    }

    // Lessons.
    const [ls] = await pool.query('SELECT id FROM lessons WHERE course_id = ? LIMIT 1', [id]);
    if (!ls?.[0]) {
      await pool.query(
        `INSERT INTO lessons (course_id, sequence, lesson_type, title, summary, content_html, duration_seconds, is_published, published_at)
         VALUES
          (?, 1, 'video', 'Welcome', 'Course overview', '<p>Welcome lesson.</p>', 420, 1, NOW()),
          (?, 2, 'video', 'Core technique', 'Practice together', '<p>Core technique lesson.</p>', 900, 1, NOW()),
          (?, 3, 'text',  'Recipes & notes', 'Downloadables', '<p>Notes and resources.</p>', NULL, 1, NOW())`,
        [id, id, id],
      );
    }
  }
  return courseIds;
}

async function seedRecipes({ recipeCategoryId }) {
  const items = [
    {
      title: 'Red Velvet Cupcakes',
      slug: 'red-velvet-cupcakes',
      summary: 'Soft cupcakes with tangy frosting.',
      content: '<p>Step-by-step recipe with tips.</p>',
      featured_image_url: '/seed-media/recipe-1.jpg',
    },
    {
      title: 'Chocolate Chip Cookies',
      slug: 'chocolate-chip-cookies',
      summary: 'Crispy edges, chewy middle.',
      content: '<p>Perfect cookies every time.</p>',
      featured_image_url: '/seed-media/recipe-2.jpg',
    },
  ];

  for (const r of items) {
    const [rows] = await pool.query('SELECT id FROM recipes WHERE slug = ? LIMIT 1', [r.slug]);
    let id = rows?.[0]?.id;
    if (!id) {
      const [res] = await pool.query(
        'INSERT INTO recipes (title, slug, summary, content, featured_image_url, is_published, published_at) VALUES (?, ?, ?, ?, ?, 1, NOW())',
        [r.title, r.slug, r.summary, r.content, r.featured_image_url],
      );
      id = res.insertId;
    }
    await pool.query('INSERT IGNORE INTO recipe_categories (recipe_id, category_id) VALUES (?, ?)', [id, recipeCategoryId]);
  }
}

async function seedCms() {
  await pool.query(
    `INSERT INTO site_content (content_key, title, content_json, content_html, is_published)
     VALUES ('homepage', 'Homepage', JSON_OBJECT('hero', JSON_OBJECT('title','Love & Flour','subtitle','Seeded dev content')), NULL, 1)
     ON DUPLICATE KEY UPDATE is_published = 1, updated_at = CURRENT_TIMESTAMP`,
  );
  await pool.query(
    `INSERT INTO site_content (content_key, title, content_json, content_html, is_published)
     VALUES ('about', 'About', JSON_OBJECT('title','About Pooja','body','Seeded about content'), NULL, 1)
     ON DUPLICATE KEY UPDATE is_published = 1, updated_at = CURRENT_TIMESTAMP`,
  );

  const [t] = await pool.query('SELECT id FROM testimonials LIMIT 1');
  if (!t?.[0]) {
    await pool.query(
      `INSERT INTO testimonials (student_name, testimonial_text, avatar_url, is_featured, is_published, sort_order)
       VALUES
        ('Aanya', 'Loved the workshop! Clear explanations and great results.', NULL, 1, 1, 1),
        ('Rohit', 'Best baking class I have taken online.', NULL, 0, 1, 2)`,
    );
  }

  const [f] = await pool.query('SELECT id FROM faqs LIMIT 1');
  if (!f?.[0]) {
    await pool.query(
      `INSERT INTO faqs (category, question, answer_html, is_published, sort_order)
       VALUES
        ('Workshops', 'How do I access my course?', '<p>Login and open Dashboard → Courses.</p>', 1, 1),
        ('Payments', 'Can I get a refund?', '<p>Refunds depend on the policy; contact support.</p>', 1, 2)`,
    );
  }

  const [a] = await pool.query('SELECT id FROM announcements LIMIT 1');
  if (!a?.[0]) {
    await pool.query(
      `INSERT INTO announcements (message, cta_label, cta_url, starts_at, ends_at, is_active)
       VALUES ('Seeded announcement: new workshop this weekend!', 'Browse', '/courses', NOW(), DATE_ADD(NOW(), INTERVAL 7 DAY), 1)`,
    );
  }
}

async function safeQuery(sql, params) {
  try {
    // eslint-disable-next-line no-param-reassign
    params = params ?? [];
    // eslint-disable-next-line no-return-await
    return await pool.query(sql, params);
  } catch (err) {
    // Seeder should be resilient across slightly different schemas in dev DBs.
    if (err?.code === 'ER_NO_SUCH_TABLE' || err?.code === 'ER_BAD_FIELD_ERROR') return null;
    throw err;
  }
}

async function seedCmsExtras() {
  // Gallery
  if (await tableExists('student_gallery')) {
    const [rows] = (await safeQuery('SELECT id FROM student_gallery LIMIT 1')) ?? [];
    if (!rows?.[0]) {
      await safeQuery(
        `INSERT INTO student_gallery (image_url, alt_text, caption, is_featured, is_published, sort_order)
         VALUES
          ('/seed-media/gallery-1.jpg', 'Student bake', 'Seeded gallery photo', 1, 1, 1),
          ('/seed-media/gallery-2.jpg', 'Cupcakes', 'Another seeded gallery photo', 0, 1, 2)`,
      );
    }
  }

  // Newsletter subscribers
  if (await tableExists('newsletter_subscribers')) {
    const [rows] = (await safeQuery('SELECT id FROM newsletter_subscribers LIMIT 1')) ?? [];
    if (!rows?.[0]) {
      await safeQuery(
        `INSERT INTO newsletter_subscribers (email, status)
         VALUES
          ('subscriber.one@example.com','subscribed'),
          ('subscriber.two@example.com','subscribed'),
          ('old.subscriber@example.com','unsubscribed')`,
      );
    }
  }

  // Legal pages
  if (await tableExists('legal_pages')) {
    await safeQuery(
      `INSERT INTO legal_pages (slug, title, content_html, status, version, updated_by)
       VALUES
        ('privacy', 'Privacy Policy', '<p>Seeded privacy policy content.</p>', 'published', 1, NULL),
        ('terms', 'Terms of Service', '<p>Seeded terms content.</p>', 'published', 1, NULL)
       ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP`,
    );
  }

  // SEO meta
  if (await tableExists('seo_meta')) {
    await safeQuery(
      `INSERT INTO seo_meta (page_key, meta_title, meta_description, og_image_url, canonical_url, json_ld, updated_by)
       VALUES
        ('home', 'Love & Flour', 'Seeded SEO for home', NULL, NULL, NULL, NULL),
        ('courses', 'Workshops', 'Seeded SEO for courses', NULL, NULL, NULL, NULL),
        ('about', 'About', 'Seeded SEO for about page', NULL, NULL, NULL, NULL)
       ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP`,
    );
  }

  // Site settings
  if (await tableExists('site_settings')) {
    await safeQuery(
      `INSERT INTO site_settings (setting_key, setting_value_json)
       VALUES
        ('support_email', JSON_OBJECT('value','support@loveandflour.local')),
        ('branding', JSON_OBJECT('primary_color','#c97a4a','secondary_color','#2b2b2b'))
       ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP`,
    );
  }
}

async function seedCommerce({ userId, courseIds }) {
  const [existing] = await pool.query('SELECT id FROM orders LIMIT 1');
  if (existing?.[0]) return;

  const courseId = courseIds[0];
  const [[price]] = await pool.query(
    'SELECT amount_cents FROM course_prices WHERE course_id = ? AND currency = ? AND is_active = 1 ORDER BY id DESC LIMIT 1',
    [courseId, 'INR'],
  );
  const subtotal = Number(price?.amount_cents ?? 99900);
  const total = subtotal;

  // Coupon
  const [cRows] = await pool.query("SELECT id FROM coupons WHERE code = 'WELCOME100' LIMIT 1");
  let couponId = cRows?.[0]?.id;
  if (!couponId) {
    const [cres] = await pool.query(
      "INSERT INTO coupons (code, description, discount_type, discount_value_cents, currency, is_active, starts_at, ends_at) VALUES ('WELCOME100','Seeded dev coupon', 'amount', 10000, 'INR', 1, NOW(), DATE_ADD(NOW(), INTERVAL 90 DAY))",
    );
    couponId = cres.insertId;
  }

  const [ores] = await pool.query(
    `INSERT INTO orders (user_id, status, currency, subtotal_cents, discount_cents, tax_cents, total_cents, coupon_id, coupon_code, billing_name, billing_email, billing_phone)
     VALUES (?, 'paid', 'INR', ?, 0, 0, ?, ?, 'WELCOME100', 'Seed User', 'seed.user@example.com', '9999999999')`,
    [userId, subtotal, total, couponId],
  );
  const orderId = ores.insertId;

  const [[course]] = await pool.query('SELECT title FROM courses WHERE id = ? LIMIT 1', [courseId]);
  await pool.query(
    `INSERT INTO order_items (order_id, item_type, course_id, title, currency, unit_price_cents, quantity, line_subtotal_cents, line_discount_cents, line_tax_cents, line_total_cents)
     VALUES (?, 'course', ?, ?, 'INR', ?, 1, ?, 0, 0, ?)`,
    [orderId, courseId, course?.title ?? 'Course', subtotal, subtotal, subtotal],
  );

  await pool.query(
    `INSERT INTO payments (order_id, provider, provider_order_id, provider_payment_id, status, amount_cents, currency, captured_at, metadata_json)
     VALUES (?, 'razorpay', 'order_seed_1', 'pay_seed_1', 'captured', ?, 'INR', NOW(), JSON_OBJECT('seed', true))`,
    [orderId, total],
  );

  // Enrollment for the purchased course.
  const [enr] = await pool.query('SELECT id FROM enrollments WHERE user_id = ? AND course_id = ? LIMIT 1', [userId, courseId]);
  if (!enr?.[0]) {
    await pool.query(
      `INSERT INTO enrollments (user_id, course_id, enrolled_at, expiry_date, status, payment_reference)
       VALUES (?, ?, NOW(), ?, 'active', ?)`,
      [userId, courseId, daysFromNow(30), `order:${orderId}`],
    );
  }
}

async function seedMoreCommerce({ courseIds }) {
  // Add more orders/enrollments spread across last ~30 days for admin analytics charts.
  const [ordersCount] = await pool.query('SELECT COUNT(*) AS c FROM orders');
  const current = Number(ordersCount?.[0]?.c ?? 0);
  if (current >= 8) return;

  for (let i = current; i < 8; i += 1) {
    const email = `seed.user${i}@example.com`;
    // eslint-disable-next-line no-await-in-loop
    const uid = await upsertUser({ name: `Seed User ${i}`, email, password: 'Password123!', role: 'user' });
    const courseId = courseIds[i % courseIds.length];

    // eslint-disable-next-line no-await-in-loop
    const [[price]] = await pool.query(
      'SELECT amount_cents FROM course_prices WHERE course_id = ? AND currency = ? AND is_active = 1 ORDER BY id DESC LIMIT 1',
      [courseId, 'INR'],
    );
    const subtotal = Number(price?.amount_cents ?? 99900);
    const total = subtotal;

    // Create order
    // eslint-disable-next-line no-await-in-loop
    const [ores] = await pool.query(
      `INSERT INTO orders (user_id, status, currency, subtotal_cents, discount_cents, tax_cents, total_cents, billing_name, billing_email, billing_phone)
       VALUES (?, 'paid', 'INR', ?, 0, 0, ?, ?, ?, '9999999999')`,
      [uid, subtotal, total, `Seed User ${i}`, email],
    );
    const orderId = ores.insertId;

    // eslint-disable-next-line no-await-in-loop
    const [[course]] = await pool.query('SELECT title FROM courses WHERE id = ? LIMIT 1', [courseId]);
    // eslint-disable-next-line no-await-in-loop
    await pool.query(
      `INSERT INTO order_items (order_id, item_type, course_id, title, currency, unit_price_cents, quantity, line_subtotal_cents, line_discount_cents, line_tax_cents, line_total_cents)
       VALUES (?, 'course', ?, ?, 'INR', ?, 1, ?, 0, 0, ?)`,
      [orderId, courseId, course?.title ?? 'Course', subtotal, subtotal, subtotal],
    );

    // Payment captured at varying times
    const daysAgo = Math.max(1, (i + 1) * 3);
    // eslint-disable-next-line no-await-in-loop
    await pool.query(
      `INSERT INTO payments (order_id, provider, provider_order_id, provider_payment_id, status, amount_cents, currency, captured_at, metadata_json)
       VALUES (?, 'razorpay', ?, ?, 'captured', ?, 'INR', DATE_SUB(NOW(), INTERVAL ? DAY), JSON_OBJECT('seed', true))`,
      [orderId, `order_seed_${i}`, `pay_seed_${i}`, total, daysAgo],
    );

    // Enrollment
    // eslint-disable-next-line no-await-in-loop
    await safeQuery(
      `INSERT INTO enrollments (user_id, course_id, enrolled_at, expiry_date, status, payment_reference)
       VALUES (?, ?, DATE_SUB(NOW(), INTERVAL ? DAY), ?, 'active', ?)`,
      [uid, courseId, daysAgo, daysFromNow(30), `order:${orderId}`],
    );

    // Best-effort set created_at for analytics grouping, if column exists.
    // eslint-disable-next-line no-await-in-loop
    await safeQuery('UPDATE orders SET created_at = DATE_SUB(NOW(), INTERVAL ? DAY) WHERE id = ?', [daysAgo, orderId]);
    // eslint-disable-next-line no-await-in-loop
    await safeQuery('UPDATE enrollments SET created_at = DATE_SUB(NOW(), INTERVAL ? DAY) WHERE user_id = ? AND course_id = ?', [
      daysAgo,
      uid,
      courseId,
    ]);
  }
}

async function seedLiveSessions({ courseId }) {
  const [rows] = await pool.query('SELECT id FROM live_sessions LIMIT 1');
  if (!rows?.[0]) {
    const [res] = await pool.query(
      `INSERT INTO live_sessions (course_id, title, zoom_meeting_id, zoom_join_url, scheduled_at, status)
       VALUES (?, 'Seeded Live Session', '1234567890', 'https://example.com/zoom', ?, 'upcoming')`,
      [courseId, daysFromNow(2)],
    );
    const liveSessionId = res.insertId;
    await pool.query(
      `INSERT INTO session_recordings (live_session_id, course_id, recording_url, provider, recorded_at, duration_seconds)
       VALUES (?, ?, 'https://example.com/recording', 'youtube', NOW(), 1800)`,
      [liveSessionId, courseId],
    );
  }
}

async function seedLearningProgress({ userId, courseId }) {
  if (!(await tableExists('user_lesson_progress'))) return;
  if (!(await tableExists('lessons'))) return;

  const [[lesson]] = await pool.query(
    'SELECT id FROM lessons WHERE course_id = ? AND is_published = 1 ORDER BY sort_order ASC, id ASC LIMIT 1',
    [courseId],
  );
  const lessonId = lesson?.id;
  if (!lessonId) return;

  const [existing] = await pool.query(
    'SELECT id FROM user_lesson_progress WHERE user_id = ? AND lesson_id = ? LIMIT 1',
    [userId, lessonId],
  );
  if (existing?.[0]) return;

  await pool.query(
    `INSERT INTO user_lesson_progress (user_id, course_id, lesson_id, started_at, progress_percentage, last_position_seconds, updated_at)
     VALUES (?, ?, ?, NOW(), 35, 420, NOW())`,
    [userId, courseId, lessonId],
  );
}

async function seedNotifications({ userId }) {
  const [rows] = await pool.query('SELECT id FROM user_notifications LIMIT 1');
  if (rows?.[0]) return;
  await pool.query(
    `INSERT INTO user_notifications (user_id, title, message, kind, link_url)
     VALUES
      (?, 'Welcome!', 'Your account is ready. Explore the courses.', 'info', '/courses'),
      (?, 'New workshop added', 'A new workshop was published. Check it out!', 'success', '/courses')`,
    [userId, userId],
  );
}

async function seedSupport({ userId, adminId }) {
  if (!(await tableExists('support_tickets'))) return;
  const [rows] = await pool.query('SELECT id FROM support_tickets LIMIT 1');
  if (rows?.[0]) return;
  const [res] = await pool.query(
    `INSERT INTO support_tickets (user_id, category, subject, status, priority, assigned_admin_id)
     VALUES (?, 'technical', 'Unable to access lesson video', 'open', 'normal', ?)`,
    [userId, adminId],
  );
  const ticketId = res.insertId;
  await pool.query(
    `INSERT INTO support_messages (ticket_id, sender_type, sender_id, message_text)
     VALUES
      (?, 'user', ?, 'Hi! The lesson video is not loading.'),
      (?, 'admin', ?, 'Thanks! Please try refreshing; we are checking on our side.')`,
    [ticketId, userId, ticketId, adminId],
  );
}

async function seedAnalytics({ userId, courseId }) {
  const [rows] = await pool.query('SELECT id FROM analytics_events LIMIT 1');
  if (rows?.[0]) return;
  const sessionId = 'seed-session-1';
  await pool.query(
    `INSERT INTO analytics_events (user_id, event_type, entity_type, entity_id, metadata_json)
     VALUES
      (NULL, 'page_view', NULL, NULL, JSON_OBJECT('session_id', ?,'path','/')),
      (NULL, 'cart_add', 'course', ?, JSON_OBJECT('session_id', ?,'path','/courses')),
      (NULL, 'checkout_started', 'order', NULL, JSON_OBJECT('session_id', ?,'path','/checkout')),
      (?, 'purchase_verified', 'course', ?, JSON_OBJECT('session_id', ?,'path','/order-success'))`,
    [sessionId, courseId, sessionId, sessionId, userId, courseId, sessionId],
  );
}

async function main() {
  if (env.NODE_ENV === 'production') {
    // eslint-disable-next-line no-console
    console.error('Refusing to seed data in production.');
    process.exitCode = 1;
    return;
  }

  await ensureSeedContent();

  const adminId = await upsertUser({
    name: 'Admin',
    email: 'admin@loveandflour.local',
    password: 'Password123!',
    role: 'admin',
  });

  const instructorId = await upsertUser({
    name: 'Instructor',
    email: 'instructor@loveandflour.local',
    password: 'Password123!',
    role: 'instructor',
  });

  const userId = await upsertUser({
    name: 'Seed User',
    email: 'seed.user@example.com',
    password: 'Password123!',
    role: 'user',
  });

  const { courseIds, recipeIds } = await seedCategories();
  const courseCategoryId = courseIds[0];
  const courseIdsSeeded = await seedCourses({ courseCategoryId });
  await seedRecipes({ recipeCategoryId: recipeIds[0] });
  await seedCms();
  await seedCmsExtras();
  await seedCommerce({ userId, courseIds: courseIdsSeeded });
  await seedMoreCommerce({ courseIds: courseIdsSeeded });
  await seedLearningProgress({ userId, courseId: courseIdsSeeded[0] });
  await seedLiveSessions({ courseId: courseIdsSeeded[0] });
  await seedNotifications({ userId });
  await seedSupport({ userId, adminId });
  await seedAnalytics({ userId, courseId: courseIdsSeeded[0] });

  logger.info(
    {
      admin: { email: 'admin@loveandflour.local', password: 'Password123!' },
      instructor: { email: 'instructor@loveandflour.local', password: 'Password123!' },
      user: { email: 'seed.user@example.com', password: 'Password123!' },
    },
    'seed_dev_data_ok',
  );
}

main()
  .catch((err) => {
    logger.error({ err }, 'seed_dev_data_failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await pool.end();
    } catch {
      // ignore
    }
  });
