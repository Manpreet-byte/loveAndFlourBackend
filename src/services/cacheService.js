import { env } from '../utils/env.js';
import { getRedisClient, isRedisEnabled, isRedisAvailable } from './redis/redisClient.js';

const inflight = new Map();
const stats = {
  hits: 0,
  misses: 0,
  sets: 0,
  errors: 0,
  bypass: 0,
  invalidations: 0,
};

function prefixKey(key) {
  return `${env.REDIS_PREFIX}:cache:${key}`;
}

function nsVersionKey(ns) {
  return `${env.REDIS_PREFIX}:nsver:${ns}`;
}

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export async function getNamespaceVersion(ns) {
  if (!isRedisEnabled()) return '0';
  const client = await getRedisClient();
  if (!client || !isRedisAvailable()) return '0';

  const k = nsVersionKey(ns);
  const v = await client.get(k);
  if (v) return v;
  await client.set(k, '1', { NX: true });
  return (await client.get(k)) ?? '1';
}

export async function bumpNamespace(ns) {
  stats.invalidations += 1;
  if (!isRedisEnabled()) return { ok: false };
  const client = await getRedisClient();
  if (!client || !isRedisAvailable()) return { ok: false };
  await client.incr(nsVersionKey(ns));
  return { ok: true };
}

export async function cacheGet(key) {
  if (!isRedisEnabled()) {
    stats.bypass += 1;
    return null;
  }
  const client = await getRedisClient();
  if (!client || !isRedisAvailable()) {
    stats.bypass += 1;
    return null;
  }
  const v = await client.get(prefixKey(key));
  if (!v) return null;
  return safeJsonParse(v);
}

export async function cacheSet(key, value, { ttlSeconds = 60 } = {}) {
  if (!isRedisEnabled()) return { ok: false };
  const client = await getRedisClient();
  if (!client || !isRedisAvailable()) return { ok: false };

  stats.sets += 1;
  await client.set(prefixKey(key), JSON.stringify(value), { EX: ttlSeconds });
  return { ok: true };
}

export async function cacheDel(key) {
  if (!isRedisEnabled()) return { ok: false };
  const client = await getRedisClient();
  if (!client || !isRedisAvailable()) return { ok: false };
  await client.del(prefixKey(key));
  return { ok: true };
}

export function getCacheStats() {
  return { ...stats, redis_available: isRedisAvailable() };
}

export async function cacheWrap({ ns, key, ttlSeconds, compute }) {
  const version = await getNamespaceVersion(ns);
  const fullKey = `${ns}:v${version}:${key}`;

  const cached = await cacheGet(fullKey);
  if (cached != null) {
    stats.hits += 1;
    return cached;
  }
  stats.misses += 1;

  // Single-flight per process to avoid local stampede.
  if (inflight.has(fullKey)) return inflight.get(fullKey);

  const p = (async () => {
    try {
      const val = await compute();
      await cacheSet(fullKey, val, { ttlSeconds });
      return val;
    } catch (err) {
      stats.errors += 1;
      throw err;
    } finally {
      inflight.delete(fullKey);
    }
  })();

  inflight.set(fullKey, p);
  return p;
}

