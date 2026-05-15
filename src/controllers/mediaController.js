import Busboy from 'busboy';
import { env } from '../utils/env.js';
import { getStorage } from '../services/storage/index.js';
import { getMediaFileById } from '../models/mediaModel.js';
import { deleteMedia, getMediaMetadata, listUserMedia, storeUploadedStream } from '../services/media/mediaService.js';

function isTruthy(v) {
  return v === true || v === 'true' || v === '1' || v === 1;
}

export async function uploadMedia(req, res, next) {
  try {
    const bb = Busboy({
      headers: req.headers,
      limits: {
        files: 1,
        fileSize: env.MEDIA_MAX_VIDEO_BYTES, // upper bound; per-type enforced during storage.
      },
    });

    let filePromise;
    let isPublic = false;

    bb.on('field', (name, value) => {
      if (name === 'is_public') isPublic = isTruthy(value);
    });

    bb.on('file', (_name, file, info) => {
      if (filePromise) {
        file.resume();
        return;
      }
      file.on('limit', () => {
        const err = new Error('File too large');
        err.status = 413;
        file.destroy(err);
      });
      filePromise = storeUploadedStream({
        user: req.user,
        fileStream: file,
        originalFileName: info.filename,
        declaredMimeType: info.mimeType,
        isPublic,
      });
    });

    bb.on('error', (err) => next(err));

    bb.on('finish', async () => {
      try {
        if (!filePromise) return res.status(400).json({ error: { message: 'No file uploaded' } });
        const result = await filePromise;
        return res.status(201).json({ id: result.mediaId, file_type: result.fileType, mime_type: result.mimeType, size: result.sizeBytes });
      } catch (err) {
        return next(err);
      }
    });

    req.pipe(bb);
  } catch (err) {
    return next(err);
  }
}

function canReadMedia({ media, actor }) {
  if (!media || media.status === 'deleted') return false;
  if (media.is_public) return true;
  if (!actor) return false;
  if (actor.role === 'admin') return true;
  return Number(media.uploaded_by) === Number(actor.id);
}

export async function getMedia(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: { message: 'Invalid media id' } });
    const media = await getMediaMetadata({ id });
    if (!media || media.status === 'deleted') return res.status(404).json({ error: { message: 'Not found' } });

    const actor = req.user ?? null;
    if (!canReadMedia({ media, actor })) return res.status(403).json({ error: { message: 'Forbidden' } });

    const url = media.is_public && media.public_url ? media.public_url : `/api/media/${media.id}/file`;
    return res.json({ media: { ...media, url } });
  } catch (err) {
    return next(err);
  }
}

export async function getMediaFile(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: { message: 'Invalid media id' } });
    const media = await getMediaFileById({ id });
    if (!media || media.status === 'deleted') return res.status(404).json({ error: { message: 'Not found' } });

    const actor = req.user ?? null;
    if (!canReadMedia({ media, actor })) return res.status(403).json({ error: { message: 'Forbidden' } });

    const storage = getStorage();
    const stream = await storage.getObjectStream({ storagePath: media.storage_path });

    res.setHeader('content-type', media.mime_type);
    res.setHeader('content-length', String(media.size_bytes));
    res.setHeader('cache-control', media.is_public ? 'public, max-age=31536000, immutable' : 'private, max-age=0, no-store');
    res.setHeader('content-disposition', `inline; filename="${encodeURIComponent(media.file_name)}"`);
    stream.on('error', (err) => next(err));
    stream.pipe(res);
  } catch (err) {
    return next(err);
  }
}

export async function deleteMediaById(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: { message: 'Invalid media id' } });
    const result = await deleteMedia({ id, actor: req.user });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

export async function listMediaForUser(req, res, next) {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ error: { message: 'Invalid user id' } });
    const actor = req.user;
    if (actor.role !== 'admin' && Number(actor.id) !== Number(userId)) {
      return res.status(403).json({ error: { message: 'Forbidden' } });
    }
    const media = await listUserMedia({ userId });
    return res.json({ media });
  } catch (err) {
    return next(err);
  }
}
