import { env } from '../utils/env.js';
import { logger } from '../utils/logger.js';

let transporter;
let nodemailerModule;
let transporterVerified = false;

function hasResendConfig() {
  return Boolean(String(env.RESEND_API_KEY ?? '').trim()) && Boolean(String(env.RESEND_FROM_EMAIL ?? '').trim());
}

function hasSmtpConfig() {
  return Boolean(resolveSmtpConfig());
}

async function loadNodemailer() {
  if (nodemailerModule) return nodemailerModule;
  try {
    nodemailerModule = await import('nodemailer');
    return nodemailerModule;
  } catch (err) {
    return null;
  }
}

function resolveSmtpConfig() {
  let provider = env.SMTP_PROVIDER ?? 'custom';

  let host = env.SMTP_HOST;
  let port = env.SMTP_PORT;
  let secure = env.SMTP_SECURE ?? null;

  // Heuristic: many deployments set only SMTP_USER/SMTP_PASSWORD for Gmail.
  // If SMTP_HOST is missing and the user is a Gmail mailbox, treat it as Gmail.
  const smtpUser = String(env.SMTP_USER ?? '').trim();
  if (!host && provider === 'custom' && smtpUser && /@gmail\.com$/i.test(smtpUser)) {
    provider = 'gmail';
  }

  if (!host && provider === 'gmail') {
    host = 'smtp.gmail.com';
    port = 465;
    if (secure == null) secure = true;
  }
  if (!host && provider === 'sendgrid') {
    host = 'smtp.sendgrid.net';
    port = 587;
  }
  if (!host && provider === 'mailgun') {
    host = 'smtp.mailgun.org';
    port = 587;
  }

  if (!host) return null;

  // Gmail App Passwords work reliably with implicit TLS on 465.
  // Keep any explicit env override, but default to the safe pairing if unset.
  if (provider === 'gmail' && secure == null) {
    secure = true;
  }

  return {
    provider,
    host,
    port,
    secure: secure ?? port === 465,
    requireTLS: env.SMTP_REQUIRE_TLS ?? undefined,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    tlsRejectUnauthorized: env.SMTP_TLS_REJECT_UNAUTHORIZED ?? undefined,
  };
}

function resolveFromAddress(provider) {
  const configuredFrom = String(env.SMTP_FROM_EMAIL ?? '').trim();
  const smtpUser = String(env.SMTP_USER ?? '').trim();

  // Gmail is strict about sender identity. Prefer the authenticated mailbox so
  // deployment configs don't fail if SMTP_FROM_EMAIL is missing or unverified.
  if (provider === 'gmail') {
    return smtpUser || configuredFrom || 'no-reply@loveandflour.local';
  }

  return configuredFrom || smtpUser || 'no-reply@loveandflour.local';
}

async function getTransporter() {
  if (transporter) return transporter;

  const smtpConfig = resolveSmtpConfig();
  if (!smtpConfig) {
    transporter = null;
    return transporter;
  }

  const nodemailer = await loadNodemailer();
  if (!nodemailer) {
    // eslint-disable-next-line no-console
    console.warn('[email] SMTP configured but nodemailer is not installed. Run `npm install` in backend.');
    transporter = null;
    return transporter;
  }

  transporter = nodemailer.default.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.secure,
    requireTLS: smtpConfig.requireTLS,
    auth: smtpConfig.auth,
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    tls: smtpConfig.tlsRejectUnauthorized == null ? undefined : { rejectUnauthorized: smtpConfig.tlsRejectUnauthorized },
  });

  return transporter;
}

