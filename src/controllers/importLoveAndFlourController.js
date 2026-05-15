import { z } from 'zod';
import { pool } from '../config/db.js';
import { slugify } from '../utils/slug.js';
import { sanitizeBasicHtml } from '../utils/sanitizeHtml.js';
import { invalidateCategories, invalidatePublicCourses } from '../services/cacheInvalidationService.js';

const importSchema = z.object({
  dry_run: z.coerce.boolean().optional().default(false),
  import_workshops: z.coerce.boolean().optional().default(true),
  import_recipes: z.coerce.boolean().optional().default(true),
  limit_workshops: z.coerce.number().int().positive().max(500).optional().nullable(),
  limit_recipes: z.coerce.number().int().positive().max(1000).optional().nullable(),
  filter_workshop_slugs: z.array(z.string().trim().min(1).max(220)).optional().nullable(),
});

const WP_BASE = 'https://loveandflourbypooja.com';
const SOURCE = 'loveandflourbypooja';

function hasWorkshopSignal({ slug, title }) {
  const s = String(slug ?? '').toLowerCase();
  const t = String(title ?? '').toLowerCase();
  return s.includes('workshop') || t.includes('workshop') || t.includes('masterclass');
}

async function fetchJson(url, { timeoutMs = 30000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = new Error(`Fetch failed (${res.status}) for ${url}`);
      err.status = res.status;
      throw err;
    }
    const json = await res.json();
    return { json, headers: res.headers };
  } finally {
    clearTimeout(timeout);
  }
}

function moneyToCents({ price, minorUnit }) {
  const raw = String(price ?? '').trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  // WooCommerce Store API returns price in "minor units" already (e.g., INR minorUnit=2 => "200000" = ₹2000.00)
  if (Number(minorUnit) === 2) return Math.round(n);
  if (Number(minorUnit) === 0) return Math.round(n) * 100;
  return Math.round(n);
}

