function safeMs(value) {
  const ms = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
}

export function computeLiveSessionState(session, { now = new Date(), enrolledCount = 0, ignoreSeatLimit = false } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const scheduledMs = safeMs(session?.scheduled_at ?? session?.scheduledAt);
  const startedMs = safeMs(session?.started_at);
  const endedMs = safeMs(session?.ended_at);
  const durationMinutes = Number(session?.duration_minutes ?? 120);
  const seatLimit = Number(session?.seat_limit ?? 0);

  const rawStatus = String(session?.status ?? '').toLowerCase();
  const cancelledAt = session?.cancelled_at ? new Date(session.cancelled_at) : null;
  if (cancelledAt || rawStatus === 'cancelled' || rawStatus === 'canceled') {
    return { state: 'cancelled', scheduledMs, startedMs, endedMs, seatLimit, enrolledCount };
  }

  if (!ignoreSeatLimit && seatLimit > 0 && enrolledCount >= seatLimit) {
    // Sold-out is a derived state for non-enrolled visitors.
    return { state: 'sold-out', scheduledMs, startedMs, endedMs, seatLimit, enrolledCount };
  }

  // Determine end time if ended_at missing.
  const computedEndMs =
    endedMs ??
    (scheduledMs && Number.isFinite(durationMinutes) && durationMinutes > 0 ? scheduledMs + durationMinutes * 60_000 : null);

  const isEnded = computedEndMs != null && nowMs >= computedEndMs;
  const isLive = scheduledMs != null && !isEnded && nowMs >= scheduledMs;

  if (isLive) return { state: 'live', scheduledMs, startedMs, endedMs: computedEndMs, seatLimit, enrolledCount };

  if (isEnded) {
    const recordingState = String(session?.recording_state ?? 'none');
    if (recordingState === 'ready') return { state: 'recording-ready', scheduledMs, startedMs, endedMs: computedEndMs, seatLimit, enrolledCount };
    return { state: 'recording-processing', scheduledMs, startedMs, endedMs: computedEndMs, seatLimit, enrolledCount };
  }

  return { state: 'upcoming', scheduledMs, startedMs, endedMs: computedEndMs, seatLimit, enrolledCount };
}

export function canJoinWindow({ scheduledMs, endedMs, nowMs, earlyMinutes = 15, lateMinutes = 60 } = {}) {
  if (!scheduledMs) return false;
  const startWindow = scheduledMs - earlyMinutes * 60_000;
  const endWindow = (endedMs ?? scheduledMs) + lateMinutes * 60_000;
  return nowMs >= startWindow && nowMs <= endWindow;
}
