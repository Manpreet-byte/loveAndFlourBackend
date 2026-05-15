import { z } from 'zod';
import { pool } from '../config/db.js';
import { assertActiveEnrollment } from '../services/accessControlService.js';
import { textToHtml } from '../utils/textToHtml.js';
import { getRequestAuditContext, logAuditEvent } from '../services/auditLogService.js';
import { createCourseQuestion, deleteCourseQuestion, getCourseQuestionById, listCourseQuestions, updateCourseQuestion } from '../models/courseQuestionModel.js';
import { createReply, deleteReply, listRepliesForQuestion } from '../models/questionReplyModel.js';

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  cursor: z.coerce.number().int().positive().optional().nullable(),
});

const courseIdSchema = z.object({ courseId: z.coerce.number().int().positive() });

export async function listQuestions(req, res, next) {
  try {
    const userId = req.user.id;
    const { courseId } = courseIdSchema.parse(req.params);
    const { limit, cursor } = listSchema.parse(req.query);
    await assertActiveEnrollment({ userId, courseId });
    const data = await listCourseQuestions({ courseId, limit: limit ?? 20, cursor: cursor ?? null });

    // Fetch a small preview of latest replies (no N+1).
    const questionIds = (data.questions ?? []).map((q) => Number(q.id)).filter(Boolean);
    let repliesByQuestion = new Map();
    if (questionIds.length) {
      const [rows] = await pool.query(
        `SELECT r.id, r.question_id, r.user_id, r.body_html, r.is_pinned, r.created_at, u.name AS author_name
           FROM question_replies r
           JOIN users u ON u.id = r.user_id
          WHERE r.question_id IN (?)
       ORDER BY r.question_id ASC, r.is_pinned DESC, r.id DESC`,
        [questionIds],
      );
      repliesByQuestion = new Map();
      for (const row of rows) {
        const qid = Number(row.question_id);
        if (!repliesByQuestion.has(qid)) repliesByQuestion.set(qid, []);
        const list = repliesByQuestion.get(qid);
        if (list.length < 3) list.push(row);
      }
    }

    const questions = (data.questions ?? []).map((q) => ({
      ...q,
      latest_replies: repliesByQuestion.get(Number(q.id)) ?? [],
    }));

    return res.json({ questions, next_cursor: data.next_cursor ?? null });
  } catch (err) {
    return next(err);
  }
}

const createSchema = z.object({
  title: z.string().trim().min(3).max(255),
  body_text: z.string().trim().min(3).max(8000),
  lesson_id: z.coerce.number().int().positive().optional().nullable(),
});

export async function createQuestion(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const userId = req.user.id;
    const isAdmin = String(req.user.role ?? '') === 'admin';
    const { courseId } = courseIdSchema.parse(req.params);
    const payload = createSchema.parse(req.body ?? {});
    await assertActiveEnrollment({ userId, courseId }, { conn });
    await conn.beginTransaction();

    const id = await createCourseQuestion(
      {
        courseId,
        userId,
        lessonId: payload.lesson_id ?? null,
        title: payload.title,
        bodyHtml: textToHtml(payload.body_text),
      },
      { conn },
    );

    const ctx = getRequestAuditContext(req);
    logAuditEvent({
      actorType: isAdmin ? 'admin' : 'user',
      actorId: userId,
      actionType: 'course_question.create',
      entityType: 'course_question',
      entityId: id,
      metadata: { courseId, lessonId: payload.lesson_id ?? null },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      method: ctx.method,
      path: ctx.path,
      statusCode: 201,
    });

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

const questionIdSchema = z.object({ id: z.coerce.number().int().positive() });
const updateSchema = z.object({
  title: z.string().trim().min(3).max(255).optional(),
  body_text: z.string().trim().min(3).max(8000).optional(),
  status: z.enum(['open', 'resolved']).optional(),
});

export async function patchQuestion(req, res, next) {
  try {
    const userId = req.user.id;
    const isAdmin = String(req.user.role ?? '') === 'admin';
    const { id } = questionIdSchema.parse(req.params);
    const payload = updateSchema.parse(req.body ?? {});
    const existing = await getCourseQuestionById({ id });
    if (!existing) return res.status(404).json({ error: { message: 'Question not found' } });
    await assertActiveEnrollment({ userId, courseId: Number(existing.course_id) });

    await updateCourseQuestion(
      {
        id,
        userId,
        isAdmin,
        title: payload.title,
        bodyHtml: payload.body_text !== undefined ? textToHtml(payload.body_text) : undefined,
        status: payload.status,
      },
    );
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
    const { id } = questionIdSchema.parse(req.params);
    const existing = await getCourseQuestionById({ id });
    if (!existing) return res.status(404).json({ error: { message: 'Question not found' } });
    await assertActiveEnrollment({ userId, courseId: Number(existing.course_id) });

    await deleteCourseQuestion({ id, userId, isAdmin });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

const replySchema = z.object({
  body_text: z.string().trim().min(2).max(8000),
});

export async function listReplies(req, res, next) {
  try {
    const userId = req.user.id;
    const { id } = questionIdSchema.parse(req.params);
    const question = await getCourseQuestionById({ id });
    if (!question) return res.status(404).json({ error: { message: 'Question not found' } });
    await assertActiveEnrollment({ userId, courseId: Number(question.course_id) });
    const replies = await listRepliesForQuestion({ questionId: id });
    return res.json({ question, replies });
  } catch (err) {
    return next(err);
  }
}

export async function createQuestionReply(req, res, next) {
  try {
    const userId = req.user.id;
    const isAdmin = String(req.user.role ?? '') === 'admin';
    const { id } = questionIdSchema.parse(req.params);
    const question = await getCourseQuestionById({ id });
    if (!question) return res.status(404).json({ error: { message: 'Question not found' } });
    await assertActiveEnrollment({ userId, courseId: Number(question.course_id) });
    const payload = replySchema.parse(req.body ?? {});
    const replyId = await createReply({ questionId: id, userId, isAdminReply: isAdmin, bodyHtml: textToHtml(payload.body_text) });
    const replies = await listRepliesForQuestion({ questionId: id });
    return res.status(201).json({ reply_id: replyId, replies });
  } catch (err) {
    return next(err);
  }
}

const replyIdSchema = z.object({ id: z.coerce.number().int().positive() });

export async function removeReply(req, res, next) {
  try {
    const userId = req.user.id;
    const isAdmin = String(req.user.role ?? '') === 'admin';
    const { id } = replyIdSchema.parse(req.params);
    await deleteReply({ id, userId, isAdmin });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}
