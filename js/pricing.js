// Price tiers, categories, conditions and the rule-based price estimator.
// Pure functions only (no DOM) so they can be unit tested in Node.

export const TIERS = [
  { id: 1, label: 'Under $100', short: '≤ $100' },
  { id: 2, label: '$101 – $500', short: '$101–500' },
  { id: 3, label: '$501 and above', short: '$501+' },
];

export function tierFor(price) {
  const p = Number(price);
  if (price === null || price === undefined || price === '' || Number.isNaN(p)) return null;
  if (p <= 100) return 1;
  if (p <= 500) return 2;
  return 3;
}

// The price that decides an item's tier: what you're asking, else the suggestion.
export function itemPrice(item) {
  if (item.askingPrice) return Number(item.askingPrice);
  if (item.suggested && item.suggested.target) return Number(item.suggested.target);
  return null;
}

export function itemTier(item) {
  return tierFor(itemPrice(item));
}

// retention: typical used value (like-new, under a year old) as a fraction of new retail.
// depr: additional value lost per year of age.
export const CATEGORIES = {
  electronics: { label: 'Electronics', retention: 0.55, depr: 0.2, ships: true },
  phones: { label: 'Phones & Tablets', retention: 0.6, depr: 0.25, ships: true },
  computers: { label: 'Computers & Laptops', retention: 0.55, depr: 0.22, ships: true },
  gaming: { label: 'Video Games & Consoles', retention: 0.6, depr: 0.12, ships: true },
  cameras: { label: 'Cameras & Lenses', retention: 0.65, depr: 0.1, ships: true },
  furniture: { label: 'Furniture', retention: 0.35, depr: 0.08, ships: false },
  appliances: { label: 'Appliances', retention: 0.4, depr: 0.12, ships: false },
  clothing: { label: 'Clothing & Shoes', retention: 0.3, depr: 0.05, ships: true },
  luxury: { label: 'Designer & Luxury Goods', retention: 0.6, depr: 0.03, ships: true },
  jewelry: { label: 'Jewelry & Watches', retention: 0.55, depr: 0.02, ships: true },
  tools: { label: 'Tools', retention: 0.55, depr: 0.06, ships: true },
  sports: { label: 'Sports & Outdoors', retention: 0.45, depr: 0.08, ships: true },
  bikes: { label: 'Bikes', retention: 0.5, depr: 0.1, ships: false },
  instruments: { label: 'Musical Instruments & Gear', retention: 0.65, depr: 0.03, ships: true },
  collectibles: { label: 'Collectibles & Antiques', retention: 0.8, depr: 0, ships: true },
  books: { label: 'Books, Movies & Music', retention: 0.25, depr: 0.05, ships: true },
  toys: { label: 'Toys & Games', retention: 0.4, depr: 0.08, ships: true },
  baby: { label: 'Baby & Kids', retention: 0.4, depr: 0.1, ships: true },
  home: { label: 'Home Decor', retention: 0.35, depr: 0.05, ships: true },
  kitchen: { label: 'Kitchen & Small Appliances', retention: 0.4, depr: 0.08, ships: true },
  auto: { label: 'Auto Parts & Accessories', retention: 0.45, depr: 0.08, ships: true },
  other: { label: 'Other', retention: 0.4, depr: 0.1, ships: true },
};

export const CONDITIONS = {
  new: { label: 'New (unopened / with tags)', mult: 1.15 },
  like_new: { label: 'Like new', mult: 1.0 },
  good: { label: 'Good (normal wear)', mult: 0.82 },
  fair: { label: 'Fair (visible wear / minor issues)', mult: 0.6 },
  parts: { label: 'For parts / not working', mult: 0.3 },
};

