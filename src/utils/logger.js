import pino from 'pino';
import { env } from './env.js';

function redactPaths() {
  return [
    'req.headers.authorization',
    'req.headers.cookie',
    'req.body.password',
    'req.body.newPassword',
    'req.body.token',
    'req.body.refresh_token',
    'req.body.refreshToken',
    '*.password',
    '*.token',
    '*.secret',
  ];
}

export const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  redact: {
    paths: redactPaths(),
    censor: '[redacted]',
    remove: false,
  },
  base: {
    service: 'love-and-flour-backend',
    env: env.NODE_ENV,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

