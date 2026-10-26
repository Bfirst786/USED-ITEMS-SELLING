// Google Sheets sync and Google Drive backups. The user deploys a small Apps Script
// (below) from their own spreadsheet as a web app. The app POSTs a snapshot of items
// and listings after every change (the script rewrites two tabs), and periodically a
// full backup: photos are uploaded once each into a Drive folder, then a small JSON
// file with everything else. No Google login or API keys live in the app — a shared
// secret (the "sync code") guards every request.

// Bump when the script gains features the app relies on.
export const SCRIPT_VERSION = 4;

import { TIERS, CATEGORIES, CONDITIONS, itemTier, suggestPrice } from './pricing.js';
import { platformName } from './platforms.js';

const STATUS = { draft: 'Draft', listed: 'Listed', sold: 'Sold', archived: 'Archived' };
const LISTING_STATUS = { active: 'Active', ended: 'Ended', sold: 'Sold' };

// Sheets treats text starting with these characters as a formula; force plain text.
function cell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? v : '';
  if (typeof v === 'boolean') return v ? 'Yes' : '';
  const s = String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function num(v) {
  return v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? '' : Number(v);
}

function day(v) {
  return v ? String(v).slice(0, 10) : '';
}

function listingName(l) {
  return l.platform === 'other' ? l.platformName || 'Other' : platformName(l.platform);
}

export const ITEM_HEADER = [
  'Item ID', 'Item', 'Brand', 'Model', 'Category', 'Condition', 'Price tier', 'Status',
  'Asking price', 'Lowest I\'ll take', 'Suggested price', 'Paid / retail new', 'Sold price', 'Sold date', 'Sold on',
  'Active listings', 'Platforms', 'First posted', 'Market check', 'Market typical sold', 'Est. shipping', 'Added', 'Last updated',
  'Listing title', 'Listing description', 'Features', 'Flaws', 'Dimensions', "What's included", 'Size', 'Color', 'Notes', 'Photos',
];

// Google Sheets refuses cells over 50,000 characters.
const clip = (v) => (typeof v === 'string' && v.length > 49000 ? v.slice(0, 49000) + '…' : v);

// Shown as a note on each column title in the sheet (hover or tap the title).
const NOTES = {
  'Item ID': 'The app\'s internal ID for the item. Links rows in the Listings tab to this item.',
  Item: 'Item name.',
  Brand: 'Brand or maker.',
  Model: 'Model or style number.',
  Category: 'Category used for pricing and platform suggestions.',
  Condition: 'Condition you selected.',
  'Price tier': 'Under $100, $101–$500, or $501+ — based on the asking price (or the suggested price if no asking price yet).',
  Status: 'Draft = not posted yet, Listed = at least one active listing, Sold, or Archived.',
  'Asking price': 'Your current asking price.',
  "Lowest I'll take": 'Your floor price. Reminder price drops never go below it.',
  'Suggested price': 'Latest suggested price (from the estimate or Claude).',
  'Paid / retail new': 'What you paid, or the retail price new.',
  'Sold price': 'Final sale price.',
  'Sold date': 'Date it sold.',
  'Sold on': 'Platform it sold on.',
  'Active listings': 'How many listings are currently up.',
  Platforms: 'Every platform this item has been listed on.',
  'First posted': 'Date of the earliest listing.',
  'Market check': 'Date Claude last searched the web for comparable listings.',
  'Market typical sold': 'Typical sold price found by the last market check.',
  'Est. shipping': 'Rough shipping cost from the shipping estimate.',
  Added: 'Date the item was added to the app.',
  'Last updated': 'Date the item was last changed in the app.',
  'Listing title': 'Title from the listing writer.',
  'Listing description': 'Description from the listing writer.',
  Features: 'Features / details you entered.',
  Flaws: 'Flaws or damage you noted.',
  Dimensions: 'Item dimensions.',
  "What's included": 'Accessories or parts included.',
  Size: 'Size (clothing, shoes, etc.).',
  Color: 'Color.',
  Notes: 'Your private notes.',
  Photos: 'Number of photos in the app (photos themselves are in the Drive backup folder).',
  'Listing ID': 'The app\'s internal ID for this listing.',
  'Item status': 'Status of the item this listing belongs to.',
  Platform: 'Where it is listed.',
  'Listing URL': 'Link to the live listing.',
  Posted: 'Date the listing was posted.',
  'Last renewed': 'Date you last renewed or bumped it.',
  'Listing price': 'Price on this listing.',
  'Listing status': 'Active, Ended, or Sold.',
};
const notesFor = (header) => header.map((h) => NOTES[h] || '');

