import { z } from 'zod';
import { pool } from '../config/db.js';
import { cacheWrap } from '../services/cacheService.js';

function stripScripts(html) {
  const raw = String(html ?? '');
  return raw.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
}

export async function getHomepageContent(_req, res, next) {
  try {
    const payload = await cacheWrap({
      ns: 'cms_homepage',
      key: 'v1',
      ttlSeconds: 60,
      compute: async () => {
        const [rows] = await pool.query(
          `SELECT content_key, title, content_json, content_html, is_published, updated_at
             FROM site_content
            WHERE content_key = 'homepage'
            LIMIT 1`,
        );
        const row = rows?.[0] ?? null;
        if (!row || !row.is_published) return { homepage: null };
        return {
          homepage: {
            key: row.content_key,
            title: row.title,
            content: row.content_json ?? null,
            content_html: row.content_html ?? null,
            updated_at: row.updated_at,
          },
        };
      },
    });
    return res.json(payload);
  } catch (err) {
    return next(err);
  }
}

export async function getAboutContent(_req, res, next) {
  try {
    const payload = await cacheWrap({
      ns: 'cms_about',
      key: 'v1',
      ttlSeconds: 120,
      compute: async () => {
        const [rows] = await pool.query(
          `SELECT content_key, title, content_json, content_html, is_published, updated_at
             FROM site_content
            WHERE content_key = 'about'
            LIMIT 1`,
        );
        const row = rows?.[0] ?? null;
        if (!row || !row.is_published) return { about: null };
        return {
          about: {
            key: row.content_key,
            title: row.title,
            content: row.content_json ?? null,
            content_html: row.content_html ?? null,
            updated_at: row.updated_at,
          },
        };
      },
    });
    return res.json(payload);
  } catch (err) {
    return next(err);
  }
}

export async function listPublicTestimonials(_req, res, next) {
  try {
    const payload = await cacheWrap({
      ns: 'cms_testimonials',
      key: 'list:v1',
      ttlSeconds: 120,
      compute: async () => {
        const [rows] = await pool.query(
          `SELECT id, student_name, testimonial_text, avatar_url, course_id, is_featured, sort_order, created_at
             FROM testimonials
            WHERE is_published = 1
         ORDER BY is_featured DESC, sort_order ASC, id DESC
            LIMIT 200`,
        );
        return { testimonials: rows };
      },
    });
    return res.json(payload);
  } catch (err) {
    return next(err);
  }
}

export async function listPublicFaqs(_req, res, next) {
  try {
    const payload = await cacheWrap({
      ns: 'cms_faqs',
      key: 'list:v1',
      ttlSeconds: 120,
      compute: async () => {
        const [rows] = await pool.query(
          `SELECT id, category, question, answer_html, sort_order
             FROM faqs
            WHERE is_published = 1
         ORDER BY sort_order ASC, id ASC
            LIMIT 500`,
        );
        return { faqs: rows.map((r) => ({ ...r, answer_html: stripScripts(r.answer_html) })) };
      },
    });
    return res.json(payload);
  } catch (err) {
    return next(err);
  }
}

export async function listPublicAnnouncements(_req, res, next) {
  try {
    const payload = await cacheWrap({
      ns: 'cms_announcements',
      key: 'list:v1',
      ttlSeconds: 30,
      compute: async () => {
        const [rows] = await pool.query(
          `SELECT id, message, cta_label, cta_url, starts_at, ends_at
             FROM announcements
            WHERE is_active = 1
              AND (starts_at IS NULL OR starts_at <= NOW())
              AND (ends_at IS NULL OR ends_at >= NOW())
         ORDER BY starts_at DESC, id DESC
            LIMIT 5`,
        );
        return { announcements: rows };
      },
    });
    return res.json(payload);
  } catch (err) {
    return next(err);
  }
}

const legalSlugSchema = z.object({
  slug: z.string().trim().min(2).max(160),
});

export async function getLegalPage(req, res, next) {
  try {
    const { slug } = legalSlugSchema.parse(req.params);
    const normalized = String(slug).trim().toLowerCase();
    const payload = await cacheWrap({
      ns: 'cms_legal',
      key: `slug:${normalized}`,
      ttlSeconds: 300,
      compute: async () => {
        const [rows] = await pool.query(
          `SELECT slug, title, content_html, status, version, updated_at
             FROM legal_pages
            WHERE slug = ? AND status = 'published'
            LIMIT 1`,
          [normalized],
        );
        const row = rows?.[0] ?? null;
        if (!row) return null;
        return { legal: { ...row, content_html: stripScripts(row.content_html) } };
      },
    });
    if (!payload) return res.status(404).json({ error: { message: 'Legal page not found' } });
    return res.json(payload);
  } catch (err) {
    return next(err);
  }
}

const seoPageSchema = z.object({
  page: z.string().trim().min(1).max(160),
});

export async function getSeoMeta(req, res, next) {
  try {
    const { page } = seoPageSchema.parse(req.params);
    const key = String(page).trim().toLowerCase();
    const payload = await cacheWrap({
      ns: 'cms_seo',
      key: `page:${key}`,
      ttlSeconds: 300,
      compute: async () => {
        const [rows] = await pool.query(
          `SELECT page_key, meta_title, meta_description, og_image_url, canonical_url, json_ld, updated_at
             FROM seo_meta
            WHERE page_key = ?
            LIMIT 1`,
          [key],
        );
        const row = rows?.[0] ?? null;
        if (!row) return { seo: null };
        return { seo: row };
      },
    });
    return res.json(payload);
  } catch (err) {
    return next(err);
  }
}

export async function listPublicGallery(_req, res, next) {
  try {
    const payload = await cacheWrap({
      ns: 'cms_gallery',
      key: 'list:v1',
      ttlSeconds: 120,
      compute: async () => {
        const [rows] = await pool.query(
          `SELECT id, image_url, alt_text, caption, is_featured, sort_order, created_at
             FROM student_gallery
            WHERE is_published = 1
         ORDER BY is_featured DESC, sort_order ASC, id DESC
            LIMIT 500`,
        );
        return { gallery: rows };
      },
    });
    return res.json(payload);
  } catch (err) {
    return next(err);
  }
}

