import { z } from 'zod';
import { withTransaction } from '../utils/dbTx.js';
import { createLesson, deleteLessonById, getLessonById, listLessonsForCourse, reorderLessons, updateLessonById } from '../models/lessonModel.js';
import { invalidatePublicCourses } from '../services/cacheInvalidationService.js';

const createLessonSchema = z.object({
  sequence: z.coerce.number().int().positive().optional().nullable(),
  lesson_type: z.enum(['video', 'text', 'resource']).default('video'),
  title: z.string().min(1).max(255),
  summary: z.string().max(5000).optional().nullable(),
  content_html: z.string().optional().nullable(),
  video_url: z.string().url().max(2048).optional().nullable(),
  resource_url: z.string().url().max(2048).optional().nullable(),
  duration_seconds: z.coerce.number().int().min(0).max(24 * 60 * 60).optional().nullable(),
  is_published: z.coerce.boolean().optional().default(false),
});

export async function createCourseLesson(req, res, next) {
  try {
    const courseId = Number(req.params.id);
    if (!Number.isFinite(courseId) || courseId <= 0) return res.status(400).json({ error: { message: 'Invalid course id' } });
    const payload = createLessonSchema.parse(req.body);

    const lessonId = await withTransaction(async (conn) => {
      // Determine next sequence if not provided.
      let sequence = payload.sequence ?? null;
      if (!sequence) {
        const [rows] = await conn.query('SELECT COALESCE(MAX(sequence), 0) AS max_seq FROM lessons WHERE course_id = ?', [
          courseId,
        ]);
        sequence = Number(rows?.[0]?.max_seq ?? 0) + 1;
      }

      const publishedAt = payload.is_published ? new Date() : null;
      const id = await createLesson(
        {
          courseId,
          sequence,
          lessonType: payload.lesson_type,
          title: payload.title,
          summary: payload.summary ?? null,
          contentHtml: payload.content_html ?? null,
          videoUrl: payload.video_url ?? null,
          resourceUrl: payload.resource_url ?? null,
          durationSeconds: payload.duration_seconds ?? null,
          isPublished: !!payload.is_published,
          publishedAt,
        },
        { conn },
      );
      return id;
    });

    await invalidatePublicCourses();
    return res.status(201).json({ lesson_id: lessonId });
  } catch (err) {
    return next(err);
  }
}

const updateLessonSchema = createLessonSchema.partial();

export async function updateLesson(req, res, next) {
  try {
    const lessonId = Number(req.params.id);
    if (!Number.isFinite(lessonId) || lessonId <= 0) return res.status(400).json({ error: { message: 'Invalid lesson id' } });
    const payload = updateLessonSchema.parse(req.body);

    const fields = [];
    const values = [];
    if (payload.sequence !== undefined) {
      fields.push('sequence = ?');
      values.push(payload.sequence ?? null);
    }
    if (payload.lesson_type !== undefined) {
      fields.push('lesson_type = ?');
      values.push(payload.lesson_type);
    }
    if (payload.title !== undefined) {
      fields.push('title = ?');
      values.push(payload.title);
    }
    if (payload.summary !== undefined) {
      fields.push('summary = ?');
      values.push(payload.summary ?? null);
    }
    if (payload.content_html !== undefined) {
      fields.push('content_html = ?');
      values.push(payload.content_html ?? null);
    }
    if (payload.video_url !== undefined) {
      fields.push('video_url = ?');
      values.push(payload.video_url ?? null);
    }
    if (payload.resource_url !== undefined) {
      fields.push('resource_url = ?');
      values.push(payload.resource_url ?? null);
    }
    if (payload.duration_seconds !== undefined) {
      fields.push('duration_seconds = ?');
      values.push(payload.duration_seconds ?? null);
    }
    if (payload.is_published !== undefined) {
      fields.push('is_published = ?');
      values.push(payload.is_published ? 1 : 0);
      fields.push('published_at = ?');
      values.push(payload.is_published ? new Date() : null);
    }

    const affected = await updateLessonById({ lessonId, fields, values });
    if (!affected) return res.status(404).json({ error: { message: 'Lesson not found' } });
    await invalidatePublicCourses();
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

export async function deleteLesson(req, res, next) {
  try {
    const lessonId = Number(req.params.id);
    if (!Number.isFinite(lessonId) || lessonId <= 0) return res.status(400).json({ error: { message: 'Invalid lesson id' } });
    const affected = await deleteLessonById({ lessonId });
    if (!affected) return res.status(404).json({ error: { message: 'Lesson not found' } });
    await invalidatePublicCourses();
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

const reorderSchema = z.object({
  course_id: z.coerce.number().int().positive(),
  lesson_ids: z.array(z.coerce.number().int().positive()).min(1).max(500),
});

export async function reorderCourseLessons(req, res, next) {
  try {
    const payload = reorderSchema.parse(req.body);
    await withTransaction(async (conn) => {
      await reorderLessons({ courseId: payload.course_id, orderedLessonIds: payload.lesson_ids }, { conn });
    });
    await invalidatePublicCourses();
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

export async function getLessonAdmin(req, res, next) {
  try {
    const lessonId = Number(req.params.id);
    if (!Number.isFinite(lessonId) || lessonId <= 0) return res.status(400).json({ error: { message: 'Invalid lesson id' } });
    const lesson = await getLessonById({ lessonId, includeDrafts: true });
    if (!lesson) return res.status(404).json({ error: { message: 'Lesson not found' } });
    return res.json({ lesson });
  } catch (err) {
    return next(err);
  }
}

export async function listCourseLessonsAdmin(req, res, next) {
  try {
    const courseId = Number(req.params.id);
    if (!Number.isFinite(courseId) || courseId <= 0) return res.status(400).json({ error: { message: 'Invalid course id' } });
    const lessons = await listLessonsForCourse({ courseId, includeDrafts: true });
    return res.json({ course_id: courseId, lessons });
  } catch (err) {
    return next(err);
  }
}
