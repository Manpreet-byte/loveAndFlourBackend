import { buildBrandedEmailHtml } from '../emailTemplates.js';

function render(template, vars) {
  return String(template).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, k) => {
    const v = vars?.[k];
    return v == null ? '' : String(v);
  });
}

export function renderTemplate({ subject, text, html }, vars) {
  const renderedSubject = render(subject, vars);
  const renderedText = text ? render(text, vars) : null;
  const renderedHtml = html ? render(html, vars) : null;

  let wrappedHtml = renderedHtml;
  if (wrappedHtml && !/<!doctype html>/i.test(wrappedHtml)) {
    const preheader = renderedText ? String(renderedText).split('\n').find((l) => l.trim()) ?? '' : '';
    wrappedHtml = buildBrandedEmailHtml({ title: renderedSubject, preheader, contentHtml: wrappedHtml });
  }

  return {
    subject: renderedSubject,
    text: renderedText,
    html: wrappedHtml,
  };
}

export const EMAIL_TEMPLATES = {
  user_registered_verify_email: {
    subject: 'Verify your email',
    text: 'Verify your email address: {{verify_url}}',
    html: '<p>Verify your email address:</p><p><a href="{{verify_url}}">{{verify_url}}</a></p>',
  },
  course_enrolled_zoom_access: {
    subject: 'Your Zoom access for the enrolled course',
    text: 'Hi {{user_name}},\n\nHere are the upcoming Zoom sessions for your enrollment:\n{{session_lines}}\n\nYour access remains active until {{expiry_date}}.',
    html: '<p>Hi {{user_name}},</p><p>Here are the upcoming Zoom sessions for your enrollment:</p><pre>{{session_lines}}</pre><p>Your access remains active until {{expiry_date}}.</p>',
  },
  certificate_issued: {
    subject: 'Your certificate is ready: {{course_title}}',
    text: 'Congrats {{user_name}}!\n\nYour certificate for {{course_title}} has been issued.\nVerification code: {{verification_code}}',
    html: '<p>Congrats {{user_name}}!</p><p>Your certificate for <strong>{{course_title}}</strong> has been issued.</p><p>Verification code: <strong>{{verification_code}}</strong></p>',
  },
};
