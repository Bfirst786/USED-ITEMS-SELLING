import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeReminders, DEFAULT_RULES, isDue, toICS, isoDay, addDays } from '../js/reminders.js';

const now = new Date(2026, 9, 20); // Oct 20 2026
const day = (n) => isoDay(addDays(now, n));

function listed(price, postedDaysAgo, extra = {}) {
  return {
    id: 'i1',
    status: 'listed',
    askingPrice: price,
    createdAt: day(-postedDaysAgo - 1),
    listings: [{ id: 'l1', platform: 'facebook', status: 'active', postedDate: day(-postedDaysAgo) }],
    ...extra,
  };
}

test('tier 1 item gets refresh + price drop after 7 days', () => {
  const r = computeReminders([listed(60, 8)], DEFAULT_RULES, {}, now);
  const due = r.filter((x) => isDue(x, now)).map((x) => x.ruleId);
  assert.ok(due.includes('t1-refresh'));
  assert.ok(due.includes('t1-drop'));
  const drop = r.find((x) => x.ruleId === 't1-drop');
  assert.equal(drop.newPrice, 55); // 60 - 10% = 54 → nice 55
});

test('tier 3 rules are slower', () => {
  const r = computeReminders([listed(900, 8)], DEFAULT_RULES, {}, now);
  assert.equal(r.filter((x) => isDue(x, now)).length, 0);
  assert.ok(r.some((x) => x.ruleId === 't3-drop'));
});

test('price drops respect the floor', () => {
  const r = computeReminders([listed(60, 8, { floorPrice: 58 })], DEFAULT_RULES, {}, now);
  assert.equal(r.find((x) => x.ruleId === 't1-drop').newPrice, 58);
  const atFloor = computeReminders([listed(58, 8, { floorPrice: 58 })], DEFAULT_RULES, {}, now);
  assert.ok(atFloor.find((x) => x.ruleId === 't1-drop').atFloor);
});

test('price change restarts the price-drop clock', () => {
  const r = computeReminders([listed(60, 8, { priceChangedAt: day(-1) })], DEFAULT_RULES, {}, now);
  const drop = r.find((x) => x.ruleId === 't1-drop');
  assert.equal(isoDay(drop.due), day(6));
});

test('done and snoozed reminders', () => {
  const [first] = computeReminders([listed(60, 8)], DEFAULT_RULES, {}, now).filter((x) => x.ruleId === 't1-refresh');
  const afterDone = computeReminders([listed(60, 8)], DEFAULT_RULES, { done: { [first.key]: true } }, now);
  assert.ok(!afterDone.some((x) => x.key === first.key));
  const snoozed = computeReminders([listed(60, 8)], DEFAULT_RULES, { snoozed: { [first.key]: day(2) } }, now);
  assert.ok(!isDue(snoozed.find((x) => x.key === first.key), now));
});

test('renewing a listing creates a fresh refresh reminder', () => {
  const item = listed(60, 8);
  item.listings[0].refreshedAt = day(0);
  const r = computeReminders([item], DEFAULT_RULES, {}, now).find((x) => x.ruleId === 't1-refresh');
  assert.equal(isoDay(r.due), day(7));
});

test('drafts and sold-with-active-listings get nudges', () => {
  const draft = { id: 'd', status: 'draft', createdAt: day(-3), listings: [] };
  const sold = { id: 's', status: 'sold', soldDate: day(0), askingPrice: 40, listings: [{ id: 'a', platform: 'ebay', status: 'active', postedDate: day(-5) }] };
  const r = computeReminders([draft, sold], DEFAULT_RULES, {}, now);
  assert.ok(r.some((x) => x.ruleId === 'all-draft' && isDue(x, now)));
  const t = r.find((x) => x.ruleId === 'all-sold');
  assert.ok(isDue(t, now));
  assert.match(t.message, /eBay/);
});

test('archived items and disabled rules produce nothing', () => {
  assert.equal(computeReminders([{ ...listed(60, 8), status: 'archived' }], DEFAULT_RULES, {}, now).length, 0);
  const off = DEFAULT_RULES.map((r) => ({ ...r, enabled: false }));
  assert.equal(computeReminders([listed(60, 8)], off, {}, now).length, 0);
});

test('ICS export is a valid calendar with alarms', () => {
  const r = computeReminders([listed(60, 8)], DEFAULT_RULES, {}, now);
  const ics = toICS(r, { i1: { title: 'Lamp, brass; vintage' } });
  assert.match(ics, /^BEGIN:VCALENDAR/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, r.length);
  assert.match(ics, /BEGIN:VALARM/);
  assert.match(ics, /Lamp\\, brass\\; vintage/);
});
