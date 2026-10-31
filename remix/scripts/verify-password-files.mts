import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { zipSync, strToU8 } from 'fflate';
import { newPasswordFile, encryptPasswordFile, decryptPasswordFile, iterableStream, passwordFileParts } from '../app/passwords/fileCrypto';
const base = process.argv[2];
if (!base || !['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Use a disposable localhost deployment.');
let checks = 0;
const check = (truth: unknown, label: string) => { assert.ok(truth, label); checks++; console.log(`✓ ${label}`); };
async function api(path: string, cookie?: string, body?: any) {
  const response = await fetch(`${base}/api/v1/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Origin: base, ...(cookie ? { Cookie: cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json(), cookie: /tt_auth=[^;]+/.exec(response.headers.get('set-cookie') || '')?.[0] };
}
const fixturePath = process.argv[3];
if (!fixturePath) throw new Error('Provide a local JSON array of three disposable username/password fixtures; configure the first username in ADMIN_USERNAMES after registering it through the API.');
const fixtures = JSON.parse(await readFile(fixturePath, 'utf8')), users: any[] = [];
for (const fixture of fixtures) {
  const login = await api('login', undefined, fixture);
  check(login.body.ok && login.cookie, 'sign in disposable file QA owner');
  users.push({ ...fixture, id: login.body.user.id, cookie: login.cookie });
}
const [admin, owner, other] = users;
check((await api('admin/users/public-uploads', admin.cookie, { userId: owner.id, scope: 'private', enabled: true })).body.ok, 'grant private upload permission through real admin API');
const call = async (body: any, user = owner) => api('passwords', user.cookie, { ...body, expectedOwnerId: user.id });
const entryId = randomUUID(), entry = { title: 'Encrypted attachment QA', passwordType: 'document', fields: [{ id: 'notes', label: 'Notes', type: 'notes', value: 'Synthetic files only.' }] };
check((await call({ operation: 'save', id: entryId, writeId: randomUUID(), revision: 0, entry })).body.ok, 'save file parent');
for (const size of [0, 9 * 1024 * 1024 + 7]) {
  const bytes = Uint8Array.from({ length: size }, (_, i) => i % 251), metadata = newPasswordFile(`synthetic-${size}.bin`, size);
  const start = await call({ operation: 'file-start', entryId, metadata });
  if (!start.body.ok) console.log({ status: start.status, error: start.body.error });
  check(start.body.ok, `start encrypted ${size}-byte file`); if (!start.body.ok) throw new Error(start.body.error);
  const { upload } = start.body, fileId = upload.id;
  check((await call({ operation: 'file-start', entryId, metadata })).body.upload.id === fileId, 'file start retry keeps exact identity');
  check((await call({ operation: 'file-start', entryId, metadata: { ...metadata, name: 'changed' } })).status === 409, 'changed upload metadata rejected');
  check((await call({ operation: 'file-parts', entryId, fileId, parts: [] }, other)).status === 404, 'another owner cannot authorize file parts');
  let partNumber = 0;
  for await (const partBytes of passwordFileParts(iterableStream(encryptPasswordFile(new Blob([bytes]).stream(), metadata)), upload.partSizeBytes)) {
    const parts = await call({ operation: 'file-parts', entryId, fileId, parts: [{ partNumber: ++partNumber, checksumSha256: createHash('sha256').update(partBytes).digest('base64') }] });
    assert.ok(parts.body.ok); const part = parts.body.parts[0];
    const put = await fetch(new URL(part.url, base), { method: 'PUT', headers: part.headers, body: partBytes as BodyInit }); assert.ok(put.ok, 'upload ciphertext part');
  }
  const complete = await call({ operation: 'file-complete', entryId, fileId });
  check(complete.body.ok, 'finalize and bind encrypted file'); if (!complete.body.ok) throw new Error(complete.body.error);
  check((await call({ operation: 'file-complete', entryId, fileId })).body.ok, 'completion retry is idempotent');
  check((await call({ operation: 'file-list', entryId }, other)).status === 404, 'another owner cannot list file metadata');
  const download = await call({ operation: 'file-download', entryId, fileId }); assert.ok(download.body.ok);
  const stored = await fetch(new URL(download.body.url, base)); const ciphertext = new Uint8Array(await stored.arrayBuffer());
  check(ciphertext.length > size && (size === 0 || !Buffer.from(ciphertext).equals(Buffer.from(bytes))), 'storage exposes ciphertext only');
  const plaintext = await new Response(iterableStream(decryptPasswordFile(new Blob([ciphertext]).stream(), download.body.metadata))).arrayBuffer();
  check(Buffer.from(plaintext).equals(Buffer.from(bytes)), 'download decrypts exact bytes');
  for (const [path, body] of [['attachments/uploads/parts', { uploadId: fileId, parts: [] }], ['attachments/uploads/complete', { uploadId: fileId }], ['attachments/delete', { id: fileId, targetId: entryId }]] as const) {
    const denied = await api(path, owner.cookie, body); check([403, 404].includes(denied.status), `ordinary ${path} cannot operate on vault file`);
  }
  const content = await fetch(`${base}/api/v1/attachments/content?id=${encodeURIComponent(fileId)}`, { headers: { Cookie: owner.cookie }, redirect: 'manual' }); check(content.status === 404, 'ordinary attachment content cannot disclose vault object');
  check((await call({ operation: 'file-delete', entryId, fileId })).body.ok, 'remove encrypted file through vault API');
  check((await call({ operation: 'file-download', entryId, fileId })).status === 404, 'deleted file unavailable');
}
const dir = '/tmp/thingtime-password-import-qa'; await mkdir(dir, { recursive: true });
await writeFile(`${dir}/browser-account.json`, JSON.stringify({ username: owner.username, password: owner.password }), { mode: 0o600 });
const fields = ['string', 'concealed', 'creditCardNumber', 'creditCardType', 'date', 'email', 'gender', 'menu', 'monthYear', 'phone', 'reference', 'url', 'totp', 'address', 'sshKey', 'futureField'].map((type, i) => ({ id: `field-${i}`, title: type, guarded: ['concealed', 'sshKey'].includes(type), value: { [type]: type === 'address' ? { street: 'Synthetic Street', city: 'Test City' } : type === 'email' ? { email_address: 'qa@example.test', provider: null } : type === 'sshKey' ? { privateKey: 'SYNTHETIC ONLY', metadata: { future: true } } : type === 'date' || type === 'monthYear' ? 0 : type === 'totp' ? 'otpauth://totp/QA?secret=GEZDGNBVGY3TQOJQ' : 'synthetic value' } }));
const data = { futureRoot: { all: 'preserved' }, accounts: [{ attrs: { accountName: 'Synthetic account', uuid: 'account' }, vaults: [{ attrs: { name: 'QA vault', uuid: 'vault' }, items: [{ uuid: 'item', categoryUuid: '114', favIndex: 1, state: 'archived', createdAt: 100, updatedAt: 200, overview: { title: 'Complete 1Password fixture', tags: ['QA/nested'], icons: [{ documentId: 'icon' }] }, details: { sections: [{ title: 'All field types', fields }], passwordHistory: [{ value: 'Synthetic old password', time: 100 }], documentAttributes: { documentId: 'document', fileName: 'example.bin', decryptedSize: 4 } } }] }] }] };
await writeFile(`${dir}/all-data.1pux`, zipSync({ 'export.attributes': strToU8('{"version":3,"unknown":true}'), 'export.data': strToU8(JSON.stringify(data)), 'files/document___example.bin': new Uint8Array([255, 0, 128, 42]), 'files/icon___custom.png': new Uint8Array([1, 2, 3]), 'unknown/extra.dat': new Uint8Array([9, 8]) }));
console.log(`${checks} encrypted file HTTP checks passed; synthetic browser fixture ready.`);