export const LISTING_HEADER = [
  'Listing ID', 'Item ID', 'Item', 'Price tier', 'Item status', 'Platform', 'Listing URL',
  'Posted', 'Last renewed', 'Listing price', 'Listing status',
];

export function buildTables(items) {
  const sorted = [...items].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const itemRows = [];
  const listingRows = [];
  for (const i of sorted) {
    const tier = itemTier(i);
    const tierLabel = tier ? TIERS[tier - 1].label : '';
    const ls = i.listings || [];
    const active = ls.filter((l) => l.status === 'active');
    const posted = ls.map((l) => l.postedDate).filter(Boolean).sort();
    const soldListing = ls.find((l) => l.status === 'sold');
    itemRows.push([
      i.id, i.title || 'Untitled item', i.brand, i.model,
      CATEGORIES[i.category]?.label, CONDITIONS[i.condition]?.label, tierLabel, STATUS[i.status] || i.status,
      num(i.askingPrice), num(i.floorPrice), num(i.suggested?.target), num(i.originalPrice),
      num(i.soldPrice), day(i.soldDate), i.soldPlatform ? platformName(i.soldPlatform) : soldListing ? listingName(soldListing) : '',
      active.length, [...new Set(ls.map(listingName))].join(', '), posted[0] || '',
      day(i.marketCheck?.at), num(i.marketCheck?.typicalSold) || '', num(i.shipping?.estimate?.typical) || '',
      day(i.createdAt), day(i.updatedAt || i.createdAt),
      i.draftTitle, i.draftDesc, i.features, i.flaws, i.dimensions, i.included, i.size, i.color, i.notes, (i.photos || []).length,
    ].map(clip).map(cell));
    for (const l of ls) {
      listingRows.push([
        l.id, i.id, i.title || 'Untitled item', tierLabel, STATUS[i.status] || i.status,
        listingName(l), l.url, day(l.postedDate), day(l.refreshedAt), num(l.price), LISTING_STATUS[l.status] || l.status,
      ].map(cell));
    }
  }
  return {
    items: { header: ITEM_HEADER, notes: notesFor(ITEM_HEADER), rows: itemRows },
    listings: { header: LISTING_HEADER, notes: notesFor(LISTING_HEADER), rows: listingRows },
  };
}

export function isWebAppUrl(url) {
  return /^https:\/\/script\.google\.com\/(a\/macros\/[\w.-]+|macros)\/s\/[\w-]+\/exec$/.test(String(url || '').trim());
}

// Explain what's wrong with a pasted URL in plain words (null when it looks right).
export function urlProblem(url) {
  const u = String(url || '').trim();
  if (!u) return 'Paste the Web app URL first.';
  if (isWebAppUrl(u)) return null;
  if (/docs\.google\.com\/spreadsheets/.test(u)) return 'That\'s the address of the spreadsheet itself. The app needs the Web app URL from Apps Script: Deploy → Manage deployments → copy the URL ending in /exec.';
  if (/script\.google\.com\/.*\/dev$/.test(u)) return 'That\'s the test (/dev) URL, which only works while you\'re signed in. Use the Web app URL ending in /exec from Deploy → Manage deployments.';
  if (/script\.google\.com\/(home|d\/)/.test(u)) return 'That\'s the address of the script editor. Use the Web app URL ending in /exec from Deploy → Manage deployments.';
  return 'That doesn\'t look like a Google Apps Script Web app URL. It should start with https://script.google.com/macros/s/ and end with /exec.';
}

const ACCESS_HELP = 'Google didn\'t let the app in. In Apps Script open Deploy → Manage deployments → ✏️ Edit, and check "Execute as: Me" and "Who has access: Anyone" (not "Anyone with Google account"). If you never clicked Allow on Google\'s permission screen, run Deploy → New deployment again and finish that step.';

// Check the deployment without changing anything; reports which spreadsheet it writes to.
export async function testSheet(url) {
  const problem = urlProblem(url);
  if (problem) throw new SyncError(problem);
  let res;
  try {
    res = await fetch(url.trim(), { method: 'GET', redirect: 'follow' });
  } catch {
    throw new SyncError(navigator.onLine === false ? 'You\'re offline.' : ACCESS_HELP);
  }
  const data = await res.json().catch(() => null);
  if (!data || !data.ok) throw new SyncError(ACCESS_HELP);
  return data;
}

export function newSecret() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export class SyncError extends Error {}

const DRIVE_PERMISSION = 'Google hasn\'t given the script permission to use Drive yet. In Apps Script, pick the function "authorizeDrive" (or "backupFolder") in the drop-down next to ▶ Run, click ▶ Run, then Review permissions → your account → Advanced → Go to … (unsafe) → Allow. No new deployment is needed — then tap Back up now again.';

