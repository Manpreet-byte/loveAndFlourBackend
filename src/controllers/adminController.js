import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import { z } from 'zod';
import { env } from '../utils/env.js';
import { pool } from '../config/db.js';
import { signAccessToken } from '../utils/tokens.js';

const bootstrapSchema = z.object({
  secret: z.string().min(1),
  name: z.string().min(1).max(150),
  email: z.string().email().max(254),
  password: z.string().min(8).max(72),
});

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

export async function bootstrapAdmin(req, res, next) {
  try {
    if (!env.ADMIN_BOOTSTRAP_ENABLED) {
      return res.status(404).json({ error: { message: 'Not Found' } });
    }

    if (!env.ADMIN_BOOTSTRAP_SECRET) {
      return res.status(400).json({ error: { message: 'ADMIN_BOOTSTRAP_SECRET is not configured on server' } });
    }

    const { secret, name, email, password } = bootstrapSchema.parse(req.body);
    const normalizedEmail = String(email).trim().toLowerCase();

    if (!safeEqual(secret, env.ADMIN_BOOTSTRAP_SECRET)) {
      return res.status(401).json({ error: { message: 'Invalid bootstrap secret' } });
    }

    const [existingAdmins] = await pool.query('SELECT id FROM users WHERE role = ? LIMIT 1', ['admin']);
    if (existingAdmins?.length) {
      return res.status(409).json({ error: { message: 'An admin already exists' } });
    }

    const [existingEmail] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [normalizedEmail]);
    if (existingEmail?.length) {
      return res.status(409).json({ error: { message: 'Email already in use' } });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const [result] = await pool.query('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)', [
      name,
      normalizedEmail,
      passwordHash,
      'admin',
    ]);

    const user = { id: result.insertId, name, email: normalizedEmail, role: 'admin', token_version: 0 };
    const token = signAccessToken({ userId: user.id, role: user.role, tokenVersion: user.token_version });
    return res.status(201).json({ user, token });
  } catch (err) {
    return next(err);
  }
}

const createAdminSchema = z.object({
  name: z.string().min(1).max(150),
  email: z.string().email().max(254),
  password: z.string().min(8).max(72),
});

export async function createAdmin(req, res, next) {
  try {
    const { name, email, password } = createAdminSchema.parse(req.body);

    const [existingEmail] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
    if (existingEmail?.length) {
      return res.status(409).json({ error: { message: 'Email already in use' } });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const [result] = await pool.query('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)', [
      name,
      email,
      passwordHash,
      'admin',
    ]);

    return res.status(201).json({
      user: { id: result.insertId, name, email, role: 'admin' },
    });
  } catch (err) {
    return next(err);
  }
}

const promoteSchema = z.object({
  secret: z.string().min(1),
  email: z.string().email().max(254),
  name: z.string().min(1).max(150).optional().nullable(),
  password: z.string().min(8).max(72).optional().nullable(),
});

// DEV helper: promote an existing user to admin (or create one) using ADMIN_BOOTSTRAP_SECRET.
export async function promoteAdmin(req, res, next) {
  try {
    if (env.NODE_ENV === 'production') {
      return res.status(404).json({ error: { message: 'Not Found' } });
    }

    if (!env.ADMIN_BOOTSTRAP_SECRET) {
      return res.status(400).json({ error: { message: 'ADMIN_BOOTSTRAP_SECRET is not configured on server' } });
    }

    const { secret, email, name, password } = promoteSchema.parse(req.body);

    if (!safeEqual(secret, env.ADMIN_BOOTSTRAP_SECRET)) {
      return res.status(401).json({ error: { message: 'Invalid bootstrap secret' } });
    }

    const [existing] = await pool.query('SELECT id, role, name FROM users WHERE email = ? LIMIT 1', [email]);
    let userId;

    if (existing?.length) {
      userId = existing[0].id;
      await pool.query('UPDATE users SET role = ? WHERE id = ?', ['admin', userId]);
    } else {
      if (!password) {
        return res.status(400).json({ error: { message: 'password is required to create a new admin' } });
      }
      const passwordHash = await bcrypt.hash(password, 12);
      const [result] = await pool.query('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)', [
        name ?? 'Admin',
        email,
        passwordHash,
        'admin',
      ]);
      userId = result.insertId;
    }

    const [tvRows] = await pool.query('SELECT token_version FROM users WHERE id = ? LIMIT 1', [userId]);
    const tokenVersion = tvRows?.[0]?.token_version ?? 0;
    const token = signAccessToken({ userId, role: 'admin', tokenVersion });
    return res.json({ ok: true, token });
  } catch (err) {
    return next(err);
  }
}
