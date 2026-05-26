import { z } from 'zod';
import { pool } from '../config/db.js';
import { getRequestAuditContext, logAuditEvent } from '../services/auditLogService.js';
import { slugify } from '../utils/slug.js';
import { invalidateCategories, invalidatePublicRecipes } from '../services/cacheInvalidationService.js';

const createRecipeSchema = z.object({
  title: z.string().min(1).max(255),
  summary: z.string().max(5000).optional().nullable(),
  content: z.string().optional().nullable(),
  // Accept explicit structured recipe fields from admin UI
  description: z.string().max(10000).optional().nullable(),
  ingredients: z.union([z.string(), z.array(z.string())]).optional().nullable(),
  instructions: z.union([z.string(), z.array(z.string())]).optional().nullable(),
  notes: z.union([z.string(), z.array(z.string())]).optional().nullable(),
  featured_image_url: z.string().url().max(1024).optional().nullable(),
  category_ids: z.array(z.coerce.number().int().positive()).default([]),
  tag_ids: z.array(z.coerce.number().int().positive()).default([]),
  is_published: z.coerce.boolean().optional().default(false),
  publish_at: z.string().datetime().optional().nullable(),
});

export async function createRecipe(req, res, next) {
  try {
    const payload = createRecipeSchema.parse(req.body);
    const slug = slugify(payload.title);
    const publishAt = payload.publish_at ? new Date(String(payload.publish_at)) : null;
    const publishedAt = payload.is_published ? new Date() : null;

    // If admin provided structured fields, serialize into HTML content for frontend parsing.
    const buildContentFromStructured = (p) => {
      const parts = [];
      if (p.description) parts.push(`<div>${String(p.description)}</div>`);
      if (p.ingredients) {
        const items = Array.isArray(p.ingredients) ? p.ingredients : String(p.ingredients).split(/\r?\n|,/).map(s=>s.trim()).filter(Boolean);
        parts.push('<h3>Ingredients</h3>');
        parts.push('<ul>');
        for (const it of items) parts.push(`<li>${String(it)}</li>`);
        parts.push('</ul>');
      }
      if (p.instructions) {
        const steps = Array.isArray(p.instructions) ? p.instructions : String(p.instructions).split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
        parts.push('<h3>Instructions</h3>');
        parts.push('<ol>');
        for (const st of steps) parts.push(`<li>${String(st)}</li>`);
        parts.push('</ol>');
      }
      if (p.notes) {
        const notes = Array.isArray(p.notes) ? p.notes : String(p.notes).split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
        parts.push('<h3>Notes</h3>');
        for (const n of notes) parts.push(`<p>${String(n)}</p>`);
      }
      return parts.join('\n');
    };

    const structuredContent = buildContentFromStructured(payload);
    const finalContent = structuredContent || payload.content || null;

    const [result] = await pool.query(
      'INSERT INTO recipes (title, slug, summary, content, featured_image_url, is_published, publish_at, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        payload.title,
        slug,
        payload.summary ?? payload.description ?? null,
        finalContent,
        payload.featured_image_url ?? null,
        payload.is_published ? 1 : 0,
        payload.is_published ? null : publishAt,
        publishedAt,
      ],
    );
    const recipeId = result.insertId;

    if (payload.category_ids?.length) {
      const values = payload.category_ids.map((cid) => [recipeId, cid]);
      await pool.query('INSERT IGNORE INTO recipe_categories (recipe_id, category_id) VALUES ?', [values]);
    }

    if (payload.tag_ids?.length) {
      const values = payload.tag_ids.map((tid) => [recipeId, tid]);
      await pool.query('INSERT IGNORE INTO recipe_tags (recipe_id, tag_id) VALUES ?', [values]);
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
        : `SELECT r.id, r.title, r.slug, r.summary, r.featured_image_url, r.is_published, r.publish_at, r.published_at, r.created_at
             FROM recipes r
             ${whereSql}
         ORDER BY r.created_at DESC
            LIMIT 200`,
      args,
    );

    const list = rows ?? [];
    if (!list.length) return res.json({ recipes: [] });

    const ids = list.map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0);
    const [catRows] = await pool.query(
      `SELECT recipe_id, GROUP_CONCAT(category_id ORDER BY category_id ASC) AS category_ids
         FROM recipe_categories
        WHERE recipe_id IN (?)
     GROUP BY recipe_id`,
      [ids],
    );
    const catsByRecipe = new Map();
    for (const r of catRows ?? []) {
      const arr = String(r.category_ids ?? '')
        .split(',')
        .map((v) => Number(v))
        .filter((n) => Number.isFinite(n) && n > 0);
      catsByRecipe.set(Number(r.recipe_id), arr);
    }

    const [tagRows] = await pool.query(
      `SELECT rt.recipe_id, GROUP_CONCAT(rt.tag_id ORDER BY rt.tag_id ASC) AS tag_ids
         FROM recipe_tags rt
        WHERE rt.recipe_id IN (?)
     GROUP BY rt.recipe_id`,
      [ids],
    );
    const tagsByRecipe = new Map();
    for (const r of tagRows ?? []) {
      const arr = String(r.tag_ids ?? '')
        .split(',')
        .map((v) => Number(v))
        .filter((n) => Number.isFinite(n) && n > 0);
      tagsByRecipe.set(Number(r.recipe_id), arr);
    }

    const decorated = list.map((r) => ({
      ...r,
      category_ids: catsByRecipe.get(Number(r.id)) ?? [],
      tag_ids: tagsByRecipe.get(Number(r.id)) ?? [],
    }));
    return res.json({ recipes: decorated });
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
    // If admin provided structured fields, serialize into HTML content for frontend parsing.
    const buildContentFromStructured = (p) => {
      const parts = [];
      if (p.description) parts.push(`<div>${String(p.description)}</div>`);
      if (p.ingredients) {
        const items = Array.isArray(p.ingredients) ? p.ingredients : String(p.ingredients).split(/\r?\n|,/).map(s=>s.trim()).filter(Boolean);
        parts.push('<h3>Ingredients</h3>');
        parts.push('<ul>');
        for (const it of items) parts.push(`<li>${String(it)}</li>`);
        parts.push('</ul>');
      }
      if (p.instructions) {
        const steps = Array.isArray(p.instructions) ? p.instructions : String(p.instructions).split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
        parts.push('<h3>Instructions</h3>');
        parts.push('<ol>');
        for (const st of steps) parts.push(`<li>${String(st)}</li>`);
        parts.push('</ol>');
      }
      if (p.notes) {
        const notes = Array.isArray(p.notes) ? p.notes : String(p.notes).split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
        parts.push('<h3>Notes</h3>');
        for (const n of notes) parts.push(`<p>${String(n)}</p>`);
      }
      return parts.join('\n');
    };

    if (payload.content !== undefined) push('content', payload.content ?? null);
    else if (payload.description || payload.ingredients || payload.instructions || payload.notes) {
      const structured = buildContentFromStructured(payload);
      push('content', structured || null);
    }
    if (payload.summary !== undefined) push('summary', payload.summary ?? null);
    else if (payload.description) push('summary', payload.description ?? null);
    if (payload.is_published !== undefined) {
      push('is_published', payload.is_published ? 1 : 0);
      push('published_at', payload.is_published ? new Date() : null);
    }
    if (payload.publish_at !== undefined) push('publish_at', payload.publish_at ? new Date(String(payload.publish_at)) : null);

    if (!fields.length && !Array.isArray(payload.category_ids) && !Array.isArray(payload.tag_ids)) return res.json({ ok: true });

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

    if (Array.isArray(payload.tag_ids)) {
      await pool.query('DELETE FROM recipe_tags WHERE recipe_id = ?', [id]);
      if (payload.tag_ids.length) {
        const values = payload.tag_ids.map((tid) => [id, tid]);
        await pool.query('INSERT IGNORE INTO recipe_tags (recipe_id, tag_id) VALUES ?', [values]);
      }
    }

    // Invalidate caches so changes appear immediately
    try {
      await invalidatePublicRecipes();
      await invalidateCategories();
    } catch (cacheErr) {
      console.error('[cache invalidation] Failed to invalidate recipe caches:', cacheErr?.message);
      // Continue even if cache invalidation fails - data is updated in DB
    }

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
