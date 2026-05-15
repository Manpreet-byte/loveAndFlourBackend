import { z } from 'zod';
import { pool } from '../config/db.js';
import { slugify } from '../utils/slug.js';
import { invalidateCategories, invalidatePublicCourses, invalidatePublicRecipes } from '../services/cacheInvalidationService.js';

const categorySchema = z.object({
  type: z.enum(['course', 'recipe', 'workshop']),
  name: z.string().min(1).max(120),
  slug: z.string().max(160).optional().nullable(),
  description: z.string().max(10000).optional().nullable(),
});

export async function createCategory(req, res, next) {
  try {
    const payload = categorySchema.parse(req.body);
    const slug = payload.slug ? slugify(payload.slug) : slugify(payload.name);
    const [result] = await pool.query(
      'INSERT INTO categories (type, name, slug, description) VALUES (?, ?, ?, ?)',
      [payload.type, payload.name, slug, payload.description ?? null],
    );
    await invalidateCategories();
    await invalidatePublicCourses();
    await invalidatePublicRecipes();
    return res.status(201).json({ category: { id: result.insertId, type: payload.type, name: payload.name, slug } });
  } catch (err) {
    return next(err);
  }
}

export async function listCategories(req, res, next) {
  try {
    const type = req.query.type;
    if (type && type !== 'course' && type !== 'recipe' && type !== 'workshop') {
      return res.status(400).json({ error: { message: 'Invalid type' } });
    }
    const source = String(req.query.source ?? '').trim();
    if (source && source.length > 40) {
      return res.status(400).json({ error: { message: 'Invalid source' } });
    }

    const where = [];
    const args = [];
    if (type) {
      where.push('type = ?');
      args.push(type);
    }
    if (source) {
      where.push('source = ?');
      args.push(source);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [rows] = await pool.query(
      `SELECT id, type, name, slug, description
         FROM categories
         ${whereSql}
     ORDER BY type, name ASC`,
      args,
    );
    return res.json({ categories: rows });
  } catch (err) {
    return next(err);
  }
}

export async function deleteCategory(req, res, next) {
  try {
    const categoryId = Number(req.params.id);
    if (!Number.isFinite(categoryId) || categoryId <= 0) {
      return res.status(400).json({ error: { message: 'Invalid category id' } });
    }
    await pool.query('DELETE FROM categories WHERE id = ?', [categoryId]);
    await invalidateCategories();
    await invalidatePublicCourses();
    await invalidatePublicRecipes();
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}
