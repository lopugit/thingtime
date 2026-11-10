'use strict';
const http = require('node:http'), https = require('node:https');
const timeoutError = () => Object.assign(new Error('Sync network stalled.'), { name: 'TimeoutError', code: 'ETIMEDOUT' });
// Only actual socket/header/body waits enter this watchdog. Caller-controlled
// rate/CPU waits happen outside it, so valid slow transfers keep their identity.
function networkWait(promise, signal, close, milliseconds = 30000) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const finish = (error, value) => { clearTimeout(timer); signal.removeEventListener('abort', abort); error ? reject(error) : resolve(value); };
        const abort = () => { close(); finish(signal.reason); };
        const timer = setTimeout(() => { const error = timeoutError(); close(error); finish(error); }, milliseconds);
        signal.addEventListener('abort', abort, { once: true });
        promise.then(value => finish(null, value), error => finish(error));
        if (signal.aborted) abort();
    });
}
function open(target, method, headers, signal) {
    const url = new URL(target);
    if (url.username || url.password || !['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid sync target.');
    const request = (url.protocol === 'https:' ? https : http).request(url, { method, headers, ...(url.protocol === 'https:' ? { rejectUnauthorized: true } : {}) });
    let incoming;
    const response = new Promise((resolve, reject) => { request.once('response', value => { incoming = value; value.on('error', () => {}); resolve(value); }); request.once('error', reject); });
    const connected = new Promise((resolve, reject) => {
        request.once('error', reject);
        request.once('socket', socket => {
            if (!socket.connecting && !socket.secureConnecting) resolve();
            else socket.once(url.protocol === 'https:' ? 'secureConnect' : 'connect', resolve);
        });
    });
    response.catch(() => {}); connected.catch(() => {});
    const close = error => { incoming?.destroy(error); request.destroy(error); };
    const abort = () => close(signal.reason instanceof Error ? signal.reason : new Error('Cancelled sync request.'));
    signal.addEventListener('abort', abort, { once: true });
    const dispose = () => { signal.removeEventListener('abort', abort); close(); };
    if (signal.aborted) abort();
    return { request, response, connected, close, dispose };
}
async function get(target, headers, signal, idleMs = 30000) {
    const io = open(target, 'GET', headers, signal); io.request.end();
    try {
        await networkWait(io.connected, signal, io.close, idleMs);
        const response = await networkWait(io.response, signal, io.close, idleMs), iterator = response[Symbol.asyncIterator]();
        const cancel = async () => io.dispose();
        return { status: response.statusCode, redirected: response.statusCode >= 300 && response.statusCode <= 399,
            headers: { get: name => { const value = response.headers[name.toLowerCase()]; return value === undefined ? null : String(value); }, has: name => response.headers[name.toLowerCase()] !== undefined },
            body: { cancel, getReader: () => ({ read: () => networkWait(iterator.next(), signal, io.close, idleMs), cancel, releaseLock() {} }) } };
    } catch (error) { io.dispose(); throw error; }
}
async function put(target, headers, body, length, signal, stopBody, idleMs = 30000) {
    const io = open(target, 'PUT', { ...headers, 'Content-Length': String(length) }, signal);
    io.request.flushHeaders();
    let early;
    const rejected = io.response.then(response => response.statusCode >= 300 ? { response } : new Promise(() => {}));
    rejected.catch(() => {});
    try {
        await networkWait(io.connected, signal, io.close, idleMs);
        const iterator = body[Symbol.asyncIterator]();
        for (;;) {
            const item = await Promise.race([iterator.next().then(next => ({ next })), rejected]);
            if (item.response) { early = item.response; stopBody(); break; }
            if (item.next.done) break;
            await networkWait(new Promise((resolve, reject) => io.request.write(item.next.value, error => error ? reject(error) : resolve())), signal, io.close, idleMs);
        }
        if (!early) io.request.end();
        const response = early ?? await networkWait(io.response, signal, io.close, idleMs);
        return { status: response.statusCode, redirected: response.statusCode >= 300 && response.statusCode <= 399 };
    } finally { io.dispose(); }
}
module.exports = { get, put, networkWait };
