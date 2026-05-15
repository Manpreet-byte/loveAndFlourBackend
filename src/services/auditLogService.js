import { pool } from '../config/db.js';

const SENSITIVE_KEYS = new Set([
  'password',
  'newPassword',
  'token',
  'refresh_token',
  'refreshToken',
  'access_token',
  'accessToken',
  'jwt',
  'secret',
  'signature',
  'authorization',
  'cookie',
  'otp',
  'code',
]);

function redact(value) {
  if (value == null) return value;
  if (typeof value === 'string') return value.length > 12 ? `${value.slice(0, 4)}…${value.slice(-4)}` : '[redacted]';
  return '[redacted]';
}

function sanitize(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.slice(0, 50).map((v) => sanitize(v));

  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(k)) out[k] = redact(v);
    else if (typeof v === 'object') out[k] = sanitize(v);
    else out[k] = v;
  }
  return out;
}

function safeJson(obj) {
  try {
    return JSON.stringify(sanitize(obj ?? {}));
  } catch {
    return '{}';
  }
}

export function getRequestAuditContext(req) {
  return {
    ipAddress: req.ip ?? null,
    userAgent: String(req.headers['user-agent'] ?? '').slice(0, 255) || null,
    method: req.method ?? null,
    path: String(req.originalUrl ?? req.url ?? '').slice(0, 255) || null,
  };
}

export function logAuditEvent(event) {
  // Non-blocking: fire-and-forget insert.
  setImmediate(() => {
    pool
      .query(
        `INSERT INTO audit_logs
          (actor_type, actor_id, action_type, entity_type, entity_id, metadata_json, ip_address, user_agent, method, path, status_code)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          event.actorType,
          event.actorId ?? null,
          event.actionType,
          event.entityType ?? null,
          event.entityId ?? null,
          event.metadata ? safeJson(event.metadata) : null,
          event.ipAddress ?? null,
          event.userAgent ?? null,
          event.method ?? null,
          event.path ?? null,
          event.statusCode ?? null,
        ],
      )
      .catch(() => {
        // Intentionally ignore audit write failures to avoid breaking main flows.
      });
  });
}

