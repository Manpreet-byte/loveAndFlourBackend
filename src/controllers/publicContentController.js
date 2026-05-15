import { pool } from '../config/db.js';
import { cacheWrap } from '../services/cacheService.js';

const IMPORT_SOURCE = 'loveandflourbypooja';

function splitTaxonomyRows(rows, key) {
  return rows
    .map((row) => ({ id: row[`${key}_id`], slug: row[`${key}_slug`], name: row[`${key}_name`] }))
    .filter((item) => item.id);
}

function mapCourseRow(row) {
  const categories = splitTaxonomyRows(row.category_rows ?? [], 'course');
  const priceText = row.amount_cents && row.currency ? `${row.currency} ${(row.amount_cents / 100).toFixed(0)}` : '';
  const contentHtml = row.content ?? row.summary ?? '';
  const excerptHtml = row.summary ?? (row.content ? String(row.content).slice(0, 220) : '');

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    link: `/courses/${row.slug}`,
    featuredImage: row.featured_image_url,
    excerptHtml,
    contentHtml,
    date: row.published_at ?? row.created_at,
    priceText,
    currency: row.currency ?? null,
    amount_cents: row.amount_cents != null ? Number(row.amount_cents) : null,
    compareAtPriceText: '',
    taxonomies: {
      'course-category': categories,
    },
  };
}

function mapRecipeRow(row) {
  const categories = splitTaxonomyRows(row.category_rows ?? [], 'category');
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    link: `/recipes/${row.slug}`,
    featuredImage: row.featured_image_url,
    excerptHtml: row.summary ?? (row.content ? String(row.content).slice(0, 220) : ''),
    contentHtml: row.content ?? '',
    date: row.published_at ?? row.created_at,
    taxonomies: {
      category: categories,
    },
  };
}

export async function listPublicCourses(_req, res, next) {
  try {
    const payload = await cacheWrap({
      ns: 'public_courses',
      key: 'list:v1:kind:workshop:source:loveandflour',
      ttlSeconds: 120,
      compute: async () => {
        const [rows] = await pool.query(
          `SELECT c.id, c.title, c.slug, c.summary, c.content, c.featured_image_url, c.published_at, c.created_at,
                  cp.currency, cp.amount_cents
             FROM courses c
        LEFT JOIN course_prices cp ON cp.course_id = c.id AND cp.is_active = 1
            WHERE c.is_published = 1 AND c.kind = 'workshop' AND c.source = ?
         ORDER BY COALESCE(c.published_at, c.created_at) DESC
            LIMIT 200`,
          [IMPORT_SOURCE],
        );

        if (!rows.length) return { courses: [] };
        const ids = rows.map((r) => r.id);
        const [catRows] = await pool.query(
          `SELECT cc.course_id,
                  cat.id AS category_id, cat.slug AS category_slug, cat.name AS category_name
             FROM course_categories cc
             JOIN categories cat ON cat.id = cc.category_id
            WHERE cc.course_id IN (?) AND cat.type = 'workshop'
         ORDER BY cat.name ASC`,
          [ids],
        );
        const byCourse = new Map();
        for (const r of catRows) {
          const list = byCourse.get(r.course_id) ?? [];
          list.push({ course_id: r.category_id, course_slug: r.category_slug, course_name: r.category_name });
          byCourse.set(r.course_id, list);
        }

        const decorated = rows.map((row) => mapCourseRow({ ...row, category_rows: byCourse.get(row.id) ?? [] }));
        return { courses: decorated };
      },
    });

    return res.json(payload);
  } catch (err) {
    return next(err);
  }
}

