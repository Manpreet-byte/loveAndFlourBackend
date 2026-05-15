import bcrypt from 'bcrypt';
import { z } from 'zod';
import { env } from '../utils/env.js';
import {
  bumpTokenVersion,
  createUser,
  findUserByEmail,
  findUserById,
  recordLoginFailure,
  recordLoginSuccess,
  setEmailVerified,
  setPasswordHashAndBumpVersion,
} from '../models/userModel.js';
import { enqueueEmail } from '../services/emailOutbox.js';
import { buildLinkEmail } from '../services/emailTemplates.js';
import { withTransaction } from '../utils/dbTx.js';
import { clearRefreshCookie, setRefreshCookie } from '../utils/authCookies.js';
import { generateOpaqueToken, generateTokenFamily, hashToken, signAccessToken } from '../utils/tokens.js';
import { getRequestAuditContext, logAuditEvent } from '../services/auditLogService.js';
import { notifyAdmins } from '../services/notificationService.js';
import {
  findRefreshTokenByHash,
  insertRefreshToken,
  revokeAllRefreshTokensForUser,
  revokeRefreshToken,
  revokeRefreshTokensByFamily,
} from '../models/refreshTokenModel.js';
import {
  consumeEmailVerificationToken,
  consumePasswordResetToken,
  deleteUnconsumedEmailVerificationTokensForUser,
  deleteUnconsumedPasswordResetTokensForUser,
  insertEmailVerificationToken,
  insertPasswordResetToken,
} from '../models/securityTokenModel.js';

const signupSchema = z.object({
  name: z.string().min(1).max(150),
  email: z.string().email().max(254),
  password: z.string().min(8).max(72),
});

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(72),
});

const refreshSchema = z.object({});

const passwordForgotSchema = z.object({
  email: z.string().email().max(254),
});

const passwordResetSchema = z.object({
  token: z.string().min(20).max(512),
  newPassword: z.string().min(8).max(72),
});

const emailVerifySchema = z.object({
  token: z.string().min(20).max(512),
});

const emailResendSchema = z.object({
  email: z.string().email().max(254),
});

function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

function addDays(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function addMinutes(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000);
}

async function issueSession({ res, user, req, parentRefreshTokenId = null, tokenFamily = null }, { conn } = {}) {
  const rawRefresh = generateOpaqueToken(48);
  const refreshHash = hashToken(rawRefresh);
  const family = tokenFamily ?? generateTokenFamily();
  const refreshId = await insertRefreshToken(
    {
      userId: user.id,
      tokenHash: refreshHash,
      tokenFamily: family,
      expiresAt: addDays(env.REFRESH_TOKEN_TTL_DAYS),
      parentId: parentRefreshTokenId,
      createdIp: req.ip,
      userAgent: req.headers['user-agent']?.slice(0, 255) ?? null,
    },
    { conn },
  );

  const accessToken = signAccessToken({ userId: user.id, role: user.role, tokenVersion: user.token_version ?? 0 });
  setRefreshCookie(res, rawRefresh);

  return { accessToken, refreshId, tokenFamily: family };
}

async function sendEmailVerification({ user }) {
  if (user.email_verified_at) return;

  const raw = generateOpaqueToken(32);
  const tokenHash = hashToken(raw);
  await deleteUnconsumedEmailVerificationTokensForUser({ userId: user.id });
  await insertEmailVerificationToken({ userId: user.id, tokenHash, expiresAt: addMinutes(60) });

  const url = `${env.PUBLIC_WEB_BASE_URL.replace(/\/$/, '')}/verify-email?token=${raw}`;
  const rendered = buildLinkEmail({
    title: 'Verify your email',
    introText: 'Please verify your email address to start using your account.',
    linkUrl: url,
    ctaLabel: 'Verify email',
  });
  await enqueueEmail({
    toEmail: user.email,
    subject: 'Verify your email',
    bodyText: rendered.text,
    bodyHtml: rendered.html,
  });
}

export async function signup(req, res, next) {
  try {
    const { name, email, password } = signupSchema.parse(req.body);
    const normalizedEmail = normalizeEmail(email);

    const existing = await findUserByEmail(normalizedEmail);
    if (existing) {
      return res.status(409).json({ error: { message: 'Email already in use' } });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await createUser({ name, email: normalizedEmail, passwordHash, role: 'user' });

    const enrichedUser = await findUserById(user.id);
    const { accessToken } = await withTransaction(async (conn) => {
      const session = await issueSession({ res, user: enrichedUser, req }, { conn });
      return session;
    });

    await sendEmailVerification({ user: enrichedUser });

    // Admin realtime notifications: new signup
    notifyAdmins({
      notificationType: 'admin_new_user',
      title: 'New user signup',
      message: `${user.name} (${user.email}) created an account.`,
      linkUrl: '/admin/dashboard',
      metadata: { user_id: user.id, email: user.email },
    }).catch(() => {});

    logAuditEvent({
      actorType: 'user',
      actorId: user.id,
      actionType: 'SIGNUP',
      entityType: 'user',
      entityId: user.id,
      ...getRequestAuditContext(req),
      statusCode: 201,
      metadata: { email: user.email },
    });

    return res.status(201).json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role, emailVerified: !!enrichedUser.email_verified_at },
      token: accessToken,
    });
  } catch (err) {
    return next(err);
  }
}

