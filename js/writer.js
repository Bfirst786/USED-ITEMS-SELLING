// Listing writing helpers: draft generator, quick edits and a checklist ("lint").
// Pure functions (no DOM).

import { CONDITIONS, CATEGORIES } from './pricing.js';
import { PLATFORMS } from './platforms.js';

export function limitsFor(platform) {
  const p = PLATFORMS[platform] || {};
  return { title: p.titleLimit || 80, desc: p.descLimit || null, hardTitle: !!p.titleLimit };
}

function uniqueWords(parts) {
  const seen = new Set();
  const out = [];
  for (const part of parts) {
    for (const w of String(part || '').split(/\s+/)) {
      const k = w.toLowerCase().replace(/[^\w]/g, '');
      if (!w || (k && seen.has(k))) continue;
      if (k) seen.add(k);
      out.push(w);
    }
  }
  return out;
}

export function generateTitle(item, platform) {
  const { title: limit } = limitsFor(platform);
  const cond = item.condition === 'new' ? (item.category === 'clothing' ? 'NWT' : 'New') : '';
  const words = uniqueWords([item.brand, item.model, item.title, item.size, item.color, cond]);
  let out = '';
  for (const w of words) {
    const next = out ? out + ' ' + w : w;
    if (next.length > limit) break;
    out = next;
  }
  return out;
}

function bullets(text) {
  return String(text || '')
    .split(/\n|;/)
    .map((s) => s.replace(/^[-•*\s]+/, '').trim())
    .filter(Boolean);
}

export function generateDescription(item, platform, settings = {}) {
  const p = PLATFORMS[platform] || { mode: 'local' };
  const local = p.mode === 'local';
  const cond = CONDITIONS[item.condition];
  const lines = [];
  const name = [item.brand, item.model, item.title].filter(Boolean).join(' ');

  if (local) {
    lines.push(`${name || 'Item'} for sale.`);
  } else {
    lines.push(name || 'Item');
  }
  lines.push('');

  const condLine = cond ? `Condition: ${cond.label}.` : '';
  const flaws = String(item.flaws || '').trim();
  if (condLine || flaws) {
    lines.push([condLine, flaws ? `Notes: ${flaws}` : item.condition && item.condition !== 'new' ? 'Normal signs of use — see photos.' : '']
      .filter(Boolean)
      .join(' '));
  }
  if (['electronics', 'phones', 'computers', 'gaming', 'cameras', 'appliances', 'kitchen', 'tools'].includes(item.category) && item.condition !== 'parts') {
    if (!/test|work/i.test(flaws + item.features)) lines.push('Tested and working.');
  }

  const feats = bullets(item.features);
  if (feats.length) {
    lines.push('');
    if (!local) lines.push('Details:');
    for (const f of feats) lines.push(`• ${f}`);
  }
  if (item.dimensions) lines.push(`• Dimensions: ${item.dimensions}`);
  if (item.included) lines.push(`• Included: ${item.included}`);
  if (item.ageYears) lines.push(`• Age: about ${item.ageYears} year${Number(item.ageYears) === 1 ? '' : 's'}`);

  lines.push('');
  if (local) {
    const where = settings.location ? `Pickup in ${settings.location}.` : 'Local pickup.';
    lines.push([where, settings.pickupNote].filter(Boolean).join(' '));
    lines.push(settings.priceNote || 'Price is firm unless noted. If the listing is up, it is available.');
  } else {
    lines.push(settings.shippingNote || 'Ships quickly and carefully packed.');
    if (settings.smokeFree) lines.push('From a smoke-free home.');
  }

  if (platform === 'depop') {
    const tags = hashtags(item).slice(0, 5);
    if (tags.length) lines.push('', tags.join(' '));
  }

  let text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const { desc } = limitsFor(platform);
  if (desc && text.length > desc) text = text.slice(0, desc - 1).trimEnd() + '…';
  return text;
}

export function hashtags(item) {
  return uniqueWords([item.brand, item.category && CATEGORIES[item.category]?.label.split(' ')[0], item.title])
    .map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter((w) => w.length > 2)
    .map((w) => '#' + w);
}

