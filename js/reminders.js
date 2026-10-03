// Rule-based reminders. Rules are evaluated against items/listings to produce
// dated reminders. Pure functions (no DOM) so they can be unit tested.

import { itemTier, nicePrice } from './pricing.js';
import { platformName } from './platforms.js';

export const ACTIONS = {
  review: 'Review',
  refresh: 'Renew / bump listing',
  price_drop: 'Drop price',
  add_platform: 'List on another platform',
  donate: 'Bundle, garage sale or donate',
  takedown: 'Take down other listings',
  custom: 'Custom',
};

export const TRIGGERS = {
  draft: 'days after creating (still a draft)',
  since_listed: 'days after first posting',
  since_price_change: 'days since last price change',
  listing_refresh: 'days since each listing was posted/renewed',
  sold_with_active: 'when sold but other listings are still up',
};

export const DEFAULT_RULES = [
  { id: 'all-draft', tier: 'all', trigger: 'draft', days: 2, action: 'review', enabled: true, message: 'Still a draft — finish the listing and post it.' },
  { id: 'all-sold', tier: 'all', trigger: 'sold_with_active', days: 0, action: 'takedown', enabled: true, message: 'Sold! Mark it sold or delete it everywhere else so nobody else messages you.' },

  { id: 't1-refresh', tier: 1, trigger: 'listing_refresh', days: 7, action: 'refresh', enabled: true, message: 'Renew or bump the listing so it shows as new again.' },
  { id: 't1-drop', tier: 1, trigger: 'since_price_change', days: 7, action: 'price_drop', pct: 10, enabled: true, message: 'No sale in a week — try a price drop.' },
  { id: 't1-final', tier: 1, trigger: 'since_listed', days: 30, action: 'donate', enabled: true, message: 'Listed for a month. Bundle it with similar items, put it in a garage sale, or donate it.' },

  { id: 't2-refresh', tier: 2, trigger: 'listing_refresh', days: 7, action: 'refresh', enabled: true, message: 'Renew or bump the listing so it shows as new again.' },
  { id: 't2-drop', tier: 2, trigger: 'since_price_change', days: 10, action: 'price_drop', pct: 10, enabled: true, message: 'No sale in 10 days — consider a price drop.' },
  { id: 't2-add', tier: 2, trigger: 'since_listed', days: 21, action: 'add_platform', enabled: true, message: 'Three weeks without a sale — cross-list on another platform and retake the cover photo.' },
  { id: 't2-review', tier: 2, trigger: 'since_listed', days: 45, action: 'review', enabled: true, message: 'Listed 45 days. Re-check sold comps and rewrite the title/description.' },

  { id: 't3-refresh', tier: 3, trigger: 'listing_refresh', days: 10, action: 'refresh', enabled: true, message: 'Renew or bump the listing so it shows as new again.' },
  { id: 't3-drop', tier: 3, trigger: 'since_price_change', days: 14, action: 'price_drop', pct: 5, enabled: true, message: 'Two weeks without a sale — consider a small price drop.' },
  { id: 't3-add', tier: 3, trigger: 'since_listed', days: 21, action: 'add_platform', enabled: true, message: 'Cross-list on a specialist marketplace or consider consignment.' },
  { id: 't3-review', tier: 3, trigger: 'since_listed', days: 60, action: 'review', enabled: true, message: 'Listed 60 days. Get a second opinion on price (appraisal, comps, consignment quote).' },
];

const DAY = 86400000;