export async function login(req, res, next) {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const normalizedEmail = normalizeEmail(email);

    const user = await findUserByEmail(normalizedEmail);
    if (!user) {
      logAuditEvent({
        actorType: 'system',
        actorId: null,
        actionType: 'LOGIN_FAILED',
        entityType: 'user',
        entityId: null,
        ...getRequestAuditContext(req),
        statusCode: 401,
        metadata: { email: normalizedEmail, reason: 'user_not_found' },
      });
      return res.status(401).json({ error: { message: 'Invalid credentials' } });
    }

    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      logAuditEvent({
        actorType: 'user',
        actorId: user.id,
        actionType: 'LOGIN_BLOCKED',
        entityType: 'user',
        entityId: user.id,
        ...getRequestAuditContext(req),
        statusCode: 423,
        metadata: { reason: 'locked' },
      });
      return res.status(423).json({ error: { message: 'Account temporarily locked. Try again later.' } });
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      await recordLoginFailure({ userId: user.id });
      logAuditEvent({
        actorType: 'user',
        actorId: user.id,
        actionType: 'LOGIN_FAILED',
        entityType: 'user',
        entityId: user.id,
        ...getRequestAuditContext(req),
        statusCode: 401,
        metadata: { reason: 'bad_password' },
      });
      return res.status(401).json({ error: { message: 'Invalid credentials' } });
    }

    await recordLoginSuccess({ userId: user.id });

    const { accessToken } = await withTransaction(async (conn) => {
      const session = await issueSession({ res, user, req }, { conn });
      return session;
    });

    if (!user.email_verified_at) {
      await sendEmailVerification({ user });
    }

    return res.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role, emailVerified: !!user.email_verified_at },
      token: accessToken,
    });
  } catch (err) {
    return next(err);
  }
}

export async function refresh(req, res, next) {
  try {
    refreshSchema.parse(req.body ?? {});
    const presented = req.cookies?.[env.AUTH_REFRESH_COOKIE_NAME];
    if (!presented) {
      logAuditEvent({
        actorType: 'system',
        actorId: null,
        actionType: 'TOKEN_REFRESH_FAILED',
        entityType: 'auth',
        entityId: null,
        ...getRequestAuditContext(req),
        statusCode: 401,
        metadata: { reason: 'missing_refresh_cookie' },
      });
      return res.status(401).json({ error: { message: 'Missing refresh token' } });
    }

    const tokenHash = hashToken(presented);
    const result = await withTransaction(async (conn) => {
      const row = await findRefreshTokenByHash(tokenHash, { conn, forUpdate: true });
      if (!row) return { ok: false, status: 401, message: 'Invalid refresh token' };

      const expiresAt = new Date(row.expires_at).getTime();
      if (expiresAt < Date.now()) return { ok: false, status: 401, message: 'Expired refresh token' };

      if (row.revoked_at) {
        // Possible token reuse (stolen token) -> revoke entire family.
        await revokeRefreshTokensByFamily({ userId: row.user_id, tokenFamily: row.token_family }, { conn });
        await bumpTokenVersion({ userId: row.user_id });
        return { ok: false, status: 401, message: 'Invalid refresh token' };
      }

      const user = await findUserById(row.user_id);
      if (!user) return { ok: false, status: 401, message: 'Invalid refresh token' };

      const session = await issueSession(
        { res, user, req, parentRefreshTokenId: row.id, tokenFamily: row.token_family },
        { conn },
      );
      await revokeRefreshToken({ tokenId: row.id, replacedById: session.refreshId }, { conn });
      return { ok: true, accessToken: session.accessToken };
    });

    if (!result.ok) {
      clearRefreshCookie(res);
      logAuditEvent({
        actorType: 'system',
        actorId: null,
        actionType: 'TOKEN_REFRESH_FAILED',
        entityType: 'auth',
        entityId: null,
        ...getRequestAuditContext(req),
        statusCode: result.status,
        metadata: { reason: result.message },
      });
      return res.status(result.status).json({ error: { message: result.message } });
    }

    logAuditEvent({
      actorType: 'user',
      actorId: req.user?.id ?? null,
      actionType: 'TOKEN_REFRESH',
      entityType: 'auth',
      entityId: null,
      ...getRequestAuditContext(req),
      statusCode: 200,
    });
    return res.json({ token: result.accessToken });
  } catch (err) {
    return next(err);
  }
}

