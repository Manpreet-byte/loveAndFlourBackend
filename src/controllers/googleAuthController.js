import bcrypt from 'bcrypt';
import { z } from 'zod';
import { env } from '../utils/env.js';
import { withTransaction } from '../utils/dbTx.js';
import { clearRefreshCookie, setRefreshCookie } from '../utils/authCookies.js';
import { generateOpaqueToken, generateTokenFamily, hashToken, signAccessToken } from '../utils/tokens.js';
import { insertRefreshToken } from '../models/refreshTokenModel.js';
import { createUser, findUserByEmail, findUserById, setEmailVerified } from '../models/userModel.js';
import { getRequestAuditContext, logAuditEvent } from '../services/auditLogService.js';
import { notifyAdmins } from '../services/notificationService.js';

const callbackSchema = z.object({
  code: z.string().min(5),
  state: z.string().min(5),
});

const startSchema = z.object({
  mode: z.enum(['login', 'signup']).optional().default('login'),
});

function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

function getCallbackUrl(req) {
  const override = String(env.GOOGLE_OAUTH_REDIRECT_URI ?? '').trim();
  if (override) return override;
  const proto = (req.headers['x-forwarded-proto'] ?? req.protocol ?? 'http').toString().split(',')[0].trim();
  const host = req.get('host');
  return `${proto}://${host}/api/auth/google/callback`;
}

function makeState() {
  return generateOpaqueToken(24);
}

function isSecureCookie(req) {
  // If SameSite=None is used, modern browsers require Secure.
  if (env.AUTH_COOKIE_SAMESITE === 'none') return true;
  if (env.COOKIE_SECURE != null) return env.COOKIE_SECURE;
  const proto = (req.headers['x-forwarded-proto'] ?? req.protocol ?? '').toString().split(',')[0].trim().toLowerCase();
  return proto === 'https' || env.NODE_ENV === 'production';
}

function setStateCookie(res, state) {
  const secure = isSecureCookie(res.req);
  res.cookie('google_oauth_state', state, {
    httpOnly: true,
    sameSite: env.AUTH_COOKIE_SAMESITE,
    secure,
    domain: env.COOKIE_DOMAIN || undefined,
    maxAge: 10 * 60 * 1000,
    path: '/api/auth/google',
  });
}

function setNextCookie(res, nextBase) {
  const secure = isSecureCookie(res.req);
  res.cookie('google_oauth_next', nextBase, {
    httpOnly: true,
    sameSite: env.AUTH_COOKIE_SAMESITE,
    secure,
    domain: env.COOKIE_DOMAIN || undefined,
    maxAge: 10 * 60 * 1000,
    path: '/api/auth/google',
  });
}

function setModeCookie(res, mode) {
  const secure = isSecureCookie(res.req);
  res.cookie('google_oauth_mode', mode, {
    httpOnly: true,
    sameSite: env.AUTH_COOKIE_SAMESITE,
    secure,
    domain: env.COOKIE_DOMAIN || undefined,
    maxAge: 10 * 60 * 1000,
    path: '/api/auth/google',
  });
}

function clearStateCookie(res) {
  const secure = isSecureCookie(res.req);
  res.clearCookie('google_oauth_state', {
    httpOnly: true,
    sameSite: env.AUTH_COOKIE_SAMESITE,
    secure,
    domain: env.COOKIE_DOMAIN || undefined,
    path: '/api/auth/google',
  });
}

function clearNextCookie(res) {
  const secure = isSecureCookie(res.req);
  res.clearCookie('google_oauth_next', {
    httpOnly: true,
    sameSite: env.AUTH_COOKIE_SAMESITE,
    secure,
    domain: env.COOKIE_DOMAIN || undefined,
    path: '/api/auth/google',
  });
}

function clearModeCookie(res) {
  const secure = isSecureCookie(res.req);
  res.clearCookie('google_oauth_mode', {
    httpOnly: true,
    sameSite: env.AUTH_COOKIE_SAMESITE,
    secure,
    domain: env.COOKIE_DOMAIN || undefined,
    path: '/api/auth/google',
  });
}

function parseOrigin(value) {
  try {
    return new URL(String(value)).origin;
  } catch {
    return '';
  }
}

function getFrontendBaseFromRequest(req) {
  const allowed = new Set((env.ALLOWED_ORIGINS ?? []).map((origin) => String(origin).trim()).filter(Boolean));
  const configured = String(env.PUBLIC_WEB_BASE_URL ?? '').trim();
  if (configured) allowed.add(parseOrigin(configured));

  const origin = parseOrigin(req.headers.origin);
  if (origin && allowed.has(origin)) return origin;

  const refererOrigin = parseOrigin(req.headers.referer);
  if (refererOrigin && allowed.has(refererOrigin)) return refererOrigin;

  if (configured) return configured.replace(/\/$/, '');
  return '';
}

async function exchangeCodeForTokens({ code, redirectUri }) {
  const body = new URLSearchParams({
    code,
    client_id: env.GOOGLE_OAUTH_CLIENT_ID,
    client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });

  let res;
  try {
    res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch (cause) {
    // Occasionally network/TLS issues can occur; retry once before failing.
    try {
      await new Promise((r) => setTimeout(r, 350));
      res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      });
    } catch (cause2) {
      const err = new Error('Unable to reach Google token endpoint');
      err.status = 502;
      err.cause = cause2 ?? cause;
      throw err;
    }
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.error_description || 'Google OAuth token exchange failed');
    err.status = 401;
    err.details = data;
    throw err;
  }
  return data;
}

