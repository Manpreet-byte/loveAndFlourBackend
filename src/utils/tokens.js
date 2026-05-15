import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from './env.js';

export function generateOpaqueToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function hashToken(token) {
  return crypto.createHmac('sha256', env.TOKEN_HASH_SECRET).update(String(token)).digest();
}

export function generateTokenFamily() {
  return crypto.randomBytes(16);
}

export function signAccessToken({ userId, role, tokenVersion }) {
  const nowSeconds = Math.floor(Date.now() / 1000);

  return jwt.sign(
    {
      id: userId,
      role,
      tv: tokenVersion,
      typ: 'access',
      iat: nowSeconds,
    },
    env.JWT_ACCESS_SECRET,
    {
      expiresIn: env.JWT_ACCESS_TTL,
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      subject: String(userId),
    },
  );
}

export function verifyAccessToken(token) {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, {
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
  });
}