const OLD_SCRIPT = 'Your Google script is an older version. In the app tap Copy script, paste it into Apps Script, then Deploy → Manage deployments → ✏️ → Version: New version → Deploy.';

// POST one request to the script and return its JSON reply.
async function callScript(url, secret, payload) {
  const problem = urlProblem(url);
  if (problem) throw new SyncError(problem);
  let res;
  try {
    // text/plain keeps this a "simple" request, which Apps Script web apps accept from browsers.
    res = await fetch(url.trim(), {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secret, ...payload }),
      redirect: 'follow',
    });
  } catch {
    throw new SyncError(navigator.onLine === false ? 'You\'re offline.' : ACCESS_HELP);
  }
  const data = await res.json().catch(() => null);
  if (!data) throw new SyncError(ACCESS_HELP);
  if (!data.ok) {
    if (data.error === 'bad secret') throw new SyncError('The sync code in your Google script doesn\'t match this app. Copy the script again and deploy a new version — or, on a new phone, enter the sync code from your old one.');
    if (payload.action && /reading 'header'|unknown action/.test(String(data.error))) throw new SyncError(OLD_SCRIPT);
    if (/permission to call DriveApp|auth\/drive/.test(String(data.error))) throw new SyncError(DRIVE_PERMISSION);
    const ebay = ebayError(String(data.error));
    if (ebay) throw new SyncError(ebay);
    throw new SyncError(`Google error: ${data.error}`);
  }
  return data;
}

const EBAY_PERMISSION = 'Google hasn\'t given the script permission to contact eBay yet. In Apps Script, pick "authorizeEbay" in the drop-down next to ▶ Run, click ▶ Run, then Review permissions → your account → Advanced → Go to … (unsafe) → Allow.';

// Friendly text for the eBay errors the script reports (null if it isn't one).
export function ebayError(msg) {
  if (/permission to call UrlFetchApp|script\.external_request|PropertiesService/.test(msg)) return EBAY_PERMISSION;
  let m = msg.match(/EBAY_KEYS_MISSING (.*)/);
  if (m) return `Your eBay keys aren't in the Google script yet (missing: ${m[1]}). In Apps Script: ⚙️ Project Settings → Script properties → Add script property.`;
  if (/EBAY_NOT_CONNECTED/.test(msg)) return 'eBay isn\'t connected. Go to Settings → eBay posting and tap Connect eBay.';
  m = msg.match(/EBAY_AUTH (.*)/);
  if (m) return `eBay didn't accept the keys or sign-in: ${m[1]}. Check EBAY_APP_ID, EBAY_CERT_ID and EBAY_RUNAME in Script properties (Production keys, no extra spaces).`;
  m = msg.match(/EBAY (.*)/);
  if (m) return `eBay: ${m[1]}`;
  return null;
}

export function pushToSheet(url, secret, items) {
  return callScript(url, secret, buildTables(items));
}

// ---------- Drive backups ----------

// Everything except photo bytes (photos are stored separately, once each).
export function buildBackup({ items, settings = {}, rules, reminderState }) {
  const { apiKey, sheetSecret, ...safeSettings } = settings; // never store keys in a backup
  const photoIds = [...new Set(items.flatMap((i) => i.photos || []))];
  return {
    app: 'resell-assistant',
    version: 2,
    createdAt: new Date().toISOString(),
    itemCount: items.length,
    items,
    photoIds,
    settings: safeSettings,
    rules,
    reminderState,
  };
}

// getPhoto(id) → base64 JPEG (no data: prefix) or null. onProgress(text) for the UI.
export async function backupToDrive({ url, secret, items, settings, rules, reminderState, getPhoto, onProgress = () => {} }) {
  const backup = buildBackup({ items, settings, rules, reminderState });
  onProgress('Checking which photos are already in Drive…');
  const have = new Set((await callScript(url, secret, { action: 'photos-have' })).ids || []);
  const missing = backup.photoIds.filter((id) => !have.has(id));
  let uploaded = 0;
  for (const id of missing) {
    onProgress(`Uploading photos ${uploaded + 1} of ${missing.length}…`);
    const data = await getPhoto(id);
    if (data) await callScript(url, secret, { action: 'photo-put', id, data });
    uploaded++;
  }
  onProgress('Saving backup…');
  const r = await callScript(url, secret, { action: 'backup', backup });
  return { ...r, photosUploaded: uploaded, items: backup.itemCount };
}

export async function listDriveBackups(url, secret) {
  return (await callScript(url, secret, { action: 'list-backups' })).backups || [];
}

