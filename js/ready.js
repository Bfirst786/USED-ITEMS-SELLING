// "Ready for <marketplace>" sheets: everything a marketplace's listing form asks for,
// in the order it asks, ready to copy. Each marketplace is a profile below; add new
// ones by adding a profile. Pure functions (no DOM) so they can be unit tested.

import { CONDITIONS, money, nicePrice } from './pricing.js';
import { generateTitle, generateDescription, limitsFor } from './writer.js';
import { estimateShipping } from './shipping.js';

// Category hints: the marketplace suggests categories from the title; these say
// which branch to pick. Names follow eBay's category tree.
const EBAY_CATEGORIES = {
  electronics: 'Consumer Electronics',
  phones: 'Cell Phones & Accessories › Cell Phones & Smartphones',
  computers: 'Computers/Tablets & Networking',
  gaming: 'Video Games & Consoles',
  cameras: 'Cameras & Photo',
  furniture: 'Home & Garden › Furniture',
  appliances: 'Home & Garden › Major Appliances',
  clothing: 'Clothing, Shoes & Accessories',
  luxury: 'Clothing, Shoes & Accessories (bags, wallets, accessories)',
  jewelry: 'Jewelry & Watches',
  tools: 'Home & Garden › Tools & Workshop Equipment',
  sports: 'Sporting Goods',
  bikes: 'Sporting Goods › Cycling › Bicycles',
  instruments: 'Musical Instruments & Gear',
  collectibles: 'Collectibles (or Antiques, if over 100 years old)',
  books: 'Books & Magazines / Movies & TV / Music',
  toys: 'Toys & Hobbies',
  baby: 'Baby',
  home: 'Home & Garden › Home Décor',
  kitchen: 'Home & Garden › Kitchen, Dining & Bar',
  auto: 'eBay Motors › Parts & Accessories',
  other: '',
};

function ebayCondition(item) {
  const apparel = ['clothing', 'luxury'].includes(item.category);
  switch (item.condition) {
    case 'new':
      return apparel ? 'New with tags (or New without tags)' : 'New (or New other / Open box if the packaging was opened)';
    case 'like_new':
      return apparel ? 'Pre-owned — Excellent' : 'Used (or Open box if it was never used)';
    case 'good':
      return apparel ? 'Pre-owned — Good' : 'Used';
    case 'fair':
      return apparel ? 'Pre-owned — Fair' : 'Used';
    case 'parts':
      return 'For parts or not working';
    default:
      return 'Used';
  }
}

function itemSpecifics(item, ai) {
  const specs = [];
  const add = (name, value) => {
    if (value && !specs.some((s) => s.name.toLowerCase() === name.toLowerCase())) specs.push({ name, value: String(value) });
  };
  add('Brand', item.brand || (ai ? '' : 'Unbranded'));
  add('Model', item.model);
  add('Size', item.size);
  add('Color', item.color);
  for (const s of ai?.itemSpecifics || []) add(s.name, s.value);
  return specs;
}

function photoNote(n) {
  if (!n) return { value: 'No photos yet', warn: 'Add photos first — listings without photos rarely sell.' };
  if (n < 4) return { value: `${n} photo${n > 1 ? 's' : ''}`, warn: 'Tip: 6–12 photos sell best — front, back, labels, any flaws.' };
  return { value: `${n} photos` };
}

