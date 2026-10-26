import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEbayListing, ebaySku, descriptionHTML, ebayAspects, defaultCondition, missingAspects } from '../js/ebay.js';
import { readySheet } from '../js/ready.js';
import { scriptSource, ebayError } from '../js/sheets.js';
import { createFakeGoogle, loadScript } from './fake-apps-script.js';
import { fakeEbay } from './fake-ebay.js';

const item = (extra = {}) => ({
  id: 'abc.123', title: 'Sony WH-1000XM4 headphones', brand: 'Sony', model: 'WH-1000XM4', color: 'Black',
  category: 'electronics', condition: 'good', askingPrice: 180, floorPrice: 140, photos: ['p1', 'p2'],
  draftTitle: 'Sony WH-1000XM4 Wireless Noise Cancelling Headphones Black', draftDesc: 'Works great.\n\nIncludes case & cable.',
  flaws: 'Light wear on headband.', shipping: { lb: 2, oz: 8, l: 10, w: 8, h: 4 }, listings: [], ...extra,
});
const cfg = { fulfillment: 'F1', payment: 'P1', returns: 'R1' };

test('sku is eBay-safe', () => {
  assert.equal(ebaySku({ id: 'abc.123/x' }), 'RS-abc123x');
  assert.ok(ebaySku({ id: 'x'.repeat(80) }).length <= 50);
});

test('description becomes simple escaped HTML', () => {
  assert.equal(descriptionHTML('A & B\nline 2\n\n<b>Next</b>'), '<p>A &amp; B<br>line 2</p>\n<p>&lt;b&gt;Next&lt;/b&gt;</p>');
});

test('aspects skip blanks and duplicates', () => {
  assert.deepEqual(ebayAspects([{ name: 'Brand', value: 'Sony' }, { name: 'brand', value: 'Other' }, { name: 'Color', value: '' }]), { Brand: ['Sony'] });
  assert.deepEqual(missingAspects([{ name: 'Brand' }, { name: 'Type' }], { Brand: ['Sony'] }).map((a) => a.name), ['Type']);
});

test('default conditions', () => {
  assert.equal(defaultCondition({ condition: 'new' }), 'NEW');
  assert.equal(defaultCondition({ condition: 'parts' }), 'FOR_PARTS_OR_NOT_WORKING');
  assert.equal(defaultCondition({ condition: 'good', category: 'tools' }), 'USED_EXCELLENT');
});

test('builds inventory item and offer from the Ready for eBay sheet', () => {
  const it = item();
  const l = buildEbayListing(it, readySheet(it, 'ebay', {}), { categoryId: '112529', extraAspects: { Type: 'Over-Ear' } }, cfg);
  assert.deepEqual(l.problems, []);
  assert.equal(l.sku, 'RS-abc123');
  assert.equal(l.inventoryItem.product.title, it.draftTitle);
  assert.deepEqual(l.inventoryItem.product.aspects.Brand, ['Sony']);
  assert.deepEqual(l.inventoryItem.product.aspects.Type, ['Over-Ear']);
  assert.equal(l.inventoryItem.condition, 'USED_EXCELLENT');
  assert.equal(l.inventoryItem.conditionDescription, 'Light wear on headband.');
  assert.deepEqual(l.inventoryItem.packageWeightAndSize.weight, { value: 2.5, unit: 'POUND' });
  assert.equal(l.offer.pricingSummary.price.value, '180.00');
  assert.equal(l.offer.categoryId, '112529');
  assert.equal(l.offer.listingPolicies.fulfillmentPolicyId, 'F1');
  const bo = l.offer.listingPolicies.bestOfferTerms;
  assert.ok(Number(bo.autoAcceptPrice.value) < 180 && Number(bo.autoDeclinePrice.value) < Number(bo.autoAcceptPrice.value));
  assert.equal(bo.autoDeclinePrice.value, '140.00');
  assert.match(l.offer.listingDescription, /Includes case &amp; cable/);
});

