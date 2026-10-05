import * as db from './db.js';
import { TIERS, CATEGORIES, CONDITIONS, tierFor, itemTier, itemPrice, suggestPrice, money, nicePrice, compLinks, needsMarketCheck, parseComps } from './pricing.js';
import { PLATFORMS, recommendPlatforms, platformName, matchPlatformKey, modeLabel } from './platforms.js';
import { DEFAULT_RULES, ACTIONS, TRIGGERS, computeReminders, isDue, toICS, isoDay, daysBetween, toDate } from './reminders.js';
import { generateTitle, generateDescription, titleCase, shorten, fixShouting, tidy, lint, limitsFor } from './writer.js';
import { MODELS, analyzeItem, improveListing, callClaude, marketCheck } from './ai.js';
import { BOXES, CALCULATORS, estimateShipping, shippingAdvice } from './shipping.js';
import { pushToSheet, scriptSource, newSecret, testSheet, urlProblem } from './sheets.js';

// ---------- State ----------
const DEFAULT_SETTINGS = {
  apiKey: '',
  model: MODELS[0].id,
  webSearch: false,
  location: '',
  pickupNote: 'Cash or app payment at pickup.',
  priceNote: '',
  shippingNote: 'Ships within 1–2 business days, carefully packed.',
  smokeFree: false,
  notify: false,
  sheetUrl: '',
  sheetSecret: '',
};

const S = {
  items: [],
  settings: { ...DEFAULT_SETTINGS },
  rules: DEFAULT_RULES,
  rem: { done: {}, snoozed: {}, notified: {} },
  sync: { dirty: false, lastOk: '', lastError: '', running: false },
  filter: { tier: 'all', status: 'active', q: '' },
};

const photoURLs = new Map();
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const today = () => isoDay(new Date());

function h(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), ms);
}

async function busy(label, fn) {
  const el = $('#busy');
  $('#busy-label').textContent = label;
  el.hidden = false;
  try {
    return await fn();
  } catch (e) {
    console.error(e);
    toast(e.message || String(e), 5000);
    return undefined;
  } finally {
    el.hidden = true;
  }
}

// ---------- Data ----------
async function load() {
  S.items = await db.getAll('items');
  S.settings = { ...DEFAULT_SETTINGS, ...(await db.getMeta('settings', {})) };
  S.rules = await db.getMeta('rules', DEFAULT_RULES);
  S.rem = { done: {}, snoozed: {}, notified: {}, ...(await db.getMeta('reminderState', {})) };
  S.sync = { ...S.sync, ...(await db.getMeta('syncState', {})), running: false };
  if (!S.settings.sheetSecret) {
    S.settings.sheetSecret = newSecret();
    await db.setMeta('settings', S.settings);
  }
}

const findItem = (id) => S.items.find((i) => i.id === id);

async function saveItem(item) {
  item.updatedAt = new Date().toISOString();
  if (!S.items.includes(item)) S.items.push(item);
  await db.put('items', item);
  scheduleSync();
}

// ---------- Google Sheets sync ----------
// Every change marks the data dirty; a debounced push sends a full snapshot.
let syncTimer;
function scheduleSync(delay = 2500) {
  if (!S.settings.sheetUrl) return;
  if (!S.sync.dirty) {
    S.sync.dirty = true;
    db.setMeta('syncState', { ...S.sync, running: false });
  }
  clearTimeout(syncTimer);
  syncTimer = setTimeout(runSync, delay);
}

async function runSync({ manual = false } = {}) {
  if (!S.settings.sheetUrl || S.sync.running) return;
  if (!navigator.onLine) {
    S.sync.lastError = 'Offline — will sync when you are back online.';
    updateSyncStatus();
    return;
  }
  S.sync.running = true;
  updateSyncStatus();
  try {
    const r = await pushToSheet(S.settings.sheetUrl, S.settings.sheetSecret, S.items);
    if (r.sheet) S.sync.sheet = { name: r.sheet, url: r.sheetUrl };
    S.sync.dirty = false;
    S.sync.lastOk = new Date().toISOString();
    S.sync.lastError = '';
    if (manual) toast(`Spreadsheet updated ✅${r.sheet ? ` (${r.sheet})` : ''}`);
  } catch (e) {
    S.sync.lastError = e.message;
    if (manual) toast(e.message, 6000);
  } finally {
    S.sync.running = false;
    await db.setMeta('syncState', { ...S.sync, running: false });
    updateSyncStatus();
  }
}

function syncStatusText() {
  if (!S.settings.sheetUrl) return '';
  if (S.sync.running) return '☁️ Updating spreadsheet…';
  if (S.sync.lastError) return `⚠️ Spreadsheet not updated: ${S.sync.lastError}`;
  if (S.sync.dirty) return '☁️ Spreadsheet update pending…';
  if (S.sync.lastOk) {
    const mins = Math.round((Date.now() - new Date(S.sync.lastOk)) / 60000);
    return `☁️ ${S.sync.sheet ? `"${S.sync.sheet.name}"` : 'Spreadsheet'} up to date (${mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : new Date(S.sync.lastOk).toLocaleString()})`;
  }
  return '☁️ Spreadsheet connected — not synced yet';
}

function updateSyncStatus() {
  for (const el of $$('[data-sync-status]')) {
    el.textContent = syncStatusText();
    el.classList.toggle('sync-error', !!S.sync.lastError && !S.sync.running);
    el.hidden = !S.settings.sheetUrl;
  }
}

// Ask the script which spreadsheet it's attached to, without writing anything.
async function runSheetTest() {
  let error = '';
  const r = await busy('Checking the Google connection…', async () => {
    try {
      const data = await testSheet(S.settings.sheetUrl);
      if (data.sheet) S.sync.sheet = { name: data.sheet, url: data.sheetUrl };
      S.sync.lastError = '';
      return data;
    } catch (e) {
      error = e.message;
      return null;
    }
  });
  if (!r) {
    S.sync.lastError = error;
    toast('Connection test failed — details are under the buttons.', 5000);
  } else if (!r.sheet) {
    toast('Connected ✅ — but this is the older script. Copy the script again and redeploy to see which sheet it uses.', 7000);
  } else {
    toast(`Connected ✅ to "${r.sheet}"`, 5000);
  }
  await db.setMeta('syncState', { ...S.sync, running: false });
  if (location.hash === '#/settings') viewSettings();
  return !!r;
}

const saveTimers = new Map();
function saveItemSoon(item) {
  clearTimeout(saveTimers.get(item.id));
  saveTimers.set(item.id, setTimeout(() => saveItem(item), 400));
}

const saveSettings = () => db.setMeta('settings', S.settings);
const saveRules = () => db.setMeta('rules', S.rules);
const saveRem = () => db.setMeta('reminderState', S.rem);

function newItem() {
  return {
    id: db.uid(),
    createdAt: new Date().toISOString(),
    status: 'draft',
    title: '',
    category: 'other',
    condition: 'good',
    photos: [],
    listings: [],
    priceHistory: [],
  };
}

async function photoURL(id) {
  if (photoURLs.has(id)) return photoURLs.get(id);
  const row = await db.get('photos', id);
  if (!row) return '';
  const url = URL.createObjectURL(row.blob);
  photoURLs.set(id, url);
  return url;
}

async function hydratePhotos(root = document) {
  for (const img of $$('img[data-photo]', root)) {
    img.src = await photoURL(img.dataset.photo);
  }
}

// Resize a camera photo so storage stays small (phones shoot 12MP+).
function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image.'));
    };
    img.src = url;
  });
}

async function resize(blob, max, quality = 0.85) {
  const img = await loadImage(blob);
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob(r, 'image/jpeg', quality));
}

async function addPhotos(item, files) {
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    const blob = await resize(f, 1600);
    const id = db.uid();
    await db.put('photos', { id, blob });
    item.photos.push(id);
  }
  await saveItem(item);
}