// Parse 'YYYY-MM-DD' as a local date; full ISO strings as-is.
export function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d, n) {
  const x = startOfDay(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function isoDay(d) {
  const x = toDate(d);
  if (!x) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
}

export function daysBetween(a, b) {
  return Math.round((startOfDay(b) - startOfDay(a)) / DAY);
}

function activeListings(item) {
  return (item.listings || []).filter((l) => l.status === 'active' && l.postedDate);
}

function earliest(dates) {
  const ds = dates.map(toDate).filter(Boolean);
  if (!ds.length) return null;
  return new Date(Math.min(...ds.map((d) => d.getTime())));
}

function ruleApplies(rule, tier) {
  return rule.enabled !== false && (rule.tier === 'all' || Number(rule.tier) === tier);
}

// Builds every reminder the rules produce (done ones filtered by state).
// state: { done: {key: true}, snoozed: {key: 'YYYY-MM-DD'} }
export function computeReminders(items, rules, state = {}, now = new Date()) {
  const done = state.done || {};
  const snoozed = state.snoozed || {};
  const out = [];

  for (const item of items) {
    if (item.status === 'archived') continue;
    const tier = itemTier(item) || 1;
    const active = activeListings(item);
    const firstPosted = earliest(active.map((l) => l.postedDate));

    for (const rule of rules) {
      if (!ruleApplies(rule, tier)) continue;
      const days = Number(rule.days) || 0;
      const push = (base, listing) => {
        const key = [rule.id, item.id, listing ? listing.id : '-', isoDay(base)].join('|');
        if (done[key]) return;
        let due = addDays(base, days);
        if (snoozed[key]) due = toDate(snoozed[key]);
        out.push(buildReminder(rule, item, listing, key, due, now));
      };

      switch (rule.trigger) {
        case 'draft':
          if (item.status === 'draft' && !active.length) push(toDate(item.createdAt), null);
          break;
        case 'since_listed':
          if (item.status === 'listed' && firstPosted) push(firstPosted, null);
          break;
        case 'since_price_change':
          if (item.status === 'listed' && firstPosted) {
            const changed = toDate(item.priceChangedAt);
            push(changed && changed > firstPosted ? changed : firstPosted, null);
          }
          break;
        case 'listing_refresh':
          if (item.status === 'listed') {
            for (const l of active) push(toDate(l.refreshedAt) || toDate(l.postedDate), l);
          }
          break;
        case 'sold_with_active':
          if (item.status === 'sold' && active.length) push(toDate(item.soldDate) || now, null);
          break;
      }
    }
  }

  out.sort((a, b) => a.due - b.due);
  return out;
}

function buildReminder(rule, item, listing, key, due, now) {
  const r = {
    key,
    ruleId: rule.id,
    itemId: item.id,
    listingId: listing ? listing.id : null,
    action: rule.action,
    title: ACTIONS[rule.action] || 'Reminder',
    message: rule.message || '',
    due,
    overdueDays: daysBetween(due, now),
  };
  if (listing) r.title += ` — ${platformName(listing.platform)}`;
  if (rule.action === 'price_drop') {
    const pct = Number(rule.pct) || 10;
    const current = Number(item.askingPrice) || 0;
    const proposed = nicePrice(current * (1 - pct / 100));
    const floor = Number(item.floorPrice) || 0;
    r.pct = pct;
    r.currentPrice = current;
    r.newPrice = floor && proposed < floor ? floor : proposed;
    r.atFloor = !!floor && current <= floor;
    if (r.atFloor) r.message = 'Already at your floor price — try a new platform, better photos, or a rewrite instead of dropping.';
  }
  if (rule.action === 'takedown') {
    const names = (item.listings || []).filter((l) => l.status === 'active').map((l) => platformName(l.platform));
    r.message += ` Still active on: ${names.join(', ')}.`;
  }
  return r;
}

export function isDue(reminder, now = new Date()) {
  return startOfDay(reminder.due) <= startOfDay(now);
}

// iCalendar file so reminders can live in the phone's calendar app with an alert.
export function toICS(reminders, itemsById, hour = 9) {
  const p = (n) => String(n).padStart(2, '0');
  const stamp = (d) =>
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  const local = (d) => `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`;
  const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (m) => '\\' + m);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Resell Assistant//EN', 'CALSCALE:GREGORIAN'];
  const now = new Date();
  for (const r of reminders) {
    const item = itemsById[r.itemId] || {};
    // Future reminders alert at `hour` on their day; anything due already alerts shortly.
    let due = startOfDay(r.due);
    due.setHours(hour);
    if (due <= now) due = new Date(now.getTime() + 10 * 60000);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${r.key.replace(/[^\w-]/g, '_')}@resell-assistant`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART:${local(due)}`,
      'DURATION:PT15M',
      `SUMMARY:${esc(`${r.title}: ${item.title || 'Item'}`)}`,
      `DESCRIPTION:${esc(r.message + (r.newPrice ? ` Suggested new price: $${r.newPrice}.` : ''))}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${esc(r.title)}`,
      'TRIGGER:PT0M',
      'END:VALARM',
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
