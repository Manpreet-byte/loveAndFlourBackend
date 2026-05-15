import { pool } from '../config/db.js';

function pickConn(conn) {
  return conn ?? pool;
}

export async function listDiscountRules({ includeInactive = true } = {}, { conn } = {}) {
  const db = pickConn(conn);
  const [rows] = await db.query(
    includeInactive
      ? `SELECT id, min_courses, max_courses, discount_percent, is_active, created_at, updated_at
           FROM discount_rules
       ORDER BY min_courses ASC, id ASC`
      : `SELECT id, min_courses, max_courses, discount_percent, is_active, created_at, updated_at
           FROM discount_rules
          WHERE is_active = 1
       ORDER BY min_courses ASC, id ASC`,
  );
  return rows ?? [];
}

export async function createDiscountRule({ minCourses, maxCourses, discountPercent, isActive = true }, { conn } = {}) {
  const db = pickConn(conn);
  const [res] = await db.query(
    `INSERT INTO discount_rules (min_courses, max_courses, discount_percent, is_active)
     VALUES (?, ?, ?, ?)`,
    [minCourses, maxCourses ?? null, discountPercent, isActive ? 1 : 0],
  );
  return res.insertId;
}

export async function updateDiscountRule({ id, patch }, { conn } = {}) {
  const db = pickConn(conn);
  const fields = [];
  const values = [];
  if (patch.minCourses !== undefined) {
    fields.push('min_courses = ?');
    values.push(patch.minCourses);
  }
  if (patch.maxCourses !== undefined) {
    fields.push('max_courses = ?');
    values.push(patch.maxCourses ?? null);
  }
  if (patch.discountPercent !== undefined) {
    fields.push('discount_percent = ?');
    values.push(patch.discountPercent);
  }
  if (patch.isActive !== undefined) {
    fields.push('is_active = ?');
    values.push(patch.isActive ? 1 : 0);
  }
  if (!fields.length) return;
  values.push(id);
  await db.query(`UPDATE discount_rules SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, values);
}

export async function deleteDiscountRule({ id }, { conn } = {}) {
  const db = pickConn(conn);
  await db.query('DELETE FROM discount_rules WHERE id = ? LIMIT 1', [id]);
}

export async function findBulkDiscountRuleForQty({ qty }, { conn } = {}) {
  const db = pickConn(conn);
  const q = Number(qty);
  const [rows] = await db.query(
    `SELECT id, min_courses, max_courses, discount_percent
       FROM discount_rules
      WHERE is_active = 1
        AND min_courses <= ?
        AND (max_courses IS NULL OR max_courses >= ?)
   ORDER BY min_courses DESC, id DESC
      LIMIT 1`,
    [q, q],
  );
  return rows?.[0] ?? null;
}

