import bcrypt from 'bcrypt';
import { z } from 'zod';
import { pool } from '../config/db.js';

const adminIdSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const resetPasswordSchema = z.object({
  password: z.string().min(8).max(72),
});

const transferSchema = z.object({
  targetUserId: z.coerce.number().int().positive(),
});

async function findAdminUserById(userId) {
  const [rows] = await pool.query(
    `SELECT id, name, email, role, token_version
       FROM users
      WHERE id = ?
      LIMIT 1`,
    [userId],
  );
  return rows?.[0] ?? null;
}

export async function superListAdmins(_req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, email, role, last_login_at, password_changed_at, created_at
         FROM users
        WHERE role IN ('admin','super_admin')
     ORDER BY role DESC, id ASC
        LIMIT 500`,
    );
    return res.json({ admins: rows ?? [] });
  } catch (err) {
    return next(err);
  }
}

// "Delete admin" in a safe way: revoke admin access instead of hard-deleting the user row
// (hard deletes often fail due to foreign keys and lose audit history).
export async function superRevokeAdmin(req, res, next) {
  try {
    const { id } = adminIdSchema.parse(req.params);
    const actorId = Number(req.user?.id);

    if (Number(id) === actorId) {
      return res.status(400).json({ error: { message: 'You cannot revoke your own admin access.' } });
    }

    const target = await findAdminUserById(id);
    if (!target) return res.status(404).json({ error: { message: 'User not found.' } });
    if (target.role !== 'admin' && target.role !== 'super_admin') {
      return res.status(400).json({ error: { message: 'Target user is not an admin.' } });
    }

    // Never allow removing the last super_admin.
    if (target.role === 'super_admin') {
      const [rows] = await pool.query(`SELECT COUNT(*) AS c FROM users WHERE role = 'super_admin'`);
      const count = Number(rows?.[0]?.c ?? 0);
      if (count <= 1) {
        return res.status(400).json({ error: { message: 'Cannot revoke the last super admin.' } });
      }
    }

    await pool.query(
      `UPDATE users
          SET role = 'user',
              token_version = token_version + 1,
              locked_until = NULL
        WHERE id = ?
        LIMIT 1`,
      [id],
    );
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

export async function superResetAdminPassword(req, res, next) {
  try {
    const { id } = adminIdSchema.parse(req.params);
    const { password } = resetPasswordSchema.parse(req.body ?? {});

    const target = await findAdminUserById(id);
    if (!target) return res.status(404).json({ error: { message: 'User not found.' } });
    if (target.role !== 'admin' && target.role !== 'super_admin') {
      return res.status(400).json({ error: { message: 'Target user is not an admin.' } });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await pool.query(
      `UPDATE users
          SET password = ?,
              token_version = token_version + 1,
              password_changed_at = CURRENT_TIMESTAMP
        WHERE id = ?
        LIMIT 1`,
      [passwordHash, id],
    );

    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

export async function superTransferSuperAdmin(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const { targetUserId } = transferSchema.parse(req.body ?? {});
    const actorId = Number(req.user?.id);

    await conn.beginTransaction();

    const [targetRows] = await conn.query(
      `SELECT id, role
         FROM users
        WHERE id = ?
        LIMIT 1`,
      [targetUserId],
    );
    const target = targetRows?.[0] ?? null;
    if (!target) {
      await conn.rollback();
      return res.status(404).json({ error: { message: 'Target user not found.' } });
    }
    if (String(target.role) !== 'admin' && String(target.role) !== 'super_admin') {
      await conn.rollback();
      return res.status(400).json({ error: { message: 'Target user must be an admin.' } });
    }

    // Enforce a single super_admin:
    await conn.query(`UPDATE users SET role = 'admin' WHERE role = 'super_admin'`);
    await conn.query(`UPDATE users SET role = 'super_admin' WHERE id = ? LIMIT 1`, [targetUserId]);

    // Revoke all existing sessions for both actor and target (forces re-login with new role).
    await conn.query(
      `UPDATE users
          SET token_version = token_version + 1
        WHERE id IN (?, ?)
      `,
      [actorId, targetUserId],
    );

    await conn.commit();
    return res.json({ ok: true });
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      // ignore
    }
    return next(err);
  } finally {
    conn.release();
  }
}

