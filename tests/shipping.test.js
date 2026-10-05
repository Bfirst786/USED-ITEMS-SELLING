import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateShipping, shippingAdvice } from '../js/shipping.js';

test('needs a weight', () => {
  assert.equal(estimateShipping({}).ok, false);
});

test('light small parcel: USPS is cheapest, billed in quarter pounds', () => {
  const e = estimateShipping({ lb: 0, oz: 10, l: 10, w: 8, h: 2 });
  assert.ok(e.ok);
  assert.equal(e.best, 'usps');
  const usps = e.options.find((o) => o.key === 'usps');
  assert.equal(usps.billable, 0.75);
  assert.ok(e.low >= 4 && e.high <= 10, `range ${e.low}-${e.high}`);
});

test('big light box is billed by dimensional weight', () => {
  const e = estimateShipping({ lb: 4, l: 24, w: 18, h: 18 }); // 7776 cu in → 47 lb USPS, 56 lb UPS
  const usps = e.options.find((o) => o.key === 'usps');
  const ups = e.options.find((o) => o.key === 'ups');
  assert.equal(usps.billable, 47);
  assert.equal(ups.billable, 56);
  assert.ok(usps.byDimensions);
  assert.ok(e.warnings.some((w) => /smaller box/.test(w)));
});

test('over 70 lb only UPS remains; over 150 lb nothing does', () => {
  const heavy = estimateShipping({ lb: 90, l: 30, w: 20, h: 20 });
  assert.ok(heavy.ok);
  assert.equal(heavy.best, 'ups');
  assert.match(heavy.options.find((o) => o.key === 'usps').unavailable, /70 lb/);
  const freight = estimateShipping({ lb: 200, l: 40, w: 30, h: 30 });
  assert.equal(freight.ok, false);
  assert.match(freight.reason, /local pickup|freight/);
});

test('oversize boxes are flagged', () => {
  const e = estimateShipping({ lb: 20, l: 62, w: 12, h: 12 }); // L+G = 110, dim 54 lb
  assert.ok(e.options.find((o) => o.key === 'usps').notes.some((n) => /Oversize/.test(n)));
  assert.ok(e.options.find((o) => o.key === 'ups').notes.some((n) => /handling/.test(n)));
});

test('advice: what to charge, and when shipping is not worth it', () => {
  const e = estimateShipping({ lb: 2, l: 12, w: 10, h: 6 });
  const a = shippingAdvice(e, 100);
  assert.equal(a.chargeBuyer, e.typical);
  assert.ok(a.freeShippingPrice > 100 && a.freeShippingPrice % 5 === 0);
  assert.equal(a.worthShipping, true);
  const cheap = shippingAdvice(estimateShipping({ lb: 15, l: 20, w: 16, h: 12 }), 20);
  assert.equal(cheap.worthShipping, false);
});
