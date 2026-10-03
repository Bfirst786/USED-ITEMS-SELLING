import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tierFor, suggestPrice, nicePrice, parseComps, median, itemTier } from '../js/pricing.js';

test('tiers follow the three price bands', () => {
  assert.equal(tierFor(5), 1);
  assert.equal(tierFor(100), 1);
  assert.equal(tierFor(101), 2);
  assert.equal(tierFor(500), 2);
  assert.equal(tierFor(501), 3);
  assert.equal(tierFor(''), null);
  assert.equal(tierFor(null), null);
});

test('item tier uses asking price, then suggestion', () => {
  assert.equal(itemTier({ askingPrice: 650 }), 3);
  assert.equal(itemTier({ suggested: { target: 250 } }), 2);
  assert.equal(itemTier({}), null);
});

test('nicePrice rounds to listing-friendly numbers', () => {
  assert.equal(nicePrice(13.4), 13);
  assert.equal(nicePrice(47), 45);
  assert.equal(nicePrice(234), 230);
  assert.equal(nicePrice(1240), 1250);
});

test('parseComps and median', () => {
  assert.deepEqual(parseComps('$120, 95; 140 abc'), [120, 95, 140]);
  assert.equal(median([120, 95, 140]), 120);
  assert.equal(median([1, 3]), 2);
});

test('suggestPrice needs original price or comps', () => {
  assert.equal(suggestPrice({ category: 'furniture' }), null);
});

test('suggestPrice depreciates by category, condition and age', () => {
  const s = suggestPrice({ category: 'electronics', condition: 'good', originalPrice: 1000, ageYears: 2 });
  // 1000 * .55 * .82 * .8^2 ≈ 288.6
  assert.equal(s.target, 290);
  assert.ok(s.low < s.target && s.target < s.high);
  assert.ok(s.listPrice > s.target);
  assert.equal(s.source, 'rules');
});

test('comps dominate the estimate when present', () => {
  const s = suggestPrice({ category: 'electronics', condition: 'good', comps: '200, 220, 240' });
  assert.equal(s.target, 220);
  const blended = suggestPrice({ category: 'electronics', condition: 'good', comps: '200, 220, 240', originalPrice: 1000, ageYears: 2 });
  assert.ok(blended.target > 220 && blended.target < 290);
});
