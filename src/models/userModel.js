import { pool } from '../config/db.js';

export async function findUserByEmail(email) {
  const [rows] = await pool.query(
    `SELECT id, name, email, password, role, email_verified_at, token_version, password_changed_at,
            failed_login_count, locked_until, created_at
       FROM users
      WHERE email = ?
      LIMIT 1`,
    [email],
  );
  return rows?.[0] ?? null;
}

export async function findUserById(id) {
  const [rows] = await pool.query(
    'SELECT id, name, email, role, phone, email_verified_at, token_version, created_at FROM users WHERE id = ? LIMIT 1',
    [id],
  );
  return rows?.[0] ?? null;
}

export async function createUser({ name, email, passwordHash, role = 'user' }) {
  const [result] = await pool.query('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)', [
    name,
    email,
    passwordHash,
    role,
  ]);

  return {
    id: result.insertId,
    name,
    email,
    role,
  };
}

export async function recordLoginSuccess({ userId }) {
  await pool.query('UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = NOW() WHERE id = ?', [
    userId,
  ]);
}

export async function recordLoginFailure({ userId, maxFailures = 10, lockMinutes = 15 }) {
  const [rows] = await pool.query(
    `UPDATE users
        SET failed_login_count = failed_login_count + 1,
            locked_until = CASE
              WHEN failed_login_count + 1 >= ? THEN DATE_ADD(NOW(), INTERVAL ? MINUTE)
              ELSE locked_until
            END
      WHERE id = ?`,
    [maxFailures, lockMinutes, userId],
  );
  return rows;
}

export async function setEmailVerified({ userId }) {
  await pool.query('UPDATE users SET email_verified_at = NOW() WHERE id = ? AND email_verified_at IS NULL', [userId]);
}

export async function setPasswordHashAndBumpVersion({ userId, passwordHash }) {
  await pool.query(
    'UPDATE users SET password = ?, password_changed_at = NOW(), token_version = token_version + 1 WHERE id = ?',
    [passwordHash, userId],
  );
}

export async function bumpTokenVersion({ userId }) {
  await pool.query('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [userId]);
}

export async function getUserTokenVersion({ userId }) {
  const [rows] = await pool.query('SELECT token_version FROM users WHERE id = ? LIMIT 1', [userId]);
  return rows?.[0]?.token_version ?? null;
}

export async function getUserAuthState({ userId }) {
  const [rows] = await pool.query('SELECT role, token_version FROM users WHERE id = ? LIMIT 1', [userId]);
  return rows?.[0] ?? null;
}

export async function updateUserProfile({ userId, name, phone }) {
  const updates = [];
  const values = [];
  if (name !== undefined) {
    updates.push('name = ?');
    values.push(name);
  }
  if (phone !== undefined) {
    updates.push('phone = ?');
    values.push(phone);
  }
  if (!updates.length) {
    return findUserById(userId);
  }
  values.push(userId);
  await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);
  return findUserById(userId);
}

export async function listAdminUsers({ limit = 50 } = {}) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const [rows] = await pool.query(
    `SELECT id, email, name
       FROM users
      WHERE role IN ('admin', 'super_admin')
   ORDER BY id ASC
      LIMIT ?`,
    [safeLimit],
  );
  return rows ?? [];
}
