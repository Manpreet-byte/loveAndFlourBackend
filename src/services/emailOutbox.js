import { pool } from '../config/db.js';
import { sendEmail } from './mailer.js';

export async function enqueueEmail({ toEmail, subject, bodyText, bodyHtml, scheduledAt = null }) {
  await pool.query(
    'INSERT INTO email_outbox (to_email, subject, body_text, body_html, scheduled_at, next_attempt_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [toEmail, subject, bodyText ?? null, bodyHtml ?? null, scheduledAt, scheduledAt, 'pending'],
  );
}

export async function enqueueBulkEmail({ toEmails, subject, bodyText, bodyHtml, scheduledAt = null }) {
  if (!toEmails?.length) return;
  const values = toEmails.map((email) => [
    email,
    subject,
    bodyText ?? null,
    bodyHtml ?? null,
    scheduledAt,
    scheduledAt,
    'pending',
  ]);
  await pool.query(
    'INSERT INTO email_outbox (to_email, subject, body_text, body_html, scheduled_at, next_attempt_at, status) VALUES ?',
    [values],
  );
}

function computeNextAttemptAt({ attempts }) {
  const baseSeconds = 30;
  const maxSeconds = 6 * 60 * 60; // 6h
  const delaySeconds = Math.min(maxSeconds, Math.pow(2, Math.max(0, attempts)) * baseSeconds);
  return new Date(Date.now() + delaySeconds * 1000);
}

export async function processOutboxBatch({ limit = 25 } = {}) {
  const [rows] = await pool.query(
    `SELECT id, to_email, subject, body_text, body_html, attempts
       FROM email_outbox
      WHERE status IN ('pending','failed')
        AND attempts < 5
        AND (scheduled_at IS NULL OR scheduled_at <= NOW())
        AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
      ORDER BY id ASC
      LIMIT ?`,
    [limit],
  );

  for (const msg of rows) {
    try {
      const result = await sendEmail({
        to: msg.to_email,
        subject: msg.subject,
        text: msg.body_text,
        html: msg.body_html,
      });

      const isSkipped = Boolean(result?.skipped);
      if (isSkipped) {
        // In dev/test, allow running without SMTP. In production, keep visibility as failed.
        const status = process.env.NODE_ENV === 'production' ? 'failed' : 'sent';
        await pool.query(
          "UPDATE email_outbox SET status = ?, attempts = attempts + 1, last_error = ?, next_attempt_at = NULL, sent_at = IF(? = 'sent', NOW(), NULL) WHERE id = ?",
          [status, result?.reason ?? 'SMTP not configured', status, msg.id],
        );
        continue;
      }

      await pool.query(
        "UPDATE email_outbox SET status = 'sent', attempts = attempts + 1, sent_at = NOW(), provider_message_id = ?, provider_response = ?, next_attempt_at = NULL WHERE id = ?",
        [result?.messageId ?? null, result?.response ?? null, msg.id],
      );
    } catch (err) {
      const errText = String(err?.message ?? err);
      const attempts = Number(msg.attempts ?? 0) + 1;
      const nextAttemptAt = computeNextAttemptAt({ attempts });
      await pool.query(
        "UPDATE email_outbox SET status = 'failed', attempts = attempts + 1, last_error = ?, next_attempt_at = ? WHERE id = ?",
        [errText, nextAttemptAt, msg.id],
      );
      // Best-effort reliability breadcrumb (optional table).
      pool
        .query(
          `INSERT INTO failed_jobs (job_type, payload_json, status, attempts, last_error)
           VALUES (?, ?, 'failed', ?, ?)` ,
          ['email_outbox', JSON.stringify({ outbox_id: msg.id, to_email: msg.to_email }), 1, errText.slice(0, 500)],
        )
        .catch(() => null);
    }
  }
}
