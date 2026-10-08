import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readySheet, readyProblems, READY_PROFILES } from '../js/ready.js';

const lamp = {
  id: 'a', title: 'Brass table lamp', brand: 'Stiffel', category: 'home', condition: 'good', flaws: 'Light patina on base',
  askingPrice: 120, floorPrice: 90, photos: ['p1', 'p2', 'p3', 'p4', 'p5'], listings: [],
  draftTitle: 'Stiffel Brass Table Lamp Vintage', draftDesc: 'Solid brass lamp. Works great.',
  shipping: { lb: 6, oz: 0, l: 18, w: 12, h: 12, box: 'custom' },
};
const field = (fields, key) => fields.find((f) => f.key === key);

test('eBay profile exists and follows the listing form order', () => {
  assert.ok(READY_PROFILES.ebay);
  const steps = [...new Set(readySheet(lamp, 'ebay').map((f) => f.step))];
  assert.deepEqual(steps, ['Photos', 'Title', 'Category', 'Item specifics', 'Condition', 'Description', 'Pricing', 'Delivery', 'Preferences']);
});

test('uses the written title/description, category hint, condition and flaws', () => {
  const f = readySheet(lamp, 'ebay');
  assert.equal(field(f, 'title').value, 'Stiffel Brass Table Lamp Vintage');
  assert.equal(field(f, 'description').value, 'Solid brass lamp. Works great.');
  assert.match(field(f, 'category').value, /Home Décor/);
  assert.equal(field(f, 'condition').value, 'Used');
  assert.equal(field(f, 'conditionNotes').value, 'Light patina on base');
  assert.match(field(f, 'specifics').value, /Brand: Stiffel/);
  assert.equal(readyProblems(f).length, 0);
});

test('offers: auto-accept near asking, auto-decline at the floor', () => {
  const v = field(readySheet(lamp, 'ebay'), 'offers').value;
  assert.match(v, /Auto-accept at \$110/);
  assert.match(v, /Auto-decline below \$90/);
});

test('shipping uses the estimate; bulky items switch to local pickup', () => {
  const f = readySheet(lamp, 'ebay');
  assert.match(field(f, 'package').value, /6 lb 0 oz\n18 × 12 × 12 in/);
  assert.match(field(f, 'shipping').value, /Calculated \(buyer pays\) — (USPS|UPS)/);
  const bulky = readySheet({ ...lamp, bulky: true }, 'ebay', { location: 'Burbank' });
  assert.equal(field(bulky, 'shipping').value, 'Local pickup only — Burbank');
  assert.equal(field(bulky, 'package'), undefined);
});

test('missing photos and price are flagged; title falls back to generated', () => {
  const bare = { id: 'b', title: 'Lamp', category: 'home', condition: 'good', photos: [], listings: [] };
  const f = readySheet(bare, 'ebay');
  const probs = readyProblems(f).map((p) => p.key);
  assert.ok(probs.includes('photos'));
  assert.ok(probs.includes('price'));
  assert.equal(field(f, 'title').value, 'Lamp');
  assert.match(field(f, 'title').warn, /Generated/);
});

test('titles never exceed the 80 character limit', () => {
  const long = { ...lamp, draftTitle: 'x'.repeat(120) };
  assert.equal(field(readySheet(long, 'ebay'), 'title').value.length, 80);
});

test('clothing gets apparel condition names; Claude suggestions take priority', () => {
  const shirt = { ...lamp, category: 'clothing', condition: 'like_new' };
  assert.match(field(readySheet(shirt, 'ebay'), 'condition').value, /Pre-owned — Excellent/);
  const withAi = { ...lamp, ready: { ebay: { ai: { category: 'Home & Garden > Lamps', condition: 'Used', itemSpecifics: [{ name: 'Type', value: 'Table Lamp' }, { name: 'brand', value: 'dup' }], notes: '' } } } };
  const f = readySheet(withAi, 'ebay');
  assert.equal(field(f, 'category').value, 'Home & Garden > Lamps');
  assert.deepEqual(field(f, 'specifics').list.map((s) => s.name), ['Brand', 'Type'], 'duplicates ignored, your brand kept');
});

test('unknown marketplace gives an empty sheet', () => {
  assert.deepEqual(readySheet(lamp, 'nowhere'), []);
});
