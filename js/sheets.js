// Google Sheets sync. The user deploys a tiny Apps Script (below) from their own
// spreadsheet as a web app; the app then POSTs a full snapshot of items and
// listings to it after every change, and the script rewrites the two tabs.
// No Google login or API keys live in the app — a shared secret guards writes.

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
  'Active listings', 'Platforms', 'First posted', 'Market check', 'Market typical sold', 'Added', 'Last updated',
];

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
      day(i.marketCheck?.at), num(i.marketCheck?.typicalSold) || '',
      day(i.createdAt), day(i.updatedAt || i.createdAt),
    ].map(cell));
    for (const l of ls) {
      listingRows.push([
        l.id, i.id, i.title || 'Untitled item', tierLabel, STATUS[i.status] || i.status,
        listingName(l), l.url, day(l.postedDate), day(l.refreshedAt), num(l.price), LISTING_STATUS[l.status] || l.status,
      ].map(cell));
    }
  }
  return {
    items: { header: ITEM_HEADER, rows: itemRows },
    listings: { header: LISTING_HEADER, rows: listingRows },
  };
}

export function isWebAppUrl(url) {
  return /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(String(url || '').trim());
}

export function newSecret() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export class SyncError extends Error {}

export async function pushToSheet(url, secret, items) {
  if (!isWebAppUrl(url)) throw new SyncError('That doesn\'t look like a Google Apps Script web app URL (it should end in /exec).');
  const body = JSON.stringify({ secret, ...buildTables(items) });
  let res;
  try {
    // text/plain keeps this a "simple" request, which Apps Script web apps accept from browsers.
    res = await fetch(url.trim(), { method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body, redirect: 'follow' });
  } catch {
    throw new SyncError('Could not reach Google. Check your connection, and that the script is deployed with access set to "Anyone".');
  }
  const data = await res.json().catch(() => null);
  if (!data) throw new SyncError('Google answered with something unexpected. Re-check the deployment steps (access must be "Anyone").');
  if (!data.ok) throw new SyncError(data.error === 'bad secret' ? 'The sync code in your Google script doesn\'t match this app. Copy the script again and redeploy.' : `Sheet error: ${data.error}`);
  return data;
}

// The Apps Script the user pastes into their spreadsheet (Extensions → Apps Script).
export function scriptSource(secret) {
  return `// Resell Assistant → Google Sheets sync
// Paste this into Extensions → Apps Script, then Deploy → New deployment → Web app
// (Execute as: Me, Who has access: Anyone). Keep the code below private.
const SYNC_CODE = '${secret}';

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.secret !== SYNC_CODE) return reply({ ok: false, error: 'bad secret' });
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    writeTab(ss, 'Items', body.items);
    writeTab(ss, 'Listings', body.listings);
    return reply({ ok: true, items: body.items.rows.length, listings: body.listings.rows.length, at: new Date().toISOString() });
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return reply({ ok: true, message: 'Resell Assistant sync is set up. Go back to the app and paste this page\\'s URL.' });
}

function writeTab(ss, name, table) {
  const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  const width = table.header.length;
  const values = [table.header].concat(table.rows);
  sheet.clearContents();
  sheet.getRange(1, 1, values.length, width).setValues(values);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, width).setFontWeight('bold');
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
`;
}