async function photosForAI(item, max = 4) {
  const out = [];
  for (const id of item.photos.slice(0, max)) {
    const row = await db.get('photos', id);
    if (!row) continue;
    const small = await resize(row.blob, 1024, 0.8);
    out.push(await blobToDataURL(small).then((d) => d.split(',')[1]));
  }
  return out;
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function reminders() {
  return computeReminders(S.items, S.rules, S.rem);
}

// ---------- Router ----------
const routes = [
  [/^#?\/?$/, () => viewList()],
  [/^#\/new$/, () => viewNew()],
  [/^#\/item\/([\w-]+)$/, (m) => viewItem(m[1])],
  [/^#\/reminders$/, () => viewReminders()],
  [/^#\/settings$/, () => viewSettings()],
];

async function render() {
  const hash = location.hash || '#/';
  for (const [re, fn] of routes) {
    const m = hash.match(re);
    if (m) {
      await fn(m);
      break;
    }
  }
  const base = hash.split('/')[1] || '';
  for (const a of $$('#nav a')) a.classList.toggle('active', a.dataset.route === base);
  updateNav();
}

function updateNav() {
  const due = reminders().filter((r) => isDue(r)).length;
  const badge = $('#nav-badge');
  badge.textContent = due;
  badge.hidden = !due;
}

function setView(title, html, { back } = {}) {
  $('#title').textContent = title;
  $('#back').hidden = !back;
  $('#back').onclick = () => (history.length > 1 ? history.back() : (location.hash = back));
  // Swap in a fresh element so listeners from the previous view are dropped.
  const old = $('#view');
  const v = old.cloneNode(false);
  old.replaceWith(v);
  v.innerHTML = html;
  window.scrollTo(0, 0);
  updateSyncStatus();
  hydratePhotos(v);
  return v;
}

// ---------- List ----------
const STATUS_FILTERS = {
  active: { label: 'Active', test: (i) => i.status === 'draft' || i.status === 'listed' },
  listed: { label: 'Listed', test: (i) => i.status === 'listed' },
  draft: { label: 'Drafts', test: (i) => i.status === 'draft' },
  sold: { label: 'Sold', test: (i) => i.status === 'sold' },
  archived: { label: 'Archived', test: (i) => i.status === 'archived' },
};

function viewList() {
  const f = S.filter;
  const rems = reminders();
  const dueByItem = new Set(rems.filter((r) => isDue(r)).map((r) => r.itemId));
  const sold = S.items.filter((i) => i.status === 'sold');
  const soldTotal = sold.reduce((s, i) => s + (Number(i.soldPrice) || 0), 0);
  const activeValue = S.items.filter(STATUS_FILTERS.active.test).reduce((s, i) => s + (itemPrice(i) || 0), 0);

  const byStatus = S.items.filter(STATUS_FILTERS[f.status].test);
  const listHTML = () => {
    const q = f.q.trim().toLowerCase();
    const list = byStatus
      .filter((i) => f.tier === 'all' || itemTier(i) === Number(f.tier))
      .filter((i) => !q || [i.title, i.brand, i.model].join(' ').toLowerCase().includes(q))
      .sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt));
    return list.map((i) => itemCard(i, dueByItem.has(i.id))).join('') || `<li class="empty">${S.items.length ? 'Nothing matches these filters.' : `No items yet.<br><a class="btn primary" href="#/new">📷 Add your first item</a>`}</li>`;
  };

  const tierCount = (t) => byStatus.filter((i) => itemTier(i) === t).length;

  const html = `
    <section class="stats">
      <div><b>${S.items.filter((i) => i.status === 'listed').length}</b><span>Listed</span></div>
      <div><b>${S.items.filter((i) => i.status === 'draft').length}</b><span>Drafts</span></div>
      <div><b>${money(activeValue)}</b><span>For sale</span></div>
      <div><b>${money(soldTotal)}</b><span>Sold (${sold.length})</span></div>
    </section>
    <div class="chips" role="tablist">
      ${Object.entries(STATUS_FILTERS).map(([k, v]) => `<button class="chip ${f.status === k ? 'on' : ''}" data-status="${k}">${v.label}</button>`).join('')}
    </div>
    <div class="chips">
      <button class="chip ${f.tier === 'all' ? 'on' : ''}" data-tier="all">All prices</button>
      ${TIERS.map((t) => `<button class="chip tier-${t.id} ${String(f.tier) === String(t.id) ? 'on' : ''}" data-tier="${t.id}">${t.short} <small>${tierCount(t.id)}</small></button>`).join('')}
    </div>
    <input class="search" type="search" placeholder="Search items" value="${h(f.q)}" id="q">
    <ul class="items" id="item-list">${listHTML()}</ul>
    <p class="small muted sync-line" data-sync-status></p>`;
  const v = setView('My Items', html);
  v.onclick = (e) => {
    const s = e.target.closest('[data-status]');
    const t = e.target.closest('[data-tier]');
    if (s) S.filter.status = s.dataset.status;
    else if (t) S.filter.tier = t.dataset.tier;
    else return;
    viewList();
  };
  $('#q').oninput = (e) => {
    S.filter.q = e.target.value;
    $('#item-list').innerHTML = listHTML();
    hydratePhotos($('#item-list'));
  };
}

function tierBadge(item) {
  const t = itemTier(item);
  if (!t) return `<span class="badge">No price</span>`;
  return `<span class="badge tier-${t}">${TIERS[t - 1].short}</span>`;
}

function statusBadge(item) {
  return `<span class="badge status-${item.status}">${{ draft: 'Draft', listed: 'Listed', sold: 'Sold', archived: 'Archived' }[item.status]}</span>`;
}

function itemCard(i, due) {
  const active = (i.listings || []).filter((l) => l.status === 'active');
  const first = active.map((l) => l.postedDate).filter(Boolean).sort()[0];
  const meta = [
    active.length ? `${active.length} listing${active.length > 1 ? 's' : ''}` : '',
    first && i.status === 'listed' ? `${daysBetween(toDate(first), new Date())}d up` : '',
    i.status === 'sold' && i.soldPrice ? `sold ${money(i.soldPrice)}` : '',
  ].filter(Boolean);
  return `<li><a href="#/item/${i.id}" class="card item-card">
    <div class="thumb">${i.photos[0] ? `<img data-photo="${i.photos[0]}" alt="">` : '📦'}</div>
    <div class="info">
      <div class="t">${h(i.title || 'Untitled item')}</div>
      <div class="row">${tierBadge(i)} ${statusBadge(i)} ${due ? '<span class="badge due">⏰ Due</span>' : ''} ${needsMarketCheck(i) ? '<span class="badge check">🔎 Check price</span>' : ''}</div>
      <div class="meta">${meta.join(' · ')}</div>
    </div>
    <div class="price">${money(i.askingPrice || i.suggested?.target)}</div>
  </a></li>`;
}

// ---------- New item ----------
function viewNew() {
  const draft = { files: [] };
  const html = `
    <div class="card">
      <h2>1. Photograph it</h2>
      <p class="muted">Shoot the front, back, labels/model tag and any flaws in good light.</p>
      <div class="btn-row">
        <label class="btn primary big">📷 Take photo<input type="file" accept="image/*" capture="environment" id="cam" hidden></label>
        <label class="btn big">🖼️ From library<input type="file" accept="image/*" multiple id="lib" hidden></label>
      </div>
      <div class="photo-strip" id="preview"></div>
    </div>
    <div class="card">
      <h2>2. Basics <small class="muted">(optional — Claude can fill these in)</small></h2>
      <label>What is it?<input id="n-title" placeholder="e.g. KitchenAid stand mixer"></label>
      <label>Category<select id="n-cat">${options(CATEGORIES, 'other')}</select></label>
      <label>Condition<select id="n-cond">${options(CONDITIONS, 'good')}</select></label>
    </div>
    <div class="btn-col">
      ${S.settings.apiKey ? `<button class="btn primary big" id="save-ai">✨ Save &amp; analyze with Claude</button>` : ''}
      <button class="btn ${S.settings.apiKey ? '' : 'primary'} big" id="save">Save item</button>
      ${S.settings.apiKey ? '' : `<p class="muted small">Tip: add a Claude API key in <a href="#/settings">Settings</a> to get prices, platforms and descriptions from your photos.</p>`}
    </div>`;
  const v = setView('Add Item', html, { back: '#/' });

  const onFiles = (e) => {
    for (const f of e.target.files) {
      draft.files.push(f);
      const img = document.createElement('img');
      img.src = URL.createObjectURL(f);
      $('#preview').append(img);
    }
    e.target.value = '';
  };
  $('#n-cond', v).onchange = () => (draft.condTouched = true);
  $('#cam', v).onchange = onFiles;
  $('#lib', v).onchange = onFiles;

  const save = async (analyze) => {
    const item = newItem();
    item.title = $('#n-title').value.trim();
    item.category = $('#n-cat').value;
    item.condition = $('#n-cond').value;
    item.conditionSetByUser = !!draft.condTouched;
    await busy('Saving photos…', () => addPhotos(item, draft.files));
    if (!findItem(item.id)) await saveItem(item);
    location.hash = `#/item/${item.id}`;
    if (analyze) setTimeout(() => runAnalyze(item), 50);
  };
  $('#save', v).onclick = () => save(false);
  const ai = $('#save-ai', v);
  if (ai) ai.onclick = () => (draft.files.length ? save(true) : toast('Add at least one photo first.'));
}

function options(obj, selected) {
  return Object.entries(obj)
    .map(([k, v]) => `<option value="${k}" ${k === selected ? 'selected' : ''}>${h(v.label || v.name || v)}</option>`)
    .join('');
}

// ---------- Item detail ----------
function viewItem(id) {
  const item = findItem(id);
  if (!item) {
    setView('Not found', `<p class="empty">That item no longer exists. <a href="#/">Back to items</a></p>`, { back: '#/' });
    return;
  }
  const html = `
    <div class="item-head">
      <div id="head-badges" class="row">${tierBadge(item)} ${statusBadge(item)}</div>
    </div>
    ${section('photos', '📷 Photos', photosHTML(item), true)}
    ${section('details', '📝 Details', detailsHTML(item), !item.title)}
    ${section('price', '💲 Price', `<div id="price-body">${priceHTML(item)}</div>`, true)}
    ${section('where', '🛒 Where to sell', `<div id="where-body">${whereHTML(item)}</div>`, true)}
    ${section('ship', `🚚 Shipping estimate${item.shipping?.estimate ? ` <span class="badge">~${money(item.shipping.estimate.typical)}</span>` : ''}`, shippingHTML(item), false)}
    ${section('listings', '🔗 Listings', `<div id="listings-body">${listingsHTML(item)}</div>`, true)}
    ${section('write', '✍️ Write the listing', writerHTML(item), false)}
    ${section('status', '📦 Status', `<div id="status-body">${statusHTML(item)}</div>`, item.status === 'sold')}
  `;
  const v = setView(item.title || 'Item', html, { back: '#/' });
  bindItem(v, item);
}

function section(id, title, body, open) {
  return `<details class="card section" id="sec-${id}" ${open ? 'open' : ''}><summary>${title}</summary><div class="section-body">${body}</div></details>`;
}

function refreshItemParts(item) {
  $('#head-badges').innerHTML = `${tierBadge(item)} ${statusBadge(item)}`;
  $('#price-body').innerHTML = priceHTML(item);
  $('#where-body').innerHTML = whereHTML(item);
  $('#listings-body').innerHTML = listingsHTML(item);
  $('#status-body').innerHTML = statusHTML(item);
  $('#title').textContent = item.title || 'Item';
}

function photosHTML(item) {
  return `
    <div class="photo-grid" id="photo-grid">
      ${item.photos.map((p, i) => `<figure><img data-photo="${p}" alt="Photo ${i + 1}"><div class="ph-actions">${i ? `<button data-act="cover" data-id="${p}" title="Make cover">★</button>` : '<span class="cover">Cover</span>'}<button data-act="del-photo" data-id="${p}" title="Delete">✕</button></div></figure>`).join('')}
    </div>
    <div class="btn-row">
      <label class="btn primary">📷 Camera<input type="file" accept="image/*" capture="environment" data-act="add-photos" hidden></label>
      <label class="btn">🖼️ Library<input type="file" accept="image/*" multiple data-act="add-photos" hidden></label>
    </div>`;
}

function field(item, key, label, attrs = '') {
  return `<label>${label}<input data-field="${key}" value="${h(item[key])}" ${attrs}></label>`;
}

function detailsHTML(item) {
  return `
    ${field(item, 'title', 'Item name')}
    <div class="grid2">
      ${field(item, 'brand', 'Brand')}
      ${field(item, 'model', 'Model / style #')}
    </div>
    <label>Category<select data-field="category">${options(CATEGORIES, item.category)}</select></label>
    <label>Condition<select data-field="condition">${options(CONDITIONS, item.condition)}</select></label>
    <div class="grid2">
      ${field(item, 'size', 'Size')}
      ${field(item, 'color', 'Color')}
    </div>
    <div class="grid2">
      ${field(item, 'originalPrice', 'Paid / retail new ($)', 'type="number" inputmode="decimal" min="0"')}
      ${field(item, 'ageYears', 'Age (years)', 'type="number" inputmode="decimal" min="0" step="0.5"')}
    </div>
    ${field(item, 'dimensions', 'Dimensions', 'placeholder="e.g. 72&quot; W × 34&quot; D × 30&quot; H"')}
    ${field(item, 'included', "What's included", 'placeholder="e.g. charger, original box"')}
    <label>Features / details <small class="muted">(one per line)</small><textarea data-field="features" rows="3">${h(item.features)}</textarea></label>
    <label>Flaws / damage<textarea data-field="flaws" rows="2" placeholder="Be specific: small scratch on lid…">${h(item.flaws)}</textarea></label>
    <label class="check"><input type="checkbox" data-field="bulky" ${item.bulky ? 'checked' : ''}> Bulky or hard to ship (local pickup)</label>
    <label>Private notes<textarea data-field="notes" rows="2" placeholder="Only you see this">${h(item.notes)}</textarea></label>`;
}

function priceHTML(item) {
  const s = item.suggested;
  const tier = itemTier(item);
  const links = compLinks(item);
  return `
    <div class="tier-banner ${tier ? 'tier-' + tier : ''}">${tier ? `Tier: <b>${TIERS[tier - 1].label}</b>` : 'Set a price to place this item in a tier'}</div>
    ${s ? `
      <div class="suggest">
        <div class="suggest-top"><span class="muted">Suggested (${s.source === 'ai' ? 'Claude' : 'rules'})</span><b>${money(s.target)}</b><span class="muted">range ${money(s.low)}–${money(s.high)}</span></div>
        <div class="suggest-row"><span>List at <b>${money(s.listPrice)}</b></span><span>Lowest to accept <b>${money(s.floor)}</b></span></div>
        ${s.rationale ? `<p class="small muted">${h(s.rationale)}</p>` : ''}
        <button class="btn small" data-act="use-suggested">Use these prices</button>
      </div>` : `<p class="muted small">Get a suggestion from your details (add original price and/or recent sold prices), or let Claude look at the photos.</p>`}
    ${marketHTML(item)}
    ${item.aiQuestions?.length ? `<div class="note"><b>Claude would like to know:</b><ul>${item.aiQuestions.map((q) => `<li>${h(q)}</li>`).join('')}</ul><span class="small muted">Add answers to Details, then re-run the analysis.</span></div>` : ''}
    <div class="btn-row">
      <button class="btn" data-act="suggest-rules">🧮 Estimate price</button>
      <button class="btn primary" data-act="analyze">✨ Analyze with Claude</button>
      <button class="btn ${needsMarketCheck(item) ? 'primary' : ''}" data-act="market-check">🔎 ${item.marketCheck ? 'Re-check' : 'Check'} market prices</button>
    </div>
    <label>Recent SOLD prices for similar items <small class="muted">(e.g. 120, 95, 140)</small><input data-field="comps" value="${h(item.comps)}" inputmode="decimal"></label>
    ${links.length ? `<div class="links">Look up comps: ${links.map((l) => `<a href="${l.url}" target="_blank" rel="noopener">${l.label}</a>`).join(' · ')}</div>` : ''}
    <div class="grid2">
      <label>Asking price ($)<input data-price="askingPrice" type="number" inputmode="decimal" min="0" value="${h(item.askingPrice)}"></label>
      <label>Lowest I'll take ($)<input data-price="floorPrice" type="number" inputmode="decimal" min="0" value="${h(item.floorPrice)}"></label>
    </div>
    ${item.priceHistory?.length ? `<details class="history"><summary>Price history (${item.priceHistory.length})</summary><ul>${item.priceHistory.slice().reverse().map((p) => `<li>${p.date}: ${money(p.price)}</li>`).join('')}</ul></details>` : ''}`;
}

function marketHTML(item) {
  const m = item.marketCheck;
  const nudge = needsMarketCheck(item)
    ? `<div class="note"><b>🔎 Recommended for items over $100:</b> ${m ? 'your market check is over a month old — prices move, so re-check before dropping the price.' : 'before you list, let Claude search the web for comparable sold and for-sale listings.'}</div>`
    : '';
  if (!m) return nudge;
  const range = (a, b) => (a && b ? `${money(a)}–${money(b)}` : a || b ? money(a || b) : '—');
  const days = daysBetween(new Date(m.at), new Date());
  return `${nudge}
    <div class="suggest market">
      <div class="suggest-top"><span class="muted">Market check · ${days ? `${days}d ago` : 'today'} · ${m.confidence} confidence</span></div>
      <div class="suggest-row">
        <span>Typically sells for <b>${money(m.typicalSold)}</b></span>
        <span>Sold ${range(m.soldLow, m.soldHigh)}</span>
        <span>Asking ${range(m.askingLow, m.askingHigh)}</span>
      </div>
      ${m.listPrice ? `<div class="suggest-row"><span>List at <b>${money(m.listPrice)}</b></span><span>Lowest to accept <b>${money(m.floor)}</b></span></div>` : ''}
      ${m.summary ? `<p class="small">${h(m.summary)}</p>` : ''}
      ${m.comparables.length ? `<details class="comps"><summary>${m.comparables.length} comparable listing${m.comparables.length > 1 ? 's' : ''}</summary><ul>
        ${m.comparables.map((c) => `<li><span class="badge ${c.status === 'sold' ? 'status-sold' : ''}">${h(c.status)}</span> <b>${money(c.price)}</b> ${c.url ? `<a href="${h(c.url)}" target="_blank" rel="noopener">${h(c.title)}</a>` : h(c.title)}<span class="small muted">${[c.condition, c.source, c.date].filter(Boolean).map(h).join(' · ')}</span></li>`).join('')}
      </ul></details>` : ''}
      ${m.caveats.length || m.dropped ? `<ul class="small muted caveats">${m.caveats.map((c) => `<li>${h(c)}</li>`).join('')}${m.dropped ? `<li>${m.dropped} listing${m.dropped > 1 ? 's were' : ' was'} left out because the link couldn't be confirmed in the search results.</li>` : ''}</ul>` : ''}
      ${m.listPrice ? `<button class="btn small" data-act="use-market">Use these prices</button>` : ''}
    </div>`;
}

function shippingHTML(item) {
  const sh = item.shipping || {};
  const num = (k, label, attrs = '') => `<label>${label}<input data-ship="${k}" type="number" inputmode="decimal" min="0" value="${h(sh[k])}" ${attrs}></label>`;
  return `
    ${item.bulky ? '<div class="note">This item is marked bulky — local pickup is usually the better deal. You can still estimate shipping below.</div>' : ''}
    <p class="small muted">Only needed if you'll ship it. Weigh it packed (item + box + padding), or add the box weight shown.</p>
    <label>Box<select data-ship="box">${Object.entries(BOXES).map(([k, b]) => `<option value="${k}" ${k === (sh.box || 'custom') ? 'selected' : ''}>${h(b.label)}</option>`).join('')}</select></label>
    <div class="grid3">${num('l', 'Length (in)')}${num('w', 'Width (in)')}${num('h', 'Height (in)')}</div>
    <div class="grid2">${num('lb', 'Weight (lb)', 'step="1"')}${num('oz', 'Ounces', 'step="1" max="15"')}</div>
    <div id="ship-results">${shippingResultsHTML(item)}</div>
    <div class="links small">Exact prices: ${CALCULATORS.map((c) => `<a href="${c.url}" target="_blank" rel="noopener">${c.label}</a>`).join(' · ')}</div>`;
}

function shippingResultsHTML(item) {
  const sh = item.shipping || {};
  if (!sh.lb && !sh.oz) return '';
  const est = estimateShipping(sh);
  if (!est.ok) return `<div class="note">${h(est.reason)}</div>`;
  const price = item.askingPrice || item.suggested?.target;
  const adv = shippingAdvice(est, price);
  return `
    <div class="suggest">
      <div class="suggest-top"><span class="muted">Rough estimate</span><b>${money(est.low)}–${money(est.high)}</b></div>
      <ul class="ship-opts">${est.options.map((o) => `<li class="${o.key === est.best ? 'best' : ''}"><b>${h(o.name)}</b>${o.key === est.best ? ' <span class="badge status-listed">cheapest</span>' : ''}<br>
        ${o.unavailable ? `<span class="small muted">${h(o.unavailable)}</span>` : `${money(o.low)}–${money(o.high)} <span class="small muted">· billed as ${o.billable} lb</span>`}
        ${o.notes.map((n) => `<div class="small muted">${h(n)}</div>`).join('')}</li>`).join('')}</ul>
      <p class="small muted">Low end = nearby, high end = across the country. Based on typical discounted label prices; check a calculator before you commit.</p>
      ${adv ? `<div class="suggest-row"><span>Charge buyer about <b>${money(adv.chargeBuyer)}</b></span>${adv.freeShippingPrice ? `<span>Or list at <b>${money(adv.freeShippingPrice)}</b> with free shipping</span>` : ''}</div>` : ''}
      ${adv && adv.worthShipping === false ? '<div class="note">Shipping could cost over half the item\'s price — local pickup is probably better.</div>' : ''}
      ${est.warnings.map((w) => `<div class="small">⚠️ ${h(w)}</div>`).join('')}
    </div>`;
}

function whereHTML(item) {
  const recs = recommendPlatforms(item);
  // eBay is always offered, even when it isn't a top pick for this item.
  if (!recs.some((r) => r.key === 'ebay')) {
    const p = PLATFORMS.ebay;
    recs.push({ key: 'ebay', name: p.name, mode: p.mode, fees: p.fees, sellUrl: p.sellUrl, reasons: ['Always worth a look — the largest buyer audience'], always: true });
  }
  const ai = (item.aiPlatforms || []).map(matchPlatformKey).filter(Boolean);
  const listed = new Set((item.listings || []).filter((l) => l.status === 'active').map((l) => l.platform));
  const tier = itemTier(item);
  return `
    ${ai.length ? `<p class="small"><b>Claude recommends:</b> ${ai.map(platformName).join(', ')}${item.aiPlatformReason ? ` — ${h(item.aiPlatformReason)}` : ''}</p>` : ''}
    ${tier ? '' : '<p class="small muted">Recommendations improve once the item has a price.</p>'}
    <ol class="recs">
      ${recs.map((r) => `<li class="rec">
        <div><b>${h(r.name)}</b> <span class="badge">${modeLabel(r.mode)}</span>${listed.has(r.key) ? ' <span class="badge status-listed">Listed</span>' : ''}${ai.includes(r.key) ? ' <span class="badge ai">✨</span>' : ''}</div>
        <div class="small">${h(r.reasons.join(' · ') || 'Decent fit')}</div>
        <div class="small muted">Fees: ${h(r.fees)}</div>
        <div class="btn-row"><a class="btn small" href="${r.sellUrl}" target="_blank" rel="noopener">Open ${h(r.name.split(' (')[0])} ↗</a><button class="btn small primary" data-act="add-listing" data-platform="${r.key}">+ Track listing</button></div>
      </li>`).join('')}
    </ol>
    <p class="small muted">Tip: copy your listing text from "Write the listing" first, post it, then paste the listing URL here with "Track listing".</p>`;
}

function listingsHTML(item) {
  const ls = item.listings || [];
  return `
    ${ls.length ? `<ul class="listings">${ls.map((l) => {
      const age = l.postedDate ? daysBetween(toDate(l.postedDate), new Date()) : null;
      return `<li class="listing status-${l.status}">
        <div class="row between"><b>${h(platformName(l.platform) === l.platform ? l.platformName || l.platform : platformName(l.platform))}</b><span class="badge status-${l.status === 'active' ? 'listed' : l.status}">${l.status}</span></div>
        ${l.url ? `<a class="url" href="${h(l.url)}" target="_blank" rel="noopener">${h(l.url)}</a>` : '<span class="small muted">No URL saved</span>'}
        <div class="small">Posted ${h(l.postedDate || '—')}${age !== null ? ` (${age}d ago)` : ''}${l.refreshedAt ? ` · renewed ${h(l.refreshedAt)}` : ''} · ${money(l.price)}</div>
        <div class="btn-row">
          ${l.url ? `<button class="btn small" data-act="copy-url" data-id="${l.id}">Copy URL</button>` : ''}
          ${l.status === 'active' ? `<button class="btn small" data-act="renewed" data-id="${l.id}">Renewed today</button>` : ''}
          <button class="btn small" data-act="edit-listing" data-id="${l.id}">Edit</button>
          <button class="btn small danger" data-act="delete-listing" data-id="${l.id}" aria-label="Delete listing">🗑 Delete</button>
        </div>
      </li>`;
    }).join('')}</ul>` : '<p class="muted small">No listings tracked yet.</p>'}
    <button class="btn primary" data-act="add-listing">+ Add listing</button>`;
}

function writerHTML(item) {
  const platform = item.writerPlatform || recommendPlatforms(item, 1)[0]?.key || 'facebook';
  const lim = limitsFor(platform);
  return `
    <label>Write for<select id="w-platform">${options(PLATFORMS, platform)}</select></label>
    <div class="btn-row">
      <button class="btn" data-act="gen-draft">📝 Generate draft</button>
      <button class="btn primary" data-act="ai-improve">✨ Improve with Claude</button>
      ${item.aiDescription ? `<button class="btn" data-act="use-ai-desc">Use Claude's description</button>` : ''}
    </div>
    <label>Title <span class="count" id="t-count"></span><input id="w-title" value="${h(item.draftTitle)}" maxlength="200"></label>
    <div class="btn-row tight">
      <button class="btn small" data-edit="title-case">Title Case</button>
      <button class="btn small" data-edit="title-short">Shorten</button>
      <button class="btn small" data-edit="title-shout">Fix shouting</button>
      <button class="btn small" data-act="copy" data-target="w-title">Copy</button>
    </div>
    <label>Description <span class="count" id="d-count"></span><textarea id="w-desc" rows="10">${h(item.draftDesc)}</textarea></label>
    <div class="btn-row tight">
      <button class="btn small" data-edit="desc-tidy">Tidy spacing</button>
      <button class="btn small" data-edit="desc-shout">Fix shouting</button>
      <button class="btn small" data-edit="desc-short">Trim filler</button>
      <button class="btn small" data-act="copy" data-target="w-desc">Copy</button>
      <button class="btn small" data-act="copy-all">Copy both</button>
    </div>
    <label>Ask Claude for a specific edit <small class="muted">(optional)</small><input id="w-instr" placeholder="e.g. make it sound friendlier, mention it's pet-free"></label>
    <div id="lint" class="lint" data-limit="${lim.title}"></div>`;
}

function statusHTML(item) {
  const btn = (act, label, cls = '') => `<button class="btn ${cls}" data-act="${act}">${label}</button>`;
  return `
    ${item.status === 'sold' ? `<p>Sold for <b>${money(item.soldPrice)}</b> on ${h(item.soldDate || '—')}${item.soldPlatform ? ` via ${h(platformName(item.soldPlatform))}` : ''}.${item.askingPrice && item.soldPrice ? ` <span class="muted small">(${Math.round((item.soldPrice / item.askingPrice) * 100)}% of asking)</span>` : ''}</p>` : ''}
    <div class="btn-row">
      ${item.status !== 'sold' ? btn('mark-sold', '✅ Mark sold', 'primary') : btn('relist', '↩︎ Back to listed')}
      ${item.status === 'archived' ? btn('unarchive', 'Unarchive') : btn('archive', 'Archive')}
      ${btn('delete-item', 'Delete', 'danger')}
    </div>
    <p class="small muted">Added ${h(isoDay(item.createdAt))}</p>`;
}

function updateLint(item) {
  const platform = $('#w-platform').value;
  const lim = limitsFor(platform);
  const t = $('#w-title').value;
  const d = $('#w-desc').value;
  $('#t-count').textContent = `${t.length}/${lim.title}`;
  $('#t-count').classList.toggle('over', t.length > lim.title);
  $('#d-count').textContent = lim.desc ? `${d.length}/${lim.desc}` : `${d.length}`;
  $('#d-count').classList.toggle('over', !!lim.desc && d.length > lim.desc);
  const issues = lint(t, d, item, platform);
  $('#lint').innerHTML = issues.length
    ? `<b>Checklist</b><ul>${issues.map((i) => `<li class="${i.level}">${i.level === 'error' ? '⛔' : i.level === 'warn' ? '⚠️' : '💡'} ${h(i.msg)}</li>`).join('')}</ul>`
    : '<b>✅ Looks good.</b>';
}

function recordPrice(item, price) {
  item.priceHistory = item.priceHistory || [];
  const last = item.priceHistory[item.priceHistory.length - 1];
  if (!last || Number(last.price) !== Number(price)) item.priceHistory.push({ date: today(), price: Number(price) });
  if (item.status === 'listed') item.priceChangedAt = today();
}

function bindItem(v, item) {
  // Details: save as you type; refresh price/platform panels when relevant fields change.
  v.addEventListener('input', (e) => {
    const f = e.target.dataset.field;
    if (f) {
      item[f] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      saveItemSoon(item);
      if (f === 'title') $('#title').textContent = item.title || 'Item';
      if (f === 'condition') item.conditionSetByUser = true;
    }
    if (e.target.dataset.ship && e.target.tagName === 'INPUT') {
      updateShipping(item, e.target.dataset.ship, e.target.value);
    }
    if (e.target.id === 'w-title' || e.target.id === 'w-desc') {
      item.draftTitle = $('#w-title').value;
      item.draftDesc = $('#w-desc').value;
      saveItemSoon(item);
      updateLint(item);
    }
  });

  v.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.dataset.field && ['category', 'condition', 'bulky', 'title', 'brand', 'model'].includes(t.dataset.field)) {
      $('#where-body').innerHTML = whereHTML(item);
      updateLint(item);
    }
    if (t.dataset.price) {
      const val = t.value === '' ? '' : Number(t.value);
      item[t.dataset.price] = val;
      if (t.dataset.price === 'askingPrice' && val !== '') recordPrice(item, val);
      await saveItem(item);
      refreshItemParts(item);
    }
    if (t.dataset.act === 'add-photos') {
      await busy('Saving photos…', () => addPhotos(item, t.files));
      $('#sec-photos .section-body').innerHTML = photosHTML(item);
      hydratePhotos($('#sec-photos'));
      updateLint(item);
    }
    if (t.dataset.ship === 'box') {
      const b = BOXES[t.value];
      item.shipping = { ...(item.shipping || {}), box: t.value };
      if (t.value !== 'custom') {
        for (const k of ['l', 'w', 'h']) {
          item.shipping[k] = b[k];
          $(`[data-ship="${k}"]`).value = b[k];
        }
        if (b.pack) toast(`Add about ${b.pack} lb for the box and padding if you weighed the item alone.`, 4000);
      }
      updateShipping(item);
    }
    if (t.id === 'w-platform') {
      item.writerPlatform = t.value;
      saveItemSoon(item);
      updateLint(item);
    }
  });

  v.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act],[data-edit]');
    if (!b || b.tagName === 'INPUT') return;
    const act = b.dataset.act;
    const edit = b.dataset.edit;
    if (edit) return applyEdit(item, edit);
    switch (act) {
      case 'cover': {
        item.photos = [b.dataset.id, ...item.photos.filter((p) => p !== b.dataset.id)];
        await saveItem(item);
        $('#sec-photos .section-body').innerHTML = photosHTML(item);
        hydratePhotos($('#sec-photos'));
        break;
      }
      case 'del-photo': {
        if (!confirm('Delete this photo?')) return;
        item.photos = item.photos.filter((p) => p !== b.dataset.id);
        await db.del('photos', b.dataset.id);
        await saveItem(item);
        $('#sec-photos .section-body').innerHTML = photosHTML(item);
        hydratePhotos($('#sec-photos'));
        break;
      }
      case 'suggest-rules': {
        const s = suggestPrice(item);
        if (!s) return toast('Add the original price or a few recent sold prices first (in Details / below).', 4000);
        item.suggested = s;
        await saveItem(item);
        refreshItemParts(item);
        break;
      }
      case 'analyze':
        return runAnalyze(item);
      case 'market-check':
        return runMarketCheck(item);
      case 'use-market': {
        const m = item.marketCheck;
        item.askingPrice = m.listPrice;
        item.floorPrice = m.floor || item.floorPrice;
        recordPrice(item, m.listPrice);
        await saveItem(item);
        refreshItemParts(item);
        toast(`Asking ${money(m.listPrice)}${m.floor ? `, floor ${money(m.floor)}` : ''} — remember to update any live listings.`, 4000);
        break;
      }
      case 'use-suggested': {
        const s = item.suggested;
        item.askingPrice = s.listPrice;
        item.floorPrice = s.floor;
        recordPrice(item, s.listPrice);
        await saveItem(item);
        refreshItemParts(item);
        toast(`Asking ${money(s.listPrice)}, floor ${money(s.floor)}`);
        break;
      }
      case 'add-listing':
        return listingDialog(item, null, b.dataset.platform);
      case 'edit-listing':
        return listingDialog(item, item.listings.find((l) => l.id === b.dataset.id));
      case 'delete-listing': {
        const l = item.listings.find((x) => x.id === b.dataset.id);
        if (!l || !confirm(`Delete the ${platformName(l.platform) === l.platform ? l.platformName || 'listing' : platformName(l.platform)} listing from the app?\n\nThis only removes it from your tracking — remember to also take it down on the site itself.`)) return;
        item.listings = item.listings.filter((x) => x !== l);
        if (item.status === 'listed' && !item.listings.some((x) => x.status === 'active')) item.status = 'draft';
        await saveItem(item);
        refreshItemParts(item);
        updateNav();
        toast('Listing deleted');
        break;
      }
      case 'renewed': {
        const l = item.listings.find((x) => x.id === b.dataset.id);
        l.refreshedAt = today();
        await saveItem(item);
        refreshItemParts(item);
        toast('Marked as renewed today.');
        break;
      }
      case 'copy-url':
        return copy(item.listings.find((l) => l.id === b.dataset.id).url);
      case 'gen-draft': {
        if ((item.draftTitle || item.draftDesc) && !confirm('Replace the current title and description with a fresh draft?')) return;
        const p = $('#w-platform').value;
        $('#w-title').value = item.draftTitle = generateTitle(item, p);
        $('#w-desc').value = item.draftDesc = generateDescription(item, p, S.settings);
        await saveItem(item);
        updateLint(item);
        break;
      }
      case 'use-ai-desc': {
        $('#w-desc').value = item.draftDesc = item.aiDescription;
        if (!item.draftTitle) $('#w-title').value = item.draftTitle = generateTitle(item, $('#w-platform').value);
        await saveItem(item);
        updateLint(item);
        break;
      }
      case 'ai-improve':
        return runImprove(item);
      case 'copy':
        return copy($('#' + b.dataset.target).value);
      case 'copy-all':
        return copy(`${$('#w-title').value}\n\n${$('#w-desc').value}`);
      case 'mark-sold':
        return soldDialog(item);
      case 'relist':
        item.status = (item.listings || []).some((l) => l.status === 'active') ? 'listed' : 'draft';
        break;
      case 'archive':
        item.status = 'archived';
        break;
      case 'unarchive':
        item.status = (item.listings || []).some((l) => l.status === 'active') ? 'listed' : 'draft';
        break;
      case 'delete-item': {
        if (!confirm('Delete this item, its photos and listings? This cannot be undone.')) return;
        for (const p of item.photos) await db.del('photos', p);
        await db.del('items', item.id);
        S.items = S.items.filter((i) => i !== item);
        scheduleSync();
        location.hash = '#/';
        return;
      }
      default:
        return;
    }
    if (['relist', 'archive', 'unarchive'].includes(act)) {
      await saveItem(item);
      refreshItemParts(item);
      updateNav();
    }
  });

  updateLint(item);
}

function updateShipping(item, key, value) {
  item.shipping = { ...(item.shipping || {}) };
  if (key) item.shipping[key] = value === '' ? '' : Number(value);
  const est = estimateShipping(item.shipping);
  item.shipping.estimate = est.ok ? { typical: est.typical, low: est.low, high: est.high, carrier: est.options.find((o) => o.key === est.best).name } : null;
  $('#ship-results').innerHTML = shippingResultsHTML(item);
  $('#sec-ship summary').innerHTML = `🚚 Shipping estimate${item.shipping.estimate ? ` <span class="badge">~${money(item.shipping.estimate.typical)}</span>` : ''}`;
  saveItemSoon(item);
}

function applyEdit(item, edit) {
  const ti = $('#w-title');
  const de = $('#w-desc');
  const lim = limitsFor($('#w-platform').value);
  if (edit === 'title-case') ti.value = titleCase(ti.value);
  if (edit === 'title-short') ti.value = shorten(ti.value, lim.title);
  if (edit === 'title-shout') ti.value = fixShouting(ti.value);
  if (edit === 'desc-tidy') de.value = tidy(de.value);
  if (edit === 'desc-shout') de.value = fixShouting(de.value);
  if (edit === 'desc-short') de.value = tidy(shorten(de.value.replace(/\n/g, '\u0000')).replace(/\u0000/g, '\n'));
  item.draftTitle = ti.value;
  item.draftDesc = de.value;
  saveItemSoon(item);
  updateLint(item);
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied');
  } catch {
    prompt('Copy this:', text);
  }
}

// ---------- AI actions ----------
async function runMarketCheck(item) {
  if (!S.settings.apiKey) return toast('Add your Claude API key in Settings first.', 4000);
  if (!item.title && !item.brand && !item.photos.length) return toast('Add a name or photo first so Claude knows what to search for.');
  const m = await busy('Claude is searching the web for comparable listings… (up to a minute)', async () => {
    const images = item.brand && item.model ? [] : await photosForAI(item, 2);
    return marketCheck(S.settings, item, images);
  });
  if (!m) return;
  item.marketCheck = m;
  // Feed sold prices into the comps field so the offline estimate benefits too.
  const sold = m.comparables.filter((c) => c.status === 'sold' && c.url).map((c) => c.price);
  if (sold.length) item.comps = [...new Set([...parseComps(item.comps), ...sold])].join(', ');
  await saveItem(item);
  if (location.hash === `#/item/${item.id}`) {
    refreshItemParts(item);
    const field = $('[data-field="comps"]');
    if (field) field.value = item.comps || '';
  }
  toast(m.comparables.length ? `Found ${m.comparables.length} comparable listings.` : 'Claude couldn\'t find close comparables — see the notes.', 4000);
}

async function runAnalyze(item) {
  if (!S.settings.apiKey) {
    toast('Add your Claude API key in Settings first.', 4000);
    return;
  }
  if (!item.photos.length && !item.title) return toast('Add a photo or a name first.');
  const r = await busy(S.settings.webSearch ? 'Claude is looking at your photos and checking prices…' : 'Claude is looking at your photos…', async () => {
    const images = await photosForAI(item);
    return analyzeItem(S.settings, item, images);
  });
  if (!r) return;
  const fill = (k, v) => {
    if (v && !String(item[k] || '').trim()) item[k] = v;
  };
  // A quick 1–2 word name typed when adding the item is just a hint; prefer Claude's fuller name.
  if (r.title && String(item.title || '').trim().split(/\s+/).length <= 2) item.title = r.title;
  fill('brand', r.brand);
  fill('model', r.model);
  if (r.category && (item.category === 'other' || !item.category)) item.category = r.category;
  if (r.condition && !item.conditionSetByUser) item.condition = r.condition;
  if (r.retail_price_new > 0) fill('originalPrice', r.retail_price_new);
  if (r.features?.length) fill('features', r.features.join('\n'));
  fill('flaws', r.flaws_seen);
  if (r.price_target > 0) {
    item.suggested = {
      source: 'ai',
      low: nicePrice(r.price_low),
      high: nicePrice(r.price_high),
      target: nicePrice(r.price_target),
      listPrice: nicePrice(r.price_target * 1.1),
      floor: nicePrice(r.price_low),
      rationale: r.pricing_rationale,
      at: new Date().toISOString(),
    };
  }
  item.aiPlatforms = r.platforms || [];
  item.aiPlatformReason = r.platform_reasoning || '';
  item.aiQuestions = r.questions || [];
  item.aiDescription = r.description || '';
  if (!item.draftDesc && r.description) item.draftDesc = r.description;
  const top = (item.aiPlatforms.map(matchPlatformKey).filter(Boolean)[0]) || recommendPlatforms(item, 1)[0]?.key;
  if (!item.draftTitle) item.draftTitle = generateTitle(item, top);
  if (top && !item.writerPlatform) item.writerPlatform = top;
  await saveItem(item);
  if (location.hash === `#/item/${item.id}`) viewItem(item.id);
  toast('Claude filled in the blanks — review everything before posting.', 4000);
}

async function runImprove(item) {
  const platform = $('#w-platform').value;
  const title = $('#w-title').value;
  const description = $('#w-desc').value;
  if (!title && !description) return toast('Generate a draft first, then improve it.');
  const r = await busy('Claude is editing your listing…', () => improveListing(S.settings, item, { title, description, platform, instruction: $('#w-instr').value.trim() }));
  if (!r) return;
  item.prevDraft = { title, description };
  $('#w-title').value = item.draftTitle = r.title;
  $('#w-desc').value = item.draftDesc = r.description;
  await saveItem(item);
  updateLint(item);
  const lintBox = $('#lint');
  lintBox.insertAdjacentHTML('beforebegin', `<div class="note" id="changes"><b>What changed:</b><ul>${(r.changes || []).map((c) => `<li>${h(c)}</li>`).join('')}</ul><button class="btn small" id="undo-ai">Undo</button></div>`);
  $('#undo-ai').onclick = async () => {
    $('#w-title').value = item.draftTitle = item.prevDraft.title;
    $('#w-desc').value = item.draftDesc = item.prevDraft.description;
    await saveItem(item);
    updateLint(item);
    $('#changes').remove();
  };
}

// ---------- Dialogs ----------
function dialog(html, onSubmit) {
  const d = $('#dialog');
  d.innerHTML = `<form method="dialog">${html}</form>`;
  const form = $('form', d);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const action = e.submitter?.value;
    if (action === 'cancel') return d.close();
    const data = Object.fromEntries(new FormData(form));
    if ((await onSubmit(action, data)) !== false) d.close();
  };
  d.showModal();
}

function listingDialog(item, listing, platform) {
  const l = listing || { platform: platform || recommendPlatforms(item, 1)[0]?.key || 'facebook', postedDate: today(), price: item.askingPrice || '', status: 'active', url: '' };
  dialog(
    `<h2>${listing ? 'Edit listing' : 'Track a listing'}</h2>
     <label>Platform<select name="platform">${options(PLATFORMS, l.platform)}<option value="other" ${l.platform === 'other' ? 'selected' : ''}>Other…</option></select></label>
     <label>Other platform name<input name="platformName" value="${h(l.platformName)}" placeholder="Only if Other"></label>
     <label>Listing URL<input name="url" type="url" inputmode="url" value="${h(l.url)}" placeholder="Paste the link to your listing"></label>
     <div class="grid2">
       <label>Posted on<input name="postedDate" type="date" value="${h(l.postedDate)}" required></label>
       <label>Listed price ($)<input name="price" type="number" inputmode="decimal" min="0" value="${h(l.price)}"></label>
     </div>
     <label>Status<select name="status">${options({ active: 'Active', ended: 'Ended / removed', sold: 'Sold here' }, l.status)}</select></label>
     <div class="btn-row end">
       ${listing ? '<button class="btn danger" value="delete" formnovalidate>Delete</button>' : ''}
       <button class="btn" value="cancel" formnovalidate>Cancel</button>
       <button class="btn primary" value="save">Save</button>
     </div>`,
    async (action, data) => {
      if (action === 'delete') {
        if (!confirm('Remove this listing from tracking?')) return false;
        item.listings = item.listings.filter((x) => x !== listing);
      } else {
        const rec = listing || { id: db.uid() };
        Object.assign(rec, data, { price: data.price === '' ? '' : Number(data.price) });
        if (!listing) item.listings.push(rec);
        if (rec.status === 'active' && item.status === 'draft') item.status = 'listed';
        if (rec.status === 'sold' && item.status !== 'sold') {
          setTimeout(() => soldDialog(item, rec), 50);
        }
        if (!item.askingPrice && rec.price) {
          item.askingPrice = rec.price;
          recordPrice(item, rec.price);
        }
      }
      if (item.status === 'listed' && !item.listings.some((x) => x.status === 'active')) item.status = 'draft';
      await saveItem(item);
      refreshItemParts(item);
    }
  );
}

function soldDialog(item, listing) {
  const active = item.listings.filter((l) => l.status === 'active' || l === listing);
  dialog(
    `<h2>Mark as sold 🎉</h2>
     <div class="grid2">
       <label>Sold for ($)<input name="soldPrice" type="number" inputmode="decimal" min="0" value="${h(listing?.price || item.askingPrice)}" required></label>
       <label>Date<input name="soldDate" type="date" value="${today()}" required></label>
     </div>
     <label>Where<select name="soldPlatform">${active.map((l) => `<option value="${l.id}" ${l === listing ? 'selected' : ''}>${h(platformName(l.platform))}</option>`).join('')}<option value="">Somewhere else / in person</option></select></label>
     <p class="small muted">Other active listings stay "active" so you get a reminder to take them down.</p>
     <div class="btn-row end"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="save">Mark sold</button></div>`,
    async (_a, data) => {
      item.status = 'sold';
      item.soldPrice = Number(data.soldPrice);
      item.soldDate = data.soldDate;
      const l = item.listings.find((x) => x.id === data.soldPlatform);
      item.soldPlatform = l ? l.platform : '';
      if (l) l.status = 'sold';
      await saveItem(item);
      refreshItemParts(item);
      render();
    }
  );
}

// ---------- Reminders ----------
function relDays(d) {
  const n = daysBetween(new Date(), d);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days overdue`;
}

function viewReminders() {
  const all = reminders();
  const due = all.filter((r) => isDue(r));
  const soon = all.filter((r) => !isDue(r) && daysBetween(new Date(), r.due) <= 30);
  const card = (r) => {
    const item = findItem(r.itemId);
    let primary = `<button class="btn small primary" data-r="done" data-key="${h(r.key)}">Done</button>`;
    if (r.action === 'price_drop' && !r.atFloor && r.newPrice) primary = `<button class="btn small primary" data-r="drop" data-key="${h(r.key)}">Drop to ${money(r.newPrice)}</button> <button class="btn small" data-r="done" data-key="${h(r.key)}">Keep price</button>`;
    if (r.action === 'refresh') primary = `<button class="btn small primary" data-r="renewed" data-key="${h(r.key)}">Renewed it</button>`;
    return `<li class="card reminder ${isDue(r) ? 'is-due' : ''}">
      <div class="row between"><b>${h(r.title)}</b><span class="small ${r.overdueDays > 0 ? 'overdue' : 'muted'}">${relDays(r.due)}</span></div>
      <a href="#/item/${r.itemId}" class="rem-item">${item.photos[0] ? `<img data-photo="${item.photos[0]}" alt="">` : ''}<span>${h(item.title || 'Untitled')} · ${money(item.askingPrice)} ${tierBadge(item)}</span></a>
      <p class="small">${h(r.message)}${r.action === 'price_drop' && !r.atFloor ? ` (${r.pct}% off ${money(r.currentPrice)}${item.floorPrice ? `, floor ${money(item.floorPrice)}` : ''})` : ''}</p>
      <div class="btn-row">${primary}<button class="btn small" data-r="snooze" data-key="${h(r.key)}">Snooze 2d</button><button class="btn small" data-r="ics" data-key="${h(r.key)}">📅</button></div>
    </li>`;
  };
  const html = `
    <h2 class="sub">Due now ${due.length ? `<span class="badge due">${due.length}</span>` : ''}</h2>
    <ul class="rems">${due.map(card).join('') || '<li class="empty small">Nothing due. 🎉</li>'}</ul>
    <h2 class="sub">Coming up (30 days)</h2>
    <ul class="rems">${soon.map(card).join('') || '<li class="empty small">No upcoming reminders. They appear once items are listed.</li>'}</ul>
    <div class="btn-col">
      <button class="btn" id="ics-all" ${all.length ? '' : 'disabled'}>📅 Add all upcoming to my calendar</button>
      ${'Notification' in window ? `<button class="btn" id="notif">${S.settings.notify && Notification.permission === 'granted' ? '🔔 Notifications on' : '🔔 Turn on notifications'}</button>` : ''}
      <p class="small muted">Reminders come from the rules in <a href="#/settings">Settings</a> and each item's price tier. For alerts even when the app is closed, add them to your calendar.</p>
    </div>`;
  const v = setView('Reminders', html);
  const byKey = Object.fromEntries(all.map((r) => [r.key, r]));
  v.onclick = async (e) => {
    const b = e.target.closest('[data-r]');
    if (b) await reminderAction(b.dataset.r, byKey[b.dataset.key]);
    if (e.target.id === 'ics-all') downloadICS(all.filter((r) => daysBetween(new Date(), r.due) <= 60), 'resell-reminders.ics');
    if (e.target.id === 'notif') enableNotifications();
  };
}

async function reminderAction(kind, r) {
  const item = findItem(r.itemId);
  if (kind === 'drop') {
    item.askingPrice = r.newPrice;
    recordPrice(item, r.newPrice);
    item.priceChangedAt = today();
    for (const l of item.listings) if (l.status === 'active') l.price = r.newPrice;
    await saveItem(item);
    S.rem.done[r.key] = true;
    toast(`Now ${money(r.newPrice)} — update the price on each platform too.`, 4000);
  } else if (kind === 'renewed') {
    const l = item.listings.find((x) => x.id === r.listingId);
    if (l) l.refreshedAt = today();
    await saveItem(item);
    S.rem.done[r.key] = true;
  } else if (kind === 'done') {
    S.rem.done[r.key] = true;
  } else if (kind === 'snooze') {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    S.rem.snoozed[r.key] = isoDay(d);
  } else if (kind === 'ics') {
    return downloadICS([r], 'reminder.ics');
  }
  await saveRem();
  render();
}

function downloadICS(rems, name) {
  const byId = Object.fromEntries(S.items.map((i) => [i.id, i]));
  download(new Blob([toICS(rems, byId)], { type: 'text/calendar' }), name);
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

async function enableNotifications() {
  const p = await Notification.requestPermission();
  S.settings.notify = p === 'granted';
  await saveSettings();
  toast(p === 'granted' ? 'Notifications on — you will be alerted when you open the app and reminders are due.' : 'Notifications were blocked in your browser settings.', 4000);
  render();
  checkNotifications();
}

async function checkNotifications() {
  if (!S.settings.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
  const due = reminders().filter((r) => isDue(r) && !S.rem.notified[r.key]);
  if (!due.length) return;
  const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
  for (const r of due.slice(0, 5)) {
    const item = findItem(r.itemId);
    const opts = { body: `${item.title || 'Item'}: ${r.message}`, tag: r.key, data: { url: `#/item/${r.itemId}` } };
    try {
      if (reg) await reg.showNotification(r.title, opts);
      else new Notification(r.title, opts);
    } catch {}
    S.rem.notified[r.key] = true;
  }
  await saveRem();
}

// ---------- Settings ----------
function viewSettings() {
  const st = S.settings;
  const ruleRows = (tier) =>
    S.rules
      .map((r, idx) => ({ r, idx }))
      .filter(({ r }) => String(r.tier) === String(tier))
      .map(({ r, idx }) => `<li class="rule">
        <label class="check"><input type="checkbox" data-rule="${idx}" data-k="enabled" ${r.enabled !== false ? 'checked' : ''}> <b>${ACTIONS[r.action]}</b></label>
        <div class="rule-line">${r.trigger === 'sold_with_active' ? '' : `<input type="number" min="0" inputmode="numeric" data-rule="${idx}" data-k="days" value="${r.days}">`} ${TRIGGERS[r.trigger]}
        ${r.action === 'price_drop' ? ` · drop <input type="number" min="1" max="90" inputmode="numeric" data-rule="${idx}" data-k="pct" value="${r.pct}">%` : ''}</div>
        <input data-rule="${idx}" data-k="message" value="${h(r.message)}">
        ${r.id.startsWith('c-') ? `<button class="btn small danger" data-del-rule="${idx}">Remove</button>` : ''}
      </li>`)
      .join('');

  const html = `
    <details class="card section" open><summary>✨ Claude AI</summary><div class="section-body">
      <p class="small muted">Claude looks at your photos to identify the item, estimate a price, pick platforms and write the listing. You need an API key from <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a> (pay-as-you-go; a typical analysis costs a few cents). The key is stored only on this phone.</p>
      <label>API key<input type="password" id="s-apiKey" value="${h(st.apiKey)}" autocomplete="off" placeholder="sk-ant-..."></label>
      <label>Model<select id="s-model">${MODELS.map((m) => `<option value="${m.id}" ${m.id === st.model ? 'selected' : ''}>${m.label}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" id="s-webSearch" ${st.webSearch ? 'checked' : ''}> Let Claude search the web for comparable sold prices (slower, costs a bit more)</label>
      <button class="btn" id="test-ai">Test connection</button>
    </div></details>

    <details class="card section"><summary>🧾 Listing defaults</summary><div class="section-body">
      <label>Your area (for pickup)<input id="s-location" value="${h(st.location)}" placeholder="e.g. North Austin"></label>
      <label>Pickup note<input id="s-pickupNote" value="${h(st.pickupNote)}"></label>
      <label>Price note (local)<input id="s-priceNote" value="${h(st.priceNote)}" placeholder="e.g. Price is firm. / Reasonable offers welcome."></label>
      <label>Shipping note<input id="s-shippingNote" value="${h(st.shippingNote)}"></label>
      <label class="check"><input type="checkbox" id="s-smokeFree" ${st.smokeFree ? 'checked' : ''}> Mention smoke-free home</label>
    </div></details>

    <details class="card section"><summary>⏰ Reminder rules</summary><div class="section-body">
      <p class="small muted">Rules run against each item's price tier. Edit the days, percentage and message, or switch rules off.</p>
      <h3>All items</h3><ul class="rules">${ruleRows('all')}</ul>
      ${TIERS.map((t) => `<h3><span class="badge tier-${t.id}">${t.label}</span></h3><ul class="rules">${ruleRows(t.id)}</ul>`).join('')}
      <h3>Add a rule</h3>
      <div class="grid2">
        <label>Tier<select id="nr-tier"><option value="all">All</option>${TIERS.map((t) => `<option value="${t.id}">${t.label}</option>`).join('')}</select></label>
        <label>Action<select id="nr-action">${options(ACTIONS, 'review')}</select></label>
      </div>
      <div class="grid2">
        <label>After (days)<input id="nr-days" type="number" min="0" value="14" inputmode="numeric"></label>
        <label>Counting from<select id="nr-trigger">${options(Object.fromEntries(Object.entries(TRIGGERS).filter(([k]) => k !== 'sold_with_active')), 'since_listed')}</select></label>
      </div>
      <label>Message<input id="nr-message" placeholder="What should you do?"></label>
      <div class="btn-row"><button class="btn primary" id="add-rule">Add rule</button><button class="btn" id="reset-rules">Reset to defaults</button></div>
    </div></details>

    <details class="card section" ${!st.sheetUrl || S.sync.lastError || !S.sync.lastOk ? 'open' : ''}><summary>📊 Google Sheets sync</summary><div class="section-body">
      <p class="small muted">Keep a live copy of every item and listing in a Google Sheet. After any change, the app rewrites the sheet's <b>Items</b> and <b>Listings</b> tabs (edits made in the sheet itself get overwritten, so make changes here). Photos stay on your phone.</p>
      <ol class="small steps">
        <li>On a computer, create a new Google Sheet at <a href="https://sheets.new" target="_blank" rel="noopener">sheets.new</a> and name it, e.g. "Resell listings".</li>
        <li>In the sheet: <b>Extensions → Apps Script</b>. Delete what's there and paste the script: <button class="btn small" id="copy-script">📋 Copy script</button></li>
        <li>Click 💾 Save, then <b>Deploy → New deployment</b> → ⚙️ <b>Web app</b>. Set <b>Execute as: Me</b> and <b>Who has access: Anyone</b>, then <b>Deploy</b>.</li>
        <li>Google asks you to authorize: choose your account → <b>Advanced → Go to … (unsafe)</b> → <b>Allow</b>. (It says "unsafe" because it's your own unpublished script.)</li>
        <li>Copy the <b>Web app URL</b> (ends in <code>/exec</code>) and paste it below. The app then tests it and shows which sheet it's connected to.</li>
      </ol>
      <p class="small muted">Changed the script later? It only takes effect after <b>Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy</b>.</p>
      <label>Web app URL<input id="s-sheetUrl" type="url" inputmode="url" value="${h(st.sheetUrl)}" placeholder="https://script.google.com/macros/s/…/exec"></label>
      ${S.sync.sheet ? `<p class="small">Connected to: <a href="${h(S.sync.sheet.url)}" target="_blank" rel="noopener"><b>${h(S.sync.sheet.name)}</b></a></p>` : ''}
      <div class="btn-row">
        <button class="btn" id="sync-test" ${st.sheetUrl ? '' : 'disabled'}>🔌 Test connection</button>
        <button class="btn primary" id="sync-now" ${st.sheetUrl ? '' : 'disabled'}>🔄 Sync now</button>
        ${st.sheetUrl ? '<button class="btn" id="sync-off">Disconnect</button>' : ''}
      </div>
      <p class="small muted" data-sync-status></p>
      <details class="small"><summary>Security</summary><p class="muted">The script only accepts updates that include this phone's private sync code, which is built into the script you copy. Anyone with the URL can't change your sheet without it. To reset the code, tap <button class="btn small" id="new-secret">New sync code</button>, then copy the script again and redeploy (Deploy → Manage deployments → ✏️ → Version: New).</p></details>
    </div></details>

    <details class="card section"><summary>💾 Your data</summary><div class="section-body">
      <p class="small muted">Everything (items, photos, listings) is saved on this phone only. Back up regularly, especially before clearing browser data or switching phones.</p>
      <div class="btn-col">
        <button class="btn" id="export">⬇️ Download full backup</button>
        <label class="btn">⬆️ Restore backup<input type="file" accept="application/json,.json" id="import" hidden></label>
        <button class="btn" id="csv">⬇️ Export listings spreadsheet (CSV)</button>
        <button class="btn danger" id="wipe">Delete all data</button>
      </div>
      <p class="small muted" id="usage"></p>
    </div></details>

    <details class="card section"><summary>📱 Install on your phone</summary><div class="section-body small">
      <p><b>iPhone (Safari):</b> tap Share → <i>Add to Home Screen</i>.</p>
      <p><b>Android (Chrome):</b> tap ⋮ → <i>Install app</i> / <i>Add to Home screen</i>.</p>
      <p>It then opens full screen like a normal app and works offline (Claude features need internet).</p>
    </div></details>`;
  const v = setView('Settings', html);

  for (const k of ['apiKey', 'location', 'pickupNote', 'priceNote', 'shippingNote']) {
    $(`#s-${k}`).oninput = (e) => {
      st[k] = e.target.value.trim();
      saveSettings();
    };
  }
  $('#s-model').onchange = (e) => {
    st.model = e.target.value;
    saveSettings();
  };
  for (const k of ['webSearch', 'smokeFree']) {
    $(`#s-${k}`).onchange = (e) => {
      st[k] = e.target.checked;
      saveSettings();
    };
  }
  $('#test-ai').onclick = () =>
    busy('Contacting Claude…', async () => {
      const text = await callClaude(st, { system: 'Reply briefly.', content: [{ type: 'text', text: 'Say "Connected!" and nothing else.' }] });
      toast(`✅ ${text.trim().slice(0, 60)}`);
    });

  v.addEventListener('change', (e) => {
    const i = e.target.dataset.rule;
    if (i === undefined) return;
    const k = e.target.dataset.k;
    S.rules[i] = { ...S.rules[i], [k]: k === 'enabled' ? e.target.checked : k === 'message' ? e.target.value : Number(e.target.value) };
    saveRules();
  });
  v.addEventListener('click', (e) => {
    const d = e.target.dataset.delRule;
    if (d !== undefined) {
      S.rules.splice(Number(d), 1);
      saveRules().then(viewSettings);
    }
  });
  $('#add-rule').onclick = async () => {
    const action = $('#nr-action').value;
    S.rules.push({
      id: 'c-' + db.uid(),
      tier: $('#nr-tier').value === 'all' ? 'all' : Number($('#nr-tier').value),
      trigger: $('#nr-trigger').value,
      days: Number($('#nr-days').value) || 0,
      action,
      pct: action === 'price_drop' ? 10 : undefined,
      message: $('#nr-message').value.trim() || ACTIONS[action],
      enabled: true,
    });
    await saveRules();
    toast('Rule added');
    viewSettings();
  };
  $('#reset-rules').onclick = async () => {
    if (!confirm('Reset all reminder rules to the defaults? Custom rules will be removed.')) return;
    S.rules = DEFAULT_RULES;
    await saveRules();
    viewSettings();
  };

  $('#copy-script').onclick = () => copy(scriptSource(st.sheetSecret));
  $('#s-sheetUrl').onchange = async (e) => {
    const url = e.target.value.trim();
    const problem = url && urlProblem(url);
    if (problem) {
      toast(problem, 8000);
      return;
    }
    st.sheetUrl = url;
    await saveSettings();
    S.sync = { ...S.sync, dirty: !!url, lastError: '', lastOk: '', sheet: null };
    viewSettings();
    if (url && (await runSheetTest())) runSync({ manual: true });
  };
  const test = $('#sync-test');
  if (test) test.onclick = runSheetTest;
  const syncNow = $('#sync-now');
  if (syncNow) syncNow.onclick = () => runSync({ manual: true });
  const off = $('#sync-off');
  if (off) {
    off.onclick = async () => {
      if (!confirm('Stop updating the Google Sheet? The sheet keeps its current contents.')) return;
      st.sheetUrl = '';
      S.sync.sheet = null;
      await saveSettings();
      viewSettings();
    };
  }
  $('#new-secret').onclick = async () => {
    if (!confirm('Make a new sync code? The current script will stop accepting updates until you paste the new script and redeploy.')) return;
    st.sheetSecret = newSecret();
    await saveSettings();
    toast('New code made — tap "Copy script" and redeploy.', 5000);
  };

  $('#export').onclick = () => busy('Preparing backup…', exportBackup);
  $('#import').onchange = (e) => busy('Restoring…', () => importBackup(e.target.files[0]));
  $('#csv').onclick = exportCSV;
  $('#wipe').onclick = async () => {
    if (!confirm('Delete ALL items, photos and settings from this phone?')) return;
    if (!confirm('Really delete everything? Download a backup first if unsure.')) return;
    await Promise.all(['items', 'photos', 'meta'].map(db.clear));
    await load();
    location.hash = '#/';
  };
  if (navigator.storage?.estimate) {
    navigator.storage.estimate().then((e) => {
      $('#usage').textContent = `Using ${(e.usage / 1048576).toFixed(1)} MB on this device.`;
    });
  }
}