export async function getPublicCourseBySlug(req, res, next) {
  try {
    const slug = String(req.params.slug ?? '').trim();
    const payload = await cacheWrap({
      ns: 'public_course_detail',
      key: `slug:${slug}:kind:workshop:source:loveandflour`,
      ttlSeconds: 300,
      compute: async () => {
        const [rows] = await pool.query(
          `SELECT c.id, c.title, c.slug, c.summary, c.content, c.featured_image_url, c.published_at, c.created_at,
                  cp.currency, cp.amount_cents
             FROM courses c
        LEFT JOIN course_prices cp ON cp.course_id = c.id AND cp.is_active = 1
            WHERE c.slug = ? AND c.is_published = 1 AND c.kind = 'workshop' AND c.source = ?
         LIMIT 1`,
          [slug, IMPORT_SOURCE],
        );
        const row = rows?.[0];
        if (!row) return null;

        const [categoryRows] = await pool.query(
          `SELECT cc.category_id AS course_id, cat.slug AS course_slug, cat.name AS course_name
             FROM course_categories cc
             JOIN categories cat ON cat.id = cc.category_id
            WHERE cc.course_id = ? AND cat.type = 'workshop'
         ORDER BY cat.name ASC`,
          [row.id],
        );
        return { course: mapCourseRow({ ...row, category_rows: categoryRows }) };
      },
    });

    if (!payload) return res.status(404).json({ error: { message: 'Course not found' } });
    return res.json(payload);
  } catch (err) {
    return next(err);
  }
}

export async function listPublicWorkshops(_req, res, next) {
  try {
    const payload = await cacheWrap({
      ns: 'public_courses',
      key: 'list:v1:kind:workshop',
      ttlSeconds: 120,
      compute: async () => {
        const [rows] = await pool.query(
          `SELECT c.id, c.title, c.slug, c.summary, c.content, c.featured_image_url, c.published_at, c.created_at,
                  cp.currency, cp.amount_cents
             FROM courses c
        LEFT JOIN course_prices cp ON cp.course_id = c.id AND cp.is_active = 1
            WHERE c.is_published = 1 AND c.kind = 'workshop' AND c.source = ?
         ORDER BY COALESCE(c.published_at, c.created_at) DESC
            LIMIT 200`,
          [IMPORT_SOURCE],
        );

        if (!rows.length) return { workshops: [] };
        const ids = rows.map((r) => r.id);
        const [catRows] = await pool.query(
          `SELECT cc.course_id,
                  cat.id AS category_id, cat.slug AS category_slug, cat.name AS category_name
             FROM course_categories cc
             JOIN categories cat ON cat.id = cc.category_id
            WHERE cc.course_id IN (?) AND cat.type = 'workshop'
         ORDER BY cat.name ASC`,
          [ids],
        );
        const byCourse = new Map();
        for (const r of catRows) {
          const list = byCourse.get(r.course_id) ?? [];
          list.push({ course_id: r.category_id, course_slug: r.category_slug, course_name: r.category_name });
          byCourse.set(r.course_id, list);
        }

        const decorated = rows.map((row) => mapCourseRow({ ...row, category_rows: byCourse.get(row.id) ?? [] }));
        return { workshops: decorated };
      },
    });

    return res.json(payload);
  } catch (err) {
    return next(err);
  }
}

export async function getPublicWorkshopBySlug(req, res, next) {
  try {
    const slug = String(req.params.slug ?? '').trim();
    const payload = await cacheWrap({
      ns: 'public_course_detail',
      key: `slug:${slug}:kind:workshop`,
      ttlSeconds: 300,
      compute: async () => {
        const [rows] = await pool.query(
          `SELECT c.id, c.title, c.slug, c.summary, c.content, c.featured_image_url, c.published_at, c.created_at,
                  cp.currency, cp.amount_cents
             FROM courses c
        LEFT JOIN course_prices cp ON cp.course_id = c.id AND cp.is_active = 1
            WHERE c.slug = ? AND c.is_published = 1 AND c.kind = 'workshop' AND c.source = ?
         LIMIT 1`,
          [slug, IMPORT_SOURCE],
        );
        const row = rows?.[0];
        if (!row) return null;

        const [categoryRows] = await pool.query(
          `SELECT cc.category_id AS course_id, cat.slug AS course_slug, cat.name AS course_name
             FROM course_categories cc
             JOIN categories cat ON cat.id = cc.category_id
            WHERE cc.course_id = ? AND cat.type = 'workshop'
         ORDER BY cat.name ASC`,
          [row.id],
        );
        return { workshop: mapCourseRow({ ...row, category_rows: categoryRows }) };
      },
    });

    if (!payload) return res.status(404).json({ error: { message: 'Workshop not found' } });
    return res.json(payload);
  } catch (err) {
    return next(err);
  }
}

