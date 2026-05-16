import { verifyAccessToken } from '../utils/tokens.js';
import { getUserAuthState } from '../models/userModel.js';
import { logger } from '../utils/logger.js';

export async function authenticateUser(req, res, next) {
  const header = req.headers.authorization ?? '';
  const [type, token] = header.split(' ');

  if (type !== 'Bearer' || !token) {
    logger.warn(
      { requestId: req.requestId, path: req.path, method: req.method, reason: 'missing_or_invalid_authorization_header' },
      'auth_failed',
    );
    return res.status(401).json({ error: { message: 'Missing or invalid Authorization header', code: 'AUTH_MISSING_BEARER' } });
  }

  try {
    const payload = verifyAccessToken(token);
    if (payload?.typ !== 'access') {
      logger.warn({ requestId: req.requestId, userId: payload?.id ?? null, reason: 'invalid_token_type' }, 'auth_failed');
      return res.status(401).json({ error: { message: 'Invalid token type', code: 'AUTH_INVALID_TYPE' } });
    }

    const userId = payload.id;
    const state = await getUserAuthState({ userId });
    if (!state || Number(state.token_version) !== Number(payload.tv ?? -1)) {
      logger.warn(
        {
          requestId: req.requestId,
          userId,
          reason: !state ? 'missing_user_state' : 'token_version_mismatch',
          tokenVersion: state?.token_version ?? null,
          tokenTv: payload.tv ?? null,
        },
        'auth_failed',
      );
      return res.status(401).json({ error: { message: 'Invalid or expired token', code: 'AUTH_TOKEN_INVALID' } });
    }

    req.user = { id: userId, role: state.role };
    return next();
  } catch (err) {
    logger.warn(
      {
        requestId: req.requestId,
        path: req.path,
        method: req.method,
        reason: 'jwt_verify_failed',
        errName: err?.name ?? null,
        errMessage: err?.message ?? null,
      },
      'auth_failed',
    );
    return res.status(401).json({ error: { message: 'Invalid or expired token', code: 'AUTH_JWT_INVALID' } });
  }
}

export function maybeAuthenticateUser(req, res, next) {
  const header = req.headers.authorization ?? '';
  if (!header) return next();
  return authenticateUser(req, res, next);
}
