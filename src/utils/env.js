import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().min(1).default('127.0.0.1'),

  DB_HOST: z.string().min(1).default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().min(1).default('root'),
  DB_PASSWORD: z.string().optional().default(''),
  DB_NAME: z.string().min(1).default('love_and_flour_lms'),

  // NOTE: JWT_SECRET is kept for backward compatibility. Prefer JWT_ACCESS_SECRET.
  JWT_SECRET: z.string().min(24).optional().default('change_me_change_me_change_me'),
  JWT_ACCESS_SECRET: z.string().min(24).optional().default(''),
  JWT_ACCESS_TTL: z.string().min(2).default('15m'),
  JWT_ISSUER: z.string().min(1).default('love-and-flour-backend'),
  JWT_AUDIENCE: z.string().min(1).default('love-and-flour-web'),

  TOKEN_HASH_SECRET: z.string().min(32).optional().default(''),

  ADMIN_BOOTSTRAP_SECRET: z.string().optional().default(''),
  ADMIN_BOOTSTRAP_ENABLED: z
    .string()
    .optional()
    .default('')
    .transform((v) => {
      if (v === '') return null;
      return v === 'true' || v === '1';
    }),

  // SMTP email delivery
  SMTP_PROVIDER: z.enum(['custom', 'gmail', 'sendgrid', 'mailgun']).optional().default('custom'),
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z
    .string()
    .optional()
    .default('')
    .transform((v) => {
      if (v === '') return null;
      return v === 'true' || v === '1';
    }),
  SMTP_REQUIRE_TLS: z
    .string()
    .optional()
    .default('')
    .transform((v) => {
      if (v === '') return null;
      return v === 'true' || v === '1';
    }),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASSWORD: z.string().optional().default(''),
  SMTP_FROM_EMAIL: z.string().optional().default('no-reply@loveandflour.local'),
  SMTP_FROM_NAME: z.string().optional().default('Love & Flour'),
  SMTP_TLS_REJECT_UNAUTHORIZED: z
    .string()
    .optional()
    .default('')
    .transform((v) => {
      if (v === '') return null;
      return v === 'true' || v === '1';
    }),

  PUBLIC_WEB_BASE_URL: z.string().min(1).default('http://localhost:5173'),
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional().default(''),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional().default(''),
  // Optional override (otherwise derived from request host): e.g. http://localhost:8080/api/auth/google/callback
  GOOGLE_OAUTH_REDIRECT_URI: z.string().optional().default(''),

  ALLOWED_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),

  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  AUTH_REFRESH_COOKIE_NAME: z.string().min(1).default('refresh_token'),
  AUTH_COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  COOKIE_DOMAIN: z.string().optional().default(''),
  COOKIE_SECURE: z
    .string()
    .optional()
    .default('')
    .transform((v) => {
      if (v === '') return null;
      return v === 'true' || v === '1';
    }),

  RATE_LIMIT_GENERAL_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_GENERAL_MAX: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_AUTH_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(15),
  RATE_LIMIT_BOOTSTRAP_WINDOW_MS: z.coerce.number().int().positive().default(10 * 60_000),
  RATE_LIMIT_BOOTSTRAP_MAX: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_PASSWORD_WINDOW_MS: z.coerce.number().int().positive().default(60 * 60_000),
  RATE_LIMIT_PASSWORD_MAX: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_SEARCH_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_SEARCH_MAX: z.coerce.number().int().positive().default(120),

  RATE_LIMIT_PAYMENTS_WINDOW_MS: z.coerce.number().int().positive().default(10 * 60_000),
  RATE_LIMIT_PAYMENTS_MAX: z.coerce.number().int().positive().default(40),
  RATE_LIMIT_COUPONS_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_COUPONS_MAX: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_ADMIN_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_ADMIN_MAX: z.coerce.number().int().positive().default(600),

  SLOW_QUERY_MS: z.coerce.number().int().positive().default(700),

  RAZORPAY_KEY_ID: z.string().optional().default(''),
  RAZORPAY_KEY_SECRET: z.string().optional().default(''),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional().default(''),
  RAZORPAY_ACCOUNT_ID: z.string().optional().default(''),

  // Payments: this project currently uses Razorpay. Stripe envs removed to avoid confusion.

  STORAGE_PROVIDER: z.enum(['local']).default('local'),
  MEDIA_LOCAL_ROOT: z.string().min(1).default('./uploads'),

  MEDIA_MAX_IMAGE_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  MEDIA_MAX_PDF_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),
  MEDIA_MAX_VIDEO_BYTES: z.coerce.number().int().positive().default(500 * 1024 * 1024),

  REDIS_ENABLED: z
    .string()
    .optional()
    .default('')
    .transform((v) => {
      if (v === '') return null;
      return v === 'true' || v === '1';
    }),
  REDIS_URL: z.string().optional().default('redis://127.0.0.1:6379'),
  REDIS_PREFIX: z.string().min(1).default('laf'),

  METRICS_ENABLED: z
    .string()
    .optional()
    .default('')
    .transform((v) => {
      if (v === '') return null;
      return v === 'true' || v === '1';
    }),
  METRICS_TOKEN: z.string().optional().default(''),

  HEALTH_DEEP_TOKEN: z.string().optional().default(''),

  WORKER_ENABLED: z
    .string()
    .optional()
    .default('')
    .transform((v) => {
      if (v === '') return null;
      return v === 'true' || v === '1';
    }),

  // Optional: serve the built frontend SPA from the backend (single origin deploy).
  SERVE_FRONTEND: z
    .string()
    .optional()
    .default('')
    .transform((v) => {
      if (v === '') return null;
      return v === 'true' || v === '1';
    }),
  FRONTEND_DIST_PATH: z.string().optional().default(''),

  // Web Push (VAPID)
  VAPID_SUBJECT: z.string().optional().default(''),
  VAPID_PUBLIC_KEY: z.string().optional().default(''),
  VAPID_PRIVATE_KEY: z.string().optional().default(''),
});

