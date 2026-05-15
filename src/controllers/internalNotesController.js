import { z } from 'zod';
import { pool } from '../config/db.js';

const createSchema = z.object({
  entity_type: z.enum(['course', 'lesson', 'order', 'user', 'ticket']),
  entity_id: z.coerce.number().int().positive(),
  note_text: z.string().trim().min(2).max(8000),
});

export async function createInternalNote(req, res, next) {
  try {
    const adminId = req.user.id;
    const payload = createSchema.parse(req.body ?? {});
    const [result] = await pool.query(
      `INSERT INTO internal_notes (entity_type, entity_id, created_by, note_text)
       VALUES (?, ?, ?, ?)`,
      [payload.entity_type, payload.entity_id, adminId, payload.note_text],
    );
    return res.status(201).json({ id: result.insertId });
  } catch (err) {
    return next(err);
  }
}

export async function listInternalNotes(req, res, next) {
  try {
    const entityType = String(req.query.entity_type ?? '').trim();
    const entityId = Number(req.query.entity_id);
    if (!entityType || !['course', 'lesson', 'order', 'user', 'ticket'].includes(entityType)) {
      return res.status(400).json({ error: { message: 'Invalid entity_type' } });
    }
    if (!Number.isFinite(entityId) || entityId <= 0) return res.status(400).json({ error: { message: 'Invalid entity_id' } });
    const [rows] = await pool.query(
      `SELECT n.id, n.entity_type, n.entity_id, n.note_text, n.created_at, u.name AS created_by_name
         FROM internal_notes n
         JOIN users u ON u.id = n.created_by
        WHERE n.entity_type = ? AND n.entity_id = ?
     ORDER BY n.id DESC
        LIMIT 200`,
      [entityType, entityId],
    );
    return res.json({ notes: rows });
  } catch (err) {
    return next(err);
  }
}

