import { withTransaction } from '../../utils/dbTx.js';
import { claimNextEvents, markEventFailed, markEventProcessed } from '../../models/notificationEventModel.js';
import { handleEventToNotifications } from './notificationService.js';

export async function processNotificationEventsBatch({ limit = 25 } = {}) {
  const events = await claimNextEvents({ limit });
  for (const ev of events) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await withTransaction(async (conn) => {
        let payload = {};
        try {
          payload = JSON.parse(ev.payload_json ?? '{}');
        } catch {
          payload = {};
        }

        await handleEventToNotifications({ eventId: ev.event_id, eventType: ev.event_type, payload }, { conn });
        await markEventProcessed({ id: ev.id }, { conn });
      });
    } catch (err) {
      // eslint-disable-next-line no-await-in-loop
      await markEventFailed({ id: ev.id, errorMessage: err?.message ?? err }, { conn: undefined });
    }
  }
}