test('lists what is missing before posting', () => {
  const it = item({ photos: [], askingPrice: 0, suggested: null });
  const l = buildEbayListing(it, readySheet(it, 'ebay', {}), { requiredAspects: [{ name: 'Type' }] }, {});
  const text = l.problems.join(' | ');
  for (const w of ['photo', 'asking price', 'category', 'policies', '"Type"']) assert.ok(text.includes(w), w);
});

test('maps script errors to friendly messages', () => {
  assert.match(ebayError('Error: EBAY_KEYS_MISSING EBAY_CERT_ID'), /missing: EBAY_CERT_ID/);
  assert.match(ebayError('Error: EBAY_NOT_CONNECTED'), /Connect eBay/);
  assert.match(ebayError('Exception: You do not have permission to call UrlFetchApp.fetch'), /authorizeEbay/);
  assert.match(ebayError('Error: EBAY The category is invalid.'), /^eBay: The category is invalid/);
  assert.equal(ebayError('something else'), null);
});

// ---------- The real Apps Script against a fake eBay ----------
const SECRET = 's3';
function setup() {
  const eb = fakeEbay();
  const fake = createFakeGoogle({ fetch: eb.handler });
  const script = loadScript(scriptSource(SECRET), fake);
  const call = (action, extra = {}) => script.doPost({ secret: SECRET, action, ...extra });
  return { eb, fake, script, call };
}

function connect(ctx) {
  Object.assign(ctx.fake.props.store, { EBAY_APP_ID: 'APP', EBAY_CERT_ID: 'CERT', EBAY_RUNAME: 'Me-App-PRD-run' });
  const url = new URL(ctx.call('ebay-auth-url').url);
  const page = ctx.script.doGet({ code: 'v^1.1#code', state: url.searchParams.get('state') });
  return { url, page };
}

test('eBay status reports missing keys', () => {
  const { call } = setup();
  const r = call('ebay-status');
  assert.equal(r.ok, true);
  assert.equal(r.configured, false);
  assert.deepEqual(r.missing, ['EBAY_APP_ID', 'EBAY_CERT_ID', 'EBAY_RUNAME']);
  assert.match(call('ebay-auth-url').error, /EBAY_KEYS_MISSING/);
});

test('sign-in: auth URL, callback with state check, token stored', () => {
  const ctx = setup();
  Object.assign(ctx.fake.props.store, { EBAY_APP_ID: 'APP', EBAY_CERT_ID: 'CERT', EBAY_RUNAME: 'Me-App-PRD-run' });
  const url = new URL(ctx.call('ebay-auth-url').url);
  assert.equal(url.host, 'auth.ebay.com');
  assert.equal(url.searchParams.get('redirect_uri'), 'Me-App-PRD-run');
  assert.match(url.searchParams.get('scope'), /sell\.inventory/);
  const bad = ctx.script.doGet({ code: 'x', state: 'wrong' });
  assert.match(bad.title, /expired/);
  const ok = ctx.script.doGet({ code: 'v^1.1#code', state: url.searchParams.get('state') });
  assert.match(ok.title, /connected/);
  assert.equal(ctx.fake.props.store.EBAY_REFRESH_TOKEN, 'RT1');
  assert.ok(ctx.eb.st.tokenCalls[0].includes('code=v%5E1.1%23code'));
  assert.equal(ctx.call('ebay-status').connected, true);
  // A replayed callback is refused (state is single-use).
  assert.match(ctx.script.doGet({ code: 'again', state: url.searchParams.get('state') }).title, /expired/);
});

test('callback shows a clear page when the keys are wrong or sign-in was declined', () => {
  const ctx = setup();
  Object.assign(ctx.fake.props.store, { EBAY_APP_ID: 'APP', EBAY_CERT_ID: 'WRONG', EBAY_RUNAME: 'r' });
  const state = new URL(ctx.call('ebay-auth-url').url).searchParams.get('state');
  const p = ctx.script.doGet({ code: 'c', state });
  assert.match(p.title, /not connected/);
  assert.match(p.html, /client authentication failed/);
  assert.match(ctx.script.doGet({ error: 'access_denied' }).html, /cancelled/);
});

