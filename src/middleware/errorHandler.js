import { logger } from '../utils/logger.js';

export function errorHandler(err, req, res, _next) {
  if (err?.name === 'ZodError') {
    logger.warn(
      {
        request_id: req.requestId,
        user_id: req.user?.id ?? null,
        path: req.originalUrl ?? req.url,
        issues: err.issues,
      },
      'validation_error',
    );
    return res.status(400).json({
      error: {
        message: 'Invalid request body',
        issues: err.issues,
      },
    });
  }

  const status = Number.isInteger(err?.status) ? err.status : 500;
  const message = status >= 500 ? 'Internal Server Error' : err?.message ?? 'Request failed';

  const logPayload = {
    request_id: req.requestId,
    user_id: req.user?.id ?? null,
    path: req.originalUrl ?? req.url,
    method: req.method,
    status,
    err: {
      name: err?.name,
      message: err?.message,
      code: err?.code,
      stack: req?.app?.get('env') === 'development' ? err?.stack : undefined,
    },
  };
  if (status >= 500) logger.error(logPayload, 'request_error');
  else logger.warn(logPayload, 'request_error');

  res.status(status).json({
    error: {
      message,
      requestId: req.requestId,
    },
  });
}
