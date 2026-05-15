import { z } from 'zod';
import { pool } from '../config/db.js';
import { getRequestAuditContext, logAuditEvent } from '../services/auditLogService.js';

const statusSchema = z.object({
  workflow_status: z.enum(['draft', 'under_review', 'approved', 'published', 'archived']),
  note_text: z.string().trim().max(8000).optional().nullable(),
});

export async function adminSetCourseWorkflowStatus(req, res, next) {
  try {
    const adminId = req.user.id;
    const courseId = Number(req.params.id);
    if (!Number.isFinite(courseId) || courseId <= 0) return res.status(400).json({ error: { message: 'Invalid course id' } });
    const payload = statusSchema.parse(req.body ?? {});

    // Keep is_published backward compatible
    const isPublished = payload.workflow_status === 'published' ? 1 : 0;
    const approvedAt = payload.workflow_status === 'approved' || payload.workflow_status === 'published' ? new Date() : null;
    const approvedBy = payload.workflow_status === 'approved' || payload.workflow_status === 'published' ? adminId : null;

    await pool.query(
      `UPDATE courses
          SET workflow_status = ?, is_published = ?, published_at = IF(?, COALESCE(published_at, NOW()), published_at),
              approved_at = ?, approved_by = ?
        WHERE id = ?`,
      [payload.workflow_status, isPublished, isPublished, approvedAt, approvedBy, courseId],
    );

    if (payload.note_text) {
      await pool.query(
        `INSERT INTO course_review_feedback (course_id, created_by, status, note_text)
         VALUES (?, ?, 'comment', ?)`,
        [courseId, adminId, payload.note_text],
      );
    }

    const ctx = getRequestAuditContext(req);
    logAuditEvent({
      actorType: 'admin',
      actorId: adminId,
      actionType: 'course.workflow_status',
      entityType: 'course',
      entityId: courseId,
      metadata: payload,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      method: ctx.method,
      path: ctx.path,
      statusCode: 200,
    });

    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

const feedbackSchema = z.object({
  status: z.enum(['comment', 'requested_changes', 'approved', 'rejected']).default('comment'),
  note_text: z.string().trim().min(2).max(8000),
});

export async function adminAddCourseFeedback(req, res, next) {
  try {
    const adminId = req.user.id;
    const courseId = Number(req.params.id);
    if (!Number.isFinite(courseId) || courseId <= 0) return res.status(400).json({ error: { message: 'Invalid course id' } });
    const payload = feedbackSchema.parse(req.body ?? {});
    const [result] = await pool.query(
      `INSERT INTO course_review_feedback (course_id, created_by, status, note_text)
       VALUES (?, ?, ?, ?)`,
      [courseId, adminId, payload.status, payload.note_text],
    );
    return res.status(201).json({ id: result.insertId });
  } catch (err) {
    return next(err);
  }
}

export async function adminListCourseFeedback(req, res, next) {
  try {
    const courseId = Number(req.params.id);
    if (!Number.isFinite(courseId) || courseId <= 0) return res.status(400).json({ error: { message: 'Invalid course id' } });
    const [rows] = await pool.query(
      `SELECT f.id, f.status, f.note_text, f.created_at, u.name AS created_by_name
         FROM course_review_feedback f
         JOIN users u ON u.id = f.created_by
        WHERE f.course_id = ?
     ORDER BY f.id DESC
        LIMIT 200`,
      [courseId],
    );
    return res.json({ feedback: rows });
  } catch (err) {
    return next(err);
  }
}

