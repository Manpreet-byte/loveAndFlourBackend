import { pool } from '../config/db.js';

function pickConn(conn) {
  return conn ?? pool;
}

export async function insertRefreshToken(
  { userId, tokenHash, tokenFamily, expiresAt, parentId = null, createdIp = null, userAgent = null },
  { conn } = {},
) {
  const db = pickConn(conn);
  const [result] = await db.query(
    `INSERT INTO refresh_tokens
      (user_id, token_hash, token_family, parent_id, expires_at, created_ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [userId, tokenHash, tokenFamily, parentId, expiresAt, createdIp, userAgent],
  );
  return result.insertId;
}

export async function findRefreshTokenByHash(tokenHash, { conn, forUpdate = false } = {}) {
  const db = pickConn(conn);
  const sql = `
    SELECT id, user_id, token_family, parent_id, expires_at, revoked_at
      FROM refresh_tokens
     WHERE token_hash = ?
     LIMIT 1
     ${forUpdate ? 'FOR UPDATE' : ''}`;
  const [rows] = await db.query(sql, [tokenHash]);
  return rows?.[0] ?? null;
}

export async function revokeRefreshToken({ tokenId, replacedById = null }, { conn } = {}) {
  const db = pickConn(conn);
  await db.query(
    `UPDATE refresh_tokens
        SET revoked_at = NOW(),
            replaced_by_id = COALESCE(?, replaced_by_id)
      WHERE id = ? AND revoked_at IS NULL`,
    [replacedById, tokenId],
  );
}

export async function revokeAllRefreshTokensForUser({ userId }, { conn } = {}) {
  const db = pickConn(conn);
  await db.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL', [userId]);
}

export async function revokeRefreshTokensByFamily({ userId, tokenFamily }, { conn } = {}) {
  const db = pickConn(conn);
  await db.query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND token_family = ? AND revoked_at IS NULL',
    [userId, tokenFamily],
  );
}
