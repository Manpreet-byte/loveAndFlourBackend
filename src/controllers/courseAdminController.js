import { z } from 'zod';
import { pool } from '../config/db.js';
import { slugify } from '../utils/slug.js';
import { toMysqlDatetime } from '../utils/datetime.js';
import { invalidateCategories, invalidatePublicCourses } from '../services/cacheInvalidationService.js';
import { enqueuePushForUsers } from '../services/push/pushOutboxService.js';
import { sanitizeBasicHtml } from '../utils/sanitizeHtml.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeStructuredLines(value) {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '').trim()).filter(Boolean);
  }
  return String(value)
    .split(/\r?\n|\s*,\s*/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildBulletSection(title, value) {
  const items = normalizeStructuredLines(value);
  if (!items.length) return '';
  const body = items.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  return `<section><h3>${escapeHtml(title)}</h3><ul>${body}</ul></section>`;
}

function buildWorkshopContentFromStructured(payload) {
  const parts = [];
  const description = String(payload.description ?? '').trim();
  const singleImageUrl = String(payload.single_image_url ?? '').trim();
  const carouselImages = normalizeStructuredLines(payload.carousel_images).filter(Boolean);

  if (description) {
    parts.push(`<section><p>${escapeHtml(description)}</p></section>`);
  }

  if (singleImageUrl) {
    parts.push(
      `<section><figure><img src="${escapeHtml(singleImageUrl)}" alt="${escapeHtml(payload.title ?? 'Workshop image')}" /></figure></section>`,
    );
  }

  if (carouselImages.length) {
    const gallery = carouselImages
      .map((src, index) => `<figure><img src="${escapeHtml(src)}" alt="${escapeHtml(`${payload.title ?? 'Workshop'} image ${index + 1}`)}" /></figure>`)
      .join('');
    parts.push(`<section data-gallery="1">${gallery}</section>`);
  }

  parts.push(buildBulletSection('What You Get', payload.what_you_get));
  parts.push(buildBulletSection('Special Collaboration', payload.special_collaboration));
  parts.push(buildBulletSection("What You’ll Learn", payload.what_you_learn));
  parts.push(buildBulletSection('Menu with Description', payload.menu_items));
  parts.push(buildBulletSection('BONUS LEARNING', payload.bonus_learning));
  parts.push(buildBulletSection('Who This Workshop Is For', payload.who_this_workshop_is_for));

  return parts.filter(Boolean).join('\n');
}

const createCourseSchema = z.object({
  kind: z.enum(['course', 'workshop']).optional(),
  title: z.string().min(1).max(255),
  summary: z.string().max(5000).optional().nullable(),
  content: z.string().optional().nullable(),
  description: z.string().max(10000).optional().nullable(),
  single_image_url: z.string().url().max(1024).optional().nullable(),
  carousel_images: z.union([z.string(), z.array(z.string())]).optional().nullable(),
  what_you_get: z.union([z.string(), z.array(z.string())]).optional().nullable(),
  special_collaboration: z.union([z.string(), z.array(z.string())]).optional().nullable(),
  what_you_learn: z.union([z.string(), z.array(z.string())]).optional().nullable(),
  menu_items: z.union([z.string(), z.array(z.string())]).optional().nullable(),
  bonus_learning: z.union([z.string(), z.array(z.string())]).optional().nullable(),
  who_this_workshop_is_for: z.union([z.string(), z.array(z.string())]).optional().nullable(),
  featured_image_url: z.string().url().max(1024).optional().nullable(),
  category_ids: z.array(z.coerce.number().int().positive()).default([]),
  qa_enabled: z.coerce.boolean().optional().default(true),
  is_published: z.coerce.boolean().optional().default(true),
  publish_at: z.string().datetime().optional().nullable(),
  price: z
    .object({
      currency: z.string().length(3).default('INR'),
      amount_cents: z.coerce.number().int().nonnegative(),
      compare_at_amount_cents: z.coerce.number().int().nonnegative().optional().nullable(),
      sale_amount_cents: z.coerce.number().int().nonnegative().optional().nullable(),
      sale_starts_at: z.string().datetime().optional().nullable(),
      sale_ends_at: z.string().datetime().optional().nullable(),
    })
    .optional()
    .nullable(),
  scheduled_at: z.string().datetime().optional().nullable(),
  zoom_meeting_id: z.string().max(64).optional().nullable(),
  zoom_join_url: z.string().url().max(2048).optional().nullable(),
});

const updateCourseSchema = createCourseSchema.partial().extend({
  is_published: z.coerce.boolean().optional(),
});

export async function createCourse(req, res, next) {
  try {
    const payload = createCourseSchema.parse(req.body);
    const kind = payload.kind ?? 'course';
    const cleanedSummary = payload.summary != null ? sanitizeBasicHtml(payload.summary) : null;
    const cleanedContent = payload.content != null ? sanitizeBasicHtml(payload.content) : null;
    const structuredContent = kind === 'workshop' ? sanitizeBasicHtml(buildWorkshopContentFromStructured(payload)) : null;
    const slug = slugify(payload.title);
    const isPublished = Boolean(payload.is_published);
    const publishedAt = isPublished ? new Date() : null;
    const publishAt = !isPublished && payload.publish_at ? toMysqlDatetime(payload.publish_at) : null;
    const finalContent = [structuredContent, cleanedContent].filter(Boolean).join('\n') || null;

    const [result] = await pool.query(
      'INSERT INTO courses (title, slug, kind, summary, content, featured_image_url, qa_enabled, is_published, publish_at, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        payload.title,
        slug,
        kind,
        cleanedSummary ?? payload.description ?? null,
        finalContent,
        payload.featured_image_url ?? null,
        payload.qa_enabled ? 1 : 0,
        isPublished ? 1 : 0,
        publishAt,
        publishedAt,
      ],
    );

    const courseId = result.insertId;

    if (payload.price && payload.price.amount_cents !== undefined) {
      await pool.query(
        'INSERT INTO course_prices (course_id, currency, amount_cents, compare_at_amount_cents, sale_amount_cents, sale_starts_at, sale_ends_at, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
        [
          courseId,
          (payload.price.currency ?? 'INR').toUpperCase(),
          payload.price.amount_cents,
          payload.price.compare_at_amount_cents ?? null,
          payload.price.sale_amount_cents ?? null,
          payload.price.sale_starts_at ? toMysqlDatetime(payload.price.sale_starts_at) : null,
          payload.price.sale_ends_at ? toMysqlDatetime(payload.price.sale_ends_at) : null,
        ],
      );
    }

    if (payload.category_ids?.length) {
      const values = payload.category_ids.map((cid) => [courseId, cid]);
      await pool.query('INSERT IGNORE INTO course_categories (course_id, category_id) VALUES ?', [values]);
    }

    if (payload.scheduled_at) {
      const scheduledAt = toMysqlDatetime(payload.scheduled_at);
      if (!scheduledAt) return res.status(400).json({ error: { message: 'Invalid scheduled_at' } });
      await pool.query(
        'INSERT INTO live_sessions (course_id, title, scheduled_at, status, zoom_meeting_id, zoom_join_url) VALUES (?, ?, ?, ?, ?, ?)',
        [
          courseId,
          `${payload.title} - Live Session`,
          scheduledAt,
          'upcoming',
          payload.zoom_meeting_id ?? null,
          payload.zoom_join_url ?? null,
        ],
      );
    }

    await invalidatePublicCourses();
    await invalidateCategories();
    return res.status(201).json({ course_id: courseId, slug });
  } catch (err) {
    return next(err);
  }
}

