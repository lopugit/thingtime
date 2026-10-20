// Full uploadFolderPart against the production Mac reader and real HTTP bytes.
// The disposable native fixture never accesses installed grants or credentials.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, mkdir, copyFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { isolatedAccountBackupProcess, verifyAccountBackupIsolation } from '../../remix/scripts/account-backup-isolation.mjs';
const root = resolve(import.meta.dirname, '..'), port = 28451;
const clean = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR || tmpdir() };
const require = createRequire(import.meta.url);
const { uploadFolderPart } = require('../lib/folder-upload.cjs');
const { FolderStream } = require('../lib/folder-stream.cjs');
if (!process.env.TT_NATIVE_UPLOAD_WORKER) {
    await verifyAccountBackupIsolation(port, clean);
    execFileSync('swift', ['build', '--package-path', resolve(root, '../macos/ThingtimeNode'), '--product', 'MacFolderSyncFixture'], { stdio: 'pipe' });
    const directory = await mkdtemp(join(tmpdir(), 'thingtime-native-upload-'));
    try {
        const binary = join(directory, 'MacFolderSyncFixture'), entitlements = join(directory, 'fixture.entitlements');
        await copyFile(resolve(root, '../macos/ThingtimeNode/.build/debug/MacFolderSyncFixture'), binary); await chmod(binary, 0o700);
        await writeFile(entitlements, '<?xml version="1.0"?><plist version="1.0"><dict><key>com.apple.security.files.bookmarks.app-scope</key><true/></dict></plist>');
        const identity = process.env.THINGTIME_TEST_SIGNING_IDENTITY || execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' }).match(/([A-F0-9]{40}) "Apple Development:/)?.[1];
        assert.ok(identity, 'Stable Apple Development fixture identity required');
        execFileSync('codesign', ['--force', '--sign', identity, '--timestamp=none', '--identifier', 'com.thingtime.tests.native-upload', '--entitlements', entitlements, binary], { stdio: 'pipe' });
        execFileSync('codesign', ['--verify', '--strict', binary], { stdio: 'pipe' });
        const child = isolatedAccountBackupProcess(process.execPath, [import.meta.filename],
            { cwd: root, env: { ...clean, TT_NATIVE_UPLOAD_WORKER: directory }, stdio: 'inherit' }, port, true);
        const timer = setTimeout(() => child.kill('SIGTERM'), 90_000);
        try { const [code] = await once(child, 'exit'); assert.equal(code, 0); }
        finally { clearTimeout(timer); }
    } finally { await rm(directory, { recursive: true, force: true }); }
} else {
    const directory = process.env.TT_NATIVE_UPLOAD_WORKER, origin = `http://127.0.0.1:${port}`;
    const owner = randomUUID(), device = randomUUID(), data = Buffer.from('real native upload source bytes');
    const selected = join(directory, 'selected'), source = join(selected, 'payload.bin');
    await mkdir(selected); await writeFile(source, data);
    let puts = 0;
    const server = createServer(async (request, response) => {
        response.setHeader('Content-Type', 'application/json');
        if (request.url === '/.well-known/thingtime-capabilities.json') {
            response.end(JSON.stringify({ schemaVersion: 1, origin, features: Object.fromEntries(Object.entries({
                'api.devices-pairing-claim': '1.0.0', 'api.devices-node-state': '1.9.0', 'api.devices-node-commands': '1.9.0',
                'api.devices-node-live-sync': '1.0.0', 'api.devices-node-identity': '1.0.0'
            }).map(([key, version]) => [key, { version }])) })); return;
        }
        if (request.url === '/api/v1/devices/node/identity') {
            assert.equal(request.headers.authorization, 'Bearer disposable-fixture-credential');
            response.end(JSON.stringify({ ok: true, ownerId: owner, deviceId: device })); return;
        }
        assert.equal(request.method, 'PUT'); assert.equal(request.url, '/fixture-part');
        assert.equal(request.headers.authorization, undefined); assert.equal(request.headers.cookie, undefined);
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        assert.deepEqual(Buffer.concat(chunks), data); puts++;
        response.end('{}');
    });
    server.listen(port, '127.0.0.1'); await once(server, 'listening');
    const config = join(directory, 'native.json');
    await writeFile(config, JSON.stringify({ base: origin, deviceId: device, credential: 'disposable-fixture-credential', directory: pathToFileURL(directory).href }), { mode: 0o600 });
    const child = spawn(join(directory, 'MacFolderSyncFixture'), [config]);
    child.stderr.resume();
    let pending;
    const exited = once(child, 'exit');
    exited.then(() => { pending?.reject(Error('Native fixture exited')); pending = undefined; });
    const watchdog = setTimeout(() => child.kill('SIGTERM'), 30_000);
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
        const current = pending;
        try {
            const value = JSON.parse(line);
            assert.ok(current);
            if (value.type === 'chunk') { current.stream.write(Buffer.from(line + '\n')); return; }
            pending = undefined;
            if (!value.ok) { current.reject(Error('Native fixture refused ' + current.request.action)); return; }
            if (current.stream) {
                current.stream.write(Buffer.from(JSON.stringify({ type: 'result', response: { id: current.request.requestId, ok: true, result: value.result } }) + '\n'));
                current.resolve(current.stream.finish().result);
            } else current.resolve(value.result);
        } catch (error) { current?.reject(error); pending = undefined; }
    });
    const send = request => new Promise((resolve, reject) => {
        assert.ok(!pending); pending = { request, resolve, reject,
            ...(request.action === 'read-range' ? { stream: new FolderStream({ id: request.requestId, method: 'folder-sync.request', parameters: request }) } : {}) };
        const encoded = Buffer.from(JSON.stringify(request)), header = Buffer.alloc(4);
        header.writeUInt32BE(encoded.length); child.stdin.write(Buffer.concat([header, encoded]));
    });
    const input = action => ({ requestId: randomUUID(), ownerId: owner, deviceId: device, origin, action });
    try {
        const rootId = (await send(input('choose'))).roots[0].id;
        const entry = (await send({ ...input('inspect'), rootId, path: 'payload.bin' })).entry;
        await assert.rejects(send({ ...input('read'), rootId, path: entry.path, version: entry.version, offset: 0, length: 0 }));
        const eof = await send({ ...input('read'), rootId, path: entry.path, version: entry.version, offset: entry.size, length: 1 });
        assert.equal(eof.chunk.data, ''); assert.equal(eof.chunk.offset, entry.size);
        console.log('NATIVE_READER_BOUNDARIES_PASS zero-length rejected; positive-length EOF accepted');
        const options = () => ({ input: { ...input('upload-part'), rootId, upload: { uploadId: 'fixture-upload', requestId: 'fixture-operation',
            source: entry, partNumber: 1, offset: 0, length: data.length } }, context: { ownerId: owner, apiOrigin: origin },
            signal: new AbortController().signal, authorize: async () => {}, requestNative: send,
            signPart: async body => ({ parts: [{ ...body.parts[0], url: origin + '/fixture-part', headers: { 'x-amz-checksum-sha256': body.parts[0].checksumSha256 } }] }),
            fetchUpload: globalThis.fetch });
        const receipt = await uploadFolderPart(options());
        assert.equal(receipt.uploadedPart.sha256, createHash('sha256').update(data).digest('hex')); assert.equal(puts, 1);
        for (const phase of ['before-put', 'after-put']) {
            await writeFile(source, data);
            const current = (await send({ ...input('inspect'), rootId, path: entry.path })).entry;
            const f = options(); f.input.upload.source = current;
            const mutate = () => writeFile(source, Buffer.concat([data, Buffer.from('changed')]));
            if (phase === 'before-put') {
                const sign = f.signPart; f.signPart = async body => { const result = await sign(body); await mutate(); return result; };
            } else {
                f.fetchUpload = async (...args) => { const response = await fetch(...args); await mutate(); return response; };
            }
            const before = puts; await assert.rejects(uploadFolderPart(f)); assert.equal(puts, before + (phase === 'after-put' ? 1 : 0));
        }
        console.log('NATIVE_UPLOAD_SOURCE_PROOF_PASS unchanged bytes/receipt; zero-length rejected; EOF revalidated; changed source fenced before and after PUT');
    } finally {
        child.stdin.end(); await exited; clearTimeout(watchdog); lines.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    }
}
