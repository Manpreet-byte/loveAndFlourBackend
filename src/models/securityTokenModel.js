import { pool } from '../config/db.js';

function pickConn(conn) {
  return conn ?? pool;
}

export async function insertEmailVerificationToken({ userId, tokenHash, expiresAt }, { conn } = {}) {
  const db = pickConn(conn);
  const [result] = await db.query(
    'INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
    [userId, tokenHash, expiresAt],
  );
  return result.insertId;
}

export async function consumeEmailVerificationToken({ tokenHash }, { conn } = {}) {
  const db = pickConn(conn);
  const [rows] = await db.query(
    `SELECT id, user_id, expires_at, consumed_at
       FROM email_verification_tokens
      WHERE token_hash = ?
      LIMIT 1`,
    [tokenHash],
  );
  const row = rows?.[0];
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.consumed_at) return { ok: false, reason: 'used', userId: row.user_id };
  if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, reason: 'expired', userId: row.user_id };

  await db.query('UPDATE email_verification_tokens SET consumed_at = NOW() WHERE id = ? AND consumed_at IS NULL', [
    row.id,
  ]);
  return { ok: true, userId: row.user_id };
}

export async function deleteUnconsumedEmailVerificationTokensForUser({ userId }, { conn } = {}) {
  const db = pickConn(conn);
  await db.query('DELETE FROM email_verification_tokens WHERE user_id = ? AND consumed_at IS NULL', [userId]);
}

export async function insertPasswordResetToken({ userId, tokenHash, expiresAt }, { conn } = {}) {
  const db = pickConn(conn);
  const [result] = await db.query(
    'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
    [userId, tokenHash, expiresAt],
  );
  return result.insertId;
}

export async function consumePasswordResetToken({ tokenHash }, { conn } = {}) {
  const db = pickConn(conn);
  const [rows] = await db.query(
    `SELECT id, user_id, expires_at, consumed_at
       FROM password_reset_tokens
      WHERE token_hash = ?
      LIMIT 1`,
    [tokenHash],
  );
  const row = rows?.[0];
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.consumed_at) return { ok: false, reason: 'used', userId: row.user_id };
  if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, reason: 'expired', userId: row.user_id };

  await db.query('UPDATE password_reset_tokens SET consumed_at = NOW() WHERE id = ? AND consumed_at IS NULL', [row.id]);
  return { ok: true, userId: row.user_id };
}

export async function deleteUnconsumedPasswordResetTokensForUser({ userId }, { conn } = {}) {
  const db = pickConn(conn);
  await db.query('DELETE FROM password_reset_tokens WHERE user_id = ? AND consumed_at IS NULL', [userId]);
}

