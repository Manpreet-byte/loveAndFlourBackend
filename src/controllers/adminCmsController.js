import { z } from 'zod';
import { pool } from '../config/db.js';
import { getRequestAuditContext, logAuditEvent } from '../services/auditLogService.js';
import { enqueuePushForUsers } from '../services/push/pushOutboxService.js';

function stripScripts(html) {
  const raw = String(html ?? '');
  return raw.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
}

const contentPatchSchema = z.object({
  title: z.string().trim().max(255).optional().nullable(),
  content: z.any().optional().nullable(),
  content_html: z.string().optional().nullable(),
  is_published: z.coerce.boolean().optional().nullable(),
});

async function getSiteContentRow({ key }) {
  const [rows] = await pool.query(
    `SELECT content_key, title, content_json, content_html, is_published, updated_at
       FROM site_content
      WHERE content_key = ?
      LIMIT 1`,
    [key],
  );
  return rows?.[0] ?? null;
}

export async function adminGetHomepage(req, res, next) {
  try {
    const row = await getSiteContentRow({ key: 'homepage' });
    return res.json({
      homepage: row
        ? { key: row.content_key, title: row.title, content: row.content_json ?? null, content_html: row.content_html ?? null, is_published: !!row.is_published }
        : null,
    });
  } catch (err) {
    return next(err);
  }
}

export async function adminGetAbout(req, res, next) {
  try {
    const row = await getSiteContentRow({ key: 'about' });
    return res.json({
      about: row
        ? { key: row.content_key, title: row.title, content: row.content_json ?? null, content_html: row.content_html ?? null, is_published: !!row.is_published }
        : null,
    });
  } catch (err) {
    return next(err);
  }
}

async function upsertSiteContent({ actorId, key, payload }) {
  const title = payload.title ?? null;
  const contentJson = payload.content ?? null;
  const contentHtml = payload.content_html != null ? stripScripts(payload.content_html) : null;
  const isPublished = payload.is_published == null ? 1 : payload.is_published ? 1 : 0;

  await pool.query(
    `INSERT INTO site_content (content_key, title, content_json, content_html, is_published, updated_by)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       title = VALUES(title),
       content_json = VALUES(content_json),
       content_html = VALUES(content_html),
       is_published = VALUES(is_published),
       updated_by = VALUES(updated_by),
       updated_at = CURRENT_TIMESTAMP`,
    [key, title, contentJson ? JSON.stringify(contentJson) : null, contentHtml, isPublished, actorId],
  );
}

