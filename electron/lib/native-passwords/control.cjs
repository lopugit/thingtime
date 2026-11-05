'use strict';
const net = require('node:net');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const { privateDirectory, privateWrite } = require('./store.cjs');
const { identity, PasswordBridgeError } = require('./contract.cjs');

const MAX_FRAME = 1024 * 1024;
const safeError = error => error instanceof PasswordBridgeError ? { code: error.code, message: error.message } : { code: 'UNAVAILABLE', message: 'The native password operation could not complete. No credential was returned.' };
async function startPasswordControl(broker, { socketDirectory = process.platform === 'win32' ? broker.directory : path.join('/tmp', `thingtime-passwords-${process.getuid()}-${identity(broker.userData)}`) } = {}) {
  await privateDirectory(broker.directory);
  await privateDirectory(socketDirectory);
  const nonce = randomBytes(16).toString('hex');
  const socket = process.platform === 'win32' ? `\\\\.\\pipe\\thingtime-passwords-${nonce}` : path.join(socketDirectory, `${nonce}.sock`);
  const token = randomBytes(32).toString('base64url');
  const descriptor = path.join(broker.directory, 'runtime.json');
  const connections = new Set();
  const server = net.createServer(client => {
    connections.add(client); client.once('close', () => connections.delete(client));
    client.on('error', () => {}); client.setTimeout(120000, () => client.destroy());
    let data = Buffer.alloc(0), handled = false;
    client.on('data', chunk => {
      if (handled) return;
      if (data.length + chunk.length > MAX_FRAME + 4) { client.destroy(); return; }
      data = Buffer.concat([data, chunk]);
      if (data.length < 4) return;
      const size = data.readUInt32LE(0);
      if (!size || size > MAX_FRAME || data.length > size + 4) { client.destroy(); return; }
      if (data.length < size + 4) return;
      handled = true;
      void (async () => {
        let request;
        try { request = JSON.parse(data.subarray(4).toString('utf8')); } catch { client.destroy(); return; }
        data.fill(0); data = Buffer.alloc(0);
        const supplied = Buffer.from(typeof request.token === 'string' ? request.token : '');
        const expected = Buffer.from(token);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { client.destroy(); return; }
        let response;
        try { response = { ok: true, result: await broker.request(request.request) }; }
        catch (error) { response = { ok: false, error: safeError(error) }; }
        const body = Buffer.from(JSON.stringify(response));
        if (body.length > MAX_FRAME) { client.destroy(); return; }
        const header = Buffer.alloc(4); header.writeUInt32LE(body.length);
        client.end(Buffer.concat([header, body]));
      })().catch(() => client.destroy());
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socket, resolve); });
  if (process.platform !== 'win32') await fs.chmod(socket, 0o600);
  try { await privateWrite(descriptor, JSON.stringify({ version: 1, origin: `thingtime-desktop://${identity(broker.userData)}`, socket, token })); }
  catch (error) { server.close(); if (process.platform !== 'win32') await fs.rm(socket, { force: true }); throw error; }
  let closing;
  return { descriptor, close() {
    if (!closing) closing = (async () => {
      for (const connection of connections) connection.destroy();
      await new Promise(resolve => server.close(resolve));
      await fs.rm(descriptor, { force: true });
      if (process.platform !== 'win32') await fs.rm(socket, { force: true });
      await broker.close();
    })();
    return closing;
  } };
}
module.exports = { startPasswordControl, MAX_FRAME, safeError };
