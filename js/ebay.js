// Posting straight to eBay. The app builds the listing here; the user's Google Apps
// Script holds the eBay keys and tokens and makes the actual eBay API calls (Inventory
// API: inventory item → offer → publish). Pure functions (no DOM) so they can be tested.

import { bestOfferPrices } from './ready.js';
import { limitsFor } from './writer.js';

// eBay's condition values. Which ones a category accepts varies; "Used" in most
// categories is USED_EXCELLENT.
export const EBAY_CONDITIONS = {
  NEW: 'New',
  LIKE_NEW: 'Like new',
  NEW_OTHER: 'New other / open box',
  USED_EXCELLENT: 'Used (most categories)',
  USED_VERY_GOOD: 'Used – very good',
  USED_GOOD: 'Used – good',
  USED_ACCEPTABLE: 'Used – acceptable',
  PRE_OWNED_EXCELLENT: 'Pre-owned – excellent (clothing)',
  PRE_OWNED_FAIR: 'Pre-owned – fair (clothing)',
  FOR_PARTS_OR_NOT_WORKING: 'For parts or not working',
};

export function defaultCondition(item) {
  if (item.condition === 'new') return 'NEW';
  if (item.condition === 'parts') return 'FOR_PARTS_OR_NOT_WORKING';
  if (['clothing', 'luxury'].includes(item.category)) return item.condition === 'fair' ? 'PRE_OWNED_FAIR' : 'USED_EXCELLENT';
  return 'USED_EXCELLENT';
}

// eBay SKUs: letters, numbers, - and _, up to 50 characters.
export const ebaySku = (item) => ('RS-' + String(item.id || '').replace(/[^A-Za-z0-9_-]/g, '')).slice(0, 50);

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// Plain-text description → simple HTML (paragraphs and line breaks).
export function descriptionHTML(text) {
  return String(text || '')
    .trim()
    .split(/\n\s*\n/)
    .map((p) => `<p>${esc(p.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

// [{name, value}] → { Name: [value] }, skipping blanks and repeats. eBay caps aspect
// names at 40 characters and values at 65.
export function ebayAspects(list = []) {
  const out = {};
  for (const { name, value } of list) {
    const n = String(name || '').trim().slice(0, 40);
    const v = String(value || '').trim().slice(0, 65);
    if (!n || !v || Object.keys(out).some((k) => k.toLowerCase() === n.toLowerCase())) continue;
    out[n] = [v];
  }
  return out;
}

const money2 = (n) => (Math.round(Number(n) * 100) / 100).toFixed(2);

// Required aspects (from eBay, for the chosen category) that have no value yet.
export function missingAspects(required = [], aspects = {}) {
  const have = new Set(Object.keys(aspects).map((k) => k.toLowerCase()));
  return required.filter((a) => !have.has(String(a.name).toLowerCase()));
}

// Everything the script needs to post. `fields` is the Ready-for-eBay sheet (readySheet),
// `post` holds the choices made on that screen, `cfg` the eBay settings.
export function buildEbayListing(item, fields, post = {}, cfg = {}) {
  const f = Object.fromEntries(fields.map((x) => [x.key, x]));
  const problems = [];
  const title = String(f.title?.value || '').trim().slice(0, limitsFor('ebay').title);
  const text = String(f.description?.value || '').trim();
  const price = Number(item.askingPrice) || Number(item.suggested?.listPrice) || 0;
  const condition = EBAY_CONDITIONS[post.condition] ? post.condition : defaultCondition(item);
  const aspects = ebayAspects([...(f.specifics?.list || []), ...Object.entries(post.extraAspects || {}).map(([name, value]) => ({ name, value }))]);

  if (!item.photos?.length) problems.push('Add at least one photo.');
  if (!title) problems.push('Add a title.');
  if (!text) problems.push('Add a description.');
  if (!price) problems.push('Set an asking price.');
  if (!post.categoryId) problems.push('Pick an eBay category.');
  if (!cfg.fulfillment || !cfg.payment || !cfg.returns) problems.push('Choose your eBay shipping, payment and return policies in Settings → eBay posting.');
  for (const a of missingAspects(post.requiredAspects, aspects)) problems.push(`eBay requires "${a.name}" for this category.`);

  const inventoryItem = {
    availability: { shipToLocationAvailability: { quantity: 1 } },
    condition,
    product: { title, description: text.slice(0, 4000), aspects },
  };
  const notes = String(f.conditionNotes?.value || '').trim();
  if (notes && condition !== 'NEW') inventoryItem.conditionDescription = notes.slice(0, 1000);

  const sh = item.shipping || {};
  const weight = (Number(sh.lb) || 0) + (Number(sh.oz) || 0) / 16;
  const dims = [sh.l, sh.w, sh.h].map((d) => Number(d) || 0);
  if (weight > 0 || dims.every((d) => d > 0)) {
    inventoryItem.packageWeightAndSize = {};
    if (weight > 0) inventoryItem.packageWeightAndSize.weight = { value: Math.round(weight * 100) / 100, unit: 'POUND' };
    if (dims.every((d) => d > 0)) inventoryItem.packageWeightAndSize.dimensions = { length: dims[0], width: dims[1], height: dims[2], unit: 'INCH' };
  }

  const listingPolicies = { fulfillmentPolicyId: cfg.fulfillment, paymentPolicyId: cfg.payment, returnPolicyId: cfg.returns };
  const { accept, decline } = bestOfferPrices(price, item.floorPrice);
  if (post.bestOffer !== false && accept > 0 && accept < price) {
    listingPolicies.bestOfferTerms = { bestOfferEnabled: true, autoAcceptPrice: { value: money2(accept), currency: 'USD' } };
    if (decline > 0 && decline < accept) listingPolicies.bestOfferTerms.autoDeclinePrice = { value: money2(decline), currency: 'USD' };
  }

  const offer = {
    format: 'FIXED_PRICE',
    availableQuantity: 1,
    categoryId: String(post.categoryId || ''),
    listingDescription: descriptionHTML(text),
    pricingSummary: { price: { value: money2(price), currency: 'USD' } },
    listingPolicies,
  };

  return { sku: ebaySku(item), inventoryItem, offer, problems, price };
}
