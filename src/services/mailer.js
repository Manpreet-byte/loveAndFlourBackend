import { env } from '../utils/env.js';
import { logger } from '../utils/logger.js';

let transporter;
let nodemailerModule;
let transporterVerified = false;

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
  const provider = env.SMTP_PROVIDER ?? 'custom';

  let host = env.SMTP_HOST;
  let port = env.SMTP_PORT;
  let secure = env.SMTP_SECURE ?? null;

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

export async function sendEmail({ to, subject, text, html }) {
  const tx = await getTransporter();
  if (!tx) {
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

  const info = await tx.sendMail({
    from: env.SMTP_FROM_NAME ? { name: env.SMTP_FROM_NAME, address: env.SMTP_FROM_EMAIL } : env.SMTP_FROM_EMAIL,
    to,
    subject,
    text: text ?? undefined,
    html: html ?? undefined,
  });

  return { sent: true, messageId: info?.messageId ?? null, response: info?.response ?? null };
}
