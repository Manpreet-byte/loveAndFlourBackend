export function escapeHtml(input) {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function textToHtml(input) {
  const safe = escapeHtml(input);
  // Preserve line breaks without allowing arbitrary HTML.
  return safe.replace(/\r\n/g, '\n').replace(/\n/g, '<br/>');
}

