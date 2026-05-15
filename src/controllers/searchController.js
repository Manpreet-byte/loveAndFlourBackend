import { z } from 'zod';
import { searchCourses, searchGlobal, searchRecipes, searchSuggestions } from '../services/searchService.js';

const globalSchema = z.object({
  q: z.string().trim().min(1).max(120),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().min(1).max(20).optional().default(20),
});

export async function globalSearch(req, res, next) {
  try {
    const { q, page, limit } = globalSchema.parse(req.query);
    const result = await searchGlobal({ q, page, limit });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

const courseSchema = globalSchema.extend({
  category_id: z.coerce.number().int().positive().optional().nullable(),
  level: z.string().trim().min(1).max(60).optional().nullable(),
  language: z.string().trim().min(1).max(60).optional().nullable(),
});

export async function courseSearch(req, res, next) {
  try {
    const parsed = courseSchema.parse(req.query);
    const result = await searchCourses({
      q: parsed.q,
      page: parsed.page,
      limit: parsed.limit,
      categoryId: parsed.category_id ?? null,
      level: parsed.level ?? null,
      language: parsed.language ?? null,
    });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

const recipeSchema = globalSchema.extend({
  category_id: z.coerce.number().int().positive().optional().nullable(),
});

export async function recipeSearch(req, res, next) {
  try {
    const parsed = recipeSchema.parse(req.query);
    const result = await searchRecipes({
      q: parsed.q,
      page: parsed.page,
      limit: parsed.limit,
      categoryId: parsed.category_id ?? null,
    });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

const suggestSchema = z.object({
  q: z.string().trim().min(1).max(80),
  limit: z.coerce.number().int().min(1).max(10).optional().default(10),
});

export async function suggestions(req, res, next) {
  try {
    const { q, limit } = suggestSchema.parse(req.query);
    const result = await searchSuggestions({ q, limit });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

