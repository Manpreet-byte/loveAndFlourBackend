import { z } from 'zod';
import { pool } from '../config/db.js';
import { slugify } from '../utils/slug.js';
import { sanitizeBasicHtml } from '../utils/sanitizeHtml.js';
import { invalidatePublicCourses } from '../services/cacheInvalidationService.js';

const seedCourseSchema = z.object({
  slug: z.string().min(1).max(220),
  title: z.string().min(1).max(255),
  excerptHtml: z.string().optional().nullable(),
  contentHtml: z.string().optional().nullable(),
  featuredImage: z.string().url().max(1024).optional().nullable(),
  currency: z.string().length(3).optional().default('INR'),
  amount_cents: z.coerce.number().int().nonnegative().optional().nullable(),
});

const seedCoursesPayloadSchema = z.object({
  courses: z.array(seedCourseSchema).min(1).max(500),
});

export async function adminUpsertSeedCourses(req, res, next) {
  try {
    const payload = seedCoursesPayloadSchema.parse(req.body ?? {});
    const results = [];

    for (const incoming of payload.courses) {
      const slug = slugify(incoming.slug);
      const title = String(incoming.title).trim();
      if (!slug || !title) continue;

      const summary = incoming.excerptHtml != null ? sanitizeBasicHtml(incoming.excerptHtml) : null;
      const content = incoming.contentHtml != null ? sanitizeBasicHtml(incoming.contentHtml) : null;
      const featured = incoming.featuredImage ?? null;

      // eslint-disable-next-line no-await-in-loop
      await pool.query(
        `INSERT INTO courses (title, slug, kind, summary, content, featured_image_url, qa_enabled, is_published, published_at, source)
         VALUES (?, ?, 'workshop', ?, ?, ?, 1, 1, NOW(), 'local')
         ON DUPLICATE KEY UPDATE
           title = VALUES(title),
           kind = VALUES(kind),
           summary = VALUES(summary),
           content = VALUES(content),
           featured_image_url = VALUES(featured_image_url),
           is_published = 1,
           source = VALUES(source)`,
        [title, slug, summary, content, featured,],
      );

      // eslint-disable-next-line no-await-in-loop
      const [[row]] = await pool.query('SELECT id FROM courses WHERE slug = ? LIMIT 1', [slug]);
      const courseId = Number(row?.id ?? 0);
      if (!courseId) continue;

      const currency = String(incoming.currency ?? 'INR').trim().toUpperCase();
      const amountCents = incoming.amount_cents != null ? Number(incoming.amount_cents) : null;

      if (amountCents != null && Number.isFinite(amountCents) && amountCents >= 0) {
        // eslint-disable-next-line no-await-in-loop
        const [[active]] = await pool.query(
          'SELECT id FROM course_prices WHERE course_id = ? AND currency = ? AND is_active = 1 LIMIT 1',
          [courseId, currency],
        );
        if (!active?.id) {
          // eslint-disable-next-line no-await-in-loop
          await pool.query('UPDATE course_prices SET is_active = 0 WHERE course_id = ? AND currency = ?', [courseId, currency]);
          // eslint-disable-next-line no-await-in-loop
          await pool.query(
            'INSERT INTO course_prices (course_id, currency, amount_cents, is_active) VALUES (?, ?, ?, 1)',
            [courseId, currency, amountCents],
          );
        }
      }

      results.push({ id: courseId, slug });
    }

    await invalidatePublicCourses();
    return res.json({ ok: true, upserted: results.length, courses: results });
  } catch (err) {
    return next(err);
  }
}
