import { env } from '../utils/env.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildBrandedEmailHtml({
  title,
  preheader = '',
  contentHtml,
  ctaLabel = null,
  ctaUrl = null,
  footerText = 'If you did not request this, you can safely ignore this email.',
} = {}) {
  const appName = env.SMTP_FROM_NAME || 'Love & Flour';
  const safeTitle = escapeHtml(title || appName);
  const safePreheader = escapeHtml(preheader || '');
  const safeFooter = escapeHtml(footerText || '');

  const cta =
    ctaLabel && ctaUrl
      ? `<div style="padding: 18px 0 6px;">
          <a href="${escapeHtml(ctaUrl)}"
             style="display:inline-block;background:#7a3b2e;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:600;">
            ${escapeHtml(ctaLabel)}
          </a>
        </div>`
      : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />
    <title>${safeTitle}</title>
    <style>
      :root { color-scheme: light dark; supported-color-schemes: light dark; }
      body { margin:0; padding:0; background:#f7f3ee; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; }
      .container { width:100%; padding:28px 12px; }
      .card { max-width:640px; margin:0 auto; background:#ffffff; border:1px solid rgba(0,0,0,0.06); border-radius:16px; overflow:hidden; }
      .header { padding:18px 22px; background:#1a1412; color:#ffffff; }
      .header .brand { font-weight:700; letter-spacing:0.2px; }
      .content { padding:22px; color:#241c19; font-size:15px; line-height:1.55; }
      .content h1 { margin:0 0 12px; font-size:20px; line-height:1.25; }
      .content a { color:#7a3b2e; }
      .footer { padding:16px 22px; background:#faf7f4; color:#6b5a55; font-size:12px; line-height:1.45; }
      .preheader { display:none !important; visibility:hidden; opacity:0; color:transparent; height:0; width:0; overflow:hidden; mso-hide:all; }
      @media (prefers-color-scheme: dark) {
        body { background:#0f0c0b !important; }
        .card { background:#141110 !important; border-color: rgba(255,255,255,0.10) !important; }
        .content { color:#f0e7e3 !important; }
        .footer { background:#0f0c0b !important; color:#b9a8a2 !important; }
      }
      @media only screen and (max-width: 520px) {
        .header, .content, .footer { padding-left:16px !important; padding-right:16px !important; }
      }
    </style>
  </head>
  <body>
    <div class="preheader">${safePreheader}</div>
    <div class="container">
      <div class="card">
        <div class="header">
          <div class="brand">${escapeHtml(appName)}</div>
        </div>
        <div class="content">
          <h1>${safeTitle}</h1>
          ${contentHtml || ''}
          ${cta}
        </div>
        <div class="footer">
          <div>${safeFooter}</div>
        </div>
      </div>
    </div>
  </body>
</html>`;
}

export function buildLinkEmail({ title, introText, linkUrl, ctaLabel }) {
  const safeUrl = String(linkUrl ?? '').trim();
  const contentHtml = `<p>${escapeHtml(introText || '')}</p>
<p style="word-break:break-all"><a href="${escapeHtml(safeUrl)}">${escapeHtml(safeUrl)}</a></p>`;
  const text = `${introText}\n\n${safeUrl}`.trim();
  const html = buildBrandedEmailHtml({
    title,
    preheader: introText,
    contentHtml,
    ctaLabel: ctaLabel || 'Open link',
    ctaUrl: safeUrl,
  });
  return { text, html };
}

