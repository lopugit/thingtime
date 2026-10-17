'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const test = require('node:test');
const { startRendererServer, STATE_FILE } = require('../lib/renderer-server.cjs');

async function profile(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'thingtime-renderer-server-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    return directory;
}
const application = async () => ({ middleware: (_request, response) => response.end('owned') });
const start = async (t, profilePath, loadApplication = application) => {
    const renderer = await startRendererServer({ profilePath, loadApplication });
    t.after(renderer.close);
    return renderer;
};

test('bind once, persist privately, and reuse the exact origin after server restart', async t => {
    const directory = await profile(t);
    const first = await start(t, directory);
    assert.equal(await (await fetch(first.origin)).text(), 'owned');
    const saved = await fs.readFile(path.join(directory, STATE_FILE), 'utf8');
    assert.equal((await fs.stat(path.join(directory, STATE_FILE))).mode & 0o777, 0o600);
    await first.close();
    const second = await start(t, directory);
    assert.equal(second.origin, first.origin);
    assert.equal(await fs.readFile(path.join(directory, STATE_FILE), 'utf8'), saved);
    assert.equal(await (await fetch(second.origin)).text(), 'owned');
});

test('occupied saved port never probes or loads another server, never rotates, and recovers after release', async t => {
    const directory = await profile(t);
    const first = await start(t, directory);
    const saved = await fs.readFile(path.join(directory, STATE_FILE), 'utf8');
    const port = first.server.address().port;
    await first.close();
    let requests = 0, loads = 0;
    const stranger = http.createServer((_request, response) => { requests++; response.end('untrusted'); });
    await new Promise(resolve => stranger.listen(port, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => stranger.close(resolve)));
    await assert.rejects(startRendererServer({ profilePath: directory, loadApplication: async () => { loads++; return application(); } }), /saved local address.*in use/);
    assert.equal(requests, 0); assert.equal(loads, 0);
    assert.equal(await fs.readFile(path.join(directory, STATE_FILE), 'utf8'), saved);
    await new Promise(resolve => stranger.close(resolve));
    const recovered = await start(t, directory);
    assert.equal(recovered.origin, first.origin);
});

for (const invalid of ['{', '{}', '{"schemaVersion":2,"port":52000}', '{"schemaVersion":1,"port":80}', '{"schemaVersion":1,"port":52000.5}', '{"schemaVersion":1,"port":65536}', '{"schemaVersion":1,"port":52000,"host":"evil"}', 'x'.repeat(257)]) {
    test(`invalid persisted origin is preserved and stops startup: ${invalid.slice(0, 64)}`, async t => {
        const directory = await profile(t), file = path.join(directory, STATE_FILE);
        await fs.writeFile(file, invalid);
        await assert.rejects(startRendererServer({ profilePath: directory, loadApplication: application }), /saved Desktop address could not be read/);
        assert.equal(await fs.readFile(file, 'utf8'), invalid);
    });
}

test('symlink origin records are rejected even when their target is absent', async t => {
    const directory = await profile(t), file = path.join(directory, STATE_FILE);
    await fs.symlink(path.join(directory, 'missing'), file);
    await assert.rejects(startRendererServer({ profilePath: directory, loadApplication: application }), /could not be read/);
    assert.ok((await fs.lstat(file)).isSymbolicLink());
});

test('bundle failure releases its socket and retains the selected origin for retry', async t => {
    const directory = await profile(t);
    await assert.rejects(startRendererServer({ profilePath: directory, loadApplication: async () => ({}) }), /node_middleware/);
    const saved = JSON.parse(await fs.readFile(path.join(directory, STATE_FILE), 'utf8'));
    const retry = await start(t, directory);
    assert.equal(retry.server.address().port, saved.port);
});

test('fresh profiles have independent origins and do not replace each other', async t => {
    const first = await start(t, await profile(t)), second = await start(t, await profile(t));
    assert.notEqual(first.origin, second.origin);
});

test('two first starts racing cannot overwrite the published address', async t => {
    const directory = await profile(t);
    const results = await Promise.allSettled([start(t, directory), start(t, directory)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const renderer = results.find(r => r.status === 'fulfilled').value;
    const saved = JSON.parse(await fs.readFile(path.join(directory, STATE_FILE), 'utf8'));
    assert.equal(saved.port, renderer.server.address().port);
});

test('non-file origin records fail without blocking or replacing the record', async t => {
    const directory = await profile(t), file = path.join(directory, STATE_FILE);
    await fs.mkdir(file);
    await assert.rejects(startRendererServer({ profilePath: directory, loadApplication: application }), /could not be read/);
    assert.ok((await fs.lstat(file)).isDirectory());
});

test('an unfinished bundle import cannot serve application content', async t => {
    const directory = await profile(t);
    let boundOrigin, release;
    const waiting = new Promise(resolve => { release = resolve; });
    let ready;
    const bound = new Promise(resolve => { ready = resolve; });
    const startup = start(t, directory, async ({ origin }) => { boundOrigin = origin; ready(); await waiting; return application(); });
    await bound;
    const response = await fetch(boundOrigin);
    assert.equal(response.status, 503); assert.equal(response.headers.get('cache-control'), 'no-store');
    release(); const renderer = await startup;
    assert.equal(await (await fetch(renderer.origin)).text(), 'owned');
});