export async function patchHomepage(req, res, next) {
  try {
    const payload = contentPatchSchema.parse(req.body ?? {});
    await upsertSiteContent({ actorId: req.user.id, key: 'homepage', payload });
    logAuditEvent({
      actorType: 'admin',
      actorId: req.user.id,
      actionType: 'CMS_UPDATE',
      entityType: 'site_content',
      entityId: null,
      ...getRequestAuditContext(req),
      statusCode: 200,
      metadata: { content_key: 'homepage' },
    });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

export async function patchAbout(req, res, next) {
  try {
    const payload = contentPatchSchema.parse(req.body ?? {});
    await upsertSiteContent({ actorId: req.user.id, key: 'about', payload });
    logAuditEvent({
      actorType: 'admin',
      actorId: req.user.id,
      actionType: 'CMS_UPDATE',
      entityType: 'site_content',
      entityId: null,
      ...getRequestAuditContext(req),
      statusCode: 200,
      metadata: { content_key: 'about' },
    });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

const testimonialCreateSchema = z.object({
  student_name: z.string().trim().min(1).max(160),
  testimonial_text: z.string().trim().min(1).max(2000),
  avatar_url: z.string().trim().max(1024).optional().nullable(),
  course_id: z.coerce.number().int().positive().optional().nullable(),
  is_featured: z.coerce.boolean().optional().default(false),
  is_published: z.coerce.boolean().optional().default(true),
  sort_order: z.coerce.number().int().min(0).max(100000).optional().default(0),
});

export async function adminListTestimonials(_req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT id, student_name, testimonial_text, avatar_url, course_id, is_featured, is_published, sort_order, created_at, updated_at
         FROM testimonials
     ORDER BY is_featured DESC, sort_order ASC, id DESC
        LIMIT 500`,
    );
    return res.json({ testimonials: rows });
  } catch (err) {
    return next(err);
  }
}

export async function adminCreateTestimonial(req, res, next) {
  try {
    const payload = testimonialCreateSchema.parse(req.body ?? {});
    const [result] = await pool.query(
      `INSERT INTO testimonials
        (student_name, testimonial_text, avatar_url, course_id, is_featured, is_published, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.student_name,
        payload.testimonial_text,
        payload.avatar_url ?? null,
        payload.course_id ?? null,
        payload.is_featured ? 1 : 0,
        payload.is_published ? 1 : 0,
        payload.sort_order ?? 0,
      ],
    );
    logAuditEvent({
      actorType: 'admin',
      actorId: req.user.id,
      actionType: 'CMS_CREATE',
      entityType: 'testimonial',
      entityId: result.insertId,
      ...getRequestAuditContext(req),
      statusCode: 201,
    });
    return res.status(201).json({ id: result.insertId });
  } catch (err) {
    return next(err);
  }
}

const testimonialUpdateSchema = testimonialCreateSchema.partial();

export async function adminUpdateTestimonial(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: { message: 'Invalid testimonial id' } });
    const payload = testimonialUpdateSchema.parse(req.body ?? {});
    const fields = [];
    const values = [];
    for (const [k, v] of Object.entries(payload)) {
      if (v === undefined) continue;
      if (k === 'is_featured' || k === 'is_published') {
        fields.push(`${k} = ?`);
        values.push(v ? 1 : 0);
      } else {
        fields.push(`${k} = ?`);
        values.push(v);
      }
    }
    if (!fields.length) return res.json({ ok: true });
    values.push(id);
    await pool.query(`UPDATE testimonials SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, values);
    logAuditEvent({
      actorType: 'admin',
      actorId: req.user.id,
      actionType: 'CMS_UPDATE',
      entityType: 'testimonial',
      entityId: id,
      ...getRequestAuditContext(req),
      statusCode: 200,
    });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

export async function adminDeleteTestimonial(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: { message: 'Invalid testimonial id' } });
    await pool.query('DELETE FROM testimonials WHERE id = ? LIMIT 1', [id]);
    logAuditEvent({
      actorType: 'admin',
      actorId: req.user.id,
      actionType: 'CMS_DELETE',
      entityType: 'testimonial',
      entityId: id,
      ...getRequestAuditContext(req),
      statusCode: 200,
    });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

const faqSchema = z.object({
  category: z.string().trim().max(120).optional().nullable(),
  question: z.string().trim().min(1).max(255),
  answer_html: z.string().trim().min(1).max(20000),
  is_published: z.coerce.boolean().optional().default(true),
  sort_order: z.coerce.number().int().min(0).max(100000).optional().default(0),
});

export async function adminListFaqs(_req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT id, category, question, answer_html, is_published, sort_order, created_at, updated_at
         FROM faqs
     ORDER BY sort_order ASC, id ASC
        LIMIT 1000`,
    );
    return res.json({ faqs: rows });
  } catch (err) {
    return next(err);
  }
}

export async function adminCreateFaq(req, res, next) {
  try {
    const payload = faqSchema.parse(req.body ?? {});
    const [result] = await pool.query(
      `INSERT INTO faqs (category, question, answer_html, is_published, sort_order)
       VALUES (?, ?, ?, ?, ?)`,
      [payload.category ?? null, payload.question, stripScripts(payload.answer_html), payload.is_published ? 1 : 0, payload.sort_order ?? 0],
    );
    logAuditEvent({
      actorType: 'admin',
      actorId: req.user.id,
      actionType: 'CMS_CREATE',
      entityType: 'faq',
      entityId: result.insertId,
      ...getRequestAuditContext(req),
      statusCode: 201,
    });
    return res.status(201).json({ id: result.insertId });
  } catch (err) {
    return next(err);
  }
}

