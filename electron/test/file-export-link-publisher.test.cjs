'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const helper = path.resolve(__dirname, '../lib/file-export-link-publisher.cjs');

async function fixture(t, parent = os.tmpdir()) {
    const base = await fs.mkdtemp(path.join(parent, 'tt-link-export-'));
    t.after(() => fs.rm(base, { recursive: true, force: true }));
    const root = path.join(base, 'selected'); await fs.mkdir(root);
    const s = await fs.lstat(root, { bigint: true });
    const input = { name: 'restored-link', parent: { dev: String(s.dev), ino: String(s.ino) }, symbolicLink: { format: 'posix-symlink-v1', targetBase64: Buffer.from('../absent').toString('base64') } };
    return { base, root, input };
}
async function run(root, input, errorCode, afterReady, mode) {
    const script = `const fs=require('node:fs/promises');const {publishLink}=require(${JSON.stringify(helper)}); process.once('message', async input => {try {
        const mode=${JSON.stringify(mode)}, code=${JSON.stringify(errorCode)};
        const operations={...fs};
        if(code) operations.symlink=async()=>{const e=Error();e.code=code;throw e;};
        if(mode==='replace-created')operations.symlink=async(target,name)=>{await fs.symlink(target,name);await fs.unlink(name);await fs.writeFile(name,'concurrent user bytes');};
        if(mode==='interrupt-final'){
            operations.filesystemType=async()=>'msdos';
            operations.openFinal=async(...args)=>{const file=await fs.open(...args);return{close:()=>file.close(),writeFile:async bytes=>{await file.write(bytes.subarray(0,17));throw Error('interrupted');}};};
        }
        const value=await publishLink(input,operations);process.send({ok:true,...value},()=>process.disconnect());
    } catch {process.send({ok:false},()=>process.disconnect());}}); process.send({ready:true});`;
    const child = spawn(process.execPath, ['-e', script], { cwd: root, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    const result = new Promise((resolve, reject) => {
        child.once('error', reject);
        child.on('message', async value => { if (value.ready) { try { await afterReady?.(); child.send(input); } catch (error) { child.kill(); reject(error); } } else resolve(value); });
        child.once('exit', code => { if (code) reject(Error('publisher exited')); });
    });
    try { return await result; } finally { if (child.connected) child.disconnect(); }
}
test('unsupported links save a private portable tagged file and retain raw target metadata', async t => {
    const f = await fixture(t), result = await run(f.root, f.input, 'ENOTSUP');
    assert.equal(result.representation, 'symbolic-link-fallback');
    const target = path.join(f.root, f.input.name), file = JSON.parse(await fs.readFile(target, 'utf8'));
    assert.equal(file.format, 'thingtime-symbolic-link-fallback-v1'); assert.equal(file.originalKind, 'symbolic-link');
    assert.deepEqual(file.symbolicLink, f.input.symbolicLink); assert.deepEqual(file.tags, ['former-symbolic-link']);
    assert.equal((await fs.stat(target)).mode & 0o777, 0o600);
});
test('permissions, space errors, changed parent and name collisions never use fallback or replace data', async t => {
    const f = await fixture(t);
    for (const code of ['EPERM', 'EACCES', 'ENOSPC', 'EDQUOT', 'EIO']) {
        assert.equal((await run(f.root, f.input, code)).ok, false); assert.deepEqual(await fs.readdir(f.root), []);
    }
    assert.equal((await run(f.root, { ...f.input, parent: { dev: '0', ino: '0' } })).ok, false);
    await fs.writeFile(path.join(f.root, f.input.name), 'user bytes');
    for (const code of [undefined, 'ENOTSUP']) assert.equal((await run(f.root, f.input, code)).ok, false);
    assert.equal(await fs.readFile(path.join(f.root, f.input.name), 'utf8'), 'user bytes');
});
test('publication stays in the pinned selected directory after an ancestor is renamed', async t => {
    const f = await fixture(t), moved = path.join(f.base, 'moved-selected');
    const result = await run(f.root, f.input, undefined, async () => { await fs.rename(f.root, moved); await fs.mkdir(f.root); });
    assert.equal(result.ok, true); assert.deepEqual(await fs.readdir(f.root), []);
    assert.equal((await fs.lstat(path.join(moved, f.input.name))).isSymbolicLink(), true);
});
test('actual mounted FAT preserves supported links and falls back for unrepresentable raw targets', { skip: !process.env.THINGTIME_FILE_EXPORT_FAT_TEST_DIRECTORY }, async t => {
    const f = await fixture(t, process.env.THINGTIME_FILE_EXPORT_FAT_TEST_DIRECTORY);
    assert.equal((await run(f.root, f.input)).representation, 'symbolic-link');
    const raw = { ...f.input, name: 'raw-link', symbolicLink: { format: 'posix-symlink-v1', targetBase64: Buffer.from([46, 47, 255, 254]).toString('base64') } };
    assert.equal((await run(f.root, raw)).representation, 'symbolic-link-fallback');
    const restored = JSON.parse(await fs.readFile(path.join(f.root, raw.name), 'utf8'));
    assert.deepEqual(restored.symbolicLink, raw.symbolicLink);
    assert.deepEqual(restored.tags, ['former-symbolic-link']);
});

test('a writer replacing a freshly created link is preserved on verification failure', async t => {
    const f = await fixture(t);
    assert.equal((await run(f.root, f.input, undefined, undefined, 'replace-created')).ok, false);
    assert.equal(await fs.readFile(path.join(f.root, f.input.name), 'utf8'), 'concurrent user bytes');
    assert.deepEqual(await fs.readdir(f.root), [f.input.name]);
});
test('interrupted exclusive fallback retains verified private recovery bytes and never retries the final name', async t => {
    const f = await fixture(t);
    assert.equal((await run(f.root, f.input, 'ENOTSUP', undefined, 'interrupt-final')).ok, false);
    const names = await fs.readdir(f.root), candidate = names.find(name => name.startsWith('.thingtime-link-candidate-'));
    assert.ok(candidate); assert.ok(names.includes(f.input.name));
    const envelope = JSON.parse(await fs.readFile(path.join(f.root, candidate), 'utf8'));
    assert.deepEqual(envelope.symbolicLink, f.input.symbolicLink);
    const prior = await fs.readFile(path.join(f.root, f.input.name));
    assert.equal((await run(f.root, f.input, 'ENOTSUP')).ok, false);
    assert.deepEqual(await fs.readFile(path.join(f.root, f.input.name)), prior);
});

test('publisher exits without publishing when its authority parent disconnects', async t => {
    const f = await fixture(t);
    const child = spawn(process.execPath, [helper], { cwd: f.root, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    const exited = new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
    const asked = new Promise((resolve, reject) => {
        child.on('message', value => { if (value.kind === 'authority') resolve(); });
        child.once('error', reject);
    });
    const timeout = setTimeout(() => child.kill(), 3000);
    t.after(() => { clearTimeout(timeout); if (child.exitCode === null) child.kill(); });
    child.send({ kind: 'publish', input: f.input });
    await asked; child.disconnect();
    assert.equal(await exited, 0);
    clearTimeout(timeout); assert.deepEqual(await fs.readdir(f.root), []);
});