export async function listPublicRecipes(_req, res, next) {
  try {
    const payload = await cacheWrap({
      ns: 'public_recipes',
      key: 'list:v1:source:loveandflour',
      ttlSeconds: 120,
      compute: async () => {
        const [rows] = await pool.query(
          `SELECT r.id, r.title, r.slug, r.summary, r.content, r.featured_image_url, r.published_at, r.created_at
             FROM recipes r
            WHERE r.is_published = 1 AND r.source = ?
         ORDER BY COALESCE(r.published_at, r.created_at) DESC
            LIMIT 200`,
          [IMPORT_SOURCE],
        );

        if (!rows.length) return { recipes: [] };
        const ids = rows.map((r) => r.id);
        const [catRows] = await pool.query(
          `SELECT rc.recipe_id,
                  cat.id AS category_id, cat.slug AS category_slug, cat.name AS category_name
             FROM recipe_categories rc
             JOIN categories cat ON cat.id = rc.category_id
            WHERE rc.recipe_id IN (?) AND cat.type = 'recipe'
         ORDER BY cat.name ASC`,
          [ids],
        );
        const byRecipe = new Map();
        for (const r of catRows) {
          const list = byRecipe.get(r.recipe_id) ?? [];
          list.push({ category_id: r.category_id, category_slug: r.category_slug, category_name: r.category_name });
          byRecipe.set(r.recipe_id, list);
        }

        const decorated = rows.map((row) => mapRecipeRow({ ...row, category_rows: byRecipe.get(row.id) ?? [] }));
        return { recipes: decorated };
      },
    });

    return res.json(payload);
  } catch (err) {
    return next(err);
  }
}

export async function getPublicRecipeBySlug(req, res, next) {
  try {
    const slug = String(req.params.slug ?? '').trim();
    const payload = await cacheWrap({
      ns: 'public_recipe_detail',
      key: `slug:${slug}:source:loveandflour`,
      ttlSeconds: 300,
      compute: async () => {
        const [rows] = await pool.query(
          `SELECT r.id, r.title, r.slug, r.summary, r.content, r.featured_image_url, r.published_at, r.created_at
             FROM recipes r
            WHERE r.slug = ? AND r.is_published = 1 AND r.source = ?
         LIMIT 1`,
          [slug, IMPORT_SOURCE],
        );
        const row = rows?.[0];
        if (!row) return null;

        const [categoryRows] = await pool.query(
          `SELECT rc.category_id AS category_id, cat.slug AS category_slug, cat.name AS category_name
             FROM recipe_categories rc
             JOIN categories cat ON cat.id = rc.category_id
            WHERE rc.recipe_id = ? AND cat.type = 'recipe'
         ORDER BY cat.name ASC`,
          [row.id],
        );
        return { recipe: mapRecipeRow({ ...row, category_rows: categoryRows }) };
      },
    });

    if (!payload) return res.status(404).json({ error: { message: 'Recipe not found' } });
    return res.json(payload);
  } catch (err) {
    return next(err);
  }
}

export async function listPublicCategories(req, res, next) {
  try {
    const type = req.query.type;
    if (type && type !== 'course' && type !== 'recipe' && type !== 'workshop') {
      return res.status(400).json({ error: { message: 'Invalid type' } });
    }

    const payload = await cacheWrap({
      ns: 'public_categories',
      key: `type:${type ?? 'all'}:source:loveandflour`,
      ttlSeconds: 600,
      compute: async () => {
        const [rows] = await pool.query(
          type
            ? 'SELECT id, type, name, slug, description FROM categories WHERE type = ? AND source = ? ORDER BY name ASC'
            : 'SELECT id, type, name, slug, description FROM categories WHERE source = ? ORDER BY type, name ASC',
          type ? [type, IMPORT_SOURCE] : [IMPORT_SOURCE],
        );
        return { categories: rows };
      },
    });

    return res.json(payload);
  } catch (err) {
    return next(err);
  }
}
