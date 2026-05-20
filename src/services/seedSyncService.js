import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function parseInrToMinorUnits(contentHtml) {
  const html = String(contentHtml ?? '');
  if (!html) return null;

  // Try to match common patterns used on the legacy site.
  const patterns = [
    /Class Fee:\s*₹\s*([\d,]+(?:\.\d{1,2})?)/i,
    /Event Fee:\s*₹\s*([\d,]+(?:\.\d{1,2})?)/i,
    /Regular Price:\s*₹\s*([\d,]+(?:\.\d{1,2})?)/i,
    /Price:\s*₹\s*([\d,]+(?:\.\d{1,2})?)/i,
    /Fee:\s*₹\s*([\d,]+(?:\.\d{1,2})?)/i,
  ];

  for (const re of patterns) {
    const match = html.match(re);
    const raw = match?.[1] ?? '';
    const value = Number(String(raw).replace(/,/g, ''));
    if (!Number.isFinite(value) || value <= 0) continue;
    return Math.round(value * 100); // INR minor units (paise)
  }

  return null;
}

function stripHtml(contentHtml) {
  return String(contentHtml ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSeedPath() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // backend/src/services -> backend/src -> backend -> repo root
  const repoRoot = path.resolve(here, '..', '..', '..');
  return path.join(repoRoot, 'frontend', 'loveAndFlour', 'src', 'data', 'seed', 'courses.json');
}

async function loadSeedCourses() {
  const seedPath = buildSeedPath();
  const raw = await fs.readFile(seedPath, 'utf8');
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

export async function syncSeedCoursesToDb({ pool, logger }) {
  let seedCourses = [];
  try {
    seedCourses = await loadSeedCourses();
  } catch (err) {
    logger?.warn?.({ err }, 'seed_courses_load_failed');
    return { ok: false, synced: 0, priced: 0 };
  }

  let synced = 0;
  let priced = 0;

  for (const course of seedCourses) {
    const slug = String(course?.slug ?? '').trim();
    const title = String(course?.title ?? '').trim();
    if (!slug || !title) continue;

    // eslint-disable-next-line no-await-in-loop
    const [[existing]] = await pool.query('SELECT id FROM courses WHERE slug = ? LIMIT 1', [slug]);
    const existingId = Number(existing?.id ?? 0);

    let courseId = existingId;
    if (!courseId) {
      const summaryHtml = course?.excerptHtml ? String(course.excerptHtml) : stripHtml(course?.contentHtml).slice(0, 240);
      const contentHtml = course?.contentHtml ? String(course.contentHtml) : '';
      const featuredImage = course?.featuredImage ? String(course.featuredImage) : null;

      // eslint-disable-next-line no-await-in-loop
      const [result] = await pool.query(
        `INSERT INTO courses (title, slug, kind, summary, content, featured_image_url, is_published, published_at, source)
         VALUES (?, ?, 'workshop', ?, ?, ?, 1, NOW(), 'local')`,
        [title, slug, summaryHtml || null, contentHtml || null, featuredImage],
      );
      courseId = Number(result?.insertId ?? 0);
      if (courseId) synced += 1;
    }

    if (!courseId) continue;

    // Ensure at least one active INR price exists so checkout can work.
    // eslint-disable-next-line no-await-in-loop
    const [[activePrice]] = await pool.query(
      'SELECT id FROM course_prices WHERE course_id = ? AND currency = ? AND is_active = 1 LIMIT 1',
      [courseId, 'INR'],
    );
    if (activePrice?.id) continue;

    const amountCents = parseInrToMinorUnits(course?.contentHtml ?? course?.excerptHtml ?? '');
    if (!amountCents) continue;

    // eslint-disable-next-line no-await-in-loop
    await pool.query('UPDATE course_prices SET is_active = 0 WHERE course_id = ? AND currency = ?', [courseId, 'INR']);
    // eslint-disable-next-line no-await-in-loop
    await pool.query(
      'INSERT INTO course_prices (course_id, currency, amount_cents, is_active) VALUES (?, ?, ?, 1)',
      [courseId, 'INR', Number(amountCents)],
    );
    priced += 1;
  }

  if (synced || priced) logger?.info?.({ synced, priced }, 'seed_courses_synced');
  return { ok: true, synced, priced };
}