export async function adminUpdateFaq(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: { message: 'Invalid faq id' } });
    const payload = faqSchema.partial().parse(req.body ?? {});
    const fields = [];
    const values = [];
    for (const [k, v] of Object.entries(payload)) {
      if (v === undefined) continue;
      if (k === 'is_published') {
        fields.push(`${k} = ?`);
        values.push(v ? 1 : 0);
      } else if (k === 'answer_html') {
        fields.push(`${k} = ?`);
        values.push(stripScripts(v));
      } else {
        fields.push(`${k} = ?`);
        values.push(v);
      }
    }
    if (!fields.length) return res.json({ ok: true });
    values.push(id);
    await pool.query(`UPDATE faqs SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, values);
    logAuditEvent({
      actorType: 'admin',
      actorId: req.user.id,
      actionType: 'CMS_UPDATE',
      entityType: 'faq',
      entityId: id,
      ...getRequestAuditContext(req),
      statusCode: 200,
    });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

export async function adminDeleteFaq(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: { message: 'Invalid faq id' } });
    await pool.query('DELETE FROM faqs WHERE id = ? LIMIT 1', [id]);
    logAuditEvent({
      actorType: 'admin',
      actorId: req.user.id,
      actionType: 'CMS_DELETE',
      entityType: 'faq',
      entityId: id,
      ...getRequestAuditContext(req),
      statusCode: 200,
    });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

const announcementSchema = z.object({
  message: z.string().trim().min(1).max(280),
  cta_label: z.string().trim().max(80).optional().nullable(),
  cta_url: z.string().trim().max(1024).optional().nullable(),
  starts_at: z.string().trim().optional().nullable(),
  ends_at: z.string().trim().optional().nullable(),
  is_active: z.coerce.boolean().optional().default(true),
});

export async function adminListAnnouncements(_req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT id, message, cta_label, cta_url, starts_at, ends_at, is_active, created_at, updated_at
         FROM announcements
     ORDER BY id DESC
        LIMIT 200`,
    );
    return res.json({ announcements: rows });
  } catch (err) {
    return next(err);
  }
}

