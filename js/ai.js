// Optional Claude integration. Calls the Anthropic Messages API directly from the
// browser with the user's own API key (stored only on this device).
// Raw fetch is used because the app has no build step to bundle the SDK.

import { CATEGORIES, CONDITIONS } from './pricing.js';
import { PLATFORMS } from './platforms.js';

const API_URL = 'https://api.anthropic.com/v1/messages';

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (best)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (faster, cheaper)' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (fastest, cheapest)' },
];

export class AIError extends Error {}

function buildBody(settings, { system, content, schema, webSearch }) {
  const model = settings.model || MODELS[0].id;
  const body = {
    model,
    max_tokens: 16000,
    system,
    messages: [{ role: 'user', content }],
  };
  const isHaiku = model.startsWith('claude-haiku');
  const outputConfig = {};
  if (!isHaiku) outputConfig.effort = 'medium';
  if (schema && !webSearch) outputConfig.format = { type: 'json_schema', schema };
  if (Object.keys(outputConfig).length) body.output_config = outputConfig;
  if (webSearch) body.tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: 4 }];
  // Retry on a recommended model if a safety classifier declines the request.
  if (!isHaiku) body.fallbacks = 'default';
  return body;
}

async function post(settings, body) {
  const headers = {
    'content-type': 'application/json',
    'x-api-key': settings.apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  if (body.fallbacks) headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
  let res;
  try {
    res = await fetch(API_URL, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch (e) {
    throw new AIError('Could not reach Claude. Check your internet connection.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || res.statusText;
    if (res.status === 401) throw new AIError('Your Claude API key was rejected. Check it in Settings.');
    if (res.status === 429) throw new AIError('Rate limited by the Claude API — wait a minute and try again.');
    if (res.status === 529 || res.status >= 500) throw new AIError('Claude is busy right now — try again shortly.');
    if (/web.?search/i.test(msg)) throw new AIError('Web search isn\'t available for your Claude API account. An admin can turn it on in the Claude Console settings.');
    throw new AIError(`Claude API error (${res.status}): ${msg}`);
  }
  return data;
}

export async function callClaude(settings, opts) {
  const data = await callClaudeRaw(settings, opts);
  const text = responseText(data);
  if (!opts.schema) return text;
  return parseJSON(text);
}

function responseText(data) {
  return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

async function callClaudeRaw(settings, opts) {
  if (!settings.apiKey) throw new AIError('Add your Claude API key in Settings to use AI features.');
  const body = buildBody(settings, opts);
  const content = [];
  let data = await post(settings, body);
  content.push(...(data.content || []));
  // Server-side web search can pause a long turn; continue it a few times.
  for (let i = 0; i < 3 && data.stop_reason === 'pause_turn'; i++) {
    body.messages = [body.messages[0], { role: 'assistant', content: data.content }];
    data = await post(settings, body);
    content.push(...(data.content || []));
  }
  if (data.stop_reason === 'refusal') throw new AIError('Claude declined this request.');
  if (data.stop_reason === 'max_tokens') throw new AIError('The response was cut off — try again.');
  // Keep every block across continuations (search results arrive before the final text).
  return { ...data, allContent: content };
}

export function parseJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.lastIndexOf('```json');
    const chunk = start >= 0 ? text.slice(start + 7, text.indexOf('```', start + 7)) : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    try {
      return JSON.parse(chunk);
    } catch {
      throw new AIError('Claude returned something unexpected — try again.');
    }
  }
}

const str = { type: 'string' };
const num = { type: 'number' };
const strArr = { type: 'array', items: str };

const ANALYZE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'category', 'brand', 'model', 'condition', 'retail_price_new', 'price_low', 'price_target', 'price_high', 'pricing_rationale', 'platforms', 'platform_reasoning', 'features', 'flaws_seen', 'description', 'questions'],
  properties: {
    title: str,
    category: { type: 'string', enum: Object.keys(CATEGORIES) },
    brand: str,
    model: str,
    condition: { type: 'string', enum: Object.keys(CONDITIONS) },
    retail_price_new: num,
    price_low: num,
    price_target: num,
    price_high: num,
    pricing_rationale: str,
    platforms: strArr,
    platform_reasoning: str,
    features: strArr,
    flaws_seen: str,
    description: str,
    questions: strArr,
  },
};

const SELLER_SYSTEM = `You help an individual in the US sell their used belongings on resale marketplaces.
Price for a realistic quick sale on the used market (what similar items actually SELL for, not asking prices or retail).
Be honest about uncertainty and never invent specs you cannot see or were not told. Use empty strings for unknown text fields and 0 for an unknown retail price.
Price tiers the seller uses: under $100, $101-$500, and $501+.
Known platforms: ${Object.values(PLATFORMS).map((p) => p.name).join(', ')}.`;

export async function analyzeItem(settings, item, images) {
  const facts = itemFacts(item);
  const content = [
    ...images.map((data) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } })),
    {
      type: 'text',
      text:
        `Identify this item from the photos and seller notes, estimate a used selling price, and recommend the 2-3 best platforms (best first, using the platform names listed).\n` +
        `Write a clear, honest listing description (plain text, no markdown, under 900 characters).\n` +
        `List up to 4 short questions whose answers would most change the price or the listing.\n\nSeller notes:\n${facts || '(none)'}` +
        (settings.webSearch ? `\n\nSearch the web for recent sold prices of comparable items before pricing. End your reply with a single JSON object (in a \`\`\`json block) with these keys: ${ANALYZE_SCHEMA.required.join(', ')}.` : ''),
    },
  ];
  return callClaude(settings, { system: SELLER_SYSTEM, content, schema: ANALYZE_SCHEMA, webSearch: !!settings.webSearch });
}

