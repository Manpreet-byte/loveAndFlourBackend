import { z } from 'zod';
import { findUserById, updateUserProfile } from '../models/userModel.js';

const updateSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  phone: z
    .string()
    .trim()
    .min(5)
    .max(30)
    .optional()
    .or(z.literal(''))
    .transform((v) => (v === '' ? null : v)),
});

export async function getProfile(req, res, next) {
  try {
    const user = await findUserById(req.user.id);
    if (!user) return res.status(404).json({ error: { message: 'User not found' } });
    return res.json({ user });
  } catch (err) {
    return next(err);
  }
}

export async function updateProfile(req, res, next) {
  try {
    const userId = req.user.id;
    const payload = updateSchema.parse(req.body ?? {});
    const updated = await updateUserProfile({ userId, name: payload.name, phone: payload.phone });
    return res.json({ user: updated });
  } catch (err) {
    return next(err);
  }
}

