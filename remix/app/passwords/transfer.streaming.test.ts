import assert from 'node:assert/strict';
import test from 'node:test';
import { zipSync, strToU8 } from 'fflate';
import { previewPasswordFile, visitPasswordFile, PasswordCsvParser, passwordImportErrorMessage } from './transfer';
import { backupFilePath, patchBackupFileReferences } from './backupReferences';
import { newPasswordFile } from './fileCrypto';
import { importOnePasswordItem, exportOnePasswordItem, ONE_PASSWORD_CATEGORIES } from './onePassword';
const archive = (items: unknown[], files: Record<string, Uint8Array> = {}) => new File([zipSync({ 'export.attributes': strToU8('{"version":3,"futureAttribute":[true,42]}'), 'export.data': strToU8(JSON.stringify({ futureRoot: { preserved: true }, accounts: [{ attrs: { uuid: 'account-a', futureAccount: 'data' }, vaults: [{ attrs: { name: 'Personal', futureVault: 'value' }, items }] }] })), ...files }, { level: 0 }) as BlobPart], 'full.1pux');
const item = { uuid: 'source-id', categoryUuid: '114', state: 'archived', favIndex: 5, createdAt: 100, updatedAt: 200, futureItem: { key: [0, false, ''] }, overview: { title: 'SSH key', subtitle: 'subtitle', tags: ['parent/child'], future: 'value', icons: [{ fileId: 'icon' }] }, details: { passwordHistory: [{ value: 'old', time: 100 }], documentAttributes: { documentId: 'document', fileName: 'file.bin', decryptedSize: 3 }, sections: [{ title: 'Keys', futureSection: true, fields: [{ id: 'key', title: 'Key', guarded: true, value: { sshKey: { privateKey: 'synthetic', metadata: { publicKey: 'public', keyType: 'ed25519' } } }, inputTraits: { keyboard: 'default' }, dontGenerate: true }, { title: 'Address', value: { address: { city: 'City', country: 'AU' } } }, { title: 'Future', value: { newType: [1, 2, { safe: 'preserve' }] } }] }] } };
test('all documented categories plus unknown categories and structured fields retain original data', () => {
  for (const categoryUuid of [...Object.keys(ONE_PASSWORD_CATEGORIES), 'future-category']) {
    const original = { ...item, categoryUuid }, entry = importOnePasswordItem(original), exported = exportOnePasswordItem(entry);
    assert.deepEqual(JSON.parse(entry.onePassword!), original);
    delete exported.details.thingtime; assert.deepEqual(exported, original);
  }
  const changed = importOnePasswordItem(item); changed.fields[1].value = '{"city":"Changed","country":"AU","future":true}';
  assert.equal(exportOnePasswordItem(changed).details.sections[0].fields[1].value.address.city, 'Changed');
  assert.equal(exportOnePasswordItem(changed).details.passwordHistory[0].value, 'old');
});
test('large archives preview every entry and preserve every member byte for byte without whole-file reads', async () => {
  const binary = new Uint8Array(21 * 1024 * 1024); binary.set([255, 0, 128]);
  const file = archive(Array.from({ length: 2005 }, (_, i) => ({ ...item, uuid: `id-${i}` })), { 'files/document___binary.bin': binary, 'future/member.bin': new Uint8Array([1, 2, 3]) });
  Object.defineProperty(file, 'arrayBuffer', { value: () => { throw new Error('Must use ranged reads'); } });
  const preview = await previewPasswordFile(file); assert.equal(preview.count, 2005); assert.equal(preview.entries.length, 50); assert.equal(preview.fileCount, 4);
  const members = new Map<string, Uint8Array>();
  await visitPasswordFile(file, { onEntry() {}, async onFile(file) { members.set(file.path, new Uint8Array(await new Response(file.open()).arrayBuffer())); } });
  assert.deepEqual(members.get('files/document___binary.bin'), binary); assert.deepEqual(members.get('future/member.bin'), new Uint8Array([1, 2, 3]));
  assert.equal(JSON.parse(new TextDecoder().decode(members.get('export.data'))).futureRoot.preserved, true);
});
test('CSV handles every character boundary and values beyond former field limits', () => {
  const rows: string[][] = [], value = '🦊'.repeat(17000) + '\r\n"quoted"';
  const parser = new PasswordCsvParser(row => rows.push(row));
  for (const char of `\uFEFFname,password\r\nName,"${value.replace(/"/g, '""')}"\r\n`) parser.write(char);
  parser.end(); assert.equal(rows[1][1], value);
});
test('stream callbacks are awaited and cancellation/errors remain safe and retryable', async () => {
  const file = archive([item, item]); const controller = new AbortController(); let visited = 0;
  await assert.rejects(visitPasswordFile(file, { signal: controller.signal, async onEntry() { await Promise.resolve(); visited++; controller.abort(); } }), { name: 'AbortError' }); assert.equal(visited, 1);
  const failure = new Error('known API failure'); await assert.rejects(visitPasswordFile(file, { onEntry() { throw failure; } }), error => error === failure);
  assert.ok(!passwordImportErrorMessage(new Error('secret-password')).includes('secret-password'));
});

