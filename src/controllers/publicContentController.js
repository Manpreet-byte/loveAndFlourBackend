import { pool } from '../config/db.js';
import { cacheWrap } from '../services/cacheService.js';
import { computeEffectivePriceCents, getDefaultCurrency } from '../services/pricingService.js';

const IMPORT_SOURCE = 'loveandflourbypooja';

function splitTaxonomyRows(rows, key) {
  return rows
    .map((row) => ({ id: row[`${key}_id`], slug: row[`${key}_slug`], name: row[`${key}_name`] }))
    .filter((item) => item.id);
}

function mapCourseRow(row) {
  const categories = splitTaxonomyRows(row.category_rows ?? [], 'course');
  const effectiveCents = row.amount_cents && row.currency ? computeEffectivePriceCents(row) : 0;
  const priceText = effectiveCents && row.currency ? `${row.currency} ${(effectiveCents / 100).toFixed(0)}` : '';
  const compareAtPriceText =
    row.compare_at_amount_cents && row.currency && Number(row.compare_at_amount_cents) > Number(effectiveCents)
      ? `${row.currency} ${(Number(row.compare_at_amount_cents) / 100).toFixed(0)}`
      : '';
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
    amount_cents: effectiveCents ? Number(effectiveCents) : row.amount_cents != null ? Number(row.amount_cents) : null,
    compareAtPriceText,
    qa_enabled: row.qa_enabled != null ? Boolean(row.qa_enabled) : true,
    taxonomies: {
      'course-category': categories,
    },
  };
}

function mapRecipeRow(row) {
  const categories = splitTaxonomyRows(row.category_rows ?? [], 'category');
  const tags = splitTaxonomyRows(row.tag_rows ?? [], 'tag');
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    link: `/recipes/${row.slug}`,
    featuredImage: row.featured_image_url,
    excerptHtml: row.summary ?? (row.content ? String(row.content).slice(0, 220) : ''),
    contentHtml: row.content ?? '',
    date: row.published_at ?? row.created_at,
    tags,
    taxonomies: {
      category: categories,
    },
  };
}

