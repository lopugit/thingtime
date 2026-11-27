'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID, createHash } = require('node:crypto');
const { DesktopFileExport, RANGE_BYTES, publishLink } = require('../lib/file-export.cjs');
const digest = value => createHash('sha256').update(value).digest();
async function fixture(t, sizeOrBytes = 17 * 1024 * 1024 + 17, parentDirectory = os.tmpdir()) {
    const root = await fs.mkdtemp(path.join(parentDirectory, 'tt-export-test-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const bytes = Buffer.isBuffer(sizeOrBytes) ? sizeOrBytes : Buffer.alloc(sizeOrBytes, 73), size = bytes.length, parts = [];
    for (let at = 0; at < size; at += 8388608) parts.push(digest(bytes.subarray(at, at + 8388608)));
    const content = { attachmentId: 'retained-file', version: 'a'.repeat(64), size,
        fingerprint: { algorithm: 'sha256-parts-v1', partSizeBytes: 8388608, partCount: parts.length, sha256: digest(Buffer.concat(parts)).toString('hex') } };
    const frame = { url: 'http://127.0.0.1:12555/files' }, sender = { mainFrame: frame, session: {} };
    const context = { enabled: true, window: { webContents: sender, isDestroyed: () => false }, appOrigin: 'http://127.0.0.1:12555', apiOrigin: 'https://saved.test' };
    const event = { sender, senderFrame: frame }, destination = path.join(root, 'Earlier.bin');
    const f = { root, content, bytes, context, event, destination, reads: [], checks: 0, account: 'owner', mode: 'valid', choose: async () => ({ filePath: destination, canceled: false }) };
    sender.session.fetch = async (target, init) => {
        const url = new URL(target);
        assert.equal(url.origin, context.appOrigin); assert.equal(url.pathname, '/api/v1/attachments/content');
        assert.equal(url.searchParams.get('version'), content.version); assert.equal(url.searchParams.get('id'), content.attachmentId);
        assert.equal(init.redirect, 'error'); assert.equal(init.bypassCustomProtocolHandlers, true); assert.equal(init.credentials, 'include');
        assert.equal(init.headers['X-Thingtime-Expected-Actor'], 'owner'); assert.equal(init.headers['X-Thingtime-Expected-Data-Plane'], 'home');
        assert.equal(init.headers['X-Thingtime-Expected-Api-Origin'], context.apiOrigin);
        const headers = { 'x-thingtime-api-fallback': f.mode === 'proxy' ? 'https://wrong.test' : context.apiOrigin };
        if (url.searchParams.has('fingerprint')) return Response.json({ ok: true, id: content.attachmentId, version: content.version, size, fingerprint: content.fingerprint }, { headers });
        const offset = Number(url.searchParams.get('offset')), length = Number(url.searchParams.get('length'));
        assert.ok(length <= RANGE_BYTES); f.reads.push({ offset, length });
        await f.onRange?.();
        if (f.mode === 'account') f.account = 'other';
        return new Response(f.mode === 'corrupt' ? Buffer.alloc(length, 72) : f.mode === 'oversize' ? Buffer.alloc(length + 1) : f.mode === 'short' ? Buffer.alloc(length - 1) : bytes.subarray(offset, offset + length), {
            status: f.mode === 'status' ? 200 : 206,
            headers: { ...headers, etag: `"${f.mode === 'version' ? 'b'.repeat(64) : content.version}"`, 'content-range': `bytes ${offset}-${offset + length - 1}/${size}` }
        });
    };
    f.host = new DesktopFileExport({ context: () => context, choose: (...args) => f.choose(...args),
        verifyAccount: async () => { f.checks++; await f.onCheck?.(); if (f.account !== 'owner') throw Error('wrong account'); },
        capabilities: async () => ({ features: { 'api.attachment-content': { version: '1.14.0' }, 'api.files': { version: '1.9.0' } } }) });
    f.input = (patch = {}) => ({ requestId: randomUUID(), ownerId: 'owner', origin: context.appOrigin, action: 'save', name: 'Earlier.bin', content, ...patch });
    return f;
}
test('retained export streams 17 MiB in bounded ranges and publishes verified private bytes', async t => {
    const f = await fixture(t), input = f.input();
    const result = await f.host.request(f.event, input);
    assert.deepEqual(result, { requestId: input.requestId, ownerId: 'owner', origin: f.context.appOrigin, attachmentId: f.content.attachmentId, version: f.content.version, size: f.content.size, saved: true });
    assert.equal(f.reads.length, 9); assert.ok(f.checks >= 22);
    assert.deepEqual(await fs.readFile(f.destination), f.bytes);
    const stat = await fs.stat(f.destination); assert.equal(stat.mode & 0o777, 0o600); assert.equal(stat.nlink, 1);
    assert.deepEqual(await fs.readdir(f.root), ['Earlier.bin']);
    assert.equal(JSON.stringify(result).includes(f.root), false);
});
test('rejects foreign frames, origins, invalid descriptors and renderer paths before picker', async t => {
    const f = await fixture(t, 123); let picked = 0; f.choose = async () => { picked++; return { canceled: true }; };
    for (const event of [{ ...f.event, sender: {} }, { ...f.event, senderFrame: { ...f.event.senderFrame } }]) await assert.rejects(f.host.request(event, f.input()));
    for (const patch of [{ origin: 'https://foreign.test' }, { requestId: 'bad' }, { name: '../file' }, { content: { ...f.content, size: -1 } }, { content: { ...f.content, attachmentId: undefined } }, { content: { ...f.content, fingerprint: { ...f.content.fingerprint, partCount: 5 } } }]) await assert.rejects(f.host.request(f.event, f.input(patch)));
    assert.equal(picked, 0); assert.equal(f.reads.length, 0);
});
test('picker cancellation creates no file; account or endpoint changes during picker prevent writes', async t => {
    const f = await fixture(t, 123);
    f.choose = async () => ({ canceled: true }); assert.equal((await f.host.request(f.event, f.input())).saved, false);
    for (const change of ['account', 'endpoint', 'generation']) {
        f.account = 'owner'; f.context.apiOrigin = 'https://saved.test';
        f.choose = async () => {
            if (change === 'account') f.account = 'other';
            if (change === 'endpoint') f.context.apiOrigin = 'https://other.test';
            if (change === 'generation') f.host.invalidate();
            return { filePath: f.destination };
        };
        await assert.rejects(f.host.request(f.event, f.input()), /Saving could not be verified/);
        assert.deepEqual(await fs.readdir(f.root), []);
    }
    assert.equal(f.reads.length, 0);
});
test('bad proxy, framing, content and account responses never publish or retain partial bytes', async t => {
    const f = await fixture(t, 123);
    for (f.mode of ['proxy', 'version', 'status', 'oversize', 'short', 'corrupt', 'account']) {
        f.account = 'owner';
        await assert.rejects(f.host.request(f.event, f.input()), /Saving could not be verified/);
        assert.deepEqual(await fs.readdir(f.root), []);
    }
});
test('existing names, symlinks and a file appearing during download are never overwritten', async t => {
    const f = await fixture(t, 123);
    await fs.writeFile(f.destination, 'existing');
    await assert.rejects(f.host.request(f.event, f.input())); assert.equal(await fs.readFile(f.destination, 'utf8'), 'existing');
    await fs.unlink(f.destination); await fs.symlink('absent', f.destination);
    await assert.rejects(f.host.request(f.event, f.input())); assert.equal(await fs.readlink(f.destination), 'absent');
    await fs.unlink(f.destination); f.onRange = () => fs.writeFile(f.destination, 'new user file');
    await assert.rejects(f.host.request(f.event, f.input())); assert.equal(await fs.readFile(f.destination, 'utf8'), 'new user file');
    assert.deepEqual(await fs.readdir(f.root), ['Earlier.bin']);
});
test('matching cancellation and lifecycle invalidation abort in-flight export; concurrent save refuses', async t => {
    const f = await fixture(t, 123);
    for (const invalidation of [false, true]) {
        const input = f.input(); let release, entered;
        const arrived = new Promise(resolve => { entered = resolve; });
        f.onRange = async () => { entered(); await new Promise(resolve => { release = resolve; }); };
        const pending = f.host.request(f.event, input), rejected = assert.rejects(pending);
        await arrived; await assert.rejects(f.host.request(f.event, f.input()), /Another file/);
        await f.host.request(f.event, { ...input, requestId: randomUUID(), action: 'cancel' });
        assert.equal(f.host.active.abort.signal.aborted, false);
        if (invalidation) f.host.invalidate(); else await f.host.request(f.event, { ...input, action: 'cancel' });
        release(); await rejected; assert.equal(f.host.active, null); assert.deepEqual(await fs.readdir(f.root), []);
    }
});
test('account change after publication reports uncertainty but preserves the completed file', async t => {
    const f = await fixture(t, 123);
    f.onCheck = async () => { try { await fs.stat(f.destination); f.account = 'other'; } catch {} };
    await assert.rejects(f.host.request(f.event, f.input()), /Check the selected folder/);
    assert.deepEqual(await fs.readFile(f.destination), f.bytes); assert.deepEqual(await fs.readdir(f.root), ['Earlier.bin']);
});
test('tagged export saves exact raw broken, absolute and non-UTF8 links without following targets', async t => {
    for (const bytes of [Buffer.from('../missing'), Buffer.from('/not-a-real-target'), Buffer.from([46, 47, 255, 254])]) {
        const f = await fixture(t, bytes), symbolicLink = { format: 'posix-symlink-v1', targetBase64: bytes.toString('base64') };
        const result = await f.host.request(f.event, f.input({ symbolicLink }));
        assert.equal(result.saved, true); assert.equal(result.representation, 'symbolic-link');
        assert.deepEqual(result.symbolicLink, symbolicLink);
        assert.equal((await fs.lstat(f.destination)).isSymbolicLink(), true);
        assert.deepEqual(await fs.readlink(f.destination, { encoding: 'buffer' }), bytes);
        assert.deepEqual(await fs.readdir(f.root), ['Earlier.bin']);
    }
});
test('link exports reject malformed metadata, mismatched verified bytes and an old API', async t => {
    const f = await fixture(t, Buffer.from('target')), good = { format: 'posix-symlink-v1', targetBase64: f.bytes.toString('base64') };
    for (const symbolicLink of [{ ...good, targetBase64: '!!!' }, { ...good, targetBase64: Buffer.from('bad\0xx').toString('base64') }, { ...good, targetBase64: Buffer.from('unsafe').toString('base64') }]) {
        await assert.rejects(f.host.request(f.event, f.input({ symbolicLink })));
        assert.deepEqual(await fs.readdir(f.root), []);
    }
    f.host.capabilities = async () => ({ features: { 'api.attachment-content': { version: '1.14.0' }, 'api.files': { version: '1.8.1' } } });
    let picked = false; f.choose = async () => { picked = true; return { canceled: true }; };
    await assert.rejects(f.host.request(f.event, f.input({ symbolicLink: good })));
    assert.equal(picked, false);
});

test('tagged child publication reauthorizes account and origin and honors cancellation before commit', async t => {
    for (const boundary of ['cancel', 'invalidate', 'account', 'origin', 'writer']) {
        const f = await fixture(t, Buffer.from('../target'));
        let entered, release;
        const ready = new Promise(resolve => { entered = resolve; });
        const gate = new Promise(resolve => { release = resolve; });
        f.host.linkPublisher = (parent, input, control) => publishLink(parent, input, { ...control, authorize: async () => {
            entered(); await gate; await control.authorize();
        } });
        const input = f.input({ symbolicLink: { format: 'posix-symlink-v1', targetBase64: f.bytes.toString('base64') } });
        const pending = f.host.request(f.event, input), rejected = assert.rejects(pending);
        await ready;
        if (boundary === 'cancel') await f.host.request(f.event, { ...input, action: 'cancel' });
        if (boundary === 'invalidate') f.host.invalidate();
        if (boundary === 'account') f.account = 'other';
        if (boundary === 'origin') f.context.apiOrigin = 'https://changed.test';
        if (boundary === 'writer') await fs.writeFile(f.destination, 'concurrent user bytes');
        release(); await rejected;
        assert.equal(f.host.active, null);
        if (boundary === 'writer') assert.equal(await fs.readFile(f.destination, 'utf8'), 'concurrent user bytes');
        else assert.deepEqual(await fs.readdir(f.root), []);
    }
});
test('full DesktopFileExport on actual FAT saves native links and non-UTF8 portable fallback', { skip: !process.env.THINGTIME_FILE_EXPORT_FAT_TEST_DIRECTORY }, async t => {
    for (const bytes of [Buffer.from('../missing'), Buffer.from([46, 47, 255, 254])]) {
        const f = await fixture(t, bytes, process.env.THINGTIME_FILE_EXPORT_FAT_TEST_DIRECTORY);
        const symbolicLink = { format: 'posix-symlink-v1', targetBase64: bytes.toString('base64') };
        const result = await f.host.request(f.event, f.input({ symbolicLink }));
        assert.equal(result.saved, true); assert.deepEqual(result.symbolicLink, symbolicLink);
        if (result.representation === 'symbolic-link') assert.deepEqual(await fs.readlink(f.destination, { encoding: 'buffer' }), bytes);
        else {
            assert.equal(result.representation, 'symbolic-link-fallback');
            const envelope = JSON.parse(await fs.readFile(f.destination, 'utf8'));
            assert.deepEqual(envelope.symbolicLink, symbolicLink); assert.deepEqual(envelope.tags, ['former-symbolic-link']);
        }
        assert.deepEqual(await fs.readdir(f.root), ['Earlier.bin']);
    }
});
