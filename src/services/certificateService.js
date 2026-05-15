import crypto from 'node:crypto';
import { markCourseCompleted } from '../models/courseCompletionModel.js';
import { createCertificate, findCertificateByUserCourse } from '../models/certificateModel.js';

function uuid() {
  return crypto.randomUUID();
}

function verificationCode() {
  // 128-bit random code -> 32 hex chars; non-guessable.
  return crypto.randomBytes(16).toString('hex');
}

export async function issueCertificateOnCompletion({ conn, userId, courseId }) {
  // Idempotent: completion row + certificate uniqueness guard.
  await markCourseCompleted({ userId, courseId }, { conn });

  const existing = await findCertificateByUserCourse({ userId, courseId }, { conn });
  if (existing) return { issued: false, certificate: existing };

  // Retry loop for ultra-rare verification_code collision.
  for (let i = 0; i < 3; i += 1) {
    try {
      await createCertificate(
        {
          certificateId: uuid(),
          userId,
          courseId,
          verificationCode: verificationCode(),
        },
        { conn },
      );
      const cert = await findCertificateByUserCourse({ userId, courseId }, { conn });
      return { issued: true, certificate: cert };
    } catch (err) {
      // ER_DUP_ENTRY: retry if verification_code collision; otherwise rethrow.
      if (String(err?.code) !== 'ER_DUP_ENTRY') throw err;
    }
  }

  const e = new Error('Failed to issue certificate');
  e.status = 500;
  throw e;
}

