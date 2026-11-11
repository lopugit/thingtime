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
const gate = () => {
    let release;
    const promise = new Promise(resolve => { release = resolve; });
    return { promise, release };
};
const eventuallyIdle = async renderer => {
    for (let i = 0; i < 100 && !renderer.isIdle(); i++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(renderer.isIdle(), true);
};

test('shutdown reserves HTTP admission, retains its owner, and permits ordinary retry after release', async t => {
    let calls = 0;
    const renderer = await start(t, await profile(t), async () => ({ middleware: (_request, response) => { calls++; response.end('owned'); } }));
    const held = renderer.reserveShutdown(); assert.ok(held);
    assert.equal(renderer.reserveShutdown(), null);
    const refused = await fetch(renderer.origin);
    assert.equal(refused.status, 503); assert.equal(refused.headers.get('retry-after'), '1'); await refused.text();
    assert.equal(calls, 0); assert.equal(held.isCurrent(), true);
    held.release(); assert.equal(held.isCurrent(), false);
    const next = renderer.reserveShutdown(); assert.ok(next);
    held.release(); assert.equal(next.isCurrent(), true);
    next.release(); assert.equal(await (await fetch(renderer.origin)).text(), 'owned'); assert.equal(calls, 1);
});

test('a streaming response remains busy after middleware returns', async t => {
    let finish;
    const renderer = await start(t, await profile(t), async () => ({ middleware: (_request, response) => {
        response.writeHead(200); response.write('first'); finish = () => response.end('last');
    } }));
    const response = await fetch(renderer.origin);
    assert.equal(renderer.reserveShutdown(), null);
    finish(); assert.equal(await response.text(), 'firstlast');
    await eventuallyIdle(renderer);
    assert.ok(renderer.reserveShutdown());
});

test('a completed response does not hide pending middleware cleanup', async t => {
    const entered = gate(), waiting = gate();
    const renderer = await start(t, await profile(t), async () => ({ middleware: async (_request, response) => {
        response.end('done'); entered.release(); await waiting.promise;
    } }));
    const response = await fetch(renderer.origin); await entered.promise;
    assert.equal(await response.text(), 'done');
    assert.equal(renderer.reserveShutdown(), null);
    waiting.release(); await eventuallyIdle(renderer);
    const held = renderer.reserveShutdown(); assert.ok(held);
    await renderer.close(); assert.equal(held.isCurrent(), false);
});

test('a client disconnect cannot release a handler still finishing durable work', async t => {
    const entered = gate(), waiting = gate();
    const renderer = await start(t, await profile(t), async () => ({ middleware: async (_request, response) => {
        response.writeHead(200); response.write('partial'); entered.release(); await waiting.promise; response.end();
    } }));
    const request = http.get(renderer.origin);
    request.on('error', () => {});
    await entered.promise;
    const disconnected = new Promise(resolve => request.once('close', resolve)); request.destroy(); await disconnected;
    assert.equal(renderer.reserveShutdown(), null);
    waiting.release(); await eventuallyIdle(renderer);
    assert.ok(renderer.reserveShutdown());
});

test('websocket lifetimes and upgrade admission are fenced without invoking the application', async t => {
    let calls = 0, peer;
    const renderer = await start(t, await profile(t), async () => ({ middleware: (_request, response) => response.end(),
        handleUpgrade: (_request, socket) => { calls++; peer = socket; socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: fixture\r\n\r\n'); } }));
    const connect = () => new Promise((resolve, reject) => {
        const request = http.get(renderer.origin, { headers: { Connection: 'Upgrade', Upgrade: 'fixture' } });
        request.on('error', reject); request.on('upgrade', (_response, socket) => resolve(socket));
        request.on('response', response => { response.resume(); resolve(response.statusCode); });
    });
    const socket = await connect(); t.after(() => socket.destroy());
    assert.equal(renderer.reserveShutdown(), null);
    const closed = new Promise(resolve => peer.once('close', resolve)); peer.destroy(); socket.destroy(); await closed;
    await eventuallyIdle(renderer);
    const held = renderer.reserveShutdown(); assert.ok(held);
    assert.equal(await connect(), 503); assert.equal(calls, 1);
    held.release();
});

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


test('an explicitly selected runtime or recovered legacy port wins without changing automatic-origin history', async t => {
    const directory = await profile(t);
    const previous = await start(t, directory);
    const history = await fs.readFile(path.join(directory, STATE_FILE), 'utf8');
    const selected = await start(t, await profile(t));
    const selectedPort = selected.server.address().port;
    await selected.close();
    const current = await startRendererServer({ profilePath: directory, selectedPort, loadApplication: application });
    t.after(current.close);
    assert.equal(current.server.address().port, selectedPort);
    assert.equal(await (await fetch(current.origin)).text(), 'owned');
    assert.equal(await fs.readFile(path.join(directory, STATE_FILE), 'utf8'), history);
    assert.notEqual(current.origin, previous.origin);
});

test('an occupied explicitly selected port fails before importing another runtime', async t => {
    const directory = await profile(t), occupied = await start(t, await profile(t));
    let loaded = false;
    await assert.rejects(startRendererServer({ profilePath: directory, selectedPort: occupied.server.address().port,
        loadApplication: async () => { loaded = true; return application(); } }), /in use/);
    assert.equal(loaded, false);
    await assert.rejects(fs.readFile(path.join(directory, STATE_FILE)), { code: 'ENOENT' });
});
