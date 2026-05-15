import crypto from 'node:crypto';

export function requestContext(req, res, next) {
  const incoming = req.headers['x-request-id'];
  const requestId = (incoming && String(incoming).slice(0, 80)) || crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  next();
}

