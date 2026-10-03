// Selling platforms and the recommender that ranks them for an item.
// Fee notes are rough guides only — platforms change fees often, so always check.

import { itemTier, itemPrice, CATEGORIES } from './pricing.js';

export const PLATFORMS = {
  facebook: {
    name: 'Facebook Marketplace',
    mode: 'local',
    fees: 'Free for local pickup; fee on shipped sales',
    sellUrl: 'https://www.facebook.com/marketplace/create/item',
    cats: { furniture: 3, appliances: 3, bikes: 2, home: 2, kitchen: 2, baby: 2, tools: 2, sports: 2, toys: 2, gaming: 2, electronics: 1, auto: 2, other: 2 },
    tiers: { 1: 3, 2: 3, 3: 2 },
  },
  offerup: {
    name: 'OfferUp',
    mode: 'local',
    fees: 'Free for local pickup; fee on shipped sales',
    sellUrl: 'https://offerup.com/',
    cats: { furniture: 2, appliances: 2, electronics: 2, tools: 2, sports: 2, bikes: 2, gaming: 2, auto: 2, other: 1 },
    tiers: { 1: 3, 2: 2, 3: 1 },
  },
  craigslist: {
    name: 'Craigslist',
    mode: 'local',
    fees: 'Free in most for-sale categories',
    sellUrl: 'https://post.craigslist.org/',
    titleLimit: 70,
    cats: { furniture: 2, appliances: 3, tools: 2, auto: 2, bikes: 1, instruments: 1, other: 1 },
    tiers: { 1: 1, 2: 2, 3: 2 },
  },
  nextdoor: {
    name: 'Nextdoor',
    mode: 'local',
    fees: 'Free',
    sellUrl: 'https://nextdoor.com/for_sale_and_free/',
    cats: { furniture: 2, baby: 2, home: 2, kitchen: 2, toys: 2, sports: 1, other: 1 },
    tiers: { 1: 2, 2: 1, 3: 0 },
  },
  ebay: {
    name: 'eBay',
    mode: 'ship',
    fees: 'Final value fee, roughly 13% for most categories',
    sellUrl: 'https://www.ebay.com/sl/prelist/suggest',
    titleLimit: 80,
    cats: { electronics: 3, phones: 2, computers: 3, gaming: 3, cameras: 3, collectibles: 3, auto: 3, tools: 2, jewelry: 2, instruments: 2, books: 1, clothing: 1, luxury: 2, sports: 2, toys: 2, other: 2 },
    tiers: { 1: 1, 2: 3, 3: 3 },
  },
  mercari: {
    name: 'Mercari',
    mode: 'ship',
    fees: 'Selling + payment fees; check current rates',
    sellUrl: 'https://www.mercari.com/sell/',
    titleLimit: 80,
    descLimit: 1000,
    cats: { clothing: 2, toys: 3, gaming: 2, electronics: 2, home: 1, kitchen: 1, books: 1, collectibles: 2, baby: 2, other: 1 },
    tiers: { 1: 3, 2: 2, 3: 1 },
  },
  poshmark: {
    name: 'Poshmark',
    mode: 'ship',
    fees: 'Flat fee under $15, ~20% above',
    sellUrl: 'https://poshmark.com/create-listing',
    titleLimit: 80,
    descLimit: 1500,
    cats: { clothing: 3, luxury: 2, jewelry: 1, baby: 1, home: 1 },
    tiers: { 1: 3, 2: 2, 3: 1 },
  },
  depop: {
    name: 'Depop',
    mode: 'ship',
    fees: 'Payment processing fee',
    sellUrl: 'https://www.depop.com/',
    descLimit: 1000,
    cats: { clothing: 3, jewelry: 1 },
    tiers: { 1: 3, 2: 2, 3: 0 },
  },
  grailed: {
    name: 'Grailed',
    mode: 'ship',
    fees: 'Commission + payment fee',
    sellUrl: 'https://www.grailed.com/sell',
    cats: { clothing: 2, luxury: 2 },
    tiers: { 1: 1, 2: 3, 3: 2 },
  },
  swappa: {
    name: 'Swappa',
    mode: 'ship',
    fees: 'Low seller fee; working devices only',
    sellUrl: 'https://swappa.com/sell',
    cats: { phones: 3, computers: 2, gaming: 2, cameras: 1 },
    tiers: { 1: 1, 2: 3, 3: 3 },
  },
  reverb: {
    name: 'Reverb',
    mode: 'ship',
    fees: 'Selling fee + payment processing',
    sellUrl: 'https://reverb.com/sell',
    cats: { instruments: 3 },
    tiers: { 1: 1, 2: 3, 3: 3 },
  },
  chrono24: {
    name: 'Chrono24',
    mode: 'ship',
    fees: 'Commission on sale',
    sellUrl: 'https://www.chrono24.com/info/private-seller.htm',
    cats: { jewelry: 2 },
    tiers: { 1: 0, 2: 1, 3: 3 },
    keywords: ['watch', 'rolex', 'omega', 'seiko', 'tudor', 'cartier', 'breitling', 'tag heuer'],
  },
  therealreal: {
    name: 'The RealReal (consignment)',
    mode: 'consign',
    fees: 'Consignment commission — they authenticate, photograph and sell',
    sellUrl: 'https://www.therealreal.com/consign',
    cats: { luxury: 3, jewelry: 2 },
    tiers: { 1: 0, 2: 1, 3: 3 },
  },
  chairish: {
    name: 'Chairish',
    mode: 'ship',
    fees: 'Commission on sale',
    sellUrl: 'https://www.chairish.com/sell',
    cats: { furniture: 2, home: 2, collectibles: 1 },
    tiers: { 1: 0, 2: 2, 3: 3 },
  },
  kaiyo: {
    name: 'Kaiyo (furniture pickup)',
    mode: 'consign',
    fees: 'They pick up and sell; you get a share',
    sellUrl: 'https://kaiyo.com/sell',
    cats: { furniture: 2 },
    tiers: { 1: 0, 2: 2, 3: 3 },
  },
  pinkbike: {
    name: 'Pinkbike Buy/Sell',
    mode: 'ship',
    fees: 'Free basic listings',
    sellUrl: 'https://www.pinkbike.com/buysell/',
    cats: { bikes: 3 },
    tiers: { 1: 1, 2: 2, 3: 3 },
  },
  decluttr: {
    name: 'Decluttr (instant offer)',
    mode: 'instant',
    fees: 'Instant fixed offer — fast, but lowest payout',
    sellUrl: 'https://www.decluttr.com/',
    cats: { books: 3, gaming: 2, phones: 1 },
    tiers: { 1: 2, 2: 1, 3: 0 },
  },
  fbgroups: {
    name: 'Facebook buy/sell groups',
    mode: 'local',
    fees: 'Free',
    sellUrl: 'https://www.facebook.com/groups/discover/',
    cats: { baby: 2, collectibles: 2, bikes: 1, instruments: 1, toys: 1, sports: 1 },
    tiers: { 1: 2, 2: 2, 3: 1 },
  },
};