test('edits, deletions, category changes and native login fields reach standard 1PUX data', () => {
  const entry = importOnePasswordItem(item);
  entry.fields = entry.fields.filter(field => field.label !== 'Address');
  entry.fields[0].label = 'Renamed SSH'; entry.passwordType = 'secure-note';
  const exported = exportOnePasswordItem(entry);
  assert.equal(exported.categoryUuid, '003');
  assert.deepEqual(exported.details.sections[0].fields.map((field: any) => field.title), ['Renamed SSH', 'Future']);
  assert.deepEqual(JSON.parse(exported.details.thingtime.entry.onePassword), item);
  const native = exportOnePasswordItem({ title: 'Native login', passwordType: 'login', fields: [{ id: 'username', label: 'User', type: 'text', value: 'synthetic' }, { id: 'password', label: 'Password', type: 'password', value: 'synthetic-password' }, { id: 'website', label: 'Website', type: 'url', value: 'https://example.test' }] });
  assert.equal(native.details.loginFields[1].designation, 'password'); assert.equal(native.overview.url, 'https://example.test');
});
test('document and icon references match exported filenames without changing preserved originals', () => {
  const entry = importOnePasswordItem(item), exported = exportOnePasswordItem(entry);
  const file = { id: 'att_123', metadata: { ...newPasswordFile('document___file.bin', 3), archivePath: 'files/document___file.bin' } };
  patchBackupFileReferences(exported, [file]);
  assert.equal(backupFilePath(file), 'files/att_123___file.bin');
  assert.equal(exported.details.documentAttributes.documentId, 'att_123');
  assert.equal(JSON.parse(exported.details.thingtime.entry.onePassword).details.documentAttributes.documentId, 'document');
});
test('null collection members remain in original data and duplicate restore ids fail preview', async () => {
  const original = { ...item, details: { loginFields: [null], sections: [null, { fields: [null] }] } };
  assert.deepEqual(JSON.parse(importOnePasswordItem(original).onePassword!), original);
  const native = exportOnePasswordItem(importOnePasswordItem(item)); native.details.thingtime.id = crypto.randomUUID();
  await assert.rejects(previewPasswordFile(archive([native, native])), /repeated backup entry ids/);
});

test('unfamiliar property names and absent values remain lossless without unsafe object paths', () => {
  const original = JSON.parse('{"categoryUuid":"future","overview":{"title":"Future"},"details":{"sections":[{"fields":[{"title":"Missing value"},{"title":"Unknown key","value":{"__proto__":{"keep":true}}}]}]}}');
  const entry = importOnePasswordItem(original), restored = exportOnePasswordItem(entry);
  delete restored.details.thingtime;
  assert.deepEqual(restored.details, original.details);
  assert.equal(({} as any).keep, undefined);
});