async function exportBackup() {
  const photos = {};
  for (const item of S.items) {
    for (const id of item.photos) {
      const row = await db.get('photos', id);
      if (row) photos[id] = await blobToDataURL(row.blob);
    }
  }
  const { apiKey, ...settings } = S.settings; // never put the API key in a backup file
  const data = { app: 'resell-assistant', version: 1, exportedAt: new Date().toISOString(), items: S.items, photos, settings, rules: S.rules, reminderState: S.rem };
  download(new Blob([JSON.stringify(data)], { type: 'application/json' }), `resell-backup-${today()}.json`);
}

async function importBackup(file) {
  if (!file) return;
  const data = JSON.parse(await file.text());
  if (data.app !== 'resell-assistant') throw new Error('That file is not a Resell Assistant backup.');
  if (!confirm(`Restore ${data.items.length} items? Items with the same ID will be overwritten.`)) return;
  for (const [id, url] of Object.entries(data.photos || {})) {
    const blob = await (await fetch(url)).blob();
    await db.put('photos', { id, blob });
  }
  for (const item of data.items) await db.put('items', item);
  if (data.settings) await db.setMeta('settings', { ...data.settings, apiKey: S.settings.apiKey });
  if (data.rules) await db.setMeta('rules', data.rules);
  if (data.reminderState) await db.setMeta('reminderState', data.reminderState);
  await load();
  scheduleSync(500);
  toast('Backup restored.');
  render();
}

