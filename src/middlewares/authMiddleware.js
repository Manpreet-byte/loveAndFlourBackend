import { verifyAccessToken } from '../utils/tokens.js';
import { getUserAuthState } from '../models/userModel.js';

export async function authenticateUser(req, res, next) {
  const header = req.headers.authorization ?? '';
  const [type, token] = header.split(' ');

  if (type !== 'Bearer' || !token) {
    return res.status(401).json({ error: { message: 'Missing or invalid Authorization header' } });
  }

  try {
    const payload = verifyAccessToken(token);
    if (payload?.typ !== 'access') {
      return res.status(401).json({ error: { message: 'Invalid token type' } });
    }

    const userId = payload.id;
    const state = await getUserAuthState({ userId });
    if (!state || Number(state.token_version) !== Number(payload.tv ?? -1)) {
      return res.status(401).json({ error: { message: 'Invalid or expired token' } });
    }

    req.user = { id: userId, role: state.role };
    return next();
  } catch {
    return res.status(401).json({ error: { message: 'Invalid or expired token' } });
  }
}

export function maybeAuthenticateUser(req, res, next) {
  const header = req.headers.authorization ?? '';
  if (!header) return next();
  return authenticateUser(req, res, next);
}
