import { z } from 'zod';
import { findCertificateByUserCourseWithCourse, listCertificatesForUser } from '../models/certificateModel.js';

const courseIdSchema = z.object({
  courseId: z.coerce.number().int().positive(),
});

export async function listMyCertificates(req, res, next) {
  try {
    const userId = req.user.id;
    const rows = await listCertificatesForUser({ userId });
    return res.json({
      certificates: rows.map((r) => ({
        id: r.id,
        certificate_id: r.certificate_id,
        verification_code: r.verification_code,
        status: r.status,
        issued_at: r.issued_at,
        revoked_at: r.revoked_at,
        revoke_reason: r.revoke_reason,
        course: { id: r.course_id, title: r.course_title, slug: r.course_slug },
      })),
    });
  } catch (err) {
    return next(err);
  }
}

export async function getMyCertificateForCourse(req, res, next) {
  try {
    const userId = req.user.id;
    const { courseId } = courseIdSchema.parse(req.params);
    const row = await findCertificateByUserCourseWithCourse({ userId, courseId });
    if (!row) return res.status(404).json({ error: { message: 'Certificate not found' } });
    return res.json({
      certificate: {
        id: row.id,
        certificate_id: row.certificate_id,
        verification_code: row.verification_code,
        status: row.status,
        issued_at: row.issued_at,
        revoked_at: row.revoked_at,
        revoke_reason: row.revoke_reason,
        course: { id: row.course_id, title: row.course_title, slug: row.course_slug },
      },
    });
  } catch (err) {
    return next(err);
  }
}
