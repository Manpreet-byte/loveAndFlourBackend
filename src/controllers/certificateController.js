import { z } from 'zod';
import { findCertificateByVerificationCode, reactivateCertificate, revokeCertificate } from '../models/certificateModel.js';

const codeSchema = z.object({
  code: z.string().trim().min(8).max(64),
});

export async function verifyCertificate(req, res, next) {
  try {
    const { code } = codeSchema.parse(req.params);
    const row = await findCertificateByVerificationCode({ code });
    if (!row) return res.status(404).json({ error: { message: 'Certificate not found' } });

    return res.json({
      certificate: {
        certificate_id: row.certificate_id,
        verification_code: code,
        status: row.status,
        issued_at: row.issued_at,
        revoked_at: row.revoked_at,
        user: { name: row.user_name, email: row.user_email },
        course: { title: row.course_title, slug: row.course_slug },
      },
    });
  } catch (err) {
    return next(err);
  }
}

const revokeSchema = z.object({
  reason: z.string().max(255).optional().nullable(),
});

export async function adminRevokeCertificate(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: { message: 'Invalid certificate id' } });
    const payload = revokeSchema.parse(req.body ?? {});
    const affected = await revokeCertificate({ id, reason: payload.reason ?? null });
    if (!affected) return res.status(404).json({ error: { message: 'Certificate not found or already revoked' } });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

export async function adminReactivateCertificate(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: { message: 'Invalid certificate id' } });
    const affected = await reactivateCertificate({ id });
    if (!affected) return res.status(404).json({ error: { message: 'Certificate not found' } });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

