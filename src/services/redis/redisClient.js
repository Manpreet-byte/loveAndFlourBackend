import { createClient } from 'redis';
import { env } from '../../utils/env.js';

let client;
let connecting;
let available = false;

export function isRedisEnabled() {
  return !!env.REDIS_ENABLED;
}

export function isRedisAvailable() {
  return available;
}

export async function getRedisClient() {
  if (!isRedisEnabled()) return null;
  if (client) return client;
  if (connecting) return connecting;

  connecting = (async () => {
    const c = createClient({ url: env.REDIS_URL });
    c.on('error', () => {
      available = false;
    });
    c.on('ready', () => {
      available = true;
    });
    c.on('end', () => {
      available = false;
    });

    try {
      await c.connect();
      client = c;
      available = true;
      return client;
    } catch {
      available = false;
      try {
        await c.quit();
      } catch {
        // ignore
      }
      client = null;
      return null;
    } finally {
      connecting = null;
    }
  })();

  return connecting;
}

