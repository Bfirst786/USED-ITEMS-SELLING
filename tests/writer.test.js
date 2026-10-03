import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateTitle, generateDescription, titleCase, shorten, fixShouting, lint } from '../js/writer.js';

const mixer = { title: 'KitchenAid stand mixer', brand: 'KitchenAid', model: 'Artisan KSM150', category: 'kitchen', condition: 'good', features: '5 qt bowl\nTilt head', flaws: 'Small scuff on base', photos: ['a', 'b', 'c', 'd', 'e'] };

test('title de-duplicates words and respects limits', () => {
  const t = generateTitle(mixer, 'ebay');
  assert.equal(t, 'KitchenAid Artisan KSM150 stand mixer');
  const long = generateTitle({ title: 'word '.repeat(40) + 'x'.repeat(10) + ' unique words that go on and on and on forever and ever more' }, 'craigslist');
  assert.ok(long.length <= 70);
});

test('description adapts to local vs shipped platforms', () => {
  const local = generateDescription(mixer, 'facebook', { location: 'Austin', pickupNote: 'Cash only.' });
  assert.match(local, /Pickup in Austin\. Cash only\./);
  assert.match(local, /• 5 qt bowl/);
  assert.match(local, /Small scuff/);
  const shipped = generateDescription(mixer, 'ebay', { shippingNote: 'Ships next day.' });
  assert.match(shipped, /Details:/);
  assert.match(shipped, /Ships next day\./);
  assert.doesNotMatch(shipped, /Pickup/);
});

test('quick edits', () => {
  assert.equal(titleCase('vintage lamp for the den'), 'Vintage Lamp for the Den');
  assert.equal(titleCase('iPhone 14 PRO max'), 'iPhone 14 PRO Max');
  assert.equal(fixShouting('GREAT DEAL!!!'), 'Great Deal!');
  assert.equal(shorten('Really nice AMAZING lamp for sale'), 'lamp');
  assert.ok(shorten('a b c d e f g h', 5).length <= 5);
});

test('lint flags common listing problems', () => {
  const msgs = (t, d, item, p = 'ebay') => lint(t, d, item, p).map((x) => x.msg).join('\n');
  assert.match(msgs('x'.repeat(90), 'desc', mixer), /keep it under 80/);
  assert.match(msgs('Couch', 'Nice couch in good condition, call 555-123-4567', { category: 'furniture', condition: 'good', photos: [] }, 'facebook'), /dimensions[\s\S]*Phone numbers[\s\S]*No photos/i);
  assert.match(msgs('Phone', 'Pay with Zelle only', { category: 'phones', condition: 'good', photos: ['a'] }), /Off-platform/);
  const good = lint('KitchenAid Artisan stand mixer', generateDescription(mixer, 'ebay'), mixer, 'ebay');
  assert.equal(good.filter((x) => x.level === 'error').length, 0);
});
