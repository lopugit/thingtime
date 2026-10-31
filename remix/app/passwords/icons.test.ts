import assert from 'node:assert/strict';
import test from 'node:test';
import { passwordIconUrl, passwordWebsiteIcon, validatePasswordIcon } from './icons';
import { emptyPasswordEntry, validatePasswordEntry } from './model';
import { createVaultDataKey, sealVaultValue, openVaultValue } from '../api/utils/auth/vaultEnvelope';
import { sealPasswordIcon, openPasswordIcon } from '../api/utils/passwords/icons';
import { fetchPasswordIcon } from './icons.client';
import { exportPasswords, import1Pux, visitPasswordFile } from './transfer';
import { exportOnePasswordItem } from './onePassword';
import { zipSync, strToU8 } from 'fflate';
import { settingsDocumentBlocks } from '../components/Settings/settingsDocument';
import { passwordIconBlocks } from '../components/Passwords/passwordIconBlocks';
const fileId = `att_${'a'.repeat(64)}`;
const maxBytes = 16 * 1024 * 1024;
test('icons require explicit HTTPS without credentials and favicon selects only the chosen origin', () => {
  // eslint-disable-next-line no-script-url -- executable schemes are refusal fixtures.
  for (const value of ['http://example.test/a.png', 'javascript:alert(1)', 'data:image/png;base64,AQ==', 'file:///x', '//example.test/x', 'https://owner:secret@example.test/x', 'https://example.test/\nimage', 'garbage']) assert.throws(() => passwordIconUrl(value));
  assert.equal(passwordIconUrl('https://Example.test/a.png?q=1#icon'), 'https://example.test/a.png?q=1#icon');
  assert.deepEqual(passwordWebsiteIcon('https://example.test/account?private=value#fragment'), { kind: 'url', url: 'https://example.test/favicon.ico' });
  assert.throws(() => validatePasswordIcon({ kind: 'attachment', fileId: 'other' }));
  assert.deepEqual(validatePasswordIcon({ kind: 'attachment', fileId }), { kind: 'attachment', fileId });
  assert.equal(validatePasswordEntry({ ...emptyPasswordEntry(), title: 'Legacy' }).icon, undefined);
  assert.throws(() => validatePasswordEntry({ ...emptyPasswordEntry(), title: 'Invalid', icon: { kind: 'url', url: 'http://bad.test' } }));
});
test('list icon envelope cannot open entry secrets or cross an owner, entry, key, or purpose boundary', () => {
  const key = createVaultDataKey(), icon = { kind: 'url' as const, url: 'https://example.test/icon.png' };
  const envelope = sealPasswordIcon('owner', key, 'entry', icon, maxBytes);
  assert.deepEqual(openPasswordIcon('owner', key, 'entry', envelope, maxBytes), icon);
  assert.throws(() => openVaultValue('owner', key, 'entry', 'secret', envelope));
  for (const [owner, id, otherKey] of [['other', 'entry', key], ['owner', 'other', key], ['owner', 'entry', createVaultDataKey()]] as const) assert.equal(openPasswordIcon(owner, otherKey, id, envelope, maxBytes), undefined);
  assert.equal(openPasswordIcon('owner', key, 'entry', sealVaultValue('owner', key, 'entry', 'secret', JSON.stringify(icon)), maxBytes), undefined);
  for (const malformed of [null, {}, { ...envelope, tag: '' }, sealVaultValue('owner', key, 'entry', 'password-icon', '{bad')]) assert.equal(openPasswordIcon('owner', key, 'entry', malformed, maxBytes), undefined);
  assert.equal(JSON.stringify(envelope).includes(icon.url), false);
});
test('chosen URL loads anonymously without referrers, redirects, or cached vault context', async t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    requests++; assert.equal(url, 'https://example.test/icon.png');
    assert.equal(init?.credentials, 'omit'); assert.equal(init?.referrerPolicy, 'no-referrer'); assert.equal(init?.redirect, 'error'); assert.equal(init?.cache, 'no-store'); assert.equal(init?.mode, 'cors');
    return new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } });
  });
  assert.equal((await fetchPasswordIcon('https://example.test/icon.png')).type, 'image/png');
  await assert.rejects(fetchPasswordIcon('https://user:secret@example.test/icon.png')); assert.equal(requests, 1);
  t.mock.method(globalThis, 'fetch', async () => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }));
  await assert.rejects(fetchPasswordIcon('https://example.test/icon.png'), /supported icon/);
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('CORS failure'); });
  await assert.rejects(fetchPasswordIcon('https://example.test/icon.png'), /CORS/);
});
test('icons round-trip through encrypted entry validation and 1PUX backup, with file source identity for restore', async () => {
  for (const icon of [{ kind: 'url' as const, url: 'https://example.test/icon.png' }, { kind: 'attachment' as const, fileId }]) {
    const entry = validatePasswordEntry({ ...emptyPasswordEntry(), title: 'Icon entry', icon });
    assert.deepEqual((await import1Pux(exportPasswords([entry], '1pux').bytes)).entries[0].icon, icon);
  }
  const item = exportOnePasswordItem({ ...emptyPasswordEntry(), title: 'Upload', icon: { kind: 'attachment', fileId } });
  item.details.thingtime.files = [{ id: fileId, path: 'files/icon.png', name: 'icon.png', size: 1, role: 'icon' }];
  const archive = new Blob([zipSync({ 'export.attributes': strToU8('{"version":3}'), 'export.data': strToU8(JSON.stringify({ accounts: [{ vaults: [{ items: [item] }] }] })), 'files/icon.png': new Uint8Array([1]) })]);
  let originalId: string | undefined;
  await visitPasswordFile(Object.assign(archive, { name: 'icon.1pux' }), { onEntry() {}, onFile(file) { if (file.path === 'files/icon.png') originalId = file.original?.id; } });
  assert.equal(originalId, fileId);
});
test('icon controls are individual reusable editable blocks with transient, unsaved private inputs', () => {
  const blocks = settingsDocumentBlocks(passwordIconBlocks);
  const serialized = JSON.stringify(blocks);
  for (const id of ['icon-upload', 'icon-url', 'icon-use-url', 'icon-website', 'icon-remove']) assert.ok(serialized.includes(`"id":"${id}"`));
  assert.equal(serialized.includes('https://'), false);
});