const parsed = schema.parse(process.env);

// Post-parse hardening + defaults that depend on NODE_ENV.
const isProd = parsed.NODE_ENV === 'production';

export const env = {
  ...parsed,
  JWT_ACCESS_SECRET: parsed.JWT_ACCESS_SECRET || parsed.JWT_SECRET,
  ADMIN_BOOTSTRAP_ENABLED: parsed.ADMIN_BOOTSTRAP_ENABLED ?? (isProd ? false : true),
  COOKIE_SECURE: parsed.COOKIE_SECURE ?? null,
  REDIS_ENABLED: parsed.REDIS_ENABLED ?? (isProd ? true : false),
  METRICS_ENABLED: parsed.METRICS_ENABLED ?? (isProd ? true : false),
  WORKER_ENABLED: parsed.WORKER_ENABLED ?? true,
  SERVE_FRONTEND: parsed.SERVE_FRONTEND ?? false,
  SMTP_SECURE: parsed.SMTP_SECURE ?? null,
  SMTP_REQUIRE_TLS: parsed.SMTP_REQUIRE_TLS ?? null,
  SMTP_TLS_REJECT_UNAUTHORIZED: parsed.SMTP_TLS_REJECT_UNAUTHORIZED ?? null,
};

const publicWebOrigin = (() => {
  try {
    return new URL(String(env.PUBLIC_WEB_BASE_URL ?? '').trim()).origin;
  } catch {
    return '';
  }
})();

if (publicWebOrigin && !env.ALLOWED_ORIGINS.includes(publicWebOrigin)) {
  env.ALLOWED_ORIGINS = [...env.ALLOWED_ORIGINS, publicWebOrigin];
}

if (isProd) {
  if (!env.JWT_ACCESS_SECRET) {
    throw new Error('JWT_ACCESS_SECRET is required in production');
  }
  if (!env.TOKEN_HASH_SECRET) {
    throw new Error('TOKEN_HASH_SECRET is required in production');
  }
  if (parsed.JWT_SECRET === 'change_me_change_me_change_me') {
    throw new Error('JWT_SECRET/JWT_ACCESS_SECRET must not use the default value in production');
  }
  if (!parsed.ADMIN_BOOTSTRAP_SECRET && env.ADMIN_BOOTSTRAP_ENABLED) {
    throw new Error('ADMIN_BOOTSTRAP_SECRET is required when ADMIN_BOOTSTRAP_ENABLED is true');
  }
  if (env.ALLOWED_ORIGINS.includes('*')) {
    throw new Error('ALLOWED_ORIGINS must not include "*" in production when using credentialed CORS');
  }

  // SMTP: production hardening (optional feature; validated when enabled).
  if (env.SMTP_HOST) {
    if (!env.SMTP_FROM_EMAIL) throw new Error('SMTP_FROM_EMAIL is required when SMTP_HOST is set');
    if (!env.SMTP_USER || !env.SMTP_PASSWORD) throw new Error('SMTP_USER and SMTP_PASSWORD are required when SMTP_HOST is set');
  }

  // Payments: allow running without providers configured, but if webhooks are enabled they must be secreted.
  // (Providers are environment-specific; staging may configure one.)
}