export async function adminImportLoveAndFlour(req, res, next) {
  try {
    const {
      dry_run: dryRun,
      import_workshops: importWorkshops,
      import_recipes: importRecipes,
      limit_workshops: limitWorkshops,
      limit_recipes: limitRecipes,
      filter_workshop_slugs: filterWorkshopSlugs,
    } = importSchema.parse(req.body ?? {});

    let importedWorkshops = 0;
    let createdWorkshops = 0;
    let updatedWorkshops = 0;
    let createdCategories = 0;
    let pagesFetched = 0;
    let importedRecipes = 0;
    let createdRecipes = 0;
    let updatedRecipes = 0;
    let createdRecipeCategories = 0;

    const perPage = 100;

    if (importWorkshops) {
      let page = 1;
      let remaining = limitWorkshops ?? Infinity;
      const allowedSlugs = Array.isArray(filterWorkshopSlugs) && filterWorkshopSlugs.length ? new Set(filterWorkshopSlugs) : null;
      while (remaining > 0) {
        // eslint-disable-next-line no-await-in-loop
        const { json: products, headers } = await fetchJson(
          `${WP_BASE}/wp-json/wp/v2/product?per_page=${perPage}&page=${page}&_embed=1`,
          { timeoutMs: 45000 },
        );
        pagesFetched += 1;
        if (!Array.isArray(products) || products.length === 0) break;

        const totalPages = Number(headers.get('x-wp-totalpages') ?? '');
        for (const product of products) {
          if (remaining <= 0) break;
          const wpId = Number(product?.id);
          const title = product?.title?.rendered ?? '';
          const wpSlug = product?.slug ?? '';
          const finalSlug = slugify(wpSlug || title);
          if (!wpId) continue;
          // When importing a selected set (from admin preview), allow any product slug.
          // Otherwise, use a conservative heuristic for "workshop-like" items.
          if (!allowedSlugs && !hasWorkshopSignal({ slug: wpSlug, title })) continue;
          if (allowedSlugs && !allowedSlugs.has(finalSlug)) continue;

          remaining -= 1;
          importedWorkshops += 1;

          // eslint-disable-next-line no-await-in-loop
          const { json: storeProduct } = await fetchJson(`${WP_BASE}/wp-json/wc/store/v1/products/${wpId}`, { timeoutMs: 45000 }).catch(
            () => ({ json: null }),
          );

          const featuredMedia = product?._embedded?.['wp:featuredmedia']?.[0] ?? null;
          const featuredImageUrl = featuredMedia?.source_url ?? storeProduct?.images?.[0]?.src ?? null;

          const summaryHtml =
            sanitizeBasicHtml(storeProduct?.short_description ?? '') || sanitizeBasicHtml(product?.excerpt?.rendered ?? '') || null;

          const contentHtml =
            sanitizeBasicHtml(product?.content?.rendered ?? '') || sanitizeBasicHtml(storeProduct?.description ?? '') || null;

          const amountCents = storeProduct?.prices
            ? moneyToCents({ price: storeProduct.prices.price, minorUnit: storeProduct.prices.currency_minor_unit })
            : null;

          const currency = storeProduct?.prices?.currency_code || 'INR';

          // eslint-disable-next-line no-await-in-loop
          const { json: terms } = await fetchJson(`${WP_BASE}/wp-json/wp/v2/product_cat?post=${wpId}&per_page=100`, { timeoutMs: 45000 }).catch(
            () => ({ json: [] }),
          );

          const termList = Array.isArray(terms) ? terms : [];

          if (!dryRun) {
            // Upsert workshop categories.
            for (const t of termList) {
              const name = String(t?.name ?? '').trim();
              if (!name) continue;
              const slug = slugify(String(t?.slug ?? '') || name);
              const description = t?.description ? sanitizeBasicHtml(String(t.description)) : null;
              // eslint-disable-next-line no-await-in-loop
              const externalId = Number(t?.id) || null;
              const [result] = await pool.query(
                `INSERT INTO categories (type, name, slug, description, source, source_external_id)
                 VALUES ('workshop', ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                   name = VALUES(name),
                   description = VALUES(description),
                   source = VALUES(source),
                   source_external_id = VALUES(source_external_id)`,
                [name, slug, description, SOURCE, externalId],
              );
              if (Number(result?.affectedRows ?? 0) === 1) createdCategories += 1;
            }

            // Upsert workshop as a course(kind=workshop) using the WP slug (unique across all courses).
            // eslint-disable-next-line no-await-in-loop
            const [upsert] = await pool.query(
              `INSERT INTO courses (title, slug, kind, summary, content, featured_image_url, is_published, published_at, source, source_external_id)
               VALUES (?, ?, 'workshop', ?, ?, ?, 1, NOW(), ?, ?)
               ON DUPLICATE KEY UPDATE
                 title = VALUES(title),
                 kind = VALUES(kind),
                 summary = VALUES(summary),
                 content = VALUES(content),
                 featured_image_url = VALUES(featured_image_url),
                 is_published = 1,
                 source = VALUES(source),
                 source_external_id = VALUES(source_external_id)`,
              [title, finalSlug, summaryHtml, contentHtml, featuredImageUrl, SOURCE, wpId],
            );

            if (Number(upsert?.affectedRows ?? 0) === 1) createdWorkshops += 1;
            else updatedWorkshops += 1;

            // eslint-disable-next-line no-await-in-loop
            const [[courseRow]] = await pool.query('SELECT id FROM courses WHERE slug = ? LIMIT 1', [finalSlug]);
            const courseId = Number(courseRow?.id);
            if (courseId) {
              if (amountCents != null) {
                // eslint-disable-next-line no-await-in-loop
                await pool.query('UPDATE course_prices SET is_active = 0 WHERE course_id = ?', [courseId]);
                // eslint-disable-next-line no-await-in-loop
                await pool.query(
                  'INSERT INTO course_prices (course_id, currency, amount_cents, is_active) VALUES (?, ?, ?, 1)',
                  [courseId, currency, amountCents],
                );
              }

              // Replace categories for this workshop based on current WP terms.
              // eslint-disable-next-line no-await-in-loop
              await pool.query(
                `DELETE cc
                   FROM course_categories cc
                   JOIN categories cat ON cat.id = cc.category_id
                  WHERE cc.course_id = ? AND cat.type = 'workshop'`,
                [courseId],
              );

              if (termList.length) {
                // eslint-disable-next-line no-await-in-loop
                const [catRows] = await pool.query(
                  `SELECT id, slug
                     FROM categories
                    WHERE type = 'workshop' AND slug IN (?)`,
                  [termList.map((t) => slugify(String(t?.slug ?? '') || String(t?.name ?? ''))).filter(Boolean)],
                );
                const catIds = (catRows ?? []).map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0);
                if (catIds.length) {
                  const values = catIds.map((cid) => [courseId, cid]);
                  // eslint-disable-next-line no-await-in-loop
                  await pool.query('INSERT IGNORE INTO course_categories (course_id, category_id) VALUES ?', [values]);
                }
              }
            }
          }
        }

        if (Number.isFinite(totalPages) && page >= totalPages) break;
        page += 1;
      }
    }

    if (importRecipes) {
      // Discover recipe categories from WP (anything with "recipe" in slug or name).
      let page = 1;
      const recipeCatIds = [];
      const recipeCats = [];
      while (true) {
        // eslint-disable-next-line no-await-in-loop
        const { json: cats, headers } = await fetchJson(`${WP_BASE}/wp-json/wp/v2/categories?per_page=${perPage}&page=${page}`, { timeoutMs: 45000 }).catch(
          () => ({ json: [], headers: new Headers() }),
        );
        pagesFetched += 1;
        const list = Array.isArray(cats) ? cats : [];
        for (const c of list) {
          const name = String(c?.name ?? '').trim();
          const slug = String(c?.slug ?? '').trim();
          if (!name || !slug) continue;
          const hay = `${name} ${slug}`.toLowerCase();
          if (!hay.includes('recipe')) continue;
          recipeCatIds.push(Number(c.id));
          recipeCats.push(c);
        }
        const totalPages = Number(headers.get('x-wp-totalpages') ?? '');
        if (!Number.isFinite(totalPages) || page >= totalPages || !list.length) break;
        page += 1;
      }

      if (!dryRun) {
        // Upsert recipe categories.
        for (const c of recipeCats) {
          const name = String(c?.name ?? '').trim();
          if (!name) continue;
          const slug = slugify(String(c?.slug ?? '') || name);
          const description = c?.description ? sanitizeBasicHtml(String(c.description)) : null;
          // eslint-disable-next-line no-await-in-loop
          const externalId = Number(c?.id) || null;
          const [result] = await pool.query(
            `INSERT INTO categories (type, name, slug, description, source, source_external_id)
             VALUES ('recipe', ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               name = VALUES(name),
               description = VALUES(description),
               source = VALUES(source),
               source_external_id = VALUES(source_external_id)`,
            [name, slug, description, SOURCE, externalId],
          );
          if (Number(result?.affectedRows ?? 0) === 1) createdRecipeCategories += 1;
        }
      }

      // Fetch posts for those categories.
      const seenPostIds = new Set();
      let remaining = limitRecipes ?? Infinity;
      for (const wpCatId of recipeCatIds) {
        if (remaining <= 0) break;
        let p = 1;
        while (remaining > 0) {
          // eslint-disable-next-line no-await-in-loop
          const { json: posts, headers } = await fetchJson(
            `${WP_BASE}/wp-json/wp/v2/posts?per_page=${perPage}&page=${p}&categories=${encodeURIComponent(String(wpCatId))}&_embed=1`,
            { timeoutMs: 45000 },
          ).catch(() => ({ json: [], headers: new Headers() }));
          pagesFetched += 1;
          const list = Array.isArray(posts) ? posts : [];
          if (!list.length) break;

          const totalPages = Number(headers.get('x-wp-totalpages') ?? '');
          for (const post of list) {
            if (remaining <= 0) break;
            const postId = Number(post?.id);
            if (!postId || seenPostIds.has(postId)) continue;
            seenPostIds.add(postId);
            remaining -= 1;

            const title = String(post?.title?.rendered ?? '').trim();
            const wpSlug = String(post?.slug ?? '').trim();
            if (!title || !wpSlug) continue;

            importedRecipes += 1;

            const featuredMedia = post?._embedded?.['wp:featuredmedia']?.[0] ?? null;
            const featuredImageUrl = featuredMedia?.source_url ?? null;
            const summaryHtml = sanitizeBasicHtml(post?.excerpt?.rendered ?? '') || null;
            const contentHtml = sanitizeBasicHtml(post?.content?.rendered ?? '') || null;

            if (!dryRun) {
              // Upsert recipe.
              // eslint-disable-next-line no-await-in-loop
              const slug = slugify(wpSlug);
              const [upsert] = await pool.query(
                `INSERT INTO recipes (title, slug, summary, content, featured_image_url, is_published, published_at, source, source_external_id)
                 VALUES (?, ?, ?, ?, ?, 1, NOW(), ?, ?)
                 ON DUPLICATE KEY UPDATE
                   title = VALUES(title),
                   summary = VALUES(summary),
                   content = VALUES(content),
                   featured_image_url = VALUES(featured_image_url),
                   is_published = 1,
                   source = VALUES(source),
                   source_external_id = VALUES(source_external_id)`,
                [title, slug, summaryHtml, contentHtml, featuredImageUrl, SOURCE, postId],
              );
              if (Number(upsert?.affectedRows ?? 0) === 1) createdRecipes += 1;
              else updatedRecipes += 1;

              // Link categories for this recipe (only recipe-type categories in our DB).
              // eslint-disable-next-line no-await-in-loop
              const [[rRow]] = await pool.query('SELECT id FROM recipes WHERE slug = ? LIMIT 1', [slug]);
              const recipeId = Number(rRow?.id);
              if (recipeId) {
                const wpCatsForPost = Array.isArray(post?.categories) ? post.categories : [];
                const wpSlugs = recipeCats
                  .filter((c) => wpCatsForPost.includes(Number(c.id)))
                  .map((c) => slugify(String(c?.slug ?? '') || String(c?.name ?? '')))
                  .filter(Boolean);

                // eslint-disable-next-line no-await-in-loop
                await pool.query(
                  `DELETE rc
                     FROM recipe_categories rc
                     JOIN categories cat ON cat.id = rc.category_id
                    WHERE rc.recipe_id = ? AND cat.type = 'recipe'`,
                  [recipeId],
                );

                if (wpSlugs.length) {
                  // eslint-disable-next-line no-await-in-loop
                  const [catRows] = await pool.query(
                    `SELECT id
                       FROM categories
                      WHERE type = 'recipe' AND slug IN (?)`,
                    [wpSlugs],
                  );
                  const catIds = (catRows ?? []).map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0);
                  if (catIds.length) {
                    const values = catIds.map((cid) => [recipeId, cid]);
                    // eslint-disable-next-line no-await-in-loop
                    await pool.query('INSERT IGNORE INTO recipe_categories (recipe_id, category_id) VALUES ?', [values]);
                  }
                }
              }
            }
          }

          if (Number.isFinite(totalPages) && p >= totalPages) break;
          p += 1;
        }
      }
    }

    if (!dryRun) {
      await invalidatePublicCourses();
      await invalidateCategories();
    }

    return res.json({
      ok: true,
      dry_run: dryRun,
      pages_fetched: pagesFetched,
      imported_workshops: importedWorkshops,
      created_workshops: createdWorkshops,
      updated_workshops: updatedWorkshops,
      created_workshop_categories: createdCategories,
      imported_recipes: importedRecipes,
      created_recipes: createdRecipes,
      updated_recipes: updatedRecipes,
      created_recipe_categories: createdRecipeCategories,
    });
  } catch (err) {
    return next(err);
  }
}
