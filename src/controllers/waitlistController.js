import { z } from 'zod';
import { pool } from '../config/db.js';

const schema = z.object({
  course_id: z.coerce.number().int().positive(),
});

export async function joinWaitlist(req, res, next) {
  try {
    const userId = req.user.id;
    const payload = schema.parse(req.body ?? {});
    const [res1] = await pool.query('INSERT IGNORE INTO waitlist_signups (user_id, course_id) VALUES (?, ?)', [
      userId,
      payload.course_id,
    ]);
    return res.status(201).json({ ok: true, created: Number(res1?.affectedRows ?? 0) > 0 });
  } catch (err) {
    return next(err);
  }
}