// Returns the backup object; photos are fetched separately with fetchDrivePhoto.
export async function fetchDriveBackup(url, secret, id) {
  const r = await callScript(url, secret, { action: 'get-backup', id });
  if (!r.backup || r.backup.app !== 'resell-assistant') throw new SyncError('That backup file is damaged or not from this app.');
  return r.backup;
}

export async function fetchDrivePhoto(url, secret, id) {
  return (await callScript(url, secret, { action: 'photo-get', id })).data || null;
}

// ---------- eBay (through the script) ----------
export const ebayStatus = (url, secret) => callScript(url, secret, { action: 'ebay-status' });
export const ebayAuthUrl = async (url, secret) => (await callScript(url, secret, { action: 'ebay-auth-url' })).url;
export const ebayDisconnect = (url, secret) => callScript(url, secret, { action: 'ebay-disconnect' });
export const ebayPolicies = (url, secret) => callScript(url, secret, { action: 'ebay-policies' });
export const ebayCategories = (url, secret, q, categoryId) => callScript(url, secret, { action: 'ebay-categories', q, categoryId });

// Makes sure the photos are in Drive (where the script picks them up), then posts.
export async function postToEbay({ url, secret, listing, photoIds, getPhoto, locationKey, postalCode, onProgress = () => {} }) {
  onProgress('Checking photos…');
  const have = new Set((await callScript(url, secret, { action: 'photos-have' })).ids || []);
  const missing = photoIds.filter((id) => !have.has(id));
  for (const [i, id] of missing.entries()) {
    onProgress(`Uploading photos to Google Drive ${i + 1} of ${missing.length}…`);
    const data = await getPhoto(id);
    if (data) await callScript(url, secret, { action: 'photo-put', id, data });
  }
  onProgress('Posting to eBay… (this can take a minute)');
  return callScript(url, secret, { action: 'ebay-post', sku: listing.sku, inventoryItem: listing.inventoryItem, offer: listing.offer, photoIds, locationKey, postalCode });
}

