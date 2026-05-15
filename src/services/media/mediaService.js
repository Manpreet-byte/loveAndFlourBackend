import path from 'node:path';
import crypto from 'node:crypto';
import { PassThrough } from 'node:stream';
import { env } from '../../utils/env.js';
import { getStorage } from '../storage/index.js';
import { createMediaFile, getMediaFileById, listMediaFilesForUser, markMediaDeleted } from '../../models/mediaModel.js';
import { detectFileTypeFromHeader } from './sniff.js';

function sanitizeBaseName(name) {
  const base = path.basename(String(name || 'file'));
  return base.replace(/[^\w.\-]+/g, '_').slice(0, 200) || 'file';
}

function randomId() {
  return crypto.randomBytes(16).toString('hex');
}

function getLimitForType(fileType) {
  if (fileType === 'image') return env.MEDIA_MAX_IMAGE_BYTES;
  if (fileType === 'pdf') return env.MEDIA_MAX_PDF_BYTES;
  if (fileType === 'video') return env.MEDIA_MAX_VIDEO_BYTES;
  return env.MEDIA_MAX_PDF_BYTES;
}

function canUpload({ role, fileType }) {
  // Conservative defaults: videos require admin until we add async processing / quotas.
  if (fileType === 'video') return role === 'admin';
  return role === 'admin' || role === 'user';
}

export async function storeUploadedStream({ user, fileStream, originalFileName, declaredMimeType, isPublic = false }) {
  // Sniff first bytes while preserving stream data (no dropping).
  const { headerBytes, bufferedBytes } = await new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let ended = false;

    function cleanup() {
      fileStream.off('data', onData);
      fileStream.off('error', onErr);
      fileStream.off('end', onEnd);
    }

    function onData(chunk) {
      chunks.push(chunk);
      total += chunk.length;
      if (total >= 16) {
        cleanup();
        fileStream.pause();
        const buf = Buffer.concat(chunks);
        resolve({ headerBytes: buf.subarray(0, 16), bufferedBytes: buf });
      }
    }

    function onErr(err) {
      cleanup();
      reject(err);
    }

    function onEnd() {
      ended = true;
      cleanup();
      if (total <= 0) {
        const err = new Error('Empty upload');
        err.status = 400;
        reject(err);
        return;
      }
      fileStream.pause();
      const buf = Buffer.concat(chunks);
      resolve({ headerBytes: buf.subarray(0, 16), bufferedBytes: buf });
    }

    fileStream.on('data', onData);
    fileStream.on('error', onErr);
    fileStream.on('end', onEnd);
  });

  const sniffed = detectFileTypeFromHeader(headerBytes);

  // If sniffed is "other", allow only video types by MIME allowlist (metadata-only acceptance).
  let fileType = sniffed.fileType;
  let mimeType = sniffed.mimeType;
  let ext = sniffed.ext;

  const declared = String(declaredMimeType || '').toLowerCase();
  const safeFileName = String(originalFileName || '').toLowerCase();
  const hasWebmExt = safeFileName.endsWith('.webm');
  const hasMp4Ext = safeFileName.endsWith('.mp4') || safeFileName.endsWith('.m4v');
  const hasMovExt = safeFileName.endsWith('.mov');
  const hasMkvExt = safeFileName.endsWith('.mkv');
  const isVideoMime =
    declared.startsWith('video/') ||
    declared === 'application/octet-stream' ||
    declared === 'application/x-matroska' ||
    hasWebmExt ||
    hasMp4Ext ||
    hasMovExt ||
    hasMkvExt;

  if (fileType === 'other') {
    if (!isVideoMime) {
      const err = new Error('Unsupported file type');
      err.status = 400;
      throw err;
    }
    fileType = 'video';
    if (declared.startsWith('video/')) {
      mimeType = declared;
      ext = declared.includes('webm') ? 'webm' : 'mp4';
    } else if (hasWebmExt) {
      mimeType = 'video/webm';
      ext = 'webm';
    } else if (hasMovExt) {
      mimeType = 'video/quicktime';
      ext = 'mov';
    } else if (hasMkvExt) {
      mimeType = 'video/x-matroska';
      ext = 'mkv';
    } else {
      mimeType = 'video/mp4';
      ext = 'mp4';
    }
  }

  if (!canUpload({ role: user.role, fileType })) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }

  const limit = getLimitForType(fileType);
  const safeOriginal = sanitizeBaseName(originalFileName);
  const storagePath = `${new Date().toISOString().slice(0, 10).replace(/-/g, '/')}/${randomId()}${ext ? `.${ext}` : ''}`;

  // Re-stream: header bytes already consumed. Prepend them back.
  const passthrough = new PassThrough();
  passthrough.write(bufferedBytes);
  fileStream.pipe(passthrough);
  fileStream.resume();

  const storage = getStorage();
  const put = await storage.putObjectStream({ storagePath, stream: passthrough, sizeLimitBytes: limit });

  const fileName = `${randomId()}_${safeOriginal}`.slice(0, 255);

  const mediaId = await createMediaFile({
    uploadedBy: user.id,
    fileName,
    originalFileName: safeOriginal,
    fileType,
    mimeType,
    sizeBytes: put.sizeBytes,
    sha256: put.sha256,
    storageProvider: storage.provider ?? env.STORAGE_PROVIDER,
    storagePath: put.storagePath,
    publicUrl: null,
    isPublic,
  });

  return { mediaId, fileType, mimeType, sizeBytes: put.sizeBytes };
}

export async function getMediaMetadata({ id }) {
  const media = await getMediaFileById({ id });
  return media;
}

export async function listUserMedia({ userId }) {
  return listMediaFilesForUser({ userId });
}

export async function deleteMedia({ id, actor }) {
  const media = await getMediaFileById({ id });
  if (!media) {
    const err = new Error('Not found');
    err.status = 404;
    throw err;
  }
  const isOwner = Number(media.uploaded_by) === Number(actor.id);
  const isAdmin = actor.role === 'admin';
  if (!isOwner && !isAdmin) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }

  await markMediaDeleted({ id });
  // Physical deletion is deferred: keeps auditability and avoids breaking references.
  return { ok: true };
}
