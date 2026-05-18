import { z } from 'zod';
import { slugify } from '../utils/slug.js';
import { createTag, deleteTag, listTags } from '../models/tagModel.js';

const listSchema = z.object({
  type: z.string().trim().optional().default('recipe'),
});

export async function adminListTags(req, res, next) {
  try {
    const { type } = listSchema.parse(req.query ?? {});
    if (type !== 'recipe') return res.status(400).json({ error: { message: 'Invalid tag type' } });
    const tags = await listTags({ tagType: type, limit: 500 });
    return res.json({ tags });
  } catch (err) {
    return next(err);
  }
}

const createSchema = z.object({
  tag_type: z.enum(['recipe']).default('recipe'),
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().max(140).optional().nullable(),
});

export async function adminCreateTag(req, res, next) {
  try {
    const payload = createSchema.parse(req.body ?? {});
    const slug = payload.slug ? slugify(payload.slug) : slugify(payload.name);
    const id = await createTag({ tagType: payload.tag_type, name: payload.name, slug });
    return res.status(201).json({ tag_id: id, slug });
  } catch (err) {
    return next(err);
  }
}

export async function adminDeleteTag(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: { message: 'Invalid tag id' } });
    const ok = await deleteTag({ id });
    if (!ok) return res.status(404).json({ error: { message: 'Tag not found' } });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

