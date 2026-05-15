import { pool } from '../config/db.js';
import { cacheWrap } from './cacheService.js';

function clampInt(value, { min, max, fallback }) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function normalizeQuery(q) {
  const s = String(q ?? '').trim().replace(/\s+/g, ' ');
  if (!s) return '';
  return s.slice(0, 120);
}

function makeSnippet(text, maxLen = 160) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return s.length <= maxLen ? s : `${s.slice(0, maxLen - 1)}…`;
}

async function tryFullText(queryFn, fallbackFn) {
  try {
    return await queryFn();
  } catch (err) {
    // Common MySQL error if fulltext index is missing.
    const msg = String(err?.message ?? '');
    if (msg.includes('FULLTEXT') || msg.includes('fulltext') || String(err?.code) === 'ER_TABLE_FULLTEXT_MATCHING_KEY_NOT_FOUND') {
      return await fallbackFn();
    }
    throw err;
  }
}

export async function searchGlobal({ q, page = 1, limit = 20 }) {
  const query = normalizeQuery(q);
  if (!query) return { q: query, page: 1, limit, results: [] };

  const safeLimit = clampInt(limit, { min: 1, max: 20, fallback: 20 });
  const safePage = clampInt(page, { min: 1, max: 1000, fallback: 1 });
  const offset = (safePage - 1) * safeLimit;

  const ft = async () => {
    const [rows] = await pool.query(
      `(
        SELECT 'course' AS type, c.id, c.title, c.slug,
               c.featured_image_url AS thumbnail_url,
               SUBSTRING(COALESCE(c.summary, c.content, ''), 1, 240) AS preview,
               (MATCH(c.title, c.summary, c.content) AGAINST (? IN NATURAL LANGUAGE MODE)) AS score
          FROM courses c
         WHERE c.is_published = 1
           AND MATCH(c.title, c.summary, c.content) AGAINST (? IN NATURAL LANGUAGE MODE)
      )
      UNION ALL
      (
        SELECT 'recipe' AS type, r.id, r.title, r.slug,
               r.featured_image_url AS thumbnail_url,
               SUBSTRING(COALESCE(r.summary, r.content, ''), 1, 240) AS preview,
               (MATCH(r.title, r.summary, r.content) AGAINST (? IN NATURAL LANGUAGE MODE)) AS score
          FROM recipes r
         WHERE r.is_published = 1
           AND MATCH(r.title, r.summary, r.content) AGAINST (? IN NATURAL LANGUAGE MODE)
      )
      UNION ALL
      (
        SELECT 'category' AS type, cat.id, cat.name AS title, cat.slug,
               NULL AS thumbnail_url,
               SUBSTRING(COALESCE(cat.description, ''), 1, 240) AS preview,
               (MATCH(cat.name, cat.description) AGAINST (? IN NATURAL LANGUAGE MODE)) AS score
          FROM categories cat
         WHERE MATCH(cat.name, cat.description) AGAINST (? IN NATURAL LANGUAGE MODE)
      )
      ORDER BY
        (title = ?) DESC,
        score DESC
      LIMIT ?
      OFFSET ?`,
      [query, query, query, query, query, query, query, safeLimit, offset],
    );
    return rows;
  };

  const like = async () => {
    const likeQ = `%${query}%`;
    const [rows] = await pool.query(
      `(
        SELECT 'course' AS type, c.id, c.title, c.slug,
               c.featured_image_url AS thumbnail_url,
               SUBSTRING(COALESCE(c.summary, c.content, ''), 1, 240) AS preview,
               0 AS score
          FROM courses c
         WHERE c.is_published = 1
           AND (c.title LIKE ? OR c.summary LIKE ? OR c.content LIKE ?)
      )
      UNION ALL
      (
        SELECT 'recipe' AS type, r.id, r.title, r.slug,
               r.featured_image_url AS thumbnail_url,
               SUBSTRING(COALESCE(r.summary, r.content, ''), 1, 240) AS preview,
               0 AS score
          FROM recipes r
         WHERE r.is_published = 1
           AND (r.title LIKE ? OR r.summary LIKE ? OR r.content LIKE ?)
      )
      UNION ALL
      (
        SELECT 'category' AS type, cat.id, cat.name AS title, cat.slug,
               NULL AS thumbnail_url,
               SUBSTRING(COALESCE(cat.description, ''), 1, 240) AS preview,
               0 AS score
          FROM categories cat
         WHERE (cat.name LIKE ? OR cat.description LIKE ?)
      )
      ORDER BY (title = ?) DESC, title ASC
      LIMIT ?
      OFFSET ?`,
      [likeQ, likeQ, likeQ, likeQ, likeQ, likeQ, likeQ, likeQ, query, safeLimit, offset],
    );
    return rows;
  };

  const rows = await tryFullText(ft, like);
  const results = rows.map((r) => ({
    type: r.type,
    id: r.id,
    title: r.title,
    slug: r.slug,
    preview: makeSnippet(r.preview, 180),
    thumbnail: r.thumbnail_url ?? null,
  }));

  return { q: query, page: safePage, limit: safeLimit, results };
}

