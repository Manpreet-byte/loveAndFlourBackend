import { z } from 'zod';
import { pool } from '../config/db.js';
import { getRequestAuditContext, logAuditEvent } from '../services/auditLogService.js';
import { slugify } from '../utils/slug.js';
import { invalidateCategories, invalidatePublicRecipes } from '../services/cacheInvalidationService.js';

const createRecipeSchema = z.object({
  title: z.string().min(1).max(255),
  summary: z.string().max(5000).optional().nullable(),
  content: z.string().optional().nullable(),
  featured_image_url: z.string().url().max(1024).optional().nullable(),
  category_ids: z.array(z.coerce.number().int().positive()).default([]),
  is_published: z.coerce.boolean().optional().default(false),
});

export async function createRecipe(req, res, next) {
  try {
    const payload = createRecipeSchema.parse(req.body);
    const slug = slugify(payload.title);
    const publishedAt = payload.is_published ? new Date() : null;

    const [result] = await pool.query(
      'INSERT INTO recipes (title, slug, summary, content, featured_image_url, is_published, published_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        payload.title,
        slug,
        payload.summary ?? null,
        payload.content ?? null,
        payload.featured_image_url ?? null,
        payload.is_published ? 1 : 0,
        publishedAt,
      ],
    );
    const recipeId = result.insertId;

    if (payload.category_ids?.length) {
      const values = payload.category_ids.map((cid) => [recipeId, cid]);
      await pool.query('INSERT IGNORE INTO recipe_categories (recipe_id, category_id) VALUES ?', [values]);
    }

    await invalidatePublicRecipes();
    await invalidateCategories();
    return res.status(201).json({ recipe_id: recipeId, slug });
  } catch (err) {
    return next(err);
  }
}

export async function listRecipes(req, res, next) {
  try {
    const categoryId = req.query.category_id ? Number(req.query.category_id) : null;
    const source = String(req.query.source ?? '').trim();
    if (source && source.length > 40) {
      return res.status(400).json({ error: { message: 'Invalid source' } });
    }

    if (req.query.category_id && (!Number.isFinite(categoryId) || categoryId <= 0)) {
      return res.status(400).json({ error: { message: 'Invalid category_id' } });
    }

    const where = [];
    const args = [];
    if (categoryId) {
      where.push('rc.category_id = ?');
      args.push(categoryId);
    }
    if (source) {
      where.push('r.source = ?');
      args.push(source);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [rows] = await pool.query(
      categoryId
        ? `SELECT r.id, r.title, r.slug, r.summary, r.featured_image_url, r.is_published, r.published_at, r.created_at
             FROM recipes r
             JOIN recipe_categories rc ON rc.recipe_id = r.id
             ${whereSql}
         ORDER BY r.created_at DESC
            LIMIT 200`
        : `SELECT r.id, r.title, r.slug, r.summary, r.featured_image_url, r.is_published, r.published_at, r.created_at
             FROM recipes r
             ${whereSql}
         ORDER BY r.created_at DESC
            LIMIT 200`,
      args,
    );

    return res.json({ recipes: rows });
  } catch (err) {
    return next(err);
  }
}

const updateSchema = createRecipeSchema.partial();

export async function updateRecipe(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: { message: 'Invalid recipe id' } });
    const payload = updateSchema.parse(req.body ?? {});
    const fields = [];
    const values = [];
    const push = (col, value) => {
      fields.push(`${col} = ?`);
      values.push(value);
    };

    if (payload.title !== undefined) {
      push('title', payload.title);
      push('slug', slugify(payload.title));
    }
    if (payload.summary !== undefined) push('summary', payload.summary ?? null);
    if (payload.featured_image_url !== undefined) push('featured_image_url', payload.featured_image_url ?? null);
    if (payload.content !== undefined) push('content', payload.content ?? null);
    if (payload.is_published !== undefined) {
      push('is_published', payload.is_published ? 1 : 0);
      push('published_at', payload.is_published ? new Date() : null);
    }

    if (!fields.length && !Array.isArray(payload.category_ids)) return res.json({ ok: true });

    const [result] = fields.length
      ? await pool.query(`UPDATE recipes SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [...values, id])
      : [{ affectedRows: 1 }];
    if (!result.affectedRows) return res.status(404).json({ error: { message: 'Recipe not found' } });

    if (Array.isArray(payload.category_ids)) {
      await pool.query('DELETE FROM recipe_categories WHERE recipe_id = ?', [id]);
      if (payload.category_ids.length) {
        const values = payload.category_ids.map((cid) => [id, cid]);
        await pool.query('INSERT IGNORE INTO recipe_categories (recipe_id, category_id) VALUES ?', [values]);
      }
    }

    await invalidatePublicRecipes();
    await invalidateCategories();

    logAuditEvent({
      actorType: 'admin',
      actorId: req.user.id,
      actionType: 'RECIPE_UPDATE',
      entityType: 'recipe',
      entityId: id,
      ...getRequestAuditContext(req),
      statusCode: 200,
    });

    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

export async function deleteRecipe(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: { message: 'Invalid recipe id' } });
    const [result] = await pool.query('DELETE FROM recipes WHERE id = ? LIMIT 1', [id]);
    if (!result.affectedRows) return res.status(404).json({ error: { message: 'Recipe not found' } });

    logAuditEvent({
      actorType: 'admin',
      actorId: req.user.id,
      actionType: 'RECIPE_DELETE',
      entityType: 'recipe',
      entityId: id,
      ...getRequestAuditContext(req),
      statusCode: 200,
    });

    await invalidatePublicRecipes();
    await invalidateCategories();
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}
