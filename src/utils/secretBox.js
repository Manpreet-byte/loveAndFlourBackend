import crypto from 'node:crypto';
import { env } from './env.js';

function getKey() {
  const secret = String(env.TOKEN_HASH_SECRET ?? '').trim() || String(env.JWT_ACCESS_SECRET ?? '').trim();
  if (!secret) {
    const err = new Error('TOKEN_HASH_SECRET (or JWT_ACCESS_SECRET) is required to encrypt/decrypt provider secrets');
    err.status = 500;
    throw err;
  }
  return crypto.createHash('sha256').update(secret).digest(); // 32 bytes
}

export function encryptSecret(plaintext) {
  const text = String(plaintext ?? '');
  if (!text) return null;
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

export function decryptSecret(packed) {
  const raw = String(packed ?? '').trim();
  if (!raw) return null;
  const [v, ivB64, tagB64, dataB64] = raw.split(':');
  if (v !== 'v1' || !ivB64 || !tagB64 || !dataB64) return null;
  const key = getKey();
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  return plaintext;
}
