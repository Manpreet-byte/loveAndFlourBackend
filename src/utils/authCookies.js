import { env } from './env.js';

function isSecureCookie() {
  if (env.COOKIE_SECURE != null) return env.COOKIE_SECURE;
  return env.NODE_ENV === 'production';
}

export function getRefreshCookieName() {
  return env.AUTH_REFRESH_COOKIE_NAME;
}

export function buildRefreshCookieOptions() {
  return {
    httpOnly: true,
    secure: isSecureCookie(),
    sameSite: env.AUTH_COOKIE_SAMESITE,
    // Use root path so the cookie is reliably sent even when requests are proxied through the frontend dev server.
    path: '/',
    domain: env.COOKIE_DOMAIN || undefined,
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  };
}

export function setRefreshCookie(res, refreshToken) {
  res.cookie(getRefreshCookieName(), refreshToken, buildRefreshCookieOptions());
}

export function clearRefreshCookie(res) {
  res.clearCookie(getRefreshCookieName(), {
    ...buildRefreshCookieOptions(),
    maxAge: 0,
  });
}