const MODE_LABEL = { local: 'Local pickup', ship: 'Ships nationwide', consign: 'Consignment', instant: 'Instant offer' };
export function modeLabel(mode) {
  return MODE_LABEL[mode] || mode;
}

// Rank platforms for an item. Returns [{ key, name, score, reasons[] }] best first.
export function recommendPlatforms(item, limit = 4) {
  const tier = itemTier(item) || 1;
  const price = itemPrice(item);
  const cat = item.category || 'other';
  const shipsWell = !item.bulky && (CATEGORIES[cat] ? CATEGORIES[cat].ships : true);
  const text = [item.title, item.brand, item.model].join(' ').toLowerCase();

  const ranked = Object.entries(PLATFORMS).map(([key, p]) => {
    const catScore = p.cats[cat] || 0;
    const tierScore = p.tiers[tier] || 0;
    let score = catScore * 3 + tierScore * 2;
    const reasons = [];
    if (catScore >= 3) reasons.push(`Top marketplace for ${CATEGORIES[cat]?.label.toLowerCase() || 'this category'}`);
    else if (catScore === 2) reasons.push('Good buyer demand for this category');
    if (tierScore >= 3) reasons.push(tier === 1 ? 'Great for quick, low-price sales' : tier === 2 ? 'Strong for mid-price items' : 'Buyers here pay up for high-value items');

    if (p.keywords && p.keywords.some((k) => text.includes(k))) {
      score += 8;
      reasons.push('Specialist audience for this item');
    }
    if (p.mode === 'local') {
      if (!shipsWell) {
        score += 5;
        reasons.push('No shipping needed for a bulky item');
      }
      if (tier === 3 && catScore < 3) score -= 2;
    } else if (p.mode === 'ship') {
      if (!shipsWell) {
        score -= 6;
      } else if (tier >= 2) {
        score += 1;
        reasons.push('Nationwide reach gets a better price');
      }
    } else if (p.mode === 'consign') {
      if (tier === 3) reasons.push('Hands-off: they handle authentication and sale');
    } else if (p.mode === 'instant') {
      if (price !== null && price < 15) {
        score += 3;
        reasons.push('Low value — speed beats squeezing out a few dollars');
      }
    }
    if (catScore === 0 && tierScore < 3) score -= 4;
    return { key, name: p.name, mode: p.mode, fees: p.fees, sellUrl: p.sellUrl, score, reasons };
  });

  ranked.sort((a, b) => b.score - a.score);
  return ranked.filter((r) => r.score > 0).slice(0, limit);
}

export function platformName(key) {
  return PLATFORMS[key] ? PLATFORMS[key].name : key || 'Other';
}

// Map a free-text platform name (e.g. from Claude) to a known key.
export function matchPlatformKey(name) {
  const n = String(name || '').toLowerCase().trim();
  if (!n) return null;
  for (const [key, p] of Object.entries(PLATFORMS)) {
    const pn = p.name.toLowerCase();
    if (n === key || n.includes(pn.split(' (')[0]) || pn.includes(n)) return key;
  }
  if (n.includes('facebook')) return 'facebook';
  return null;
}
