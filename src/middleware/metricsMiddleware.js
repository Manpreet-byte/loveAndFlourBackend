import { httpRequestDurationMs, httpRequestTotal } from '../services/metricsService.js';

export function metricsMiddleware() {
  return function metrics(req, res, next) {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const end = process.hrtime.bigint();
      const ms = Number(end - start) / 1e6;
      const route = req.route?.path ? String(req.route.path) : req.path || 'unknown';
      const status = String(res.statusCode);
      httpRequestTotal.inc({ method: req.method, route, status_code: status });
      httpRequestDurationMs.observe({ method: req.method, route, status_code: status }, ms);
    });
    next();
  };
}