export async function listPublicCourses(_req, res, next) {
  try {
    const currency = String(_req.query?.currency ?? '').trim().toUpperCase();
    const selectedCurrency = currency && currency.length === 3 ? currency : await getDefaultCurrency();
    const payload = await cacheWrap({
      ns: 'public_courses',
      key: `list:v1:kind:workshop:source:loveandflour:cur:${selectedCurrency}`,
      ttlSeconds: 120,
      compute: async () => {
        const [rows] = await pool.query(
          `SELECT c.id, c.title, c.slug, c.summary, c.content, c.featured_image_url, c.published_at, c.created_at,
                  c.qa_enabled, cp.currency, cp.amount_cents, cp.compare_at_amount_cents, cp.sale_amount_cents, cp.sale_starts_at, cp.sale_ends_at
             FROM courses c
        LEFT JOIN course_prices cp ON cp.course_id = c.id AND cp.is_active = 1 AND cp.currency = ?
            WHERE c.is_published = 1 AND c.kind = 'workshop' AND (c.source = ? OR c.source = 'local')
          ORDER BY COALESCE(c.published_at, c.created_at) DESC
            LIMIT 200`,
          [selectedCurrency, IMPORT_SOURCE],
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
    const currency = String(req.query?.currency ?? '').trim().toUpperCase();
    const selectedCurrency = currency && currency.length === 3 ? currency : await getDefaultCurrency();
    const payload = await cacheWrap({
      ns: 'public_course_detail',
      key: `slug:${slug}:kind:workshop:source:loveandflour:cur:${selectedCurrency}`,
      ttlSeconds: 300,
      compute: async () => {
        const [rows] = await pool.query(
          `SELECT c.id, c.title, c.slug, c.summary, c.content, c.featured_image_url, c.published_at, c.created_at,
                  c.qa_enabled, cp.currency, cp.amount_cents, cp.compare_at_amount_cents, cp.sale_amount_cents, cp.sale_starts_at, cp.sale_ends_at
             FROM courses c
        LEFT JOIN course_prices cp ON cp.course_id = c.id AND cp.is_active = 1 AND cp.currency = ?
            WHERE c.slug = ? AND c.is_published = 1 AND c.kind = 'workshop' AND (c.source = ? OR c.source = 'local')
         LIMIT 1`,
          [selectedCurrency, slug, IMPORT_SOURCE],
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
    const currency = String(_req.query?.currency ?? '').trim().toUpperCase();
    const selectedCurrency = currency && currency.length === 3 ? currency : await getDefaultCurrency();
    const payload = await cacheWrap({
      ns: 'public_courses',
      key: `list:v1:kind:workshop:cur:${selectedCurrency}`,
      ttlSeconds: 120,
      compute: async () => {
        const [rows] = await pool.query(
          `SELECT c.id, c.title, c.slug, c.summary, c.content, c.featured_image_url, c.published_at, c.created_at,
                  c.qa_enabled, cp.currency, cp.amount_cents, cp.compare_at_amount_cents, cp.sale_amount_cents, cp.sale_starts_at, cp.sale_ends_at
             FROM courses c
        LEFT JOIN course_prices cp ON cp.course_id = c.id AND cp.is_active = 1 AND cp.currency = ?
            WHERE c.is_published = 1 AND c.kind = 'workshop' AND (c.source = ? OR c.source = 'local')
          ORDER BY COALESCE(c.published_at, c.created_at) DESC
            LIMIT 200`,
          [selectedCurrency, IMPORT_SOURCE],
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
    const currency = String(req.query?.currency ?? '').trim().toUpperCase();
    const selectedCurrency = currency && currency.length === 3 ? currency : await getDefaultCurrency();
    const payload = await cacheWrap({
      ns: 'public_course_detail',
      key: `slug:${slug}:kind:workshop:cur:${selectedCurrency}`,
      ttlSeconds: 300,
      compute: async () => {
        const [rows] = await pool.query(
          `SELECT c.id, c.title, c.slug, c.summary, c.content, c.featured_image_url, c.published_at, c.created_at,
                  c.qa_enabled, cp.currency, cp.amount_cents, cp.compare_at_amount_cents, cp.sale_amount_cents, cp.sale_starts_at, cp.sale_ends_at
             FROM courses c
        LEFT JOIN course_prices cp ON cp.course_id = c.id AND cp.is_active = 1 AND cp.currency = ?
            WHERE c.slug = ? AND c.is_published = 1 AND c.kind = 'workshop' AND (c.source = ? OR c.source = 'local')
         LIMIT 1`,
          [selectedCurrency, slug, IMPORT_SOURCE],
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
            WHERE r.is_published = 1 AND (r.source = ? OR r.source = 'local')
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

        const [tagRows] = await pool.query(
          `SELECT rt.recipe_id,
                  t.id AS tag_id, t.slug AS tag_slug, t.name AS tag_name
             FROM recipe_tags rt
             JOIN tags t ON t.id = rt.tag_id
            WHERE rt.recipe_id IN (?) AND t.tag_type = 'recipe'
         ORDER BY t.name ASC`,
          [ids],
        );
        const tagsByRecipe = new Map();
        for (const r of tagRows) {
          const list = tagsByRecipe.get(r.recipe_id) ?? [];
          list.push({ tag_id: r.tag_id, tag_slug: r.tag_slug, tag_name: r.tag_name });
          tagsByRecipe.set(r.recipe_id, list);
        }

        const decorated = rows.map((row) => mapRecipeRow({ ...row, category_rows: byRecipe.get(row.id) ?? [], tag_rows: tagsByRecipe.get(row.id) ?? [] }));
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
            WHERE r.slug = ? AND r.is_published = 1 AND (r.source = ? OR r.source = 'local')
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
        const [tagRows] = await pool.query(
          `SELECT t.id AS tag_id, t.slug AS tag_slug, t.name AS tag_name
             FROM recipe_tags rt
             JOIN tags t ON t.id = rt.tag_id
            WHERE rt.recipe_id = ? AND t.tag_type = 'recipe'
         ORDER BY t.name ASC`,
          [row.id],
        );
        return { recipe: mapRecipeRow({ ...row, category_rows: categoryRows, tag_rows: tagRows }) };
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
