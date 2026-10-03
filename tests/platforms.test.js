import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recommendPlatforms, matchPlatformKey } from '../js/platforms.js';

const keys = (item) => recommendPlatforms(item).map((r) => r.key);

test('bulky furniture goes local', () => {
  const k = keys({ category: 'furniture', bulky: true, askingPrice: 150 });
  assert.equal(k[0], 'facebook');
  assert.ok(!k.includes('ebay'));
});

test('clothing goes to fashion marketplaces', () => {
  const k = keys({ category: 'clothing', askingPrice: 40 });
  assert.ok(k.slice(0, 3).includes('poshmark'));
});

test('expensive phone favors shipped tech markets', () => {
  const k = keys({ category: 'phones', askingPrice: 700 });
  assert.ok(k.slice(0, 2).includes('swappa'));
  assert.ok(k.includes('ebay'));
});

test('watches get a specialist boost', () => {
  const k = keys({ category: 'jewelry', title: 'Omega Seamaster watch', askingPrice: 2500 });
  assert.equal(k[0], 'chrono24');
});

test('every recommendation explains itself', () => {
  for (const r of recommendPlatforms({ category: 'instruments', askingPrice: 800 })) assert.ok(r.sellUrl.startsWith('https://'));
});

test('matchPlatformKey maps free text names', () => {
  assert.equal(matchPlatformKey('eBay'), 'ebay');
  assert.equal(matchPlatformKey('Facebook Marketplace'), 'facebook');
  assert.equal(matchPlatformKey('OfferUp'), 'offerup');
  assert.equal(matchPlatformKey(''), null);
  assert.equal(matchPlatformKey('Nonexistent Market'), null);
});
