import { processOutboxBatch } from '../services/emailOutbox.js';
import { processLiveSessionReminders, REMINDER_TYPES } from '../services/sessionReminders.js';
import { processPushOutboxBatch } from '../services/push/pushOutboxService.js';
import { logger } from '../utils/logger.js';
import { workerErrorsTotal, workerLoopDurationMs } from '../services/metricsService.js';

let timer;
let reminderTimer;
let pushTimer;

export function startWorker() {
  if (timer) return;
  timer = setInterval(() => {
    const start = process.hrtime.bigint();
    processOutboxBatch()
      .then(() => {
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        workerLoopDurationMs.observe({ job: 'email_outbox' }, ms);
        globalThis.__worker_last_heartbeat = Date.now();
      })
      .catch((err) => {
        workerErrorsTotal.inc({ job: 'email_outbox' });
        logger.error({ err }, 'worker_email_outbox_error');
      });
  }, 10_000);

  pushTimer = setInterval(() => {
    const start = process.hrtime.bigint();
    processPushOutboxBatch()
      .then(() => {
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        workerLoopDurationMs.observe({ job: 'push_outbox' }, ms);
        globalThis.__worker_last_heartbeat = Date.now();
      })
      .catch((err) => {
        workerErrorsTotal.inc({ job: 'push_outbox' });
        logger.error({ err }, 'worker_push_outbox_error');
      });
  }, 10_000);

  reminderTimer = setInterval(() => {
    const start24 = process.hrtime.bigint();
    processLiveSessionReminders({ reminderType: REMINDER_TYPES.REMINDER_24H })
      .then(() => {
        const ms = Number(process.hrtime.bigint() - start24) / 1e6;
        workerLoopDurationMs.observe({ job: 'reminder_24h' }, ms);
        globalThis.__worker_last_heartbeat = Date.now();
      })
      .catch((err) => {
        workerErrorsTotal.inc({ job: 'reminder_24h' });
        logger.error({ err }, 'worker_reminder_24h_error');
      });

    const start1h = process.hrtime.bigint();
    processLiveSessionReminders({ reminderType: REMINDER_TYPES.REMINDER_1H })
      .then(() => {
        const ms = Number(process.hrtime.bigint() - start1h) / 1e6;
        workerLoopDurationMs.observe({ job: 'reminder_1h' }, ms);
        globalThis.__worker_last_heartbeat = Date.now();
      })
      .catch((err) => {
        workerErrorsTotal.inc({ job: 'reminder_1h' });
        logger.error({ err }, 'worker_reminder_1h_error');
      });
  }, 60_000);
}

export function stopWorker() {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
  if (reminderTimer) {
    clearInterval(reminderTimer);
    reminderTimer = undefined;
  }
  if (pushTimer) {
    clearInterval(pushTimer);
    pushTimer = undefined;
  }
}
