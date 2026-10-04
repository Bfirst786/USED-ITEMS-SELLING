import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTables, isWebAppUrl, scriptSource, ITEM_HEADER, LISTING_HEADER } from '../js/sheets.js';

const items = [
  {
    id: 'b', createdAt: '2026-10-02T10:00:00Z', updatedAt: '2026-10-03T09:00:00Z', title: 'Brass lamp', brand: 'Stiffel',
    category: 'home', condition: 'good', status: 'listed', askingPrice: 75, floorPrice: 60, suggested: { target: 70 },
    listings: [
      { id: 'l1', platform: 'facebook', url: 'https://facebook.com/marketplace/item/1', postedDate: '2026-10-02', price: 75, status: 'active' },
      { id: 'l2', platform: 'other', platformName: 'Local shop', url: '', postedDate: '2026-10-01', price: 80, status: 'ended' },
    ],
  },
  { id: 'a', createdAt: '2026-10-01T10:00:00Z', title: '=HYPERLINK("x")', category: 'other', condition: 'fair', status: 'sold', askingPrice: 650, soldPrice: 600, soldDate: '2026-10-03', soldPlatform: 'ebay', listings: [] },
];

test('one row per item and per listing, with matching widths', () => {
  const t = buildTables(items);
  assert.equal(t.items.rows.length, 2);
  assert.equal(t.listings.rows.length, 2);
  for (const r of t.items.rows) assert.equal(r.length, ITEM_HEADER.length);
  for (const r of t.listings.rows) assert.equal(r.length, LISTING_HEADER.length);
});

test('item rows carry tier, prices and listing summary', () => {
  const lamp = buildTables(items).items.rows.find((r) => r[0] === 'b');
  const col = (name) => lamp[ITEM_HEADER.indexOf(name)];
  assert.equal(col('Price tier'), 'Under $100');
  assert.equal(col('Status'), 'Listed');
  assert.equal(col('Asking price'), 75);
  assert.equal(col('Active listings'), 1);
  assert.equal(col('Platforms'), 'Facebook Marketplace, Local shop');
  assert.equal(col('First posted'), '2026-10-01');
  assert.equal(col('Last updated'), '2026-10-03');
});

test('sold item shows where it sold and lands in the $501+ tier', () => {
  const sold = buildTables(items).items.rows.find((r) => r[0] === 'a');
  assert.equal(sold[ITEM_HEADER.indexOf('Price tier')], '$501 and above');
  assert.equal(sold[ITEM_HEADER.indexOf('Sold on')], 'eBay');
  assert.equal(sold[ITEM_HEADER.indexOf('Sold price')], 600);
});

test('text that looks like a formula is neutralised', () => {
  const sold = buildTables(items).items.rows.find((r) => r[0] === 'a');
  assert.equal(sold[1], '\'=HYPERLINK("x")');
});

test('listing rows include URL and status', () => {
  const [first] = buildTables(items).listings.rows;
  assert.equal(first[LISTING_HEADER.indexOf('Listing URL')], 'https://facebook.com/marketplace/item/1');
  assert.equal(first[LISTING_HEADER.indexOf('Listing status')], 'Active');
});

test('web app URL validation', () => {
  assert.ok(isWebAppUrl('https://script.google.com/macros/s/AKfycbx_abc-123/exec'));
  assert.ok(!isWebAppUrl('https://script.google.com/macros/s/AKfycbx/dev'));
  assert.ok(!isWebAppUrl('https://evil.example.com/exec'));
});

test('generated script embeds the sync code and is valid JavaScript', () => {
  const src = scriptSource('abc123');
  assert.match(src, /const SYNC_CODE = 'abc123';/);
  // Compile it (Apps Script globals are only referenced inside functions).
  assert.doesNotThrow(() => new Function(src));
});