export async function logout(req, res, next) {
  try {
    const presented = req.cookies?.[env.AUTH_REFRESH_COOKIE_NAME];
    clearRefreshCookie(res);
    if (!presented) return res.json({ ok: true });

    const tokenHash = hashToken(presented);
    await withTransaction(async (conn) => {
      const row = await findRefreshTokenByHash(tokenHash, { conn, forUpdate: true });
      if (!row || row.revoked_at) return;
      await revokeRefreshToken({ tokenId: row.id }, { conn });
    });

    logAuditEvent({
      actorType: 'user',
      actorId: req.user?.id ?? null,
      actionType: 'LOGOUT',
      entityType: 'auth',
      entityId: null,
      ...getRequestAuditContext(req),
      statusCode: 200,
    });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

export async function logoutAll(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: { message: 'Unauthorized' } });

    await withTransaction(async (conn) => {
      await revokeAllRefreshTokensForUser({ userId }, { conn });
      await bumpTokenVersion({ userId });
    });
    clearRefreshCookie(res);
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

export async function verifyEmail(req, res, next) {
  try {
    const { token } = emailVerifySchema.parse(req.body);
    const tokenHash = hashToken(token);

    const result = await withTransaction(async (conn) => {
      const consumed = await consumeEmailVerificationToken({ tokenHash }, { conn });
      if (!consumed.ok) return consumed;
      await setEmailVerified({ userId: consumed.userId });
      return { ok: true };
    });

    if (!result.ok) {
      return res.status(400).json({ error: { message: 'Invalid or expired token' } });
    }

    logAuditEvent({
      actorType: 'system',
      actorId: null,
      actionType: 'EMAIL_VERIFIED',
      entityType: 'user',
      entityId: null,
      ...getRequestAuditContext(req),
      statusCode: 200,
    });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

export async function resendEmailVerification(req, res, next) {
  try {
    const { email } = emailResendSchema.parse(req.body);
    const user = await findUserByEmail(normalizeEmail(email));
    if (user && !user.email_verified_at) {
      await sendEmailVerification({ user });
    }
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

export async function forgotPassword(req, res, next) {
  try {
    const { email } = passwordForgotSchema.parse(req.body);
    const user = await findUserByEmail(normalizeEmail(email));
    if (!user) {
      logAuditEvent({
        actorType: 'system',
        actorId: null,
        actionType: 'PASSWORD_RESET_REQUEST',
        entityType: 'user',
        entityId: null,
        ...getRequestAuditContext(req),
        statusCode: 200,
        metadata: { email: normalizeEmail(email), result: 'no_user' },
      });
      return res.json({ ok: true });
    }

    const raw = generateOpaqueToken(32);
    const tokenHash = hashToken(raw);

    await deleteUnconsumedPasswordResetTokensForUser({ userId: user.id });
    await insertPasswordResetToken({ userId: user.id, tokenHash, expiresAt: addMinutes(30) });

    const url = `${env.PUBLIC_WEB_BASE_URL.replace(/\/$/, '')}/reset-password?token=${raw}`;
    const rendered = buildLinkEmail({
      title: 'Reset your password',
      introText: 'You requested a password reset. If this wasn’t you, you can ignore this email.',
      linkUrl: url,
      ctaLabel: 'Reset password',
    });
    await enqueueEmail({
      toEmail: user.email,
      subject: 'Reset your password',
      bodyText: rendered.text,
      bodyHtml: rendered.html,
    });

    logAuditEvent({
      actorType: 'user',
      actorId: user.id,
      actionType: 'PASSWORD_RESET_REQUEST',
      entityType: 'user',
      entityId: user.id,
      ...getRequestAuditContext(req),
      statusCode: 200,
    });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

export async function resetPassword(req, res, next) {
  try {
    const { token, newPassword } = passwordResetSchema.parse(req.body);
    const tokenHash = hashToken(token);

    await withTransaction(async (conn) => {
      const consumed = await consumePasswordResetToken({ tokenHash }, { conn });
      if (!consumed.ok) {
        const err = new Error('Invalid or expired token');
        err.status = 400;
        throw err;
      }

      const passwordHash = await bcrypt.hash(newPassword, 12);
      await setPasswordHashAndBumpVersion({ userId: consumed.userId, passwordHash });
      await revokeAllRefreshTokensForUser({ userId: consumed.userId }, { conn });
    });

    clearRefreshCookie(res);
    logAuditEvent({
      actorType: 'system',
      actorId: null,
      actionType: 'PASSWORD_RESET_COMPLETED',
      entityType: 'user',
      entityId: null,
      ...getRequestAuditContext(req),
      statusCode: 200,
    });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}
