import { z } from 'zod';
import { pool } from '../config/db.js';

const WP_BASE = 'https://loveandflourbypooja.com';
const IMPORT_SOURCE = 'loveandflourbypooja';

const previewSchema = z.object({
  include_workshop_groups: z.coerce.boolean().optional().default(true),
  include_recipe_categories: z.coerce.boolean().optional().default(true),
});

async function fetchJson(url, { timeoutMs = 45000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' }, signal: controller.signal });
    if (!res.ok) {
      const err = new Error(`Fetch failed (${res.status}) for ${url}`);
      err.status = res.status;
      throw err;
    }
    const json = await res.json().catch(() => null);
    return { json, headers: res.headers };
  } finally {
    clearTimeout(timeout);
  }
}

async function listAllWpProductCats() {
  const all = [];
  let page = 1;
  const perPage = 100;
  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const { json, headers } = await fetchJson(`${WP_BASE}/wp-json/wp/v2/product_cat?per_page=${perPage}&page=${page}`);
    const list = Array.isArray(json) ? json : [];
    all.push(...list);
    const totalPages = Number(headers.get('x-wp-totalpages') ?? '');
    if (!Number.isFinite(totalPages) || page >= totalPages || list.length === 0) break;
    page += 1;
  }
  return all;
}

async function listWpProductsForProductCatId(productCatId) {
  const all = [];
  let page = 1;
  const perPage = 100;
  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const { json, headers } = await fetchJson(
      `${WP_BASE}/wp-json/wp/v2/product?per_page=${perPage}&page=${page}&product_cat=${encodeURIComponent(String(productCatId))}&_embed=1`,
    );
    const list = Array.isArray(json) ? json : [];
    all.push(...list);
    const totalPages = Number(headers.get('x-wp-totalpages') ?? '');
    if (!Number.isFinite(totalPages) || page >= totalPages || list.length === 0) break;
    page += 1;
  }
  return all;
}

async function listAllWpRecipeCategories() {
  const all = [];
  let page = 1;
  const perPage = 100;
  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const { json, headers } = await fetchJson(`${WP_BASE}/wp-json/wp/v2/categories?per_page=${perPage}&page=${page}`);
    const list = Array.isArray(json) ? json : [];
    all.push(...list);
    const totalPages = Number(headers.get('x-wp-totalpages') ?? '');
    if (!Number.isFinite(totalPages) || page >= totalPages || list.length === 0) break;
    page += 1;
  }
  // heuristic: recipe categories contain "recipe" in slug or name
  return all.filter((c) => {
    const hay = `${String(c?.name ?? '')} ${String(c?.slug ?? '')}`.toLowerCase();
    return hay.includes('recipe');
  });
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function catMatchesGroup(cat, group) {
  const name = normalizeText(cat?.name).toLowerCase();
  const slug = normalizeText(cat?.slug).toLowerCase();
  const hay = `${name} ${slug}`;
  const matchAll = Array.isArray(group?.match_all) ? group.match_all : [];
  const matchAny = Array.isArray(group?.match_any) ? group.match_any : [];
  if (matchAll.length && !matchAll.every((m) => hay.includes(String(m).toLowerCase()))) return false;
  if (matchAny.length && !matchAny.some((m) => hay.includes(String(m).toLowerCase()))) return false;
  return matchAll.length > 0 || matchAny.length > 0;
}

