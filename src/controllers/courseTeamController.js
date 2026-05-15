import { z } from 'zod';
import { pool } from '../config/db.js';
import { getRequestAuditContext, logAuditEvent } from '../services/auditLogService.js';

const addSchema = z.object({
  user_id: z.coerce.number().int().positive(),
  permission_role: z.enum(['course_owner', 'editor', 'moderator', 'viewer']).default('viewer'),
});

export async function addCourseTeamMember(req, res, next) {
  try {
    const adminId = req.user.id;
    const courseId = Number(req.params.id);
    if (!Number.isFinite(courseId) || courseId <= 0) return res.status(400).json({ error: { message: 'Invalid course id' } });
    const payload = addSchema.parse(req.body ?? {});
    await pool.query(
      `INSERT INTO course_team_members (course_id, user_id, permission_role)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE permission_role = VALUES(permission_role)`,
      [courseId, payload.user_id, payload.permission_role],
    );

    const ctx = getRequestAuditContext(req);
    logAuditEvent({
      actorType: 'admin',
      actorId: adminId,
      actionType: 'course_team.add',
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

const patchSchema = z.object({
  permission_role: z.enum(['course_owner', 'editor', 'moderator', 'viewer']),
});

export async function patchCourseTeamMember(req, res, next) {
  try {
    const adminId = req.user.id;
    const courseId = Number(req.params.id);
    const memberId = Number(req.params.memberId);
    if (!Number.isFinite(courseId) || courseId <= 0) return res.status(400).json({ error: { message: 'Invalid course id' } });
    if (!Number.isFinite(memberId) || memberId <= 0) return res.status(400).json({ error: { message: 'Invalid member id' } });
    const payload = patchSchema.parse(req.body ?? {});
    await pool.query(
      `UPDATE course_team_members
          SET permission_role = ?
        WHERE id = ? AND course_id = ?`,
      [payload.permission_role, memberId, courseId],
    );

    const ctx = getRequestAuditContext(req);
    logAuditEvent({
      actorType: 'admin',
      actorId: adminId,
      actionType: 'course_team.update',
      entityType: 'course',
      entityId: courseId,
      metadata: { memberId, ...payload },
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

export async function removeCourseTeamMember(req, res, next) {
  try {
    const adminId = req.user.id;
    const courseId = Number(req.params.id);
    const memberId = Number(req.params.memberId);
    if (!Number.isFinite(courseId) || courseId <= 0) return res.status(400).json({ error: { message: 'Invalid course id' } });
    if (!Number.isFinite(memberId) || memberId <= 0) return res.status(400).json({ error: { message: 'Invalid member id' } });
    await pool.query(`DELETE FROM course_team_members WHERE id = ? AND course_id = ?`, [memberId, courseId]);

    const ctx = getRequestAuditContext(req);
    logAuditEvent({
      actorType: 'admin',
      actorId: adminId,
      actionType: 'course_team.remove',
      entityType: 'course',
      entityId: courseId,
      metadata: { memberId },
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

export async function listCourseTeam(req, res, next) {
  try {
    const courseId = Number(req.params.id);
    if (!Number.isFinite(courseId) || courseId <= 0) return res.status(400).json({ error: { message: 'Invalid course id' } });
    const [rows] = await pool.query(
      `SELECT m.id, m.course_id, m.user_id, m.permission_role, m.created_at, u.name, u.email, u.role
         FROM course_team_members m
         JOIN users u ON u.id = m.user_id
        WHERE m.course_id = ?
     ORDER BY m.id DESC
        LIMIT 500`,
      [courseId],
    );
    return res.json({ members: rows });
  } catch (err) {
    return next(err);
  }
}

