import { pool } from '../config/db.js';

export async function listTags({ tagType = 'recipe', limit = 500 } = {}) {
  const [rows] = await pool.query(
    `SELECT id, tag_type, name, slug, created_at
       FROM tags
      WHERE tag_type = ?
   ORDER BY name ASC
      LIMIT ?`,
    [String(tagType), Number(limit)],
  );
  return rows ?? [];
}

export async function createTag({ tagType = 'recipe', name, slug }) {
  const [res] = await pool.query('INSERT INTO tags (tag_type, name, slug) VALUES (?, ?, ?)', [String(tagType), name, slug]);
  return Number(res.insertId);
}

export async function deleteTag({ id }) {
  const [res] = await pool.query('DELETE FROM tags WHERE id = ? LIMIT 1', [Number(id)]);
  return Number(res.affectedRows ?? 0) > 0;
}