export async function adminPreviewLoveAndFlour(req, res, next) {
  try {
    const { include_workshop_groups: includeWorkshops, include_recipe_categories: includeRecipes } = previewSchema.parse(req.body ?? {});

    const preview = {
      ok: true,
      workshop_groups: [],
      recipe_categories: [],
    };

    const [[localCounts]] = await pool
      .query(
        `SELECT
           (SELECT COUNT(*) FROM courses WHERE kind = 'workshop') AS workshops_total,
           (SELECT COUNT(*) FROM recipes) AS recipes_total,
           (SELECT COUNT(*) FROM categories WHERE type = 'workshop') AS workshop_categories_total,
           (SELECT COUNT(*) FROM categories WHERE type = 'recipe') AS recipe_categories_total,
           (SELECT COUNT(*) FROM courses WHERE kind = 'workshop' AND source = ?) AS workshops_imported,
           (SELECT COUNT(*) FROM recipes WHERE source = ?) AS recipes_imported,
           (SELECT COUNT(*) FROM categories WHERE type = 'workshop' AND source = ?) AS workshop_categories_imported,
           (SELECT COUNT(*) FROM categories WHERE type = 'recipe' AND source = ?) AS recipe_categories_imported`,
        [IMPORT_SOURCE, IMPORT_SOURCE, IMPORT_SOURCE, IMPORT_SOURCE],
      )
      .catch(() => [[{}]]);

    preview.local_counts = localCounts ?? {};

    if (includeWorkshops) {
      const desiredGroups = [
        { key: 'online_workshops', label: 'Online workshops', match_all: ['online', 'workshop'] },
        { key: 'upcoming_live_workshops', label: 'Upcoming live workshops', match_any: ['upcoming live', 'live session', 'live workshop', 'live'] },
        { key: 'ebooks', label: 'Ebooks', match_any: ['ebook', 'e-book', 'e book'] },
        { key: 'recorded_live_workshops', label: 'Recorded live workshops', match_any: ['recorded live', 'recorded'] },
        { key: 'hands_on_classes', label: 'Hands on classes', match_any: ['hands-on classes', 'hands on classes', 'hands-on', 'hands on'] },
      ];

      const cats = await listAllWpProductCats();
      const candidates = desiredGroups.map((g) => ({
        group: g,
        cats: cats.filter((cat) => catMatchesGroup(cat, g)),
      }));

      for (const c of candidates) {
        if (!c.cats.length) {
          preview.workshop_groups.push({
            key: c.group.key,
            label: c.group.label,
            product_cat: null,
            product_cats: [],
            missing_on_source: true,
            remote_products: [],
          });
          continue;
        }

        const bySlug = new Map();
        for (const cat of c.cats) {
          // eslint-disable-next-line no-await-in-loop
          const products = await listWpProductsForProductCatId(cat.id);
          for (const p of products) {
            const featuredMedia = p?._embedded?.['wp:featuredmedia']?.[0] ?? null;
            const item = {
              wp_id: Number(p.id),
              slug: normalizeText(p.slug),
              title: normalizeText(p?.title?.rendered),
              permalink: normalizeText(p?.link),
              featured_image_url: normalizeText(featuredMedia?.source_url ?? ''),
              modified_gmt: p?.modified_gmt ?? null,
            };
            if (item.slug && !bySlug.has(item.slug)) bySlug.set(item.slug, item);
          }
        }

        const remote = Array.from(bySlug.values());

        // eslint-disable-next-line no-await-in-loop
        const [localRows] = await pool.query(
          `SELECT slug, source, source_external_id
             FROM courses
            WHERE kind = 'workshop' AND (source = ? OR source_external_id IS NOT NULL)`,
          [IMPORT_SOURCE],
        );
        const localSlugs = new Set((localRows ?? []).map((r) => String(r.slug)));
        const missing = remote.filter((r) => r.slug && !localSlugs.has(r.slug));

        preview.workshop_groups.push({
          key: c.group.key,
          label: c.group.label,
          product_cat: c.cats[0]?.id ? { id: Number(c.cats[0].id), name: c.cats[0].name, slug: c.cats[0].slug } : null,
          product_cats: c.cats.map((cat) => ({ id: Number(cat.id), name: cat.name, slug: cat.slug })),
          remote_total: remote.length,
          missing_total: missing.length,
          missing,
        });
      }
    }

    if (includeRecipes) {
      const cats = await listAllWpRecipeCategories();
      const [localCatRows] = await pool.query(`SELECT slug FROM categories WHERE type = 'recipe' AND source = ?`, [IMPORT_SOURCE]);
      const localSlugs = new Set((localCatRows ?? []).map((r) => String(r.slug)));
      preview.recipe_categories = cats.map((c) => ({
        wp_id: Number(c.id),
        name: normalizeText(c.name),
        slug: normalizeText(c.slug),
        count: Number(c.count ?? 0),
        missing: !localSlugs.has(normalizeText(c.slug)),
      }));
    }

    return res.json(preview);
  } catch (err) {
    return next(err);
  }
}
