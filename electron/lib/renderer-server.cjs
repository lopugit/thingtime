'use strict';

const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const STATE_FILE = 'renderer-origin.json';
const STATE_LIMIT = 256;

async function readPort(file) {
    let handle, observed = false;
    try {
        const entry = await fs.lstat(file);
        observed = true;
        if (!entry.isFile()) throw new Error('Invalid origin record');
        handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        const stat = await handle.stat();
        if (!stat.isFile() || stat.ino !== entry.ino || stat.dev !== entry.dev || stat.size > STATE_LIMIT) throw new Error('Invalid origin record');
        const bytes = Buffer.alloc(STATE_LIMIT + 1);
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
        if (bytesRead > STATE_LIMIT) throw new Error('Oversized origin record');
        const record = JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'));
        if (record?.schemaVersion !== 1 || !Number.isInteger(record.port) || record.port < 1024 || record.port > 65535 ||
            Object.keys(record).sort().join(',') !== 'port,schemaVersion') throw new Error('Invalid origin record');
        return record.port;
    } catch (error) {
        if (error.code === 'ENOENT' && !observed) return null;
        throw new Error('The saved Desktop address could not be read. Keep renderer-origin.json and the profile intact for recovery; Desktop has not changed its address.', { cause: error });
    } finally {
        await handle?.close();
    }
}

async function syncDirectory(directory) {
    // Windows does not expose fsync for directory handles; file data is still
    // flushed before the exclusive link publishes the record.
    if (process.platform === 'win32') return;
    const handle = await fs.open(directory, constants.O_RDONLY);
    try { await handle.sync(); } finally { await handle.close(); }
}

async function savePort(file, port) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    let handle;
    try {
        handle = await fs.open(temporary, 'wx', 0o600);
        await handle.writeFile(`${JSON.stringify({ schemaVersion: 1, port })}\n`);
        await handle.sync();
        await handle.close(); handle = null;
        // Publish without overwriting another launch's record. The Electron
        // single-instance lock is the normal guard; a race still fails closed.
        await fs.link(temporary, file);
        await syncDirectory(path.dirname(file));
    } finally {
        await handle?.close();
        await fs.rm(temporary, { force: true });
    }
}

async function closeServer(server) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
}

/** Own the listening socket throughout startup; never probe an unknown server. */
async function startRendererServer({ profilePath, loadApplication, selectedPort }) {
    if (selectedPort !== undefined && (!Number.isInteger(selectedPort) || selectedPort < 1024 || selectedPort > 65535)) {
        throw new Error('Invalid selected Desktop port');
    }
    await fs.mkdir(profilePath, { recursive: true, mode: 0o700 });
    const stateFile = path.join(profilePath, STATE_FILE);
    // An explicitly selected local API or recovered legacy origin owns its exact
    // address. Keep the older automatic-origin record untouched for recovery.
    const savedPort = selectedPort ?? await readPort(stateFile);
    let middleware;
    const server = http.createServer((request, response) => {
        if (!middleware) {
            response.writeHead(503, { 'Cache-Control': 'no-store' }); response.end(); return;
        }
        Promise.resolve().then(() => middleware(request, response)).catch(() => {
            if (!response.headersSent) response.writeHead(500, { 'Cache-Control': 'no-store' });
            response.end();
        });
    });
    try {
        await new Promise((resolve, reject) => {
            const onError = error => { server.removeListener('listening', onListen); reject(error); };
            const onListen = () => { server.removeListener('error', onError); resolve(); };
            server.once('error', onError); server.once('listening', onListen);
            server.listen({ host: '127.0.0.1', port: savedPort ?? 0, exclusive: true });
        });
        const port = server.address().port;
        if (selectedPort === undefined && savedPort === null) await savePort(stateFile, port);
        const origin = `http://127.0.0.1:${port}`;
        const application = await loadApplication({ port, origin });
        if (typeof application.middleware !== 'function') {
            throw new Error('The bundled web server is incompatible. Rebuild Desktop with the node_middleware Nitro preset.');
        }
        middleware = application.middleware;
        if (typeof application.handleUpgrade === 'function') server.on('upgrade', application.handleUpgrade);
        return { origin, server, close: () => closeServer(server) };
    } catch (error) {
        await closeServer(server);
        if (error.code === 'EADDRINUSE') {
            throw new Error(`Desktop's saved local address (127.0.0.1:${savedPort}) is in use. Close the application using that port and reopen Thingtime. Your saved data and address have been preserved.`, { cause: error });
        }
        throw error;
    }
}

module.exports = { startRendererServer, STATE_FILE };