async function fetchUserInfo(accessToken) {
  let res;
  try {
    res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { authorization: `Bearer ${accessToken}` },
    });
  } catch (cause) {
    const err = new Error('Unable to reach Google userinfo endpoint');
    err.status = 502;
    err.cause = cause;
    throw err;
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error('Failed to fetch Google profile');
    err.status = 401;
    err.details = data;
    throw err;
  }
  return data;
}

async function issueSession({ res, user, req }, { conn } = {}) {
  const rawRefresh = generateOpaqueToken(48);
  const refreshHash = hashToken(rawRefresh);
  const family = generateTokenFamily();
  await insertRefreshToken(
    {
      userId: user.id,
      tokenHash: refreshHash,
      tokenFamily: family,
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
      parentId: null,
      createdIp: req.ip,
      userAgent: req.headers['user-agent']?.slice(0, 255) ?? null,
    },
    { conn },
  );

  const accessToken = signAccessToken({ userId: user.id, role: user.role, tokenVersion: user.token_version ?? 0 });
  setRefreshCookie(res, rawRefresh);
  return { accessToken };
}

export async function googleStart(req, res, next) {
  try {
    if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
      return res.status(501).json({ error: { message: 'Google OAuth is not configured' } });
    }

    const { mode } = startSchema.parse(req.query ?? {});
    const state = makeState();
    const nextBase = getFrontendBaseFromRequest(req);
    setStateCookie(res, state);
    if (nextBase) setNextCookie(res, nextBase);
    setModeCookie(res, mode);

    const redirectUri = getCallbackUrl(req);
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', env.GOOGLE_OAUTH_CLIENT_ID);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('prompt', 'select_account');

    return res.redirect(url.toString());
  } catch (err) {
    return next(err);
  }
}

export async function googleCallback(req, res, next) {
  try {
    if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
      return res.status(501).json({ error: { message: 'Google OAuth is not configured' } });
    }

    const { code, state } = callbackSchema.parse(req.query);
    const expected = req.cookies?.google_oauth_state;
    const nextBase = String(req.cookies?.google_oauth_next ?? '').trim();
    const mode = String(req.cookies?.google_oauth_mode ?? 'login') === 'signup' ? 'signup' : 'login';
    clearStateCookie(res);
    clearNextCookie(res);
    clearModeCookie(res);
    if (!expected || String(expected) !== String(state)) {
      return res.status(401).json({ error: { message: 'Invalid OAuth state' } });
    }

    const redirectUri = getCallbackUrl(req);
    const tokenData = await exchangeCodeForTokens({ code, redirectUri });
    const accessToken = tokenData?.access_token;
    if (!accessToken) return res.status(401).json({ error: { message: 'Missing Google access token' } });

    const profile = await fetchUserInfo(accessToken);
    const email = normalizeEmail(profile?.email);
    if (!email) return res.status(400).json({ error: { message: 'Google account missing email' } });

    const name = String(profile?.name ?? profile?.given_name ?? 'User').trim().slice(0, 150);

    const result = await withTransaction(async (conn) => {
      let user = await findUserByEmail(email);
      if (!user) {
        if (mode !== 'signup') {
          const err = new Error('No account found. Please sign up with Google first.');
          err.status = 409;
          err.code = 'GOOGLE_SIGNUP_REQUIRED';
          err.details = { email, name };
          throw err;
        }

        const randomPassword = generateOpaqueToken(32);
        const passwordHash = await bcrypt.hash(randomPassword, 12);
        const created = await createUser({ name, email, passwordHash, role: 'user' });
        await setEmailVerified({ userId: created.id });
        user = await findUserById(created.id);

        notifyAdmins(
          {
            notificationType: 'admin_new_user',
            title: 'New Google signup',
            message: `${name} (${email}) signed up with Google.`,
            linkUrl: '/admin/dashboard',
            metadata: { user_id: created.id, email },
          },
          { conn },
        ).catch(() => {});
      } else if (!user.email_verified_at) {
        await setEmailVerified({ userId: user.id });
        user = await findUserById(user.id);
      } else {
        user = await findUserById(user.id);
      }

      const session = await issueSession({ res, user, req }, { conn });
      return { user, token: session.accessToken };
    });

    logAuditEvent({
      actorType: 'user',
      actorId: result.user.id,
      actionType: 'LOGIN_GOOGLE',
      entityType: 'user',
      entityId: result.user.id,
      ...getRequestAuditContext(req),
      statusCode: 200,
      metadata: { email },
    });

    // Redirect back to frontend with token; frontend will store it and hydrate.
    const fallbackBase = String(env.PUBLIC_WEB_BASE_URL ?? '').trim().replace(/\/$/, '');
    const resolvedBase = nextBase || fallbackBase;
    const nextUrl = new URL(`${resolvedBase}/${mode === 'signup' ? 'signup' : 'login'}`);
    nextUrl.searchParams.set('oauth', 'google');
    nextUrl.searchParams.set('token', result.token);
    return res.redirect(nextUrl.toString());
  } catch (err) {
    clearRefreshCookie(res);
    // Browser-friendly fallback: redirect back to login page with an error instead of a blank JSON 500.
    try {
      const fallbackBase = String(env.PUBLIC_WEB_BASE_URL ?? '').trim().replace(/\/$/, '');
      if (fallbackBase) {
        const nextUrl = new URL(`${fallbackBase}/${err?.code === 'GOOGLE_SIGNUP_REQUIRED' ? 'signup' : 'login'}`);
        nextUrl.searchParams.set('oauth', 'google');
        nextUrl.searchParams.set('error', err?.message ?? 'Google login failed');
        if (err?.details?.email) nextUrl.searchParams.set('email', String(err.details.email));
        if (err?.details?.name) nextUrl.searchParams.set('name', String(err.details.name));
        return res.redirect(nextUrl.toString());
      }
    } catch {
      // ignore
    }
    return next(err);
  }
}
