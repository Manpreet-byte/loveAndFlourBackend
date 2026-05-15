import { z } from 'zod';
import { pool } from '../config/db.js';
import { getRequestAuditContext, logAuditEvent } from '../services/auditLogService.js';
import bcrypt from 'bcrypt';

const createSchema = z.object({
  name: z.string().trim().min(2).max(150),
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(200),
  role: z.enum(['instructor', 'support_agent', 'content_editor', 'admin']).default('instructor'),
  instructor_bio: z.string().trim().max(4000).optional().nullable(),
  instructor_avatar: z.string().trim().max(1024).optional().nullable(),
});

export async function adminListInstructors(_req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, email, role, instructor_status, instructor_bio, instructor_avatar, created_at
         FROM users
        WHERE role IN ('instructor','support_agent','content_editor','admin','super_admin')
     ORDER BY created_at DESC
        LIMIT 500`,
    );
    return res.json({ instructors: rows });
  } catch (err) {
    return next(err);
  }
}

export async function adminCreateInstructor(req, res, next) {
  try {
    const adminId = req.user.id;
    const payload = createSchema.parse(req.body ?? {});
    const passwordHash = await bcrypt.hash(payload.password, 10);

    const [result] = await pool.query(
      `INSERT INTO users (name, email, password, role, instructor_bio, instructor_avatar, instructor_status)
       VALUES (?, ?, ?, ?, ?, ?, 'active')`,
      [payload.name, payload.email, passwordHash, payload.role, payload.instructor_bio ?? null, payload.instructor_avatar ?? null],
    );

    const ctx = getRequestAuditContext(req);
    logAuditEvent({
      actorType: 'admin',
      actorId: adminId,
      actionType: 'instructor.create',
      entityType: 'user',
      entityId: result.insertId,
      metadata: { role: payload.role },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      method: ctx.method,
      path: ctx.path,
      statusCode: 201,
    });

    return res.status(201).json({ id: result.insertId });
  } catch (err) {
    return next(err);
  }
}

const patchSchema = z.object({
  role: z.enum(['super_admin', 'admin', 'instructor', 'support_agent', 'content_editor', 'user']).optional(),
  instructor_status: z.enum(['active', 'suspended']).optional(),
  instructor_bio: z.string().trim().max(4000).nullable().optional(),
  instructor_avatar: z.string().trim().max(1024).nullable().optional(),
});

export async function adminPatchInstructor(req, res, next) {
  try {
    const adminId = req.user.id;
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: { message: 'Invalid user id' } });
    const payload = patchSchema.parse(req.body ?? {});

    const fields = [];
    const values = [];
    for (const [k, v] of Object.entries(payload)) {
      fields.push(`${k} = ?`);
      values.push(v);
    }
    if (!fields.length) return res.json({ ok: true });
    values.push(id);
    await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);

    const ctx = getRequestAuditContext(req);
    logAuditEvent({
      actorType: 'admin',
      actorId: adminId,
      actionType: 'instructor.update',
      entityType: 'user',
      entityId: id,
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

