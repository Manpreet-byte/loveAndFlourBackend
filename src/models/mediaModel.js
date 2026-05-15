import { pool } from '../config/db.js';

function pickConn(conn) {
  return conn ?? pool;
}

export async function createMediaFile(
  {
    uploadedBy,
    fileName,
    originalFileName,
    fileType,
    mimeType,
    sizeBytes,
    sha256,
    storageProvider,
    storagePath,
    publicUrl = null,
    isPublic = false,
  },
  { conn } = {},
) {
  const db = pickConn(conn);
  const [result] = await db.query(
    `INSERT INTO media_files
      (uploaded_by, file_name, original_file_name, file_type, mime_type, size_bytes, sha256,
       storage_provider, storage_path, public_url, is_public, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploaded')`,
    [
      uploadedBy,
      fileName,
      originalFileName ?? null,
      fileType,
      mimeType,
      sizeBytes,
      sha256,
      storageProvider,
      storagePath,
      publicUrl ?? null,
      isPublic ? 1 : 0,
    ],
  );
  return result.insertId;
}

export async function getMediaFileById({ id }, { conn } = {}) {
  const db = pickConn(conn);
  const [rows] = await db.query(
    `SELECT id, uploaded_by, file_name, original_file_name, file_type, mime_type, size_bytes,
            storage_provider, storage_path, public_url, is_public, status, deleted_at, created_at
       FROM media_files
      WHERE id = ?
      LIMIT 1`,
    [id],
  );
  return rows?.[0] ?? null;
}

export async function listMediaFilesForUser({ userId, limit = 200 }, { conn } = {}) {
  const db = pickConn(conn);
  const [rows] = await db.query(
    `SELECT id, file_name, file_type, mime_type, size_bytes, is_public, status, created_at
       FROM media_files
      WHERE uploaded_by = ?
   ORDER BY id DESC
      LIMIT ?`,
    [userId, limit],
  );
  return rows;
}

export async function markMediaDeleted({ id }, { conn } = {}) {
  const db = pickConn(conn);
  const [result] = await db.query(
    `UPDATE media_files
        SET status = 'deleted', deleted_at = NOW()
      WHERE id = ? AND status <> 'deleted'`,
    [id],
  );
  return result.affectedRows ?? 0;
}

