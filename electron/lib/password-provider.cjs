const path = require('node:path');
const { spawn } = require('node:child_process');
function requirePasswordSender(event, origin, bundled = false) {
  const trustedLoopback = bundled && /^http:\/\/127\.0\.0\.1:\d+$/.test(origin);
  if (!event?.senderFrame || event.senderFrame !== event.sender?.mainFrame || new URL(event.senderFrame.url).origin !== origin || (!origin.startsWith('https://') && !trustedLoopback)) {
    throw new Error('Password AutoFill requires the active HTTPS Thingtime page.');
  }
}
function runHelper(executable, action, value) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [`--${action}`], { stdio: ['pipe', action === 'status' ? 'pipe' : 'ignore', 'ignore'], windowsHide: true });
    let output = '', invalidOutput = false;
    if (action === 'status') child.stdout.on('data', chunk => {
      if (output.length + chunk.length > 4096) { invalidOutput = true; child.kill(); return; }
      output += chunk.toString('utf8');
    });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Password AutoFill connection timed out.')); }, 60000);
    child.once('error', () => { clearTimeout(timer); reject(new Error('Install the Thingtime Passwords native helper to enable AutoFill.')); });
    child.once('close', code => {
      clearTimeout(timer);
      if (code !== 0 || invalidOutput) return reject(new Error('Could not check or update Password AutoFill. Sign in and try again.'));
      if (action !== 'status') return resolve();
      try {
        const state = JSON.parse(output);
        if (!['connected', 'disconnected', 'differentSession', 'unavailable'].includes(state)) throw new Error();
        resolve(state);
      } catch { reject(new Error('Password AutoFill status is unavailable.')); }
    });
    child.stdin.on('error', () => {}); child.stdin.end(value ? JSON.stringify(value) : '');
  });
}
function createPasswordProvider({ app, root, origin, endpoint, helper = runHelper }) {
  // One serial queue keeps logout/account switches ordered after pending connects.
  let queue = Promise.resolve();
  let retiring = false;
  const executable = app.isPackaged ? path.join(process.resourcesPath, '..', 'Helpers', 'Thingtime Passwords.app', 'Contents', 'MacOS', 'Thingtime Passwords') : path.join(root, 'dist', 'native', 'Thingtime Passwords.app', 'Contents', 'MacOS', 'Thingtime Passwords');
  const enqueue = work => { const pending = queue.then(work, work); queue = pending.catch(() => {}); return pending; };
  const handle = async (event, input) => {
    if (retiring) throw new Error('Thingtime is restarting. Try again after restart.');
    const activeOrigin = new URL(origin()).origin;
    requirePasswordSender(event, activeOrigin, app.isPackaged);
    if (process.platform !== 'darwin' || !['connect', 'sync', 'disconnect', 'status'].includes(input?.action)) throw new Error('Unsupported Password AutoFill request.');
    const authority = new URL(endpoint()).origin;
    if (!authority.startsWith('https://')) throw new Error('System AutoFill requires an HTTPS account endpoint.');
    const work = async () => {
      if (retiring) throw new Error('Thingtime is restarting. Try again after restart.');
      requirePasswordSender(event, activeOrigin, app.isPackaged);
      if (new URL(origin()).origin !== activeOrigin || new URL(endpoint()).origin !== authority) throw new Error('Your Thingtime endpoint changed.');
      if (input.action === 'status' && !input.ownerId) return { ok: true, connection: 'unavailable' };
      if (input.action === 'disconnect' || !input.ownerId) { await helper(executable, 'disconnect'); return { ok: true, message: 'Password AutoFill disconnected.' }; }
      if (typeof input.ownerId !== 'string' || input.ownerId.length > 200) throw new Error('Invalid account.');
      const cookies = await event.sender.session.cookies.get({ url: activeOrigin, name: 'tt_auth' });
      const matches = cookies.filter(cookie => cookie.httpOnly && (cookie.secure || activeOrigin.startsWith('http://127.0.0.1:') && app.isPackaged) && cookie.path === '/');
      if (matches.length !== 1) {
        if (input.action === 'status') return { ok: true, connection: 'unavailable' };
        throw new Error('Sign in to Thingtime before connecting Password AutoFill.');
      }
      let result;
      try { result = await helper(executable, input.action, { origin: authority, ownerId: input.ownerId, cookie: `tt_auth=${matches[0].value}` }); }
      catch (error) { if (input.action !== 'status') throw error; result = 'unavailable'; }
      requirePasswordSender(event, activeOrigin, app.isPackaged);
      if (new URL(origin()).origin !== activeOrigin || new URL(endpoint()).origin !== authority) throw new Error('Your Thingtime endpoint changed.');
      if (input.action === 'status') return { ok: true, connection: ['connected', 'disconnected', 'differentSession', 'unavailable'].includes(result) ? result : 'unavailable' };
      return { ok: true, message: 'Connected. Enable Thingtime in System Settings → General → AutoFill & Passwords.' };
    };
    return enqueue(work);
  };
  // Endpoint changes clear the OS vault before switching the app's authority.
  handle.disconnect = () => {
    retiring = true;
    return process.platform === 'darwin' ? enqueue(() => helper(executable, 'disconnect')) : Promise.resolve();
  };
  return handle;
}
module.exports = { createPasswordProvider, requirePasswordSender };