const IMPROVE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'description', 'changes'],
  properties: { title: str, description: str, changes: strArr },
};

export async function improveListing(settings, item, { title, description, platform, instruction }) {
  const p = PLATFORMS[platform];
  const limits = [p?.titleLimit && `title max ${p.titleLimit} characters`, p?.descLimit && `description max ${p.descLimit} characters`].filter(Boolean).join(', ');
  const content = [
    {
      type: 'text',
      text:
        `Edit this ${p ? p.name : 'marketplace'} listing so it sells faster. ${p?.mode === 'local' ? 'Local pickup buyers skim on phones: keep it short and friendly.' : 'Shipped buyers search by keywords: front-load brand, model, size and key specs in the title.'}\n` +
        (limits ? `Limits: ${limits}.\n` : '') +
        `Keep every fact accurate — do not add features, specs or claims that are not in the item facts or current text. Plain text, no markdown.\n` +
        (instruction ? `Seller's request: ${instruction}\n` : '') +
        `\nItem facts:\n${itemFacts(item)}\n\nCurrent title:\n${title}\n\nCurrent description:\n${description}\n\n` +
        `Return the improved title, description, and a short list of what you changed.`,
    },
  ];
  return callClaude(settings, { system: SELLER_SYSTEM, content, schema: IMPROVE_SCHEMA });
}

export function itemFacts(item) {
  const f = [
    ['Title', item.title],
    ['Brand', item.brand],
    ['Model', item.model],
    ['Category', CATEGORIES[item.category]?.label],
    ['Condition', CONDITIONS[item.condition]?.label],
    ['Size', item.size],
    ['Color', item.color],
    ['Age (years)', item.ageYears],
    ['Original retail price', item.originalPrice && `$${item.originalPrice}`],
    ['Recent sold comps', item.comps],
    ['Dimensions', item.dimensions],
    ['Included', item.included],
    ['Features', item.features],
    ['Flaws', item.flaws],
    ['Bulky / local pickup only', item.bulky ? 'yes' : ''],
    ['Asking price', item.askingPrice && `$${item.askingPrice}`],
  ];
  return f.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n');
}