export async function listCourses(req, res, next) {
  try {
    const kind = String(req.query.kind ?? '').trim();
    if (kind && kind !== 'course' && kind !== 'workshop') {
      return res.status(400).json({ error: { message: 'Invalid kind' } });
    }
    const currency = String(req.query.currency ?? '').trim().toUpperCase();
    if (currency && currency.length !== 3) return res.status(400).json({ error: { message: 'Invalid currency' } });
    const source = String(req.query.source ?? '').trim();
    if (source && source.length > 40) {
      return res.status(400).json({ error: { message: 'Invalid source' } });
    }
    const where = [];
    const args = [];
    if (kind) {
      where.push('c.kind = ?');
      args.push(kind);
    }
    if (source) {
      where.push('c.source = ?');
      args.push(source);
    }
    const joinCurrency = currency || 'INR';
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [rows] = await pool.query(
      `SELECT c.id, c.title, c.slug, c.summary, c.content, c.featured_image_url, c.is_published, c.published_at, c.created_at, c.updated_at,
              c.kind, c.qa_enabled, c.publish_at,
              cp.currency, cp.amount_cents, cp.compare_at_amount_cents, cp.sale_amount_cents, cp.sale_starts_at, cp.sale_ends_at
         FROM courses c
    LEFT JOIN course_prices cp ON cp.course_id = c.id AND cp.is_active = 1 AND cp.currency = ?
        ${whereSql}
     ORDER BY c.created_at DESC
        LIMIT 200`,
      [joinCurrency, ...args],
    );
    const list = rows ?? [];
    if (!list.length) return res.json({ courses: [] });

    const ids = list.map((c) => Number(c.id)).filter((n) => Number.isFinite(n) && n > 0);
    const [catRows] = await pool.query(
      `SELECT course_id, GROUP_CONCAT(category_id ORDER BY category_id ASC) AS category_ids
         FROM course_categories
        WHERE course_id IN (?)
     GROUP BY course_id`,
      [ids],
    );
    const catByCourse = new Map();
    for (const r of catRows ?? []) {
      const arr = String(r.category_ids ?? '')
        .split(',')
        .map((v) => Number(v))
        .filter((n) => Number.isFinite(n) && n > 0);
      catByCourse.set(Number(r.course_id), arr);
    }

    const withCats = list.map((c) => ({ ...c, category_ids: catByCourse.get(Number(c.id)) ?? [] }));
    return res.json({ courses: withCats });
  } catch (err) {
    return next(err);
  }
}

