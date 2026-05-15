import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { pool } from '../src/config/db.js';

dotenv.config();

function stripTags(html) {
  return String(html ?? '')
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractInrPaiseFromContent(html) {
  const text = stripTags(html);

  // Prefer "Regular Price" if present, else "Fee", else first ₹ amount.
  const patterns = [
    /Regular\s*Price[^₹0-9]*₹\s*([0-9][0-9,]*)/i,
    /Fee[^₹0-9]*₹\s*([0-9][0-9,]*)/i,
    /₹\s*([0-9][0-9,]*)/i,
  ];

  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const rupees = Number(String(m[1]).replace(/,/g, ''));
    if (!Number.isFinite(rupees) || rupees <= 0) continue;
    return Math.round(rupees * 100); // paise
  }

  // Reasonable fallback for test payments
  return 2000 * 100;
}

async function upsertCourseFromSeed(seed) {
  const slug = String(seed?.slug ?? '').trim();
  if (!slug) return null;

  const title = String(seed?.title ?? slug).trim().slice(0, 255);
  const summary = String(seed?.excerptHtml ?? '').trim();
  const content = String(seed?.contentHtml ?? '').trim();
  const featured = seed?.featuredImage?.src ? String(seed.featuredImage.src) : null;
  const publishedAt = seed?.date ? new Date(seed.date) : new Date();

  // Create or update by unique `slug`
  await pool.query(
    `INSERT INTO courses (title, slug, summary, content, featured_image_url, is_published, published_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)
     ON DUPLICATE KEY UPDATE
       title = VALUES(title),
       summary = VALUES(summary),
       content = VALUES(content),
       featured_image_url = VALUES(featured_image_url),
       is_published = 1,
       published_at = COALESCE(courses.published_at, VALUES(published_at))`,
    [title, slug, summary || null, content || null, featured, publishedAt],
  );

  const [[row]] = await pool.query(`SELECT id FROM courses WHERE slug = ? LIMIT 1`, [slug]);
  const courseId = row?.id ? Number(row.id) : null;
  if (!courseId) return null;

  const amountPaise = extractInrPaiseFromContent(seed?.contentHtml);

  // Ensure exactly one active price row
  await pool.query(`UPDATE course_prices SET is_active = 0 WHERE course_id = ?`, [courseId]);
  await pool.query(
    `INSERT INTO course_prices (course_id, currency, amount_cents, is_active, valid_from)
     VALUES (?, 'INR', ?, 1, NOW())`,
    [courseId, amountPaise],
  );

  return { courseId, slug, title, amountPaise };
}

async function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const seedPath = path.resolve(here, '../../frontend/loveAndFlour/src/data/seed/courses.json');
  const raw = await fs.readFile(seedPath, 'utf8');
  const seeds = JSON.parse(raw);
  if (!Array.isArray(seeds) || seeds.length === 0) {
    throw new Error('No seeded courses found.');
  }

  let ok = 0;
  for (const seed of seeds) {
    // eslint-disable-next-line no-await-in-loop
    const res = await upsertCourseFromSeed(seed);
    if (res) ok += 1;
  }

  // eslint-disable-next-line no-console
  console.log(`[syncFrontendSeedCourses] upserted ${ok}/${seeds.length} courses`);
  await pool.end();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});

