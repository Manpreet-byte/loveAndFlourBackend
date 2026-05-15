import rateLimit from 'express-rate-limit';
import { env } from '../utils/env.js';
import RedisStore from 'rate-limit-redis';
import { getRedisClient } from '../services/redis/redisClient.js';

function ipKey(req) {
  return req.ip;
}

const redisClient = await getRedisClient();
const redisStore =
  redisClient && env.REDIS_ENABLED
    ? new RedisStore({
        sendCommand: (...args) => redisClient.sendCommand(args),
      })
    : undefined;

export const generalApiLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_GENERAL_WINDOW_MS,
  max: env.RATE_LIMIT_GENERAL_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKey,
  store: redisStore,
});

export const authLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_AUTH_WINDOW_MS,
  max: env.RATE_LIMIT_AUTH_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKey,
  store: redisStore,
});

export const bootstrapLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_BOOTSTRAP_WINDOW_MS,
  max: env.RATE_LIMIT_BOOTSTRAP_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKey,
  store: redisStore,
});

export const passwordLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_PASSWORD_WINDOW_MS,
  max: env.RATE_LIMIT_PASSWORD_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKey,
  store: redisStore,
});

export const searchLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_SEARCH_WINDOW_MS,
  max: env.RATE_LIMIT_SEARCH_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKey,
  store: redisStore,
});

export const paymentsLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_PAYMENTS_WINDOW_MS,
  max: env.RATE_LIMIT_PAYMENTS_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKey,
  store: redisStore,
});

export const couponsLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_COUPONS_WINDOW_MS,
  max: env.RATE_LIMIT_COUPONS_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKey,
  store: redisStore,
});

export const adminLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_ADMIN_WINDOW_MS,
  max: env.RATE_LIMIT_ADMIN_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKey,
  store: redisStore,
});
