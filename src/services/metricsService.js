import client from 'prom-client';
import { env } from '../utils/env.js';
import { getCacheStats } from './cacheService.js';
import { isRedisAvailable, isRedisEnabled } from './redis/redisClient.js';

const register = new client.Registry();
register.setDefaultLabels({ service: 'love-and-flour-backend' });
client.collectDefaultMetrics({ register });

export const httpRequestDurationMs = new client.Histogram({
  name: 'http_request_duration_ms',
  help: 'HTTP request duration in ms',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
  registers: [register],
});

export const httpRequestTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'HTTP request count',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

export const dbQueryDurationMs = new client.Histogram({
  name: 'db_query_duration_ms',
  help: 'MySQL query duration in ms',
  labelNames: ['ok'],
  buckets: [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500],
  registers: [register],
});

export const externalIntegrationTotal = new client.Counter({
  name: 'external_integrations_total',
  help: 'External integration calls',
  labelNames: ['integration', 'result'],
  registers: [register],
});

export const workerLoopDurationMs = new client.Histogram({
  name: 'worker_loop_duration_ms',
  help: 'Worker loop duration in ms',
  labelNames: ['job'],
  buckets: [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
  registers: [register],
});

export const workerErrorsTotal = new client.Counter({
  name: 'worker_errors_total',
  help: 'Worker errors count',
  labelNames: ['job'],
  registers: [register],
});

export async function metricsText() {
  if (!env.METRICS_ENABLED) return '';

  const cacheStats = getCacheStats();
  const cacheGauge = register.getSingleMetric('cache_stats') ??
    new client.Gauge({
      name: 'cache_stats',
      help: 'Cache stats snapshot',
      labelNames: ['metric'],
      registers: [register],
    });

  cacheGauge.set({ metric: 'hits' }, cacheStats.hits);
  cacheGauge.set({ metric: 'misses' }, cacheStats.misses);
  cacheGauge.set({ metric: 'sets' }, cacheStats.sets);
  cacheGauge.set({ metric: 'errors' }, cacheStats.errors);
  cacheGauge.set({ metric: 'bypass' }, cacheStats.bypass);
  cacheGauge.set({ metric: 'invalidations' }, cacheStats.invalidations);

  const redisGauge = register.getSingleMetric('redis_available') ??
    new client.Gauge({
      name: 'redis_available',
      help: 'Redis availability (1/0)',
      registers: [register],
    });
  redisGauge.set(isRedisEnabled() && isRedisAvailable() ? 1 : 0);

  return register.metrics();
}

