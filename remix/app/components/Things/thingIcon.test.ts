import assert from 'node:assert/strict';
import test from 'node:test';

import { fileIconForThing, thingIcon } from './thingIcon';

const attachment = (crystal: Record<string, unknown>) => ({ thingtime: ['attachment'], crystal });

test('semantic screenshot names win over broad image metadata', () => {
  assert.equal(thingIcon(attachment({ name: 'Screenshot 2026-08-10 at 10.15.36 PM.png', type: 'image/png' })), '🖼️');
  assert.equal(thingIcon(attachment({ filename: 'Screen Shot 2026-08-10 at 10.15.36 PM.jpg', mimeType: 'image/jpeg' })), '🖼️');
  assert.equal(thingIcon(attachment({ name: 'screen_capture-login.webp', contentType: 'image/webp' })), '🖼️');
});

test('ordinary images and photos use the landscape icon', () => {
  assert.equal(thingIcon(attachment({ name: 'opengraph-image.png', type: 'image/png' })), '🏞️');
  assert.equal(thingIcon(attachment({ name: 'kirby wallpaper suyashabi.jpg' })), '🏞️');
  assert.equal(thingIcon({ thingtime: ['photo'], crystal: {} }), '🏞️');
});

test('the file icon registry differentiates useful file families', () => {
  const cases: Array<[string, string]> = [
    ['synergy-3.6.3-macos-arm64.dmg', '💿'],
    ['notes.pdf', '📕'],
    ['numbers.xlsx', '📊'],
    ['slides.key', '📽️'],
    ['source.tsx', '💻'],
    ['backup.tar.gz', '🗜️'],
    ['model.usdz', '🧊'],
    ['song.flac', '🎵'],
    ['clip.mov', '🎬']
  ];
  for (const [name, icon] of cases) assert.equal(fileIconForThing(attachment({ name })), icon, name);
});

test('unknown files and known non-file thing kinds avoid accidental generic spirals', () => {
  assert.equal(thingIcon(attachment({ name: 'mystery.blob' })), '💾');
  assert.equal(thingIcon({ thingtime: ['chat-message'], crystal: {} }), '🗨️');
  assert.equal(thingIcon({ thingtime: ['community'], crystal: {} }), '🏘️');
  assert.equal(thingIcon({ thingtime: ['future-unknown-kind'], crystal: {} }), '🌀');
});

test('authored folder icons remain authoritative', () => {
  assert.equal(thingIcon({ thingtime: ['folder'], crystal: { icon: '🌈' } }), '🌈');
});
