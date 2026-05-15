import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import crypto from 'node:crypto';
import { env } from '../../utils/env.js';

function resolveRoot() {
  // MEDIA_LOCAL_ROOT is relative to backend/ process cwd.
  return path.resolve(process.cwd(), env.MEDIA_LOCAL_ROOT);
}

export class LocalStorageAdapter {
  provider = 'local';

  async putObjectStream({ storagePath, stream, sizeLimitBytes }) {
    const root = resolveRoot();
    const fullPath = path.join(root, storagePath);
    const dir = path.dirname(fullPath);
    await fsp.mkdir(dir, { recursive: true });

    const hash = crypto.createHash('sha256');
    let size = 0;

    const out = fs.createWriteStream(fullPath, { flags: 'wx' });
    stream.on('data', (chunk) => {
      size += chunk.length;
      if (sizeLimitBytes && size > sizeLimitBytes) {
        const err = new Error('File too large');
        err.status = 413;
        stream.destroy(err);
        return;
      }
      hash.update(chunk);
    });

    await pipeline(stream, out);

    return {
      sizeBytes: size,
      sha256: hash.digest(),
      storagePath,
    };
  }

  async getObjectStream({ storagePath }) {
    const root = resolveRoot();
    const fullPath = path.join(root, storagePath);
    return fs.createReadStream(fullPath);
  }

  async deleteObject({ storagePath }) {
    const root = resolveRoot();
    const fullPath = path.join(root, storagePath);
    await fsp.rm(fullPath, { force: true });
  }
}
