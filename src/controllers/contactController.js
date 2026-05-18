import { z } from 'zod';
import { env } from '../utils/env.js';
import { sendEmail } from '../services/mailer.js';
import { buildBrandedEmailHtml } from '../services/emailTemplates.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const contactSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  subject: z.string().trim().min(1).max(160),
  message: z.string().trim().min(1).max(5000),
});

export async function sendContactMessage(req, res, next) {
  try {
    const payload = contactSchema.parse(req.body ?? {});
    const to = String(env.CONTACT_TO_EMAIL ?? '').trim() || 'contact@loveandflourbypooja.com';
    const subject = `${env.CONTACT_SUBJECT_PREFIX || '[Contact]'} ${payload.subject}`.trim();

    const metaLines = [
      `From: ${payload.name} <${payload.email}>`,
      `IP: ${req.ip}`,
      `User-Agent: ${String(req.headers['user-agent'] ?? '')}`.trim(),
    ];

    const text = `${metaLines.join('\n')}\n\n${payload.message}`.trim();
    const html = buildBrandedEmailHtml({
      title: 'New contact message',
      preheader: payload.subject,
      footerText: 'This message was sent from the Love & Flour contact form.',
      contentHtml: `
        <p><strong>From:</strong> ${escapeHtml(payload.name)} &lt;${escapeHtml(payload.email)}&gt;</p>
        <p><strong>Subject:</strong> ${escapeHtml(payload.subject)}</p>
        <p><strong>IP:</strong> ${escapeHtml(req.ip)}</p>
        <p><strong>User-Agent:</strong> ${escapeHtml(String(req.headers['user-agent'] ?? ''))}</p>
        <hr style="border:none;border-top:1px solid rgba(0,0,0,0.08);margin:16px 0;" />
        <p style="white-space:pre-wrap;margin:0;">${escapeHtml(payload.message)}</p>
      `,
    });

    const result = await sendEmail({
      to,
      subject,
      text,
      html,
      replyTo: { name: payload.name, address: payload.email },
    });

    if (result?.skipped && env.NODE_ENV === 'production') {
      return res.status(503).json({ error: { message: 'Email service is not configured.' } });
    }

    return res.json({ ok: true, skipped: Boolean(result?.skipped) });
  } catch (err) {
    return next(err);
  }
}