async function sendViaResend({ to, subject, text, html, replyTo }) {
  const apiKey = String(env.RESEND_API_KEY ?? '').trim();
  const fromEmail = String(env.RESEND_FROM_EMAIL ?? '').trim();
  const fromName = String(env.RESEND_FROM_NAME ?? env.SMTP_FROM_NAME ?? 'Love & Flour').trim();
  if (!apiKey || !fromEmail) return { skipped: true, reason: 'Resend not configured' };

  const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail;
  const toList = Array.isArray(to) ? to : String(to ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const payload = {
    from,
    to: toList,
    subject,
    ...(html ? { html } : null),
    ...(text ? { text } : null),
    ...(replyTo?.address ? { reply_to: replyTo.address } : null),
  };

  const url = 'https://api.resend.com/emails';
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  // Node 18+ has fetch; some hosts still run Node 16 (no fetch).
  const canFetch = typeof fetch === 'function';
  let status = 0;
  let data = null;

  if (canFetch) {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    status = res.status;
    data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = data?.message || data?.error?.message || `Resend request failed (${status})`;
      const err = new Error(msg);
      err.status = status;
      err.data = data;
      throw err;
    }
  } else {
    const { request } = await import('node:https');
    const { URL } = await import('node:url');

    const parsed = new URL(url);
    const body = JSON.stringify(payload);

    const result = await new Promise((resolve, reject) => {
      const req = request(
        {
          protocol: parsed.protocol,
          hostname: parsed.hostname,
          port: parsed.port || 443,
          path: `${parsed.pathname}${parsed.search}`,
          method: 'POST',
          headers: {
            ...headers,
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          status = res.statusCode ?? 0;
          let raw = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            raw += chunk;
          });
          res.on('end', () => {
            try {
              data = raw ? JSON.parse(raw) : null;
            } catch {
              data = { raw };
            }
            resolve({ ok: status >= 200 && status < 300 });
          });
        },
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });

    if (!result.ok) {
      const msg = data?.message || data?.error?.message || `Resend request failed (${status})`;
      const err = new Error(msg);
      err.status = status;
      err.data = data;
      throw err;
    }
  }

  if (!status) status = 200;
  if (status < 200 || status >= 300) {
    const msg = data?.message || data?.error?.message || `Resend request failed (${status})`;
    const err = new Error(msg);
    err.status = status;
    err.data = data;
    throw err;
  }

  return { sent: true, provider: 'resend', id: data?.id ?? null };
}

export async function sendEmail({ to, subject, text, html, replyTo }) {
  // Prefer HTTPS email APIs when explicitly configured, because many hosts block SMTP ports.
  // Fallback gracefully if the chosen provider is not configured.
  if (env.EMAIL_PROVIDER === 'resend') {
    if (hasResendConfig()) return sendViaResend({ to, subject, text, html, replyTo });
    if (hasSmtpConfig()) logger.warn({ to, subject }, 'email_resend_not_configured_falling_back_to_smtp');
    else {
      logger.info({ to, subject }, 'email_skipped_resend_not_configured');
      return { skipped: true, reason: 'Resend not configured' };
    }
  }

  const tx = await getTransporter();
  if (!tx) {
    if (hasResendConfig()) {
      logger.warn({ to, subject }, 'email_smtp_not_configured_falling_back_to_resend');
      return sendViaResend({ to, subject, text, html, replyTo });
    }
    logger.info({ to, subject }, 'email_skipped_smtp_not_configured');
    return { skipped: true, reason: 'SMTP not configured' };
  }

  if (!transporterVerified) {
    try {
      await tx.verify();
      transporterVerified = true;
    } catch (err) {
      transporterVerified = false;
      throw err;
    }
  }

  const smtpProvider = env.SMTP_PROVIDER ?? 'custom';
  const fromAddress = resolveFromAddress(smtpProvider);

  let info;
  try {
    info = await tx.sendMail({
      from: env.SMTP_FROM_NAME ? { name: env.SMTP_FROM_NAME, address: fromAddress } : fromAddress,
      to,
      replyTo: replyTo ?? undefined,
      subject,
      text: text ?? undefined,
      html: html ?? undefined,
    });
  } catch (err) {
    logger.error({ err, to, subject }, 'email_smtp_send_failed');
    throw err;
  }

  return { sent: true, messageId: info?.messageId ?? null, response: info?.response ?? null };
}
