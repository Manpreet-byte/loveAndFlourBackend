import { pool } from '../config/db.js';
import { invalidatePublicCourses, invalidatePublicRecipes } from './cacheInvalidationService.js';
import { logger } from '../utils/logger.js';

export async function publishDueContent({ limit = 200 } = {}) {
  const publishedAt = new Date();
  let courses = 0;
  let recipes = 0;

  try {
    const [res] = await pool.query(
      `UPDATE courses
          SET is_published = 1,
              published_at = COALESCE(published_at, ?),
              publish_at = NULL,
              updated_at = CURRENT_TIMESTAMP
        WHERE is_published = 0
          AND publish_at IS NOT NULL
          AND publish_at <= NOW()
        LIMIT ?`,
      [publishedAt, Number(limit)],
    );
    courses = Number(res?.affectedRows ?? 0);
  } catch (err) {
    logger.warn({ err }, 'scheduled_publish_courses_failed');
  }

  try {
    const [res] = await pool.query(
      `UPDATE recipes
          SET is_published = 1,
              published_at = COALESCE(published_at, ?),
              publish_at = NULL,
              updated_at = CURRENT_TIMESTAMP
        WHERE is_published = 0
          AND publish_at IS NOT NULL
          AND publish_at <= NOW()
        LIMIT ?`,
      [publishedAt, Number(limit)],
    );
    recipes = Number(res?.affectedRows ?? 0);
  } catch (err) {
    logger.warn({ err }, 'scheduled_publish_recipes_failed');
  }

  if (courses > 0) await invalidatePublicCourses().catch(() => null);
  if (recipes > 0) await invalidatePublicRecipes().catch(() => null);

  return { courses, recipes };
}

