import pinoHttp from 'pino-http';
import { logger } from '../utils/logger.js';

export const httpLogger = pinoHttp({
  logger,
  genReqId(req, res) {
    const rid = req.requestId;
    if (rid) return rid;
    const incoming = req.headers['x-request-id'];
    const id = (incoming && String(incoming).slice(0, 80)) || undefined;
    if (id) {
      res.setHeader('x-request-id', id);
      req.requestId = id;
    }
    return id;
  },
  customProps(req, res) {
    return {
      request_id: req.requestId,
      user_id: req.user?.id ?? null,
      role: req.user?.role ?? null,
      status_code: res.statusCode,
    };
  },
  customLogLevel(req, res, err) {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  serializers: {
    req(req) {
      return {
        id: req.requestId,
        method: req.method,
        url: req.url,
        remoteAddress: req.ip,
        userAgent: req.headers['user-agent'],
      };
    },
    res(res) {
      return {
        statusCode: res.statusCode,
      };
    },
  },
});