function ebaySheet(item, settings = {}) {
  const ai = item.ready?.ebay?.ai;
  const lim = limitsFor('ebay');
  const title = (item.draftTitle || generateTitle(item, 'ebay')).slice(0, lim.title);
  const description = item.draftDesc || generateDescription(item, 'ebay', settings);
  const price = Number(item.askingPrice) || Number(item.suggested?.listPrice) || 0;
  const floor = Number(item.floorPrice) || 0;
  const est = item.shipping && (item.shipping.lb || item.shipping.oz) ? estimateShipping(item.shipping) : null;
  const sh = item.shipping || {};
  const photos = photoNote((item.photos || []).length);
  const specs = itemSpecifics(item, ai);
  const category = ai?.category || EBAY_CATEGORIES[item.category] || '';

  // Offers: auto-accept close to asking, auto-decline below your floor.
  const accept = price ? nicePrice(price * 0.93) : 0;
  const decline = price ? Math.min(floor || nicePrice(price * 0.8), accept - 1) : 0;

  const fields = [
    { key: 'photos', step: 'Photos', label: 'Photos', value: photos.value, copy: false, warn: photos.warn, action: 'save-photos', hint: 'Tap "Save photos" to put them in your camera roll, then add them in eBay. First photo = cover.' },
    { key: 'title', step: 'Title', label: 'Title', value: title, limit: lim.title, warn: !item.draftTitle ? 'Generated from your details — edit it in "Write the listing" if you like.' : '', hint: 'Lead with brand, model and key specs — that\'s what buyers search.' },
    { key: 'category', step: 'Category', label: 'Category', value: category, copy: false, hint: category ? 'eBay suggests categories after you type the title — pick the one matching this.' : 'eBay suggests categories after you type the title — pick the closest match.' },
    { key: 'specifics', step: 'Item specifics', label: 'Item specifics', value: specs.map((s) => `${s.name}: ${s.value}`).join('\n'), multiline: true, list: specs, hint: ai ? 'Filled in with Claude — check each against the item.' : 'eBay asks for these on the next screen. Required ones (marked with *) vary by category — tap "Fill with Claude" for a fuller list.' },
    { key: 'condition', step: 'Condition', label: 'Condition', value: ai?.condition || ebayCondition(item), copy: false, hint: 'Pick this from eBay\'s list (names vary a little by category).' },
    { key: 'conditionNotes', step: 'Condition', label: 'Condition description', value: item.condition === 'new' ? '' : item.flaws || (CONDITIONS[item.condition] ? `${CONDITIONS[item.condition].label}. See photos for details.` : ''), hint: 'Shown next to the condition — mention any flaws here.', optional: true },
    { key: 'description', step: 'Description', label: 'Description', value: description, multiline: true, warn: !item.draftDesc ? 'Generated from your details — edit it in "Write the listing" if you like.' : '' },
    { key: 'format', step: 'Pricing', label: 'Format', value: 'Buy It Now', copy: false, hint: 'Auctions suit rare or collectible items; Buy It Now is simpler for most things.' },
    { key: 'price', step: 'Pricing', label: 'Price', value: price ? String(price) : '', warn: price ? '' : 'Set an asking price first (Price section).', display: price ? money(price) : '' },
    { key: 'offers', step: 'Pricing', label: 'Best Offer', value: price ? `Allow offers: On\nAuto-accept at ${money(accept)} or more\nAuto-decline below ${money(decline)}` : '', copy: false, multiline: true, hint: floor ? `Auto-decline is set from your lowest price (${money(floor)}).` : 'Set "Lowest I\'ll take" in the Price section to tune auto-decline.' },
  ];

  if (item.bulky) {
    fields.push({ key: 'shipping', step: 'Delivery', label: 'Delivery', value: `Local pickup only${settings.location ? ` — ${settings.location}` : ''}`, copy: false, hint: 'Marked bulky — choose "Local pickup" in eBay\'s delivery options.' });
  } else {
    fields.push(
      { key: 'package', step: 'Delivery', label: 'Package weight & size', value: sh.lb || sh.oz ? `${sh.lb || 0} lb ${sh.oz || 0} oz${sh.l && sh.w && sh.h ? `\n${sh.l} × ${sh.w} × ${sh.h} in` : ''}` : '', copy: false, multiline: true, warn: sh.lb || sh.oz ? (sh.estimated ? 'Estimated by Claude — weigh and measure the packed box before buying a label.' : '') : 'Add a packed weight in "Shipping estimate" so eBay can calculate postage.' },
      { key: 'shipping', step: 'Delivery', label: 'Shipping', value: est && est.ok ? `Calculated (buyer pays) — ${est.options.find((o) => o.key === est.best).name}\nTypical cost ${money(est.low)}–${money(est.high)}` : 'Calculated (buyer pays)', copy: false, multiline: true, hint: 'Calculated shipping charges each buyer the right amount for their distance. When it sells, buy the label on Pirate Ship (usually the cheapest) and paste the tracking number into the eBay order — or use eBay\'s own label if you prefer.' },
      { key: 'handling', step: 'Delivery', label: 'Handling time', value: '1 business day', copy: false, hint: 'Faster handling helps your listing rank.' }
    );
  }
  fields.push({ key: 'returns', step: 'Preferences', label: 'Returns', value: 'No returns (or 30-day returns for higher-value items)', copy: false, hint: 'eBay\'s Money Back Guarantee still covers "not as described" — describe flaws honestly.' });
  return fields;
}

export const READY_PROFILES = {
  ebay: {
    name: 'eBay',
    icon: '🛒',
    sellUrl: 'https://www.ebay.com/sl/prelist/suggest',
    intro: 'Open the eBay app (Selling → List an item) or the button below, then fill each step in order. Tap Copy, switch to eBay, paste. ✓ marks what you\'ve done.',
    build: ebaySheet,
    canAssist: true,
  },
};

export function readySheet(item, platform, settings) {
  const p = READY_PROFILES[platform];
  return p ? p.build(item, settings) : [];
}

// Fields still blocking a good listing (warnings on required steps).
export function readyProblems(fields) {
  return fields.filter((f) => f.warn && !f.optional && (!f.value || /No photos|Set an asking/.test(f.value + f.warn)));
}

// Structured output schema for Claude's eBay category + item specifics suggestion.
export const EBAY_ASSIST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['category', 'condition', 'itemSpecifics', 'notes'],
  properties: {
    category: { type: 'string' },
    condition: { type: 'string' },
    itemSpecifics: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['name', 'value'], properties: { name: { type: 'string' }, value: { type: 'string' } } },
    },
    notes: { type: 'string' },
  },
};
