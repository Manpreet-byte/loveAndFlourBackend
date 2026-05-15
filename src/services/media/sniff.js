const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const PDF_MAGIC = Buffer.from('%PDF-');

function startsWith(buf, magic) {
  if (!buf || buf.length < magic.length) return false;
  for (let i = 0; i < magic.length; i += 1) {
    if (buf[i] !== magic[i]) return false;
  }
  return true;
}

export function detectFileTypeFromHeader(headerBytes) {
  if (startsWith(headerBytes, PNG_MAGIC)) return { fileType: 'image', mimeType: 'image/png', ext: 'png' };
  if (startsWith(headerBytes, JPG_MAGIC)) return { fileType: 'image', mimeType: 'image/jpeg', ext: 'jpg' };
  if (startsWith(headerBytes, PDF_MAGIC)) return { fileType: 'pdf', mimeType: 'application/pdf', ext: 'pdf' };

  // WebP: RIFF....WEBP
  if (
    headerBytes?.length >= 12 &&
    headerBytes.toString('ascii', 0, 4) === 'RIFF' &&
    headerBytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { fileType: 'image', mimeType: 'image/webp', ext: 'webp' };
  }

  // Videos: for now we accept based on MIME allowlist from uploader (metadata only),
  // because robust sniffing requires broader codec/container detection.
  return { fileType: 'other', mimeType: 'application/octet-stream', ext: '' };
}

