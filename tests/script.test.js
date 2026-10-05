// Runs the real Google Apps Script the app generates against in-memory fakes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scriptSource, buildTables, buildBackup, ITEM_HEADER, SCRIPT_VERSION } from '../js/sheets.js';
import { createFakeGoogle, loadScript } from './fake-apps-script.js';

const SECRET = 'code123';
const item = (id, photos = []) => ({
  id, createdAt: '2026-10-05T10:00:00Z', title: `Item ${id}`, category: 'other', condition: 'good', status: 'draft',
  draftTitle: `Title ${id}`, draftDesc: `Description for ${id}`, features: 'Feature A', photos, listings: [],
});

function setup() {
  const fake = createFakeGoogle();
  return { fake, script: loadScript(scriptSource(SECRET), fake) };
}

test('doGet reports version and sheet name', () => {
  const { script } = setup();
  const r = script.doGet();
  assert.equal(r.ok, true);
  assert.equal(r.version, SCRIPT_VERSION);
  assert.equal(r.sheet, 'Resell listings');
});

test('sync writes labelled tabs, puts Items first and removes the empty Sheet1', () => {
  const { fake, script } = setup();
  const r = script.doPost({ secret: SECRET, ...buildTables([item('a'), item('b')]) });
  assert.equal(r.ok, true);
  assert.deepEqual(fake.sheets.map((s) => s.name), ['Items', 'Listings']);
  const items = fake.ss.getSheetByName('Items');
  assert.deepEqual(items.values[0], ITEM_HEADER);
  assert.equal(items.values.length, 3);
  assert.equal(items.frozen, 1);
  assert.equal(items.headerStyle.background, '#0f766e');
  assert.equal(items.notes[0].length, ITEM_HEADER.length);
  assert.ok(items.notes[0].every(Boolean), 'every column has a description');
  const desc = items.values[1][ITEM_HEADER.indexOf('Listing description')];
  assert.equal(desc, 'Description for a');
});

test('wrong sync code is rejected for every action', () => {
  const { script } = setup();
  for (const action of [undefined, 'backup', 'list-backups', 'get-backup', 'photo-get']) {
    assert.equal(script.doPost({ secret: 'nope', action }).error, 'bad secret');
  }
});

test('backup → list → restore round trip, photos stored once', () => {
  const { fake, script } = setup();
  const photo = Buffer.from('fake-jpeg-bytes').toString('base64');
  const items = [item('a', ['p1', 'p2']), item('b', ['p2'])];

  assert.deepEqual(script.doPost({ secret: SECRET, action: 'photos-have' }).ids, []);
  for (const id of ['p1', 'p2']) assert.equal(script.doPost({ secret: SECRET, action: 'photo-put', id, data: photo }).ok, true);
  script.doPost({ secret: SECRET, action: 'photo-put', id: 'p1', data: photo }); // duplicate ignored
  assert.deepEqual(script.doPost({ secret: SECRET, action: 'photos-have' }).ids.sort(), ['p1', 'p2']);

  const saved = script.doPost({ secret: SECRET, action: 'backup', backup: buildBackup({ items, settings: { apiKey: 'sk-secret', sheetSecret: SECRET, location: 'Austin' } }) });
  assert.equal(saved.ok, true);
  const folder = fake.parent.folders.find((f) => f.name === 'Resell backups');
  assert.ok(folder, 'backup folder created next to the sheet');

  const list = script.doPost({ secret: SECRET, action: 'list-backups' }).backups;
  assert.equal(list.length, 1);
  assert.equal(list[0].items, 2);

  const back = script.doPost({ secret: SECRET, action: 'get-backup', id: list[0].id }).backup;
  assert.equal(back.items.length, 2);
  assert.equal(back.items[0].draftDesc, 'Description for a');
  assert.equal(back.settings.location, 'Austin');
  assert.equal(back.settings.apiKey, undefined, 'API key never stored');
  assert.equal(back.settings.sheetSecret, undefined, 'sync code never stored');
  assert.equal(script.doPost({ secret: SECRET, action: 'photo-get', id: 'p2' }).data, photo);
});

test('keeps the newest 10 backups and cleans up photos nothing uses', () => {
  const { fake, script } = setup();
  const photo = Buffer.from('x').toString('base64');
  script.doPost({ secret: SECRET, action: 'photo-put', id: 'old', data: photo });
  script.doPost({ secret: SECRET, action: 'backup', backup: buildBackup({ items: [item('a', ['old'])] }) });
  for (let i = 0; i < 11; i++) script.doPost({ secret: SECRET, action: 'backup', backup: buildBackup({ items: [item('a')] }) });
  const list = script.doPost({ secret: SECRET, action: 'list-backups' }).backups;
  assert.equal(list.length, 10);
  assert.deepEqual(script.doPost({ secret: SECRET, action: 'photos-have' }).ids, [], 'photo only used by a deleted backup was removed');
  const folder = fake.parent.folders.find((f) => f.name === 'Resell backups');
  assert.equal(folder.files.length, 10);
});

test('only files inside the backup folder can be read back', () => {
  const { fake, script } = setup();
  const other = fake.root.createFile('secret.json', '{"app":"resell-assistant"}', 'application/json');
  const r = script.doPost({ secret: SECRET, action: 'get-backup', id: other.getId() });
  assert.equal(r.ok, false);
  assert.match(r.error, /not found/);
});

test('rejects odd photo ids', () => {
  const { script } = setup();
  const r = script.doPost({ secret: SECRET, action: 'photo-put', id: '../evil', data: 'eA==' });
  assert.equal(r.ok, false);
});
