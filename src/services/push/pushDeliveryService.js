import webpush from 'web-push';
import { env } from '../../utils/env.js';

let configured = false;

function isConfigured() {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
}

export function configureWebPush() {
  if (configured) return;
  if (!isConfigured()) return;
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  configured = true;
}

export function canSendPush() {
  return isConfigured();
}

export async function sendPushToSubscription({ subscription, payload }) {
  configureWebPush();
  if (!isConfigured()) {
    const err = new Error('Web Push is not configured');
    err.status = 500;
    throw err;
  }
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});
  return webpush.sendNotification(subscription, body, { TTL: 60 * 60 });
}