export function parseComps(text) {
  if (!text) return [];
  return String(text)
    .split(/[\s,;/]+/)
    .map((s) => Number(s.replace(/[$]/g, '')))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Round to a price that looks natural on a listing.
export function nicePrice(n) {
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n < 20) return Math.max(1, Math.round(n));
  if (n < 100) return Math.round(n / 5) * 5;
  if (n < 1000) return Math.round(n / 10) * 10;
  if (n < 5000) return Math.round(n / 25) * 25;
  return Math.round(n / 100) * 100;
}

// Rule-based estimate. Uses comparable sold prices when you have them,
// otherwise depreciates the original retail price by category, condition and age.
export function suggestPrice(item) {
  const cat = CATEGORIES[item.category] || CATEGORIES.other;
  const cond = CONDITIONS[item.condition] || CONDITIONS.good;
  const comps = parseComps(item.comps);
  const original = Number(item.originalPrice) || 0;
  const age = Math.max(0, Number(item.ageYears) || 0);
  const notes = [];

  let formula = null;
  if (original > 0) {
    formula = original * cat.retention * cond.mult * Math.pow(1 - cat.depr, age);
    if (item.category !== 'collectibles') formula = Math.min(formula, original * 0.9);
    notes.push(
      `${cat.label} typically resell around ${Math.round(cat.retention * 100)}% of retail when like new` +
        (cat.depr ? `, losing ~${Math.round(cat.depr * 100)}%/yr` : '') +
        `; condition "${cond.label}" adjusts ×${cond.mult}.`
    );
  }

  const compMedian = median(comps);
  let target;
  if (compMedian && formula) {
    target = compMedian * 0.7 + formula * 0.3;
    notes.push(`Weighted 70% toward the median of ${comps.length} sold comp(s) ($${compMedian.toFixed(0)}).`);
  } else if (compMedian) {
    target = compMedian;
    notes.push(`Based on the median of ${comps.length} sold comp(s).`);
  } else if (formula) {
    target = formula;
    notes.push('Add a few recent SOLD prices for similar items to sharpen this estimate.');
  } else {
    return null;
  }

  if (item.category === 'collectibles' && !compMedian) {
    notes.push('Collectibles vary wildly — check sold comps before trusting this number.');
  }

  target = nicePrice(target);
  const low = nicePrice(target * 0.85);
  const high = nicePrice(target * 1.15);
  // List a little high to leave room to negotiate; floor is the lowest you should accept.
  const listPrice = nicePrice(target * 1.1);
  return {
    source: 'rules',
    low,
    high,
    target,
    listPrice,
    floor: low,
    rationale: notes.join(' '),
    at: new Date().toISOString(),
  };
}

export function money(n) {
  if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  return '$' + v.toLocaleString('en-US', { maximumFractionDigits: v % 1 ? 2 : 0, minimumFractionDigits: v % 1 ? 2 : 0 });
}

export function searchQuery(item) {
  return [item.brand, item.model, item.title].filter(Boolean).join(' ').trim();
}

export function compLinks(item) {
  const q = encodeURIComponent(searchQuery(item));
  if (!q) return [];
  return [
    { label: 'eBay sold prices', url: `https://www.ebay.com/sch/i.html?_nkw=${q}&LH_Sold=1&LH_Complete=1` },
    { label: 'Facebook Marketplace', url: `https://www.facebook.com/marketplace/search?query=${q}` },
    { label: 'Google Shopping (retail)', url: `https://www.google.com/search?tbm=shop&q=${q}` },
  ];
}

// Items over $100 (or that cost over $100 new, before they have a price) deserve a
// web check of comparable listings; a check older than 30 days counts as stale.
export function needsMarketCheck(item, now = new Date()) {
  if (item.status === 'sold' || item.status === 'archived') return false;
  const tier = itemTier(item);
  const valuable = tier ? tier >= 2 : Number(item.originalPrice) > 100;
  if (!valuable) return false;
  if (!item.marketCheck || !item.marketCheck.at) return true;
  return now - new Date(item.marketCheck.at) > 30 * 86400000;
}
