import { z } from 'zod';
import { pool } from '../config/db.js';
import { computeCourseExpiryDate } from '../services/enrollmentExpiry.js';
import { enqueueEmail } from '../services/emailOutbox.js';

export async function listUsers(req, res, next) {
  try {
    const [rows] = await pool.query('SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC LIMIT 500');
    return res.json({ users: rows });
  } catch (err) {
    return next(err);
  }
}

const enrollmentSchema = z.object({
  user_id: z.coerce.number().int().positive(),
  course_id: z.coerce.number().int().positive(),
  expiry_date: z.string().date().optional().nullable(),
});

export async function enrollUser(req, res, next) {
  try {
    const payload = enrollmentSchema.parse(req.body);
    const expiry = payload.expiry_date ?? (await computeCourseExpiryDate(payload.course_id));

    const [result] = await pool.query(
      'INSERT INTO enrollments (user_id, course_id, expiry_date, status, payment_reference) VALUES (?, ?, ?, ?, ?)',
      [payload.user_id, payload.course_id, expiry, 'active', `admin:${req.user?.id ?? 'system'}`],
    );

    const [userRows] = await pool.query('SELECT email, name FROM users WHERE id = ? LIMIT 1', [payload.user_id]);
    const user = userRows?.[0];
    if (user?.email) {
      const [sessionRows] = await pool.query(
        `SELECT title, scheduled_at, zoom_join_url
           FROM live_sessions
          WHERE course_id = ?
            AND status IN ('upcoming', 'live')
            AND scheduled_at >= NOW()
            AND zoom_join_url IS NOT NULL
       ORDER BY scheduled_at ASC
          LIMIT 5`,
        [payload.course_id],
      );

      if (sessionRows?.length) {
        const lines = sessionRows.map((session) => `- ${session.title ?? 'Live Session'} | ${session.scheduled_at}\n  ${session.zoom_join_url}`).join('\n');
        await enqueueEmail({
          toEmail: user.email,
          subject: 'Your Zoom access for the enrolled course',
          bodyText: `Hi ${user.name ?? 'there'},\n\nHere are the upcoming Zoom sessions for your enrollment:\n${lines}\n\nYour access remains active until ${expiry}.`,
        });
      }
    }
    return res.status(201).json({ enrollment_id: result.insertId });
  } catch (err) {
    return next(err);
  }
}

export async function removeEnrollment(req, res, next) {
  try {
    const enrollmentId = Number(req.params.id);
    if (!Number.isFinite(enrollmentId) || enrollmentId <= 0) {
      return res.status(400).json({ error: { message: 'Invalid enrollment id' } });
    }
    await pool.query('DELETE FROM enrollments WHERE id = ?', [enrollmentId]);
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

export async function listEnrollments(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT e.id, e.user_id, e.course_id, e.enrolled_at, e.expiry_date, e.status,
              u.email as user_email, c.title as course_title
         FROM enrollments e
         JOIN users u ON u.id = e.user_id
         JOIN courses c ON c.id = e.course_id
     ORDER BY e.enrolled_at DESC
        LIMIT 500`,
    );
    return res.json({ enrollments: rows });
  } catch (err) {
    return next(err);
  }
}