function exportCSV() {
  const rows = [['Item', 'Brand', 'Category', 'Condition', 'Tier', 'Status', 'Asking', 'Floor', 'Sold price', 'Sold date', 'Platform', 'Listing URL', 'Posted', 'Listing price', 'Listing status']];
  for (const i of S.items) {
    const base = [i.title, i.brand, CATEGORIES[i.category]?.label, CONDITIONS[i.condition]?.label, TIERS[(itemTier(i) || 0) - 1]?.label || '', i.status, i.askingPrice, i.floorPrice, i.soldPrice, i.soldDate];
    if (!i.listings.length) rows.push([...base, '', '', '', '', '']);
    for (const l of i.listings) rows.push([...base, platformName(l.platform), l.url, l.postedDate, l.price, l.status]);
  }
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  download(new Blob([csv], { type: 'text/csv' }), `resell-listings-${today()}.csv`);
}

// ---------- Boot ----------
async function boot() {
  await load();
  db.persist();
  window.addEventListener('hashchange', render);
  await render();
  checkNotifications();
  setInterval(checkNotifications, 5 * 60 * 1000);
  if (S.sync.dirty) runSync();
  window.addEventListener('online', () => S.sync.dirty && runSync());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkNotifications();
  });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();

// Exposed for quick debugging in the browser console.
window.__resell = { S, tierFor };
