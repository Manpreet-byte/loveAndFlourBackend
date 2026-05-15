import { z } from 'zod';
import { pool } from '../config/db.js';
import { getCourseLessonsForUser, startLessonForUser, completeLessonForUser, getCourseProgressForUser, parseStartPayload } from '../services/learningService.js';
import { getRequestAuditContext } from '../services/auditLogService.js';
import { isSchemaMismatchError } from '../utils/dbErrors.js';

const courseIdSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export async function listMyCoursesWithProgress(req, res, next) {
  try {
    const userId = req.user.id;
    const includeExpired = String(req.query.include_expired ?? '').trim() === '1';
    const includeInactive = String(req.query.include_inactive ?? '').trim() === '1';
    let rows = [];
    try {
      const [result] = await pool.query(
        `SELECT e.course_id, e.expiry_date, e.status,
                c.title, c.slug, c.summary, c.featured_image_url,
                (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id AND l.is_published = 1) AS total_lessons,
                (SELECT COUNT(*)
                   FROM user_lesson_progress ulp
                   JOIN lessons l2 ON l2.id = ulp.lesson_id
                  WHERE ulp.user_id = ? AND ulp.course_id = c.id AND ulp.completed_at IS NOT NULL AND l2.is_published = 1) AS completed_lessons
           FROM enrollments e
           JOIN courses c ON c.id = e.course_id
          WHERE e.user_id = ?
            ${includeInactive ? '' : "AND e.status = 'active'"}
            ${includeExpired ? '' : 'AND e.expiry_date >= CURDATE()'}
       ORDER BY e.expiry_date DESC
          LIMIT 500`,
        [userId, userId],
      );
      rows = result ?? [];
    } catch (err) {
      if (!isSchemaMismatchError(err)) throw err;
      return res.json({ courses: [] });
    }

    const courses = rows.map((r) => {
      const total = Number(r.total_lessons ?? 0);
      const completed = Number(r.completed_lessons ?? 0);
      const progressPercentage = total === 0 ? 0 : Math.floor((completed / total) * 100);
      return {
        course_id: r.course_id,
        title: r.title,
        slug: r.slug,
        summary: r.summary,
        featured_image_url: r.featured_image_url,
        expiry_date: r.expiry_date,
        enrollment_status: r.status,
        progress: { total_lessons: total, completed_lessons: completed, progress_percentage: progressPercentage, is_completed: total > 0 && completed >= total },
      };
    });

    return res.json({ courses });
  } catch (err) {
    return next(err);
  }
}

export async function listCourseLessons(req, res, next) {
  try {
    const userId = req.user.id;
    const { id } = courseIdSchema.parse(req.params);
    const lessons = await getCourseLessonsForUser({ userId, courseId: id });
    return res.json({ course_id: id, lessons });
  } catch (err) {
    return next(err);
  }
}

const lessonIdSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export async function startLesson(req, res, next) {
  try {
    const userId = req.user.id;
    const { id } = lessonIdSchema.parse(req.params);
    const payload = parseStartPayload(req.body);
    const result = await startLessonForUser({
      userId,
      lessonId: id,
      progressPercentage: payload.progress_percentage ?? null,
      lastPositionSeconds: payload.last_position_seconds ?? null,
      auditContext: getRequestAuditContext(req),
    });
    return res.json({ ok: true, course_id: result.courseId });
  } catch (err) {
    return next(err);
  }
}

export async function completeLesson(req, res, next) {
  try {
    const userId = req.user.id;
    const { id } = lessonIdSchema.parse(req.params);
    const result = await completeLessonForUser({ userId, lessonId: id, auditContext: getRequestAuditContext(req) });
    return res.json({ ok: true, course_id: result.courseId, progress: result.summary });
  } catch (err) {
    return next(err);
  }
}

export async function getCourseProgress(req, res, next) {
  try {
    const userId = req.user.id;
    const courseId = Number(req.params.courseId);
    if (!Number.isFinite(courseId) || courseId <= 0) return res.status(400).json({ error: { message: 'Invalid course id' } });
    const result = await getCourseProgressForUser({ userId, courseId });
    return res.json({ course_id: courseId, summary: result.summary, lesson_progress: result.progress });
  } catch (err) {
    return next(err);
  }
}