// ---------- Market check (web search for comparable listings) ----------


export async function marketCheck(settings, item, images = []) {
  const content = [
    ...images.map((data) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } })),
    {
      type: 'text',
      text:
        `Research the current US resale market for this item. Search the web for SOLD listings (eBay sold/completed listings, marketplace sold prices) and current FOR-SALE listings of the same or closely comparable items (same brand/model, similar condition).\n` +
        `Sold prices matter most; asking prices only show the ceiling. Note condition, completeness and any differences from the seller's item.\n` +
        `Only list comparables you actually found in your search results, with their real URLs. Never invent listings, prices or URLs; leave url empty if you have none.\n\n` +
        `Item facts:\n${itemFacts(item) || '(see photos)'}\n\n` +
        `Finish with a single JSON object in a \`\`\`json block with these keys:\n` +
        `comparables: array of up to 8 {title, price (number), status ("sold" | "for sale" | "retail new"), condition, source (site name), url, date (if shown, else "")};\n` +
        `sold_low, sold_high, typical_sold, asking_low, asking_high, suggested_list_price, suggested_floor (numbers in USD; 0 if unknown);\n` +
        `confidence ("low" | "medium" | "high"); summary (2-3 plain sentences for the seller); caveats (array of short strings).`,
    },
  ];
  const data = await callClaudeRaw(settings, { system: SELLER_SYSTEM, content, webSearch: true });
  const parsed = parseJSON(responseText(data));
  return normalizeMarket(parsed, searchResultUrls(data.allContent));
}

// Every URL the web search tool actually returned.
export function searchResultUrls(blocks = []) {
  const urls = new Set();
  for (const b of blocks) {
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
      for (const r of b.content) if (r.url) urls.add(normalizeUrl(r.url));
    }
    if (b.type === 'text' && Array.isArray(b.citations)) {
      for (const c of b.citations) if (c.url) urls.add(normalizeUrl(c.url));
    }
  }
  return urls;
}

function normalizeUrl(u) {
  try {
    const x = new URL(u);
    return (x.host.replace(/^www\./, '') + x.pathname.replace(/\/$/, '')).toLowerCase();
  } catch {
    return String(u).toLowerCase();
  }
}

const n = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v) * 100) / 100 : 0);

// Clean up Claude's JSON and drop links that didn't come from the search results.
export function normalizeMarket(raw, foundUrls = new Set()) {
  let dropped = 0;
  const comps = (Array.isArray(raw?.comparables) ? raw.comparables : [])
    .map((c) => {
      const url = String(c.url || '').trim();
      const verified = !!url && /^https?:\/\//.test(url) && foundUrls.has(normalizeUrl(url));
      // A link that never appeared in the search results is likely made up — drop the whole listing.
      if (url && !verified) {
        dropped++;
        return null;
      }
      return {
        title: String(c.title || '').slice(0, 160),
        price: n(c.price),
        status: ['sold', 'for sale', 'retail new'].includes(c.status) ? c.status : 'for sale',
        condition: String(c.condition || '').slice(0, 60),
        source: String(c.source || '').slice(0, 40),
        url: verified ? url : '',
        date: String(c.date || '').slice(0, 20),
      };
    })
    .filter((c) => c && c.title && c.price);
  return {
    at: new Date().toISOString(),
    comparables: comps.slice(0, 8),
    dropped,
    soldLow: n(raw?.sold_low),
    soldHigh: n(raw?.sold_high),
    typicalSold: n(raw?.typical_sold),
    askingLow: n(raw?.asking_low),
    askingHigh: n(raw?.asking_high),
    listPrice: n(raw?.suggested_list_price),
    floor: n(raw?.suggested_floor),
    confidence: ['low', 'medium', 'high'].includes(raw?.confidence) ? raw.confidence : 'low',
    summary: String(raw?.summary || ''),
    caveats: (Array.isArray(raw?.caveats) ? raw.caveats : []).map(String).slice(0, 5),
  };
}