// The Apps Script the user pastes into their spreadsheet (Extensions → Apps Script).
export function scriptSource(secret) {
  return `// Re-Sell Assistant → Google Sheets sync, Drive backups and eBay posting (script version ${SCRIPT_VERSION})
// Paste this into Extensions → Apps Script, then Deploy → New deployment → Web app
// (Execute as: Me, Who has access: Anyone). Keep the code below private.
const SYNC_CODE = '${secret}';
const BACKUP_FOLDER = 'Resell backups';
const KEEP_BACKUPS = 10;

// Run this once from the editor (▶ Run) so Google asks for Drive permission for backups.
function authorizeDrive() {
  backupFolder();
  Logger.log('Drive access granted — backups are ready.');
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.secret !== SYNC_CODE) return reply(Object.assign({ ok: false, error: 'bad secret' }, sheetInfo()));
    const action = body.action || 'sync';
    if (action === 'sync') {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      writeTab(ss, 'Items', body.items, 1);
      writeTab(ss, 'Listings', body.listings, 2);
      removeEmptyDefaultSheet(ss);
      return reply(Object.assign({ ok: true, items: body.items.rows.length, listings: body.listings.rows.length, at: new Date().toISOString() }, sheetInfo()));
    }
    if (action === 'photos-have') return reply({ ok: true, ids: listPhotoIds() });
    if (action === 'photo-put') { putPhoto(body.id, body.data); return reply({ ok: true }); }
    if (action === 'photo-get') return reply({ ok: true, data: getPhoto(body.id) });
    if (action === 'backup') return reply(Object.assign({ ok: true }, saveBackup(body.backup)));
    if (action === 'list-backups') return reply({ ok: true, backups: listBackups() });
    if (action === 'get-backup') return reply({ ok: true, backup: getBackup(body.id) });
    if (action === 'ebay-status') return reply(Object.assign({ ok: true }, ebayStatus()));
    if (action === 'ebay-auth-url') return reply({ ok: true, url: ebayAuthUrl() });
    if (action === 'ebay-disconnect') { ebayDisconnect(); return reply({ ok: true }); }
    if (action === 'ebay-policies') return reply(Object.assign({ ok: true }, ebayPolicies()));
    if (action === 'ebay-categories') return reply(Object.assign({ ok: true }, ebayCategories(body.q, body.categoryId)));
    if (action === 'ebay-post') return reply(Object.assign({ ok: true }, ebayPost(body)));
    return reply({ ok: false, error: 'unknown action' });
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.code || p.error) return ebayCallback(p);
  return reply(Object.assign({ ok: true, app: 'resell-assistant', version: ${SCRIPT_VERSION}, message: 'Resell Assistant sync is set up. Copy this page\\'s URL into the app.' }, sheetInfo()));
}

// Tells the app which spreadsheet this script is attached to.
function sheetInfo() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return { sheet: ss.getName(), sheetUrl: ss.getUrl() };
}

function writeTab(ss, name, table, position) {
  let sheet = ss.getSheetByName(name);
  const isNew = !sheet;
  if (isNew) sheet = ss.insertSheet(name, position - 1);
  const width = table.header.length;
  const values = [table.header].concat(table.rows);
  sheet.clearContents();
  if (sheet.getMaxColumns() > width) sheet.deleteColumns(width + 1, sheet.getMaxColumns() - width);
  sheet.getRange(1, 1, values.length, width).setValues(values);
  // Labelled, colored header row that stays visible while scrolling.
  sheet.setFrozenRows(1);
  const header = sheet.getRange(1, 1, 1, width);
  header.setFontWeight('bold').setBackground('#0f766e').setFontColor('#ffffff').setWrap(true).setVerticalAlignment('middle');
  if (table.notes) header.setNotes([table.notes]);
  if (values.length > 1) sheet.getRange(2, 1, values.length - 1, width).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  if (isNew || sheet.getLastRow() <= 2) {
    sheet.autoResizeColumns(1, width);
    for (let c = 1; c <= width; c++) {
      if (sheet.getColumnWidth(c) > 300) sheet.setColumnWidth(c, 300);
      if (sheet.getColumnWidth(c) < 90) sheet.setColumnWidth(c, 90);
    }
  }
}

// New spreadsheets start with an empty "Sheet1"; remove it so Items opens first.
function removeEmptyDefaultSheet(ss) {
  ['Sheet1', 'Feuille 1', 'Hoja 1'].forEach(function (n) {
    const s = ss.getSheetByName(n);
    if (s && ss.getSheets().length > 1 && s.getLastRow() === 0 && s.getLastColumn() === 0) ss.deleteSheet(s);
  });
}

// ---- Drive backups: "Resell backups" folder next to this spreadsheet ----
function childFolder(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function backupFolder() {
  const parents = DriveApp.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId()).getParents();
  return childFolder(parents.hasNext() ? parents.next() : DriveApp.getRootFolder(), BACKUP_FOLDER);
}

function photoFolder() {
  return childFolder(backupFolder(), 'photos');
}

function listPhotoIds() {
  const ids = [];
  const it = photoFolder().getFiles();
  while (it.hasNext()) ids.push(it.next().getName().replace(/\\.jpg$/, ''));
  return ids;
}

function putPhoto(id, data) {
  if (!/^[\\w-]+$/.test(id)) throw new Error('bad photo id');
  const folder = photoFolder();
  if (folder.getFilesByName(id + '.jpg').hasNext()) return;
  folder.createFile(Utilities.newBlob(Utilities.base64Decode(data), 'image/jpeg', id + '.jpg'));
}

function getPhoto(id) {
  const it = photoFolder().getFilesByName(id + '.jpg');
  return it.hasNext() ? Utilities.base64Encode(it.next().getBlob().getBytes()) : null;
}

function jsonBackups(folder) {
  const out = [];
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (/^resell-backup-.*\\.json$/.test(f.getName())) out.push(f);
  }
  return out.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
}

function saveBackup(backup) {
  const folder = backupFolder();
  const name = 'resell-backup-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd-HHmmss') + '.json';
  const file = folder.createFile(name, JSON.stringify(backup), 'application/json');
  // Keep the newest backups, and only the photos they still use.
  const files = jsonBackups(folder);
  files.slice(KEEP_BACKUPS).forEach(function (f) { f.setTrashed(true); });
  const keep = {};
  (backup.photoIds || []).forEach(function (id) { keep[id] = true; });
  files.slice(0, KEEP_BACKUPS).forEach(function (f) {
    try { (JSON.parse(f.getBlob().getDataAsString()).photoIds || []).forEach(function (id) { keep[id] = true; }); } catch (err) {}
  });
  const it = photoFolder().getFiles();
  while (it.hasNext()) {
    const p = it.next();
    if (!keep[p.getName().replace(/\\.jpg$/, '')]) p.setTrashed(true);
  }
  return { name: name, id: file.getId(), size: file.getSize(), at: new Date().toISOString() };
}

function listBackups() {
  return jsonBackups(backupFolder()).map(function (f) {
    let items = null;
    try { items = JSON.parse(f.getBlob().getDataAsString()).itemCount; } catch (err) {}
    return { id: f.getId(), name: f.getName(), at: f.getDateCreated().toISOString(), size: f.getSize(), items: items };
  });
}

// Only files inside the backup folder can be read back.
function getBackup(id) {
  const files = jsonBackups(backupFolder());
  const f = id ? files.filter(function (x) { return x.getId() === id; })[0] : files[0];
  if (!f) throw new Error('backup not found');
  return JSON.parse(f.getBlob().getDataAsString());
}

// ---- eBay posting ----
// Your eBay keys go in ⚙️ Project Settings → Script properties (not in this code):
// EBAY_APP_ID, EBAY_CERT_ID and EBAY_RUNAME. Sign-in tokens are kept there too.
const EBAY_API = 'https://api.ebay.com';
const EBAY_MARKET = 'EBAY_US';
const EBAY_SCOPES = ['https://api.ebay.com/oauth/api_scope', 'https://api.ebay.com/oauth/api_scope/sell.inventory', 'https://api.ebay.com/oauth/api_scope/sell.account'].join(' ');

// Run this once from the editor (▶ Run) so Google allows the script to contact eBay.
function authorizeEbay() {
  UrlFetchApp.fetch(EBAY_API, { muteHttpExceptions: true });
  props().getProperty('EBAY_APP_ID');
  Logger.log('eBay access granted. Keys found: ' + JSON.stringify(ebayStatus()));
}

function props() { return PropertiesService.getScriptProperties(); }
function enc(s) { return encodeURIComponent(s); }
function safeJson(t) { try { return JSON.parse(t); } catch (err) { return null; } }

function ebayKeys() {
  const p = props();
  const get = function (k) { return String(p.getProperty(k) || '').trim(); };
  const k = { appId: get('EBAY_APP_ID'), certId: get('EBAY_CERT_ID'), ruName: get('EBAY_RUNAME') };
  k.missing = ['EBAY_APP_ID', 'EBAY_CERT_ID', 'EBAY_RUNAME'].filter(function (n) { return !get(n); });
  return k;
}

function requireKeys() {
  const k = ebayKeys();
  if (k.missing.length) throw new Error('EBAY_KEYS_MISSING ' + k.missing.join(', '));
  return k;
}

function ebayStatus() {
  const k = ebayKeys();
  const p = props();
  return { configured: !k.missing.length, missing: k.missing, connected: !!p.getProperty('EBAY_REFRESH_TOKEN'), connectedAt: p.getProperty('EBAY_CONNECTED_AT') || '' };
}

function ebayAuthUrl() {
  const k = requireKeys();
  const state = Utilities.getUuid();
  props().setProperty('EBAY_STATE', state);
  return 'https://auth.ebay.com/oauth2/authorize?client_id=' + enc(k.appId) + '&redirect_uri=' + enc(k.ruName) +
    '&response_type=code&scope=' + enc(EBAY_SCOPES) + '&state=' + enc(state);
}

function ebayToken(form) {
  const k = requireKeys();
  const res = UrlFetchApp.fetch(EBAY_API + '/identity/v1/oauth2/token', {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(k.appId + ':' + k.certId) },
    payload: form,
    muteHttpExceptions: true,
  });
  const data = safeJson(res.getContentText()) || {};
  if (res.getResponseCode() !== 200) {
    const e = new Error('EBAY_AUTH ' + (data.error_description || data.error || ('HTTP ' + res.getResponseCode())));
    e.grant = data.error;
    throw e;
  }
  return data;
}

function saveAccess(t) {
  const p = props();
  p.setProperty('EBAY_ACCESS_TOKEN', t.access_token);
  p.setProperty('EBAY_ACCESS_EXPIRES', String(Date.now() + (Number(t.expires_in) - 120) * 1000));
}

// eBay sends the browser back here (the RuName's accepted URL) after sign-in.
function ebayCallback(p) {
  try {
    if (p.error) return page('eBay not connected', 'Sign-in was cancelled. Go back to Re-Sell Assistant and tap Connect eBay to try again.');
    const props_ = props();
    if (!p.state || p.state !== props_.getProperty('EBAY_STATE')) return page('Sign-in link expired', 'Go back to Re-Sell Assistant and tap Connect eBay again.');
    props_.deleteProperty('EBAY_STATE');
    const t = ebayToken('grant_type=authorization_code&code=' + enc(p.code) + '&redirect_uri=' + enc(requireKeys().ruName));
    props_.setProperty('EBAY_REFRESH_TOKEN', t.refresh_token);
    props_.setProperty('EBAY_CONNECTED_AT', new Date().toISOString());
    saveAccess(t);
    return page('eBay connected ✓', 'You can close this page and go back to Re-Sell Assistant.');
  } catch (err) {
    return page('eBay not connected', String(err.message || err).replace(/^EBAY_\\w+ /, ''));
  }
}

function page(title, text) {
  const esc = function (s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); };
  return HtmlService.createHtmlOutput('<div style="font-family:-apple-system,Roboto,Arial,sans-serif;padding:24px;max-width:480px;margin:auto">' +
    '<h2 style="color:#0f766e">' + esc(title) + '</h2><p style="font-size:17px">' + esc(text) + '</p></div>')
    .setTitle(title).addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function ebayDisconnect() {
  ['EBAY_REFRESH_TOKEN', 'EBAY_ACCESS_TOKEN', 'EBAY_ACCESS_EXPIRES', 'EBAY_CONNECTED_AT', 'EBAY_STATE'].forEach(function (k) { props().deleteProperty(k); });
}

// A user token for the seller's account, refreshed when it expires (every 2 hours).
function ebayAccess() {
  const p = props();
  if (p.getProperty('EBAY_ACCESS_TOKEN') && Date.now() < Number(p.getProperty('EBAY_ACCESS_EXPIRES') || 0)) return p.getProperty('EBAY_ACCESS_TOKEN');
  const refresh = p.getProperty('EBAY_REFRESH_TOKEN');
  if (!refresh) throw new Error('EBAY_NOT_CONNECTED');
  try {
    const t = ebayToken('grant_type=refresh_token&refresh_token=' + enc(refresh) + '&scope=' + enc(EBAY_SCOPES));
    saveAccess(t);
    return t.access_token;
  } catch (err) {
    if (err.grant === 'invalid_grant') { ebayDisconnect(); throw new Error('EBAY_NOT_CONNECTED'); }
    throw err;
  }
}

function ebayErrorText(data, code) {
  const errs = (data && data.errors) || [];
  if (!errs.length) return 'eBay returned an error (HTTP ' + code + ').';
  return errs.map(function (x) {
    const params = (x.parameters || []).map(function (q) { return q.value; }).filter(String).join(', ');
    return (x.longMessage || x.message || 'Error ' + x.errorId) + (params && (x.longMessage || x.message || '').indexOf(params) < 0 ? ' (' + params + ')' : '');
  }).join(' ');
}

// One eBay REST call. allow404: return null instead of failing when nothing is found.
function ebayApi(method, path, body, allow404) {
  const opts = {
    method: method,
    headers: { Authorization: 'Bearer ' + ebayAccess(), 'Content-Language': 'en-US', 'Accept-Language': 'en-US', 'X-EBAY-C-MARKETPLACE-ID': EBAY_MARKET },
    muteHttpExceptions: true,
  };
  if (body !== undefined) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(body); }
  const res = UrlFetchApp.fetch(EBAY_API + path, opts);
  const code = res.getResponseCode();
  const data = safeJson(res.getContentText()) || {};
  if (code === 404 && allow404) return null;
  if (code >= 400) throw new Error('EBAY ' + ebayErrorText(data, code));
  return data;
}

function ebayPolicies() {
  const m = '?marketplace_id=' + EBAY_MARKET;
  const list = function (arr, idKey) { return (arr || []).map(function (x) { return { id: x[idKey], name: x.name }; }); };
  const locs = (ebayApi('get', '/sell/inventory/v1/location?limit=100', undefined, true) || {}).locations || [];
  return {
    fulfillment: list(ebayApi('get', '/sell/account/v1/fulfillment_policy' + m).fulfillmentPolicies, 'fulfillmentPolicyId'),
    payment: list(ebayApi('get', '/sell/account/v1/payment_policy' + m).paymentPolicies, 'paymentPolicyId'),
    returns: list(ebayApi('get', '/sell/account/v1/return_policy' + m).returnPolicies, 'returnPolicyId'),
    locations: locs.map(function (l) {
      const a = (l.location && l.location.address) || {};
      return { key: l.merchantLocationKey, name: l.name || l.merchantLocationKey, postalCode: a.postalCode || '' };
    }),
  };
}

// Category suggestions for a title, and the item specifics eBay requires for a category.
function ebayCategories(q, categoryId) {
  const out = {};
  const tree = '/commerce/taxonomy/v1/category_tree/0';
  if (q) {
    const r = ebayApi('get', tree + '/get_category_suggestions?q=' + enc(String(q).slice(0, 100)), undefined, true) || {};
    out.suggestions = (r.categorySuggestions || []).slice(0, 8).map(function (s) {
      const path = (s.categoryTreeNodeAncestors || []).map(function (a) { return a.categoryName; }).reverse();
      path.push(s.category.categoryName);
      return { id: s.category.categoryId, name: s.category.categoryName, path: path.join(' › ') };
    });
  }
  if (categoryId) {
    const r = ebayApi('get', tree + '/get_item_aspects_for_category?category_id=' + enc(categoryId), undefined, true) || {};
    out.aspects = (r.aspects || []).filter(function (a) { return a.aspectConstraint && a.aspectConstraint.aspectRequired; }).map(function (a) {
      return { name: a.localizedAspectName, mode: a.aspectConstraint.aspectMode, values: (a.aspectValues || []).slice(0, 40).map(function (v) { return v.localizedValue; }) };
    });
  }
  return out;
}

// Uploads a backed-up photo to eBay's picture hosting once and remembers its URL.
function ebayImageUrl(id) {
  if (!/^[\\w-]+$/.test(id)) throw new Error('bad photo id');
  const p = props();
  const cached = safeJson(p.getProperty('EBAY_IMG_' + id) || '');
  if (cached && Date.now() < cached.exp) return cached.url;
  const it = photoFolder().getFilesByName(id + '.jpg');
  if (!it.hasNext()) throw new Error('EBAY A photo is missing from Google Drive. Try posting again.');
  const res = UrlFetchApp.fetch('https://apim.ebay.com/commerce/media/v1_beta/image/create_image_from_file', {
    method: 'post',
    headers: { Authorization: 'Bearer ' + ebayAccess() },
    payload: { image: it.next().getBlob() },
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  let data = safeJson(res.getContentText()) || {};
  if (code >= 400) throw new Error('EBAY Photo upload failed: ' + ebayErrorText(data, code));
  if (!data.imageUrl) {
    const h = res.getAllHeaders();
    const loc = h.Location || h.location;
    if (loc) data = safeJson(UrlFetchApp.fetch(loc, { headers: { Authorization: 'Bearer ' + ebayAccess() }, muteHttpExceptions: true }).getContentText()) || {};
  }
  if (!data.imageUrl) throw new Error('EBAY Photo upload failed: eBay did not return a picture link.');
  p.setProperty('EBAY_IMG_' + id, JSON.stringify({ url: data.imageUrl, exp: Date.now() + 25 * 86400000 }));
  return data.imageUrl;
}

// Where items ship from: the chosen location, any existing one, or a new one from the ZIP code.
function ebayLocation(key, zip) {
  const locs = (ebayApi('get', '/sell/inventory/v1/location?limit=100', undefined, true) || {}).locations || [];
  const keys = locs.map(function (l) { return l.merchantLocationKey; });
  if (key && keys.indexOf(key) >= 0) return key;
  if (keys.length) return keys[0];
  zip = String(zip || '').trim();
  if (!/^\\d{5}(-\\d{4})?$/.test(zip)) throw new Error('EBAY Enter your ZIP code in Settings → eBay posting so eBay knows where the item ships from.');
  ebayApi('post', '/sell/inventory/v1/location/resell-home', { location: { address: { postalCode: zip, country: 'US' } }, locationTypes: ['WAREHOUSE'], name: 'Home', merchantLocationStatus: 'ENABLED' });
  return 'resell-home';
}

function ebayPost(b) {
  const sku = String(b.sku || '');
  if (!/^[\\w-]{1,50}$/.test(sku)) throw new Error('bad sku');
  const imageUrls = (b.photoIds || []).slice(0, 24).map(ebayImageUrl);
  if (!imageUrls.length) throw new Error('EBAY Add at least one photo.');
  const inv = b.inventoryItem;
  inv.product.imageUrls = imageUrls;
  ebayApi('put', '/sell/inventory/v1/inventory_item/' + enc(sku), inv);
  const offer = b.offer;
  offer.sku = sku;
  offer.marketplaceId = EBAY_MARKET;
  offer.merchantLocationKey = ebayLocation(b.locationKey, b.postalCode);
  const found = ebayApi('get', '/sell/inventory/v1/offer?sku=' + enc(sku) + '&marketplace_id=' + EBAY_MARKET, undefined, true);
  const existing = found && (found.offers || [])[0];
  let offerId, listingId;
  if (existing) {
    offerId = existing.offerId;
    ebayApi('put', '/sell/inventory/v1/offer/' + enc(offerId), offer);
    if (existing.status === 'PUBLISHED' && existing.listing && existing.listing.listingId) listingId = existing.listing.listingId;
  } else {
    offerId = ebayApi('post', '/sell/inventory/v1/offer', offer).offerId;
  }
  const updated = !!listingId;
  if (!listingId) listingId = ebayApi('post', '/sell/inventory/v1/offer/' + enc(offerId) + '/publish', {}).listingId;
  return { offerId: offerId, listingId: listingId, url: 'https://www.ebay.com/itm/' + listingId, updated: updated, photos: imageUrls.length };
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
`;
}
