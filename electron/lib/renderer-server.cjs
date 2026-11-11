'use strict';

const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const STATE_FILE = 'renderer-origin.json';
const STATE_LIMIT = 256;

// Fixed diagnostic labels only. These startup routes are registered in Nitro's
// root-data route / api import map and apiDocs, and used by routes.tsx/useApi.
// Unknown paths (including identifiers and queries) are never retained.
const HTTP_ACTIVITY_ROUTES = Object.freeze({
    '/api/root-data': 'root-data',
    '/.well-known/thingtime-capabilities.json': 'discovery',
    '/api/v1/auth/me': 'auth-me',
    '/api/v1/auth/accounts': 'auth-accounts',
    '/api/v1/users/profile': 'profile',
    '/api/v1/settings/lopu-prompt': 'settings-prompt',
    '/api/v1/settings/lopu-chat-defaults': 'settings-chat',
    '/api/v1/settings/lopu-access': 'settings-access',
    '/api/v1/themes': 'themes',
    '/api/v1/themes/active': 'themes',
    '/api/v1/releases/native-web': 'release-catalogue',
    '/api/v1/releases/native-web/content': 'release-content'
});
const HTTP_ACTIVITY_CLASSES = Object.freeze([...new Set(Object.values(HTTP_ACTIVITY_ROUTES)), 'document', 'asset', 'other']);
const HTTP_ACTIVITY_FIELDS = Object.freeze(['requests', 'middlewarePending', 'responsePending', 'oldestAgeMs']);
function httpActivityClass(request) {
    try {
        const { pathname } = new URL(request.url, 'http://localhost');
        if (Object.hasOwn(HTTP_ACTIVITY_ROUTES, pathname)) return HTTP_ACTIVITY_ROUTES[pathname];
        if (pathname === '/' || pathname === '/index.html') return 'document';
        if (pathname.startsWith('/assets/')) return 'asset';
    } catch { /* Malformed/unknown request is still admitted and tracked. */ }
    return 'other';
}
function projectHttpActivity(value) {
    if (value?.format !== 1) throw Error('Invalid HTTP activity observation');
    const result = { format: 1 };
    for (const key of ['requests', 'upgradedSockets', 'upgradeHandlers']) {
        if (!Number.isSafeInteger(value[key]) || value[key] < 0) throw Error('Invalid HTTP activity count');
        result[key] = value[key];
    }
    result.classes = {};
    for (const name of HTTP_ACTIVITY_CLASSES) {
        const row = {};
        for (const field of HTTP_ACTIVITY_FIELDS) {
            const count = value.classes?.[name]?.[field];
            if (!Number.isSafeInteger(count) || count < 0) throw Error('Invalid HTTP activity class');
            row[field] = count;
        }
        result.classes[name] = Object.freeze(row);
    }
    Object.freeze(result.classes);
    return Object.freeze(result);
}

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
    let middleware, reservation = null, closed = false, active = 0;
    const upgradedSockets = new Set(), requests = new Set();
    let upgradeHandlers = 0;
    const isIdle = () => !closed && active === 0 && upgradedSockets.size === 0;
    const unavailable = response => {
        response.writeHead(503, { 'Cache-Control': 'no-store', 'Retry-After': '1' }); response.end();
    };
    const server = http.createServer((request, response) => {
        if (!middleware || reservation || closed) { unavailable(response); return; }
        // Middleware may return before a streamed response ends, or finish
        // durable cleanup after the client disconnects. Wait for both halves.
        active++;
        const activity = { kind: httpActivityClass(request), startedAt: Date.now(), middlewarePending: true, responsePending: true };
        requests.add(activity);
        let settled = false, ended = false, released = false;
        const release = () => { if (settled && ended && !released) { released = true; active--; requests.delete(activity); } };
        const onEnd = () => {
            ended = true; activity.responsePending = false; response.removeListener('finish', onEnd); response.removeListener('close', onEnd); release();
        };
        response.once('finish', onEnd); response.once('close', onEnd);
        Promise.resolve().then(() => middleware(request, response)).catch(() => {
            if (!response.headersSent) response.writeHead(500, { 'Cache-Control': 'no-store' });
            response.end();
        }).finally(() => { settled = true; activity.middlewarePending = false; release(); });
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
        if (typeof application.handleUpgrade === 'function') server.on('upgrade', (request, socket, head) => {
            if (reservation || closed) { socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nRetry-After: 1\r\n\r\n'); return; }
            active++; upgradeHandlers++; upgradedSockets.add(socket);
            socket.once('close', () => upgradedSockets.delete(socket));
            Promise.resolve().then(() => application.handleUpgrade(request, socket, head))
                .catch(() => socket.destroy()).finally(() => { active--; upgradeHandlers--; });
        });
        const snapshotActivity = () => {
            const classes = Object.fromEntries(HTTP_ACTIVITY_CLASSES.map(name => [name,
                { requests: 0, middlewarePending: 0, responsePending: 0, oldestAgeMs: 0 }]));
            const now = Date.now();
            for (const activity of requests) {
                const row = classes[activity.kind]; row.requests++;
                if (activity.middlewarePending) row.middlewarePending++;
                if (activity.responsePending) row.responsePending++;
                row.oldestAgeMs = Math.max(row.oldestAgeMs, Math.max(0, now - activity.startedAt));
            }
            return projectHttpActivity({ format: 1, requests: requests.size, upgradedSockets: upgradedSockets.size, upgradeHandlers, classes });
        };
        return { origin, server, isIdle, snapshotActivity,
            reserveShutdown: () => {
                if (reservation || !isIdle()) return null;
                const own = reservation = {};
                return { isCurrent: () => reservation === own && isIdle(),
                    release: () => { if (reservation === own) reservation = null; } };
            },
            close: () => {
                closed = true;
                for (const socket of upgradedSockets) socket.destroy();
                return closeServer(server);
            }
        };
    } catch (error) {
        await closeServer(server);
        if (error.code === 'EADDRINUSE') {
            throw new Error(`Desktop's saved local address (127.0.0.1:${savedPort}) is in use. Close the application using that port and reopen Thingtime. Your saved data and address have been preserved.`, { cause: error });
        }
        throw error;
    }
}

module.exports = { startRendererServer, STATE_FILE, HTTP_ACTIVITY_CLASSES, httpActivityClass, projectHttpActivity };
