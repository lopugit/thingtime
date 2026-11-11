import assert from 'node:assert/strict';
import test from 'node:test';
import { ComposerDraftAdmission, sharedMessageRequestId } from './composerInitialDraft';

test('repeated delivery preserves the live caption, including an intentionally cleared draft', () => {
  const draft = { id: 'share-1', text: 'https://example.com' };
  const admission = new ComposerDraftAdmission(draft);
  assert.equal(admission.text('https://example.com\nMy message', draft), 'https://example.com\nMy message');
  assert.equal(admission.text('', draft), '');
});

test('a later distinct delivery preserves existing text and is admitted once', () => {
  const admission = new ComposerDraftAdmission();
  const draft = { id: 'new-share', text: 'shared text' };
  const merged = admission.text('typed caption', draft);
  assert.equal(merged, 'typed caption\n\nshared text');
  assert.equal(admission.text(merged, { ...draft }), merged);
});

test('refused upload admission retains every arbitrary file for grant recovery without duplicates', () => {
  const files = [{ name: 'archive.zip', type: 'application/zip' }, { name: 'unknown.custom', type: '' }] as File[];
  const draft = { id: 'files', text: '', files };
  const admission = new ComposerDraftAdmission(draft);
  assert.equal(admission.files(draft, offered => { assert.equal(offered, files); return false; }), false);
  assert.equal(admission.files(draft, offered => { assert.equal(offered, files); return true; }), true);
  assert.equal(admission.files({ ...draft }, () => { throw new Error('duplicate upload'); }), true);
});

 test('shared sends reuse a bounded operation key across reloads and isolate destinations', async () => {
  const key = await sharedMessageRequestId('native-share-1', 'chat-a');
  assert.equal(await sharedMessageRequestId('native-share-1', 'chat-a'), key);
  assert.notEqual(await sharedMessageRequestId('native-share-1', 'chat-b'), key);
  assert.match(key, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
});