// ---- Quick edits ----
const SMALL = new Set(['a', 'an', 'and', 'or', 'the', 'of', 'for', 'in', 'on', 'with', 'to', 'at', 'by']);
export function titleCase(s) {
  return String(s)
    .split(' ')
    .map((w, i) => {
      if (/\d/.test(w) || /[A-Z]/.test(w.slice(1))) return w; // keep model numbers / acronyms (e.g. iPhone, XL, 4K)
      const lw = w.toLowerCase();
      if (i > 0 && SMALL.has(lw)) return lw;
      return lw.charAt(0).toUpperCase() + lw.slice(1);
    })
    .join(' ');
}

const FILLER = /\b(very|really|super|great|nice|amazing|awesome|beautiful|must see|for sale|l@@k|wow)\b\s*/gi;
export function shorten(s, limit) {
  let out = String(s).replace(FILLER, '').replace(/\s{2,}/g, ' ').replace(/[!]{2,}/g, '!').trim();
  if (limit && out.length > limit) {
    const cut = out.slice(0, limit + 1);
    out = cut.slice(0, Math.max(cut.lastIndexOf(' '), 0) || limit).trim();
  }
  return out;
}

export function fixShouting(s) {
  return String(s).replace(/\b[A-Z]{4,}\b/g, (w) => w.charAt(0) + w.slice(1).toLowerCase()).replace(/!{2,}/g, '!');
}

export function tidy(s) {
  return String(s)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---- Checklist ----
export function lint(title, desc, item, platform) {
  const out = [];
  const t = String(title || '');
  const d = String(desc || '');
  const all = (t + ' ' + d).toLowerCase();
  const lim = limitsFor(platform);
  const add = (level, msg) => out.push({ level, msg });

  if (!t.trim()) add('error', 'Add a title.');
  if (t.length > lim.title) add(lim.hardTitle ? 'error' : 'warn', `Title is ${t.length} characters; keep it under ${lim.title}.`);
  if (lim.desc && d.length > lim.desc) add('error', `Description is ${d.length} characters; the limit here is ${lim.desc}.`);
  if (t && t === t.toUpperCase() && /[A-Z]{4}/.test(t)) add('warn', 'All-caps titles look spammy — use "Fix shouting".');
  if (/!{2,}/.test(t + d)) add('warn', 'Multiple exclamation marks read as pushy.');
  if (d.trim().length < 80) add('warn', 'Description is very short — buyers skip listings with little info.');
  if (!item.brand && !/\b(unbranded|no brand|handmade)\b/i.test(all)) add('tip', 'Include the brand (or say "unbranded") — it is the #1 search term.');
  if (!/condition|new|used|wear|scratch|mint|excellent|good|fair/i.test(d)) add('warn', 'Say what condition it is in.');
  if (['good', 'fair', 'parts'].includes(item.condition) && !String(item.flaws || '').trim() && !/scratch|scuff|stain|dent|chip|wear|flaw|crack|missing/i.test(d))
    add('tip', 'Mention specific flaws — honest listings get fewer returns and lowball arguments.');
  if (['furniture', 'appliances', 'home'].includes(item.category) && !/\d+\s*(\"|in|inch|cm|ft|x)/i.test(d))
    add('warn', 'Add dimensions (W × D × H) — one of the most-asked buyer questions.');
  if (['electronics', 'phones', 'computers', 'gaming', 'cameras', 'appliances', 'tools'].includes(item.category) && !/test|work|function|power/i.test(d))
    add('warn', 'Say whether it is tested and working.');
  if (['phones', 'computers'].includes(item.category) && !/\b\d+\s?(gb|tb)\b/i.test(all)) add('tip', 'Include storage size (GB/TB).');
  if (item.category === 'clothing' && !/\bsize\b|\b(xs|s|m|l|xl|xxl)\b/i.test(all)) add('warn', 'Include the size.');
  if (/\b\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/.test(d) || /\S+@\S+\.\w+/.test(d))
    add('warn', 'Phone numbers/emails in listings can get them hidden or flagged — use in-app messages.');
  if (/\b(zelle|venmo|cash ?app|wire transfer|western union)\b/i.test(d))
    add(PLATFORMS[platform]?.mode === 'ship' ? 'error' : 'tip', 'Off-platform payment mentions can get shipped listings removed and attract scammers.');
  if (!(item.photos || []).length) add('warn', 'No photos yet — listings with 5+ clear photos sell much faster.');
  else if ((item.photos || []).length < 4) add('tip', 'Add more photos: front, back, label/model tag, and any flaws.');
  return out;
}
