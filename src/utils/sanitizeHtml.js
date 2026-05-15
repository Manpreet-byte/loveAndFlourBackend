export function sanitizeBasicHtml(input) {
  if (input == null) return null;
  const html = String(input);
  if (!html.trim()) return '';

  // Remove script/style blocks completely.
  let out = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');

  // Remove inline event handlers (on*) and inline styles/classes/ids to prevent messy styling.
  // Note: This is a minimal sanitizer; it does not aim to be a full HTML sanitizer.
  out = out
    .replace(/\s(on[a-z]+\s*=\s*"[^"]*")/gi, '')
    .replace(/\s(on[a-z]+\s*=\s*'[^']*')/gi, '')
    .replace(/\sstyle\s*=\s*"[^"]*"/gi, '')
    .replace(/\sstyle\s*=\s*'[^']*'/gi, '')
    .replace(/\sclass\s*=\s*"[^"]*"/gi, '')
    .replace(/\sclass\s*=\s*'[^']*'/gi, '')
    .replace(/\sid\s*=\s*"[^"]*"/gi, '')
    .replace(/\sid\s*=\s*'[^']*'/gi, '');

  // Remove javascript: URLs in href/src.
  out = out.replace(/\s(href|src)\s*=\s*(['"])\s*javascript:[\s\S]*?\2/gi, '');

  return out;
}

