import { z } from 'zod';
import { pool } from '../config/db.js';
import { assertActiveEnrollment } from '../services/accessControlService.js';
import { textToHtml } from '../utils/textToHtml.js';
import { createLessonComment, deleteLessonComment, listLessonComments } from '../models/lessonCommentModel.js';

const lessonIdSchema = z.object({ lessonId: z.coerce.number().int().positive() });
const createSchema = z.object({ body_text: z.string().trim().min(2).max(8000) });
const deleteSchema = z.object({ id: z.coerce.number().int().positive() });

export async function listComments(req, res, next) {
  try {
    const userId = req.user.id;
    const { lessonId } = lessonIdSchema.parse(req.params);
    const [rows] = await pool.query(`SELECT course_id FROM lessons WHERE id = ? LIMIT 1`, [lessonId]);
    const courseId = rows?.[0]?.course_id ? Number(rows[0].course_id) : null;
    if (!courseId) return res.status(404).json({ error: { message: 'Lesson not found' } });
    await assertActiveEnrollment({ userId, courseId });
    const comments = await listLessonComments({ lessonId });
    return res.json({ lesson_id: lessonId, comments });
  } catch (err) {
    return next(err);
  }
}

export async function createComment(req, res, next) {
  try {
    const userId = req.user.id;
    const { lessonId } = lessonIdSchema.parse(req.params);
    const payload = createSchema.parse(req.body ?? {});
    const [rows] = await pool.query(`SELECT course_id FROM lessons WHERE id = ? LIMIT 1`, [lessonId]);
    const courseId = rows?.[0]?.course_id ? Number(rows[0].course_id) : null;
    if (!courseId) return res.status(404).json({ error: { message: 'Lesson not found' } });
    await assertActiveEnrollment({ userId, courseId });
    const id = await createLessonComment({ lessonId, courseId, userId, bodyHtml: textToHtml(payload.body_text) });
    const comments = await listLessonComments({ lessonId });
    return res.status(201).json({ comment_id: id, comments });
  } catch (err) {
    return next(err);
  }
}

export async function removeComment(req, res, next) {
  try {
    const userId = req.user.id;
    const isAdmin = String(req.user.role ?? '') === 'admin';
    const { id } = deleteSchema.parse(req.params);
    await deleteLessonComment({ id, userId, isAdmin });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

