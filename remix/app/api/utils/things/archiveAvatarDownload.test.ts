import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import test from 'node:test';
import sharp from 'sharp';
import { downloadArchiveAvatar, isPublicArchiveAvatarAddress } from './archiveAvatarDownload';

test('avatar sockets admit public IPs only, including mapped, transition and reserved address fences', () => {
  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) assert.equal(isPublicArchiveAvatarAddress(address), true, address);
  for (const address of ['localhost', '10.0.0.1', '127.0.0.1', '169.254.169.254', '100.64.0.1',
    '192.168.1.1', '192.0.2.1', '198.18.0.1', '224.0.0.1', '240.0.0.1', '255.255.255.255',
    '::', '::1', '::ffff:127.0.0.1', '64:ff9b::a00:1', '2002:7f00:1::', '2001::1',
    '2001:db8::1', 'fc00::1', 'fe80::1', 'ff02::1']) assert.equal(isPublicArchiveAvatarAddress(address), false, address);
});

const fixture = (body: Buffer, statusCode = 200, extraHeaders = {}) => {
  let requests = 0;
  let lookups = 0;
  let response: Readable;
  const deps = {
    lookup: (async () => { lookups++; return [{ address: '8.8.8.8', family: 4 }]; }) as any,
    get: ((url: URL, options: any, callback: (response: any) => void) => {
      requests++;
      assert.equal(url.hostname, 'avatar.example');
      assert.equal(options.agent, false);
      assert.deepEqual(Object.keys(options.headers).sort(), ['Accept', 'Accept-Encoding']);
      options.lookup('avatar.example', { all: true }, (error: unknown, addresses: unknown) => {
        assert.equal(error, null); assert.deepEqual(addresses, [{ address: '8.8.8.8', family: 4 }]);
      });
      options.lookup('avatar.example', {}, (error: unknown, address: string, family: number) => {
        assert.equal(error, null); assert.equal(address, '8.8.8.8'); assert.equal(family, 4);
      });
      response = Object.assign(Readable.from([body]), { statusCode,
        headers: { 'content-type': 'image/png', 'content-length': String(body.length), ...extraHeaders } });
      queueMicrotask(() => callback(response));
      return new EventEmitter();
    }) as any
  };
  return { deps, counts: () => ({ requests, lookups }), destroyed: () => response?.destroyed };
};

test('downloads exact decodable bytes using pinned DNS and credential-free request options', async () => {
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#ff00ff' } }).png().toBuffer();
  const f = fixture(png);
  const result = await downloadArchiveAvatar('https://avatar.example/photo.png', undefined, f.deps);
  assert.deepEqual(result, { bytes: new Uint8Array(png), mime: 'image/png' });
  assert.deepEqual(f.counts(), { requests: 1, lookups: 1 });
  assert.equal(f.destroyed(), true);
});

test('rejects unsafe URLs and mixed public/private DNS before any connection', async () => {
  const f = fixture(Buffer.from('unused'));
  for (const url of ['http://avatar.example/a', 'https://user:password@avatar.example/a',
    'https://avatar.example:8443/a', 'https://avatar.example/a#fragment', 'https://127.0.0.1/a',
    'https://[::ffff:127.0.0.1]/a', 'https://metadata.google.internal/a']) {
    await assert.rejects(downloadArchiveAvatar(url, undefined, f.deps));
  }
  await assert.rejects(downloadArchiveAvatar('https://avatar.example/a', undefined, { ...f.deps,
    lookup: (async () => [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }]) as any }));
  assert.equal(f.counts().requests, 0);
});

test('redirects, encoded bodies, excessive lengths, size mismatches and non-images are refused', async () => {
  for (const [body, status, headers] of [
    [Buffer.from('redirect'), 302, { location: 'https://127.0.0.1/a' }],
    [Buffer.from('encoded'), 200, { 'content-encoding': 'gzip' }],
    [Buffer.from('small'), 200, { 'content-length': '2097153' }],
    [Buffer.from('small'), 200, { 'content-length': '2' }],
    [Buffer.from('<svg/>'), 200, { 'content-type': 'image/svg+xml' }],
    [Buffer.from('not a PNG'), 200, {}],
    [Buffer.alloc(2097153), 200, { 'content-length': undefined }]
  ] as const) {
    const f = fixture(body, status, headers);
    await assert.rejects(downloadArchiveAvatar('https://avatar.example/a', undefined, f.deps));
    assert.equal(f.counts().requests, 1);
    assert.equal(f.destroyed(), true);
  }
});

test('cancellation during DNS returns promptly and a late answer never opens a socket', async () => {
  const controller = new AbortController();
  const f = fixture(Buffer.from('unused'));
  let resolve!: (value: unknown) => void;
  const pending = downloadArchiveAvatar('https://avatar.example/a', controller.signal, { ...f.deps,
    lookup: (() => new Promise(done => { resolve = done; })) as any });
  await Promise.resolve();
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  resolve([{ address: '8.8.8.8', family: 4 }]);
  await new Promise(done => setImmediate(done));
  assert.equal(f.counts().requests, 0);
});

test('small compressed images cannot exceed the decoded pixel budget or hide truncated data', async () => {
  const large = await sharp({ create: { width: 2049, height: 2049, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const valid = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#ffffff' } }).png().toBuffer();
  for (const bytes of [large, valid.subarray(0, Math.floor(valid.length / 2))]) {
    assert.ok(bytes.length < 2097152);
    await assert.rejects(downloadArchiveAvatar('https://avatar.example/a', undefined, fixture(bytes).deps));
  }
});
