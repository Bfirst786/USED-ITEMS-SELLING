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

import { shippingFromEstimate, PACKING_SCHEMA } from '../js/shipping.js';

const est = (o) => ({
  identified_as: 'KitchenAid Artisan stand mixer', item_length_in: 14, item_width_in: 8.7, item_height_in: 14, item_weight_lb: 22,
  box_length_in: 18, box_width_in: 18, box_height_in: 16, packed_weight_lb: 25.4, fragile: false, ship_recommended: true,
  confidence: 'high', packing_tips: ['Remove the bowl and wrap it separately'], reasoning: 'Published specs.', ...o,
});

test('Claude estimate becomes shipping fields, matching a box preset', () => {
  const s = shippingFromEstimate(est());
  assert.equal(s.box, 'large');
  assert.deepEqual([s.l, s.w, s.h], [18, 18, 16]);
  assert.equal(s.lb, 25);
  assert.equal(s.oz, 7); // 0.4 lb = 6.4 oz → rounded up
  assert.equal(s.estimated, true);
  assert.equal(s.ai.confidence, 'high');
  assert.equal(s.ai.tips.length, 1);
  assert.ok(estimateShipping(s).ok, 'feeds straight into the rate estimate');
});

test('box is never smaller than the item, and odd sizes stay custom', () => {
  const s = shippingFromEstimate(est({ box_length_in: 10, box_width_in: 9.2, box_height_in: 4, item_length_in: 12, item_width_in: 6, item_height_in: 5 }));
  assert.deepEqual([s.l, s.w, s.h], [12, 10, 5]);
  assert.equal(s.box, 'custom');
});

test('ounces roll over to the next pound; missing weights fall back sensibly', () => {
  const s = shippingFromEstimate(est({ packed_weight_lb: 2.99, item_weight_lb: 2 }));
  assert.equal(s.lb, 3);
  assert.equal(s.oz, 0);
  const noPacked = shippingFromEstimate(est({ packed_weight_lb: 0, item_weight_lb: 1.5 }));
  assert.equal(noPacked.lb, 1);
  assert.equal(noPacked.oz, 8);
  assert.equal(shippingFromEstimate(est({ packed_weight_lb: 0, item_weight_lb: 0 })), null);
});

test('bad confidence values fall back to low; schema requires every field', () => {
  assert.equal(shippingFromEstimate(est({ confidence: 'sure' })).ai.confidence, 'low');
  assert.equal(PACKING_SCHEMA.required.length, Object.keys(PACKING_SCHEMA.properties).length);
});

test('packed weight is never less than the item itself', () => {
  assert.equal(shippingFromEstimate(est({ packed_weight_lb: 3, item_weight_lb: 22 })).lb, 22);
});
