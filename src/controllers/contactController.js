import { z } from 'zod';
import { env } from '../utils/env.js';
import { enqueueEmail } from '../services/emailOutbox.js';
import { buildBrandedEmailHtml } from '../services/emailTemplates.js';
import { getRequestAuditContext, logAuditEvent } from '../services/auditLogService.js';

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
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  mobile: z.string().trim().min(3).max(40).optional(),
  country: z.string().trim().min(2).max(80).optional(),
  email: z.string().trim().email().max(200),
  subject: z.string().trim().min(1).max(160),
  message: z.string().trim().min(1).max(5000),
});

export async function sendContactMessage(req, res, next) {
  try {
    const payload = contactSchema.parse(req.body ?? {});
    const to = String(env.CONTACT_TO_EMAIL ?? '').trim() || 'manpreet24@navgurukul.org';
    const subject = `${env.CONTACT_SUBJECT_PREFIX || '[Contact]'} ${payload.subject}`.trim();

    const metaLines = [
      `From: ${payload.name} <${payload.email}>`,
      payload.mobile ? `Mobile: ${payload.mobile}` : null,
      payload.country ? `Country: ${payload.country}` : null,
      `IP: ${req.ip}`,
      `User-Agent: ${String(req.headers['user-agent'] ?? '')}`.trim(),
    ].filter(Boolean);

    const text = `${metaLines.join('\n')}\n\n${payload.message}`.trim();
    const html = buildBrandedEmailHtml({
      title: 'New contact message',
      preheader: payload.subject,
      footerText: 'This message was sent from the Love & Flour contact form.',
      contentHtml: `
        <p><strong>From:</strong> ${escapeHtml(payload.name)} &lt;${escapeHtml(payload.email)}&gt;</p>
        ${payload.mobile ? `<p><strong>Mobile:</strong> ${escapeHtml(payload.mobile)}</p>` : ''}
        ${payload.country ? `<p><strong>Country:</strong> ${escapeHtml(payload.country)}</p>` : ''}
        <p><strong>Subject:</strong> ${escapeHtml(payload.subject)}</p>
        <p><strong>IP:</strong> ${escapeHtml(req.ip)}</p>
        <p><strong>User-Agent:</strong> ${escapeHtml(String(req.headers['user-agent'] ?? ''))}</p>
        <hr style="border:none;border-top:1px solid rgba(0,0,0,0.08);margin:16px 0;" />
        <p style="white-space:pre-wrap;margin:0;">${escapeHtml(payload.message)}</p>
      `,
    });

    await enqueueEmail({
      toEmail: to,
      subject,
      bodyText: text,
      bodyHtml: html,
    });

    // Always accept the contact form submission.
    // Delivery is handled asynchronously by the email worker so a temporary SMTP issue
    // does not break the contact form for users.
    try {
      logAuditEvent({
        actorType: 'system',
        actorId: null,
        actionType: 'CONTACT_MESSAGE',
        entityType: 'contact',
        entityId: null,
        ...getRequestAuditContext(req),
        statusCode: 202,
        metadata: {
          name: payload.name,
          firstName: payload.firstName ?? null,
          lastName: payload.lastName ?? null,
          mobile: payload.mobile ?? null,
          country: payload.country ?? null,
          email: payload.email,
          subject: payload.subject,
          queued: true,
        },
      });
    } catch {
      // ignore audit errors for contact requests
    }

    return res.status(202).json({ ok: true, queued: true });
  } catch (err) {
    return next(err);
  }
}
