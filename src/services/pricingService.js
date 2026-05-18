import { getSiteSettings } from '../models/siteSettingsModel.js';

export async function getDefaultCurrency() {
  try {
    const s = (await getSiteSettings({ key: 'global' })) ?? {};
    const c = String(s.currency ?? '').trim().toUpperCase();
    if (c && c.length === 3) return c;
  } catch {
    // ignore
  }
  return 'INR';
}

export function computeEffectivePriceCents(priceRow, { now = new Date() } = {}) {
  const base = Number(priceRow?.amount_cents ?? 0);
  const sale = priceRow?.sale_amount_cents == null ? null : Number(priceRow.sale_amount_cents);
  if (!sale || sale <= 0) return base;
  const startsAt = priceRow?.sale_starts_at ? new Date(priceRow.sale_starts_at) : null;
  const endsAt = priceRow?.sale_ends_at ? new Date(priceRow.sale_ends_at) : null;
  const nowMs = now.getTime();
  if (startsAt && Number.isFinite(startsAt.getTime()) && nowMs < startsAt.getTime()) return base;
  if (endsAt && Number.isFinite(endsAt.getTime()) && nowMs > endsAt.getTime()) return base;
  return sale;
}