export async function adminPatchAnnouncements(req, res, next) {
  try {
    // For simplicity: create a new announcement record (campaign-friendly).
    const payload = announcementSchema.parse(req.body ?? {});
    const [result] = await pool.query(
      `INSERT INTO announcements (message, cta_label, cta_url, starts_at, ends_at, is_active)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        payload.message,
        payload.cta_label ?? null,
        payload.cta_url ?? null,
        payload.starts_at ? new Date(payload.starts_at) : null,
        payload.ends_at ? new Date(payload.ends_at) : null,
        payload.is_active ? 1 : 0,
      ],
    );
    logAuditEvent({
      actorType: 'admin',
      actorId: req.user.id,
      actionType: 'CMS_CREATE',
      entityType: 'announcement',
      entityId: result.insertId,
      ...getRequestAuditContext(req),
      statusCode: 201,
    });

    // Best-effort push broadcast for active announcements.
    if (payload.is_active) {
      const [users] = await pool.query(`SELECT id FROM users LIMIT 50000`).catch(() => [[]]);
      const userIds = (users ?? []).map((u) => Number(u.id)).filter((n) => Number.isFinite(n) && n > 0);
      enqueuePushForUsers({
        userIds,
        title: 'New announcement',
        body: payload.message,
        url: payload.cta_url ? String(payload.cta_url) : '/',
        tag: `announcement:${result.insertId}`,
        data: { announcement_id: result.insertId },
      }).catch(() => null);
    }

    return res.status(201).json({ id: result.insertId });
  } catch (err) {
    return next(err);
  }
}

const legalSchema = z.object({
  title: z.string().trim().min(1).max(255),
  content_html: z.string().trim().min(1).max(200000),
  status: z.enum(['draft', 'published']).optional(),
});

export async function adminPatchLegal(req, res, next) {
  try {
    const slug = String(req.params.slug ?? '').trim().toLowerCase();
    if (!slug || slug.length > 160) return res.status(400).json({ error: { message: 'Invalid slug' } });
    const payload = legalSchema.parse(req.body ?? {});
    await pool.query(
      `INSERT INTO legal_pages (slug, title, content_html, status, version, updated_by)
       VALUES (?, ?, ?, ?, 1, ?)
       ON DUPLICATE KEY UPDATE
         title = VALUES(title),
         content_html = VALUES(content_html),
         status = VALUES(status),
         version = version + 1,
         updated_by = VALUES(updated_by),
         updated_at = CURRENT_TIMESTAMP`,
      [slug, payload.title, stripScripts(payload.content_html), payload.status ?? 'published', req.user.id],
    );
    logAuditEvent({
      actorType: 'admin',
      actorId: req.user.id,
      actionType: 'CMS_UPDATE',
      entityType: 'legal_page',
      entityId: null,
      ...getRequestAuditContext(req),
      statusCode: 200,
      metadata: { slug },
    });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

const seoSchema = z.object({
  meta_title: z.string().trim().max(255).optional().nullable(),
  meta_description: z.string().trim().max(320).optional().nullable(),
  og_image_url: z.string().trim().max(1024).optional().nullable(),
  canonical_url: z.string().trim().max(1024).optional().nullable(),
  json_ld: z.string().trim().max(20000).optional().nullable(),
});

export async function adminPatchSeo(req, res, next) {
  try {
    const pageKey = String(req.params.page ?? '').trim().toLowerCase();
    if (!pageKey || pageKey.length > 160) return res.status(400).json({ error: { message: 'Invalid page key' } });
    const payload = seoSchema.parse(req.body ?? {});
    await pool.query(
      `INSERT INTO seo_meta (page_key, meta_title, meta_description, og_image_url, canonical_url, json_ld, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         meta_title = VALUES(meta_title),
         meta_description = VALUES(meta_description),
         og_image_url = VALUES(og_image_url),
         canonical_url = VALUES(canonical_url),
         json_ld = VALUES(json_ld),
         updated_by = VALUES(updated_by),
         updated_at = CURRENT_TIMESTAMP`,
      [
        pageKey,
        payload.meta_title ?? null,
        payload.meta_description ?? null,
        payload.og_image_url ?? null,
        payload.canonical_url ?? null,
        payload.json_ld ?? null,
        req.user.id,
      ],
    );
    logAuditEvent({
      actorType: 'admin',
      actorId: req.user.id,
      actionType: 'CMS_UPDATE',
      entityType: 'seo_meta',
      entityId: null,
      ...getRequestAuditContext(req),
      statusCode: 200,
      metadata: { page_key: pageKey },
    });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

const gallerySchema = z.object({
  image_url: z.string().trim().min(1).max(1024),
  alt_text: z.string().trim().max(160).optional().nullable(),
  caption: z.string().trim().max(255).optional().nullable(),
  is_featured: z.coerce.boolean().optional().default(false),
  is_published: z.coerce.boolean().optional().default(true),
  sort_order: z.coerce.number().int().min(0).max(100000).optional().default(0),
});

export async function adminListGallery(_req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT id, image_url, alt_text, caption, is_featured, is_published, sort_order, created_at, updated_at
         FROM student_gallery
     ORDER BY is_featured DESC, sort_order ASC, id DESC
        LIMIT 1000`,
    );
    return res.json({ gallery: rows });
  } catch (err) {
    return next(err);
  }
}

export async function adminCreateGallery(req, res, next) {
  try {
    const payload = gallerySchema.parse(req.body ?? {});
    const [result] = await pool.query(
      `INSERT INTO student_gallery (image_url, alt_text, caption, is_featured, is_published, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        payload.image_url,
        payload.alt_text ?? null,
        payload.caption ?? null,
        payload.is_featured ? 1 : 0,
        payload.is_published ? 1 : 0,
        payload.sort_order ?? 0,
      ],
    );
    logAuditEvent({
      actorType: 'admin',
      actorId: req.user.id,
      actionType: 'CMS_CREATE',
      entityType: 'gallery',
      entityId: result.insertId,
      ...getRequestAuditContext(req),
      statusCode: 201,
    });
    return res.status(201).json({ id: result.insertId });
  } catch (err) {
    return next(err);
  }
}

export async function adminDeleteGallery(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: { message: 'Invalid gallery id' } });
    await pool.query('DELETE FROM student_gallery WHERE id = ? LIMIT 1', [id]);
    logAuditEvent({
      actorType: 'admin',
      actorId: req.user.id,
      actionType: 'CMS_DELETE',
      entityType: 'gallery',
      entityId: id,
      ...getRequestAuditContext(req),
      statusCode: 200,
    });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

export async function adminListNewsletterSubscribers(_req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT id, email, status, subscribed_at, created_at
         FROM newsletter_subscribers
     ORDER BY subscribed_at DESC, id DESC
        LIMIT 5000`,
    );
    return res.json({ subscribers: rows });
  } catch (err) {
    return next(err);
  }
}