export async function searchCourses({ q, page = 1, limit = 20, categoryId = null, level = null, language = null }) {
  const query = normalizeQuery(q);
  const safeLimit = clampInt(limit, { min: 1, max: 20, fallback: 20 });
  const safePage = clampInt(page, { min: 1, max: 1000, fallback: 1 });
  const offset = (safePage - 1) * safeLimit;

  const filters = {
    level: level ? String(level).trim() : null,
    language: language ? String(language).trim() : null,
    categoryId: categoryId ? Number(categoryId) : null,
  };

  const ft = async () => {
    const where = ['c.is_published = 1'];
    const params = [];
    if (query) {
      where.push('MATCH(c.title, c.summary, c.content) AGAINST (? IN NATURAL LANGUAGE MODE)');
      params.push(query);
    }
    if (filters.level) {
      where.push('c.level = ?');
      params.push(filters.level);
    }
    if (filters.language) {
      where.push('c.language = ?');
      params.push(filters.language);
    }
    if (filters.categoryId) {
      where.push('EXISTS (SELECT 1 FROM course_categories cc WHERE cc.course_id = c.id AND cc.category_id = ?)');
      params.push(filters.categoryId);
    }

    const [rows] = await pool.query(
      `SELECT c.id, c.title, c.slug, c.summary, c.featured_image_url AS thumbnail_url,
              (CASE WHEN ? = '' THEN 0 ELSE MATCH(c.title, c.summary, c.content) AGAINST (? IN NATURAL LANGUAGE MODE) END) AS score
         FROM courses c
        WHERE ${where.join(' AND ')}
     ORDER BY (c.title = ?) DESC, score DESC, COALESCE(c.published_at, c.created_at) DESC
        LIMIT ?
       OFFSET ?`,
      [query, query, ...params, query, safeLimit, offset],
    );
    return rows;
  };

  const like = async () => {
    const likeQ = `%${query}%`;
    const whereLikeParts = ['c.is_published = 1'];
    const params = [];
    if (query) {
      whereLikeParts.push('(c.title LIKE ? OR c.summary LIKE ? OR c.content LIKE ?)');
      params.push(likeQ, likeQ, likeQ);
    }
    if (filters.level) {
      whereLikeParts.push('c.level = ?');
      params.push(filters.level);
    }
    if (filters.language) {
      whereLikeParts.push('c.language = ?');
      params.push(filters.language);
    }
    if (filters.categoryId) {
      whereLikeParts.push('EXISTS (SELECT 1 FROM course_categories cc WHERE cc.course_id = c.id AND cc.category_id = ?)');
      params.push(filters.categoryId);
    }
    const [rows] = await pool.query(
      `SELECT c.id, c.title, c.slug, c.summary, c.featured_image_url AS thumbnail_url, 0 AS score
         FROM courses c
        WHERE ${whereLikeParts.join(' AND ')}
     ORDER BY (c.title = ?) DESC, COALESCE(c.published_at, c.created_at) DESC
        LIMIT ?
       OFFSET ?`,
      [...params, query, safeLimit, offset],
    );
    return rows;
  };

  const rows = query ? await tryFullText(ft, like) : await ft();
  const results = rows.map((r) => ({
    type: 'course',
    id: r.id,
    title: r.title,
    slug: r.slug,
    preview: makeSnippet(r.summary, 180),
    thumbnail: r.thumbnail_url ?? null,
  }));

  return { q: query, page: safePage, limit: safeLimit, results };
}