test('policies, categories and required aspects', () => {
  const ctx = setup();
  connect(ctx);
  const pol = ctx.call('ebay-policies');
  assert.deepEqual(pol.fulfillment, [{ id: 'F1', name: 'USPS Ground' }]);
  assert.deepEqual(pol.locations, []);
  const cats = ctx.call('ebay-categories', { q: 'sony headphones', categoryId: '112529' });
  assert.equal(cats.suggestions[0].path, 'Consumer Electronics › Portable Audio & Headphones › Headphones');
  assert.deepEqual(cats.aspects.map((a) => a.name), ['Brand']);
});

test('posting: uploads photos, creates location, inventory item, offer, publishes; re-post updates', () => {
  const ctx = setup();
  connect(ctx);
  ctx.call('photo-put', { id: 'p1', data: Buffer.from('jpeg1').toString('base64') });
  ctx.call('photo-put', { id: 'p2', data: Buffer.from('jpeg2').toString('base64') });
  const it = item();
  const l = buildEbayListing(it, readySheet(it, 'ebay', {}), { categoryId: '112529' }, cfg);
  const body = { sku: l.sku, inventoryItem: l.inventoryItem, offer: l.offer, photoIds: ['p1', 'p2'], postalCode: '78701' };

  const noZip = ctx.call('ebay-post', { ...body, postalCode: '' });
  assert.match(noZip.error, /ZIP code/);

  const r = ctx.call('ebay-post', body);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.url, 'https://www.ebay.com/itm/1234567890');
  assert.equal(r.updated, false);
  assert.deepEqual(ctx.eb.st.inventory['RS-abc123'].product.imageUrls, ['https://i.ebayimg.com/img1.jpg', 'https://i.ebayimg.com/img2.jpg']);
  assert.equal(ctx.eb.st.locations[0].location.address.postalCode, '78701');
  assert.equal(ctx.eb.st.offers[0].merchantLocationKey, 'resell-home');
  assert.equal(ctx.eb.st.offers[0].marketplaceId, 'EBAY_US');

  // Second post: same offer revised, photos not uploaded again.
  body.offer.pricingSummary.price.value = '170.00';
  const r2 = ctx.call('ebay-post', body);
  assert.equal(r2.updated, true);
  assert.equal(ctx.eb.st.offers.length, 1);
  assert.equal(ctx.eb.st.offers[0].pricingSummary.price.value, '170.00');
  assert.equal(ctx.eb.st.images, 2);
});

test('eBay errors come back readable; expired access token is refreshed', () => {
  const ctx = setup();
  connect(ctx);
  ctx.call('photo-put', { id: 'p1', data: Buffer.from('x').toString('base64') });
  const it = item({ photos: ['p1'] });
  const l = buildEbayListing(it, readySheet(it, 'ebay', {}), { categoryId: '' }, cfg);
  const r = ctx.call('ebay-post', { sku: l.sku, inventoryItem: l.inventoryItem, offer: l.offer, photoIds: ['p1'], postalCode: '78701' });
  assert.match(ebayError(r.error), /^eBay: The category ID is invalid\./);
  ctx.fake.props.store.EBAY_ACCESS_EXPIRES = '0';
  ctx.call('ebay-policies');
  assert.ok(ctx.eb.st.tokenCalls.at(-1).includes('grant_type=refresh_token'));
  assert.equal(ctx.fake.props.store.EBAY_ACCESS_TOKEN, 'AT2');
});

test('disconnect forgets the tokens', () => {
  const ctx = setup();
  connect(ctx);
  ctx.call('ebay-disconnect');
  assert.equal(ctx.call('ebay-status').connected, false);
  assert.match(ctx.call('ebay-policies').error, /EBAY_NOT_CONNECTED/);
});
