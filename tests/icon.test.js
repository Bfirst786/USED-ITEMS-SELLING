import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_NAME, DEFAULT_ICON, normalizeIcon, isDefaultIcon, iconLetters, buildManifest } from '../js/icon.js';

test('default name is Re-Sell Assistant', () => {
  assert.equal(APP_NAME, 'Re-Sell Assistant');
  assert.equal(normalizeIcon({}).name, 'Re-Sell Assistant');
  assert.equal(normalizeIcon({ name: '   ' }).name, 'Re-Sell Assistant');
});

test('normalizeIcon cleans bad values', () => {
  const n = normalizeIcon({ style: 'nope', bg: 'red', fg: '#ABCDEF', text: '  abcd ', name: 'My Shop' });
  assert.equal(n.style, 'tag');
  assert.equal(n.bg, DEFAULT_ICON.bg);
  assert.equal(n.fg, '#abcdef');
  assert.equal(n.text, 'abc');
  assert.equal(n.name, 'My Shop');
});

test('photo style needs a photo', () => {
  assert.equal(normalizeIcon({ style: 'photo' }).style, 'tag');
  assert.equal(normalizeIcon({ style: 'photo', photo: 'javascript:alert(1)' }).style, 'tag');
  assert.equal(normalizeIcon({ style: 'photo', photo: 'data:image/jpeg;base64,AAA' }).style, 'photo');
});

test('iconLetters counts emoji as one character', () => {
  assert.equal(iconLetters('💰💵🪙🤑'), '💰💵🪙');
  assert.equal(iconLetters(''), '');
});

test('isDefaultIcon', () => {
  assert.equal(isDefaultIcon({}), true);
  assert.equal(isDefaultIcon({ name: 'Other' }), true);
  assert.equal(isDefaultIcon({ bg: '#1d4ed8' }), false);
  assert.equal(isDefaultIcon({ style: 'emoji' }), false);
});

test('buildManifest uses absolute URLs and the custom name', () => {
  const m = buildManifest('https://x.github.io/app/index.html', {
    name: 'My Shop',
    icons: [{ src: 'data:image/png;base64,AA', sizes: '192x192', type: 'image/png' }, { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
  });
  assert.equal(m.name, 'My Shop');
  assert.equal(m.short_name, 'My Shop');
  assert.equal(m.start_url, 'https://x.github.io/app/');
  assert.equal(m.scope, 'https://x.github.io/app/');
  assert.equal(m.icons[0].src, 'data:image/png;base64,AA');
  assert.equal(m.icons[1].src, 'https://x.github.io/app/icons/icon-512.png');
});
