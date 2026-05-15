import { z } from 'zod';
import { pool } from '../config/db.js';
import { assertActiveEnrollment } from '../services/accessControlService.js';
import { startLessonForUser, completeLessonForUser } from '../services/learningService.js';

function stripScripts(html) {
  const str = String(html ?? '');
  return str.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
}

export async function offlineSync(req, res, next) {
  try {
    const userId = req.user.id;

    // Courses the user can access (active + verified).
    const [courses] = await pool.query(
      `SELECT e.course_id, e.expiry_date,
              c.title, c.slug, c.summary, c.featured_image_url
         FROM enrollments e
         JOIN courses c ON c.id = e.course_id
        WHERE e.user_id = ?
          AND e.status = 'active'
          AND e.expiry_date >= CURDATE()
     ORDER BY e.expiry_date DESC
        LIMIT 500`,
      [userId],
    );

    const courseIds = courses.map((c) => Number(c.course_id)).filter(Boolean);
    if (!courseIds.length) {
      return res.json({ generated_at: new Date().toISOString(), ttl_seconds: 86400, courses: [], lessons: [] });
    }

    // Lessons payload: safe for offline (no video bytes). Includes text HTML + resource URL.
    const [lessons] = await pool.query(
      `SELECT l.id, l.course_id, l.title, l.summary, l.lesson_type,
              l.content_html, l.resource_url, l.video_url,
              l.sequence_order, l.updated_at
         FROM lessons l
        WHERE l.course_id IN (?)
          AND l.is_published = 1
     ORDER BY l.course_id ASC, l.sequence_order ASC, l.id ASC`,
      [courseIds],
    );

    // Never send video urls for offline payload.
    const safeLessons = lessons.map((l) => ({
      id: l.id,
      course_id: l.course_id,
      title: l.title,
      summary: l.summary,
      lesson_type: l.lesson_type,
      content_html: l.lesson_type === 'text' ? stripScripts(l.content_html) : null,
      resource_url: l.lesson_type === 'resource' ? l.resource_url : null,
      sequence_order: l.sequence_order,
      updated_at: l.updated_at,
    }));

    return res.json({
      generated_at: new Date().toISOString(),
      ttl_seconds: 86400,
      courses,
      lessons: safeLessons,
    });
  } catch (err) {
    return next(err);
  }
}

const progressSchema = z.object({
  events: z
    .array(
      z.object({
        client_event_id: z.string().trim().min(8).max(64),
        type: z.enum(['lesson_start', 'lesson_progress', 'lesson_complete']),
        lesson_id: z.coerce.number().int().positive(),
        progress_percentage: z.coerce.number().int().min(0).max(100).optional().nullable(),
        last_position_seconds: z.coerce.number().int().min(0).max(24 * 60 * 60).optional().nullable(),
        occurred_at: z.string().trim().min(10).max(40).optional().nullable(),
      }),
    )
    .min(1)
    .max(200),
});

export async function offlineProgressSync(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const userId = req.user.id;
    const payload = progressSchema.parse(req.body ?? {});
    const results = [];

    for (const e of payload.events) {
      // eslint-disable-next-line no-await-in-loop
      const [[existing]] = await conn.query(
        `SELECT id FROM offline_progress_events WHERE user_id = ? AND client_event_id = ? LIMIT 1`,
        [userId, e.client_event_id],
      );
      if (existing) {
        results.push({ client_event_id: e.client_event_id, ok: true, duplicate: true });
        // eslint-disable-next-line no-continue
        continue;
      }

      // Make sure enrollment is still valid before accepting offline writes.
      // eslint-disable-next-line no-await-in-loop
      const [lessonRows] = await conn.query(`SELECT course_id FROM lessons WHERE id = ? LIMIT 1`, [e.lesson_id]);
      const courseId = lessonRows?.[0]?.course_id ? Number(lessonRows[0].course_id) : null;
      if (!courseId) {
        results.push({ client_event_id: e.client_event_id, ok: false, error: 'Lesson not found' });
        // eslint-disable-next-line no-continue
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      await assertActiveEnrollment({ userId, courseId }, { conn });

      // Insert idempotency row first; delete it on apply failure to allow retry.
      // eslint-disable-next-line no-await-in-loop
      await conn.query(
        `INSERT INTO offline_progress_events (user_id, client_event_id, event_type, lesson_id, payload_json, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          userId,
          e.client_event_id,
          e.type,
          e.lesson_id,
          JSON.stringify({ progress_percentage: e.progress_percentage ?? null, last_position_seconds: e.last_position_seconds ?? null }),
          e.occurred_at ? new Date(e.occurred_at) : null,
        ],
      );

      try {
        if (e.type === 'lesson_complete') {
          // eslint-disable-next-line no-await-in-loop
          await completeLessonForUser({
            userId,
            lessonId: e.lesson_id,
            auditContext: { ipAddress: req.ip, userAgent: req.headers['user-agent'], method: 'OFFLINE', path: '/api/user/offline-progress-sync' },
          });
        } else {
          // lesson_start / lesson_progress maps to startLessonForUser (progress optional)
          // eslint-disable-next-line no-await-in-loop
          await startLessonForUser({
            userId,
            lessonId: e.lesson_id,
            progressPercentage: e.progress_percentage ?? null,
            lastPositionSeconds: e.last_position_seconds ?? null,
            auditContext: { ipAddress: req.ip, userAgent: req.headers['user-agent'], method: 'OFFLINE', path: '/api/user/offline-progress-sync' },
          });
        }
        results.push({ client_event_id: e.client_event_id, ok: true });
      } catch (err) {
        // Best-effort remove idempotency row to allow retry.
        // eslint-disable-next-line no-await-in-loop
        await conn.query(`DELETE FROM offline_progress_events WHERE user_id = ? AND client_event_id = ?`, [userId, e.client_event_id]);
        results.push({ client_event_id: e.client_event_id, ok: false, error: err?.message ?? 'Failed to apply event' });
      }
    }

    return res.json({ ok: true, results });
  } catch (err) {
    return next(err);
  } finally {
    conn.release();
  }
}
