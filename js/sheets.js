// Google Sheets sync and Google Drive backups. The user deploys a small Apps Script
// (below) from their own spreadsheet as a web app. The app POSTs a snapshot of items
// and listings after every change (the script rewrites two tabs), and periodically a
// full backup: photos are uploaded once each into a Drive folder, then a small JSON
// file with everything else. No Google login or API keys live in the app — a shared
// secret (the "sync code") guards every request.

// Bump when the script gains features the app relies on.
export const SCRIPT_VERSION = 3;

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
    throw new SyncError(`Google error: ${data.error}`);
  }
  return data;
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

// The Apps Script the user pastes into their spreadsheet (Extensions → Apps Script).
export function scriptSource(secret) {
  return `// Resell Assistant → Google Sheets sync + Drive backups (script version ${SCRIPT_VERSION})
// Paste this into Extensions → Apps Script, then Deploy → New deployment → Web app
// (Execute as: Me, Who has access: Anyone). Keep the code below private.
const SYNC_CODE = '${secret}';
const BACKUP_FOLDER = 'Resell backups';
const KEEP_BACKUPS = 10;

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
    return reply({ ok: false, error: 'unknown action' });
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
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

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
`;
}
