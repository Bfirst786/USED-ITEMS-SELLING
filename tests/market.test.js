import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsMarketCheck } from '../js/pricing.js';
import { normalizeMarket, searchResultUrls } from '../js/ai.js';

const now = new Date('2026-10-05T12:00:00Z');

test('only higher-value active items are flagged for a market check', () => {
  assert.equal(needsMarketCheck({ askingPrice: 60, status: 'draft' }, now), false);
  assert.equal(needsMarketCheck({ askingPrice: 150, status: 'draft' }, now), true);
  assert.equal(needsMarketCheck({ askingPrice: 900, status: 'listed' }, now), true);
  assert.equal(needsMarketCheck({ originalPrice: 400, status: 'draft' }, now), true, 'no price yet but expensive new');
  assert.equal(needsMarketCheck({ askingPrice: 900, status: 'sold' }, now), false);
});

test('a recent check clears the flag; a stale one brings it back', () => {
  assert.equal(needsMarketCheck({ askingPrice: 300, status: 'listed', marketCheck: { at: '2026-09-20T00:00:00Z' } }, now), false);
  assert.equal(needsMarketCheck({ askingPrice: 300, status: 'listed', marketCheck: { at: '2026-08-01T00:00:00Z' } }, now), true);
});

const blocks = [
  { type: 'server_tool_use', name: 'web_search' },
  { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://www.ebay.com/itm/123456', title: 'Sold' }] },
  { type: 'text', text: 'Found it', citations: [{ url: 'https://offerup.com/item/detail/42/' }] },
];

test('collects URLs from search results and citations', () => {
  const urls = searchResultUrls(blocks);
  assert.ok(urls.has('ebay.com/itm/123456'));
  assert.ok(urls.has('offerup.com/item/detail/42'));
});

test('keeps real links, strips invented ones, cleans numbers', () => {
  const m = normalizeMarket(
    {
      comparables: [
        { title: 'Trek FX 2 — sold', price: '410', status: 'sold', url: 'https://ebay.com/itm/123456', source: 'eBay' },
        { title: 'Made-up listing', price: 999, status: 'for sale', url: 'https://example.com/fake' },
        { title: 'No price', price: 0, status: 'sold' },
        { title: 'Weird status', price: 380, status: 'auction' },
      ],
      sold_low: 350, sold_high: 450, typical_sold: 400, suggested_list_price: 440, suggested_floor: 370,
      confidence: 'very high', summary: 'Sells around $400.', caveats: ['Check the size'],
    },
    searchResultUrls(blocks)
  );
  assert.equal(m.comparables.length, 2);
  assert.equal(m.dropped, 1, 'listing with a link not in the search results is dropped');
  assert.equal(m.comparables[0].url, 'https://ebay.com/itm/123456');
  assert.equal(m.comparables[0].price, 410);
  assert.ok(!m.comparables.some((c) => c.title === 'Made-up listing'));
  assert.equal(m.comparables[1].url, '', 'listing given without any link is kept, unlinked');
  assert.equal(m.comparables[1].status, 'for sale');
  assert.equal(m.confidence, 'low', 'unknown confidence falls back to low');
  assert.equal(m.listPrice, 440);
  assert.deepEqual(m.caveats, ['Check the size']);
});

test('survives an empty or broken reply', () => {
  const m = normalizeMarket(null);
  assert.deepEqual(m.comparables, []);
  assert.equal(m.typicalSold, 0);
});