export async function searchRecipes({ q, page = 1, limit = 20, categoryId = null }) {
  const query = normalizeQuery(q);
  const safeLimit = clampInt(limit, { min: 1, max: 20, fallback: 20 });
  const safePage = clampInt(page, { min: 1, max: 1000, fallback: 1 });
  const offset = (safePage - 1) * safeLimit;

  const filters = {
    categoryId: categoryId ? Number(categoryId) : null,
  };

  const ft = async () => {
    const where = ['r.is_published = 1'];
    const params = [];
    if (query) {
      where.push('MATCH(r.title, r.summary, r.content) AGAINST (? IN NATURAL LANGUAGE MODE)');
      params.push(query);
    }
    if (filters.categoryId) {
      where.push('EXISTS (SELECT 1 FROM recipe_categories rc WHERE rc.recipe_id = r.id AND rc.category_id = ?)');
      params.push(filters.categoryId);
    }

    const [rows] = await pool.query(
      `SELECT r.id, r.title, r.slug, r.summary, r.featured_image_url AS thumbnail_url,
              (CASE WHEN ? = '' THEN 0 ELSE MATCH(r.title, r.summary, r.content) AGAINST (? IN NATURAL LANGUAGE MODE) END) AS score
         FROM recipes r
        WHERE ${where.join(' AND ')}
     ORDER BY (r.title = ?) DESC, score DESC, COALESCE(r.published_at, r.created_at) DESC
        LIMIT ?
       OFFSET ?`,
      [query, query, ...params, query, safeLimit, offset],
    );
    return rows;
  };

  const like = async () => {
    const likeQ = `%${query}%`;
    const whereLikeParts = ['r.is_published = 1'];
    const params = [];
    if (query) {
      whereLikeParts.push('(r.title LIKE ? OR r.summary LIKE ? OR r.content LIKE ?)');
      params.push(likeQ, likeQ, likeQ);
    }
    if (filters.categoryId) {
      whereLikeParts.push('EXISTS (SELECT 1 FROM recipe_categories rc WHERE rc.recipe_id = r.id AND rc.category_id = ?)');
      params.push(filters.categoryId);
    }
    const [rows] = await pool.query(
      `SELECT r.id, r.title, r.slug, r.summary, r.featured_image_url AS thumbnail_url, 0 AS score
         FROM recipes r
        WHERE ${whereLikeParts.join(' AND ')}
     ORDER BY (r.title = ?) DESC, COALESCE(r.published_at, r.created_at) DESC
        LIMIT ?
       OFFSET ?`,
      [...params, query, safeLimit, offset],
    );
    return rows;
  };

  const rows = query ? await tryFullText(ft, like) : await ft();
  const results = rows.map((r) => ({
    type: 'recipe',
    id: r.id,
    title: r.title,
    slug: r.slug,
    preview: makeSnippet(r.summary, 180),
    thumbnail: r.thumbnail_url ?? null,
  }));

  return { q: query, page: safePage, limit: safeLimit, results };
}

export async function searchSuggestions({ q, limit = 10 }) {
  const query = normalizeQuery(q);
  if (!query) return { q: query, suggestions: [] };
  const safeLimit = clampInt(limit, { min: 1, max: 10, fallback: 10 });
  return cacheWrap({
    ns: 'search_suggestions',
    key: `${query}:${safeLimit}`,
    ttlSeconds: 300,
    compute: async () => {
      const prefix = `${query}%`;

      const [courses] = await pool.query(
        `SELECT id, title
           FROM courses
          WHERE is_published = 1 AND title LIKE ?
       ORDER BY (title = ?) DESC, title ASC
          LIMIT ?`,
        [prefix, query, safeLimit],
      );
      const [recipes] = await pool.query(
        `SELECT id, title
           FROM recipes
          WHERE is_published = 1 AND title LIKE ?
       ORDER BY (title = ?) DESC, title ASC
          LIMIT ?`,
        [prefix, query, safeLimit],
      );
      const [categories] = await pool.query(
        `SELECT id, name
           FROM categories
          WHERE name LIKE ?
       ORDER BY (name = ?) DESC, name ASC
          LIMIT ?`,
        [prefix, query, safeLimit],
      );

      const suggestions = [
        ...courses.map((c) => ({ type: 'course', id: c.id, title: c.title })),
        ...recipes.map((r) => ({ type: 'recipe', id: r.id, title: r.title })),
        ...categories.map((c) => ({ type: 'category', id: c.id, title: c.name })),
      ].slice(0, safeLimit * 3);

      return { q: query, suggestions };
    },
  });
}
