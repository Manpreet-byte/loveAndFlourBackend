import { z } from 'zod';
import { pool } from '../config/db.js';
import { assertActiveEnrollment } from '../services/accessControlService.js';
import { textToHtml } from '../utils/textToHtml.js';
import { createCourseQuestion, deleteCourseQuestion, getCourseQuestionById, listCourseQuestions, updateCourseQuestion } from '../models/courseQuestionModel.js';
import { createReply, listRepliesForQuestion } from '../models/questionReplyModel.js';

// This controller exposes "helpdesk/Q&A spec" endpoints while reusing the existing Q&A tables.

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  cursor: z.coerce.number().int().positive().optional().nullable(),
});

export async function listQuestionsByCourse(req, res, next) {
  try {
    const userId = req.user.id;
    const courseId = Number(req.params.courseId);
    if (!Number.isFinite(courseId) || courseId <= 0) return res.status(400).json({ error: { message: 'Invalid course id' } });
    const { limit, cursor } = listSchema.parse(req.query);
    await assertActiveEnrollment({ userId, courseId });
    const data = await listCourseQuestions({ courseId, limit: limit ?? 20, cursor: cursor ?? null });
    return res.json({ questions: data.questions ?? [], next_cursor: data.next_cursor ?? null });
  } catch (err) {
    return next(err);
  }
}

const createSchema = z.object({
  course_id: z.coerce.number().int().positive(),
  lesson_id: z.coerce.number().int().positive().optional().nullable(),
  title: z.string().trim().min(3).max(255),
  body: z.string().trim().min(3).max(8000),
});

export async function createQuestion(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const userId = req.user.id;
    const payload = createSchema.parse(req.body ?? {});
    await assertActiveEnrollment({ userId, courseId: payload.course_id }, { conn });
    await conn.beginTransaction();
    const id = await createCourseQuestion(
      {
        courseId: payload.course_id,
        userId,
        lessonId: payload.lesson_id ?? null,
        title: payload.title,
        bodyHtml: textToHtml(payload.body),
      },
      { conn },
    );
    await conn.commit();
    const question = await getCourseQuestionById({ id });
    return res.status(201).json({ question });
  } catch (err) {
    try { await conn.rollback(); } catch {}
    return next(err);
  } finally {
    conn.release();
  }
}

const idSchema = z.object({ id: z.coerce.number().int().positive() });

export async function getQuestion(req, res, next) {
  try {
    const userId = req.user.id;
    const { id } = idSchema.parse(req.params);
    const question = await getCourseQuestionById({ id });
    if (!question) return res.status(404).json({ error: { message: 'Question not found' } });
    await assertActiveEnrollment({ userId, courseId: Number(question.course_id) });
    const replies = await listRepliesForQuestion({ questionId: id });
    return res.json({ question, replies });
  } catch (err) {
    return next(err);
  }
}

const replySchema = z.object({ body: z.string().trim().min(2).max(8000) });

export async function postReply(req, res, next) {
  try {
    const userId = req.user.id;
    const isAdmin = String(req.user.role ?? '') === 'admin';
    const { id } = idSchema.parse(req.params);
    const payload = replySchema.parse(req.body ?? {});
    const question = await getCourseQuestionById({ id });
    if (!question) return res.status(404).json({ error: { message: 'Question not found' } });
    await assertActiveEnrollment({ userId, courseId: Number(question.course_id) });
    await createReply({ questionId: id, userId, isAdminReply: isAdmin, bodyHtml: textToHtml(payload.body) });

    // If admin replied, mark as answered (non-breaking; status enum includes answered).
    if (isAdmin) {
      await updateCourseQuestion({ id, userId, isAdmin: true, status: 'answered' });
    }

    const replies = await listRepliesForQuestion({ questionId: id });
    return res.status(201).json({ replies });
  } catch (err) {
    return next(err);
  }
}

const patchSchema = z.object({
  title: z.string().trim().min(3).max(255).optional(),
  body: z.string().trim().min(3).max(8000).optional(),
});

export async function patchQuestion(req, res, next) {
  try {
    const userId = req.user.id;
    const isAdmin = String(req.user.role ?? '') === 'admin';
    const { id } = idSchema.parse(req.params);
    const payload = patchSchema.parse(req.body ?? {});
    const existing = await getCourseQuestionById({ id });
    if (!existing) return res.status(404).json({ error: { message: 'Question not found' } });
    await assertActiveEnrollment({ userId, courseId: Number(existing.course_id) });
    await updateCourseQuestion({
      id,
      userId,
      isAdmin,
      title: payload.title,
      bodyHtml: payload.body !== undefined ? textToHtml(payload.body) : undefined,
    });
    const question = await getCourseQuestionById({ id });
    return res.json({ question });
  } catch (err) {
    return next(err);
  }
}

const statusSchema = z.object({ status: z.enum(['open', 'answered', 'resolved', 'closed']) });

export async function patchQuestionStatus(req, res, next) {
  try {
    const userId = req.user.id;
    const isAdmin = String(req.user.role ?? '') === 'admin';
    const { id } = idSchema.parse(req.params);
    const payload = statusSchema.parse(req.body ?? {});
    const existing = await getCourseQuestionById({ id });
    if (!existing) return res.status(404).json({ error: { message: 'Question not found' } });
    await assertActiveEnrollment({ userId, courseId: Number(existing.course_id) });
    // Only admins can close; users can resolve their own.
    if (!isAdmin && payload.status === 'closed') return res.status(403).json({ error: { message: 'Forbidden' } });
    await updateCourseQuestion({ id, userId, isAdmin, status: payload.status });
    const question = await getCourseQuestionById({ id });
    return res.json({ question });
  } catch (err) {
    return next(err);
  }
}

export async function removeQuestion(req, res, next) {
  try {
    const userId = req.user.id;
    const isAdmin = String(req.user.role ?? '') === 'admin';
    const { id } = idSchema.parse(req.params);
    const existing = await getCourseQuestionById({ id });
    if (!existing) return res.status(404).json({ error: { message: 'Question not found' } });
    await assertActiveEnrollment({ userId, courseId: Number(existing.course_id) });
    await deleteCourseQuestion({ id, userId, isAdmin });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