export async function updateCourse(req, res, next) {
  try {
    const courseId = Number(req.params.id);
    if (!Number.isFinite(courseId) || courseId <= 0) {
      return res.status(400).json({ error: { message: 'Invalid course id' } });
    }

    const payload = updateCourseSchema.parse(req.body);
    const [[before]] = await pool.query('SELECT is_published, title, slug FROM courses WHERE id = ? LIMIT 1', [courseId]);
    const fields = [];
    const values = [];

    if (payload.kind !== undefined) {
      fields.push('kind = ?');
      values.push(payload.kind ?? 'course');
    }
    if (payload.title !== undefined) {
      fields.push('title = ?');
      values.push(payload.title);
      fields.push('slug = ?');
      values.push(slugify(payload.title));
    }
    if (payload.summary !== undefined) {
      fields.push('summary = ?');
      values.push(payload.summary == null ? null : sanitizeBasicHtml(payload.summary));
    }
    if (payload.content !== undefined || payload.description !== undefined || payload.single_image_url !== undefined || payload.carousel_images !== undefined || payload.what_you_get !== undefined || payload.special_collaboration !== undefined || payload.what_you_learn !== undefined || payload.menu_items !== undefined || payload.bonus_learning !== undefined || payload.who_this_workshop_is_for !== undefined) {
      fields.push('content = ?');
      const rawContent = payload.content == null ? null : sanitizeBasicHtml(payload.content);
      const structuredContent = buildWorkshopContentFromStructured(payload);
      values.push([structuredContent, rawContent].filter(Boolean).join('\n') || null);
    }
    if (payload.featured_image_url !== undefined) {
      fields.push('featured_image_url = ?');
      values.push(payload.featured_image_url ?? null);
    }
    if (payload.qa_enabled !== undefined) {
      fields.push('qa_enabled = ?');
      values.push(payload.qa_enabled ? 1 : 0);
    }
    if (payload.publish_at !== undefined) {
      fields.push('publish_at = ?');
      values.push(payload.publish_at ? toMysqlDatetime(payload.publish_at) : null);
    }
    if (payload.summary === undefined && payload.description !== undefined) {
      fields.push('summary = ?');
      values.push(payload.description == null ? null : sanitizeBasicHtml(payload.description));
    }
    if (payload.is_published !== undefined) {
      fields.push('is_published = ?');
      values.push(payload.is_published ? 1 : 0);
      fields.push('published_at = ?');
      values.push(payload.is_published ? new Date() : null);
      if (payload.is_published) {
        fields.push('publish_at = ?');
        values.push(null);
      }
    }

    if (fields.length) {
      values.push(courseId);
      await pool.query(`UPDATE courses SET ${fields.join(', ')} WHERE id = ?`, values);
    }

    if (payload.price) {
      const cur = String(payload.price.currency ?? 'INR').toUpperCase();
      await pool.query('UPDATE course_prices SET is_active = 0 WHERE course_id = ? AND currency = ?', [courseId, cur]);
      await pool.query(
        'INSERT INTO course_prices (course_id, currency, amount_cents, compare_at_amount_cents, sale_amount_cents, sale_starts_at, sale_ends_at, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
        [
          courseId,
          cur,
          payload.price.amount_cents,
          payload.price.compare_at_amount_cents ?? null,
          payload.price.sale_amount_cents ?? null,
          payload.price.sale_starts_at ? toMysqlDatetime(payload.price.sale_starts_at) : null,
          payload.price.sale_ends_at ? toMysqlDatetime(payload.price.sale_ends_at) : null,
        ],
      );
    }

    if (payload.category_ids) {
      await pool.query('DELETE FROM course_categories WHERE course_id = ?', [courseId]);
      if (payload.category_ids.length) {
        const values2 = payload.category_ids.map((cid) => [courseId, cid]);
        await pool.query('INSERT INTO course_categories (course_id, category_id) VALUES ?', [values2]);
      }
    }

    // Invalidate caches so changes appear immediately
    try {
      await invalidatePublicCourses();
      await invalidateCategories();
    } catch (cacheErr) {
      console.error('[cache invalidation] Failed to invalidate course caches:', cacheErr?.message);
      // Continue even if cache invalidation fails - data is updated in DB
    }

    // Push when a course is newly published.
    if (payload.is_published === true && before && Number(before.is_published) !== 1) {
      const [[course]] = await pool.query('SELECT id, title, slug, kind FROM courses WHERE id = ? LIMIT 1', [courseId]);
      const [users] = await pool.query(`SELECT id FROM users LIMIT 50000`).catch(() => [[]]);
      const userIds = (users ?? []).map((u) => Number(u.id)).filter((n) => Number.isFinite(n) && n > 0);
      const kind = course?.kind === 'workshop' ? 'workshop' : 'course';
      enqueuePushForUsers({
        userIds,
        title: kind === 'workshop' ? 'New workshop available' : 'New course available',
        body: course?.title ?? (kind === 'workshop' ? 'A new workshop is now available.' : 'A new course is now available.'),
        url: course?.slug ? `/${kind === 'workshop' ? 'workshops' : 'courses'}/${encodeURIComponent(course.slug)}` : `/${kind === 'workshop' ? 'workshops' : 'courses'}`,
        tag: `${kind}:${courseId}:published`,
        data: { course_id: courseId, kind },
      }).catch(() => null);
    }

    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

export async function deleteCourse(req, res, next) {
  try {
    const courseId = Number(req.params.id);
    if (!Number.isFinite(courseId) || courseId <= 0) {
      return res.status(400).json({ error: { message: 'Invalid course id' } });
    }
    await pool.query('DELETE FROM courses WHERE id = ?', [courseId]);
    await invalidatePublicCourses();
    await invalidateCategories();
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}
