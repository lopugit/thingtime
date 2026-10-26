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
    const child = spawn(executable, [`--${action}`, '--connection-status-v1'], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Password AutoFill connection timed out.')); }, 60000);
    child.once('error', () => { clearTimeout(timer); reject(new Error('Install the Thingtime Passwords native helper to enable AutoFill.')); });
    child.once('exit', code => {
      clearTimeout(timer);
      if (code === 20 && action !== 'disconnect') resolve('index-synchronized');
      else if (code === 21 && action !== 'disconnect') resolve('linked-index-pending');
      else if (code === 22 || code === 0 && action === 'disconnect') resolve('disconnected');
      // Old helper exit0 never proved indexing (or even linkage for --sync).
      else if (code === 0) resolve('unknown');
      else reject(new Error('Could not connect Password AutoFill. Sign in and try again.'));
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
    if (process.platform !== 'darwin' || !['connect', 'sync', 'disconnect'].includes(input?.action)) throw new Error('Unsupported Password AutoFill request.');
    const authority = new URL(endpoint()).origin;
    if (!authority.startsWith('https://')) throw new Error('System AutoFill requires an HTTPS account endpoint.');
    const work = async () => {
      if (retiring) throw new Error('Thingtime is restarting. Try again after restart.');
      requirePasswordSender(event, activeOrigin, app.isPackaged);
      if (new URL(origin()).origin !== activeOrigin || new URL(endpoint()).origin !== authority) throw new Error('Your Thingtime endpoint changed.');
      if (input.action === 'disconnect' || !input.ownerId) { await helper(executable, 'disconnect'); return { ok: true, state: 'disconnected', linked: false, indexSynchronized: false, message: 'Password AutoFill disconnected.' }; }
      if (typeof input.ownerId !== 'string' || input.ownerId.length > 200) throw new Error('Invalid account.');
      const cookies = await event.sender.session.cookies.get({ url: activeOrigin, name: 'tt_auth' });
      const matches = cookies.filter(cookie => cookie.httpOnly && (cookie.secure || activeOrigin.startsWith('http://127.0.0.1:') && app.isPackaged) && cookie.path === '/');
      if (matches.length !== 1) throw new Error('Sign in to Thingtime before connecting Password AutoFill.');
      const state = await helper(executable, input.action, { origin: authority, ownerId: input.ownerId, cookie: `tt_auth=${matches[0].value}` });
      try {
        requirePasswordSender(event, activeOrigin, app.isPackaged);
        if (retiring || new URL(origin()).origin !== activeOrigin || new URL(endpoint()).origin !== authority) throw new Error();
        const currentCookies = await event.sender.session.cookies.get({ url: activeOrigin, name: 'tt_auth' });
        const currentMatches = currentCookies.filter(cookie => cookie.httpOnly && (cookie.secure || activeOrigin.startsWith('http://127.0.0.1:') && app.isPackaged) && cookie.path === '/');
        if (currentMatches.length !== 1 || currentMatches[0].value !== matches[0].value) throw new Error();
        requirePasswordSender(event, activeOrigin, app.isPackaged);
        if (retiring || new URL(origin()).origin !== activeOrigin || new URL(endpoint()).origin !== authority) throw new Error();
      } catch {
        // This queue still owns the just-linked authority. A retiring transition
        // already queued disconnect; all other stale exits clear it before any new link.
        if (!retiring) await helper(executable, 'disconnect');
        throw new Error('Password AutoFill request was replaced. Retry Connect Password AutoFill.');
      }
      if (state === 'index-synchronized') return { ok: true, state, linked: true, indexSynchronized: true, message: 'Account linked and password suggestions synchronized. Enable Thingtime in AutoFill & Passwords settings.' };
      if (state === 'linked-index-pending') return { ok: true, state, linked: true, indexSynchronized: false, message: 'Account linked. Password suggestions are not synchronized. Enable Thingtime in AutoFill & Passwords settings, then retry Connect Password AutoFill.' };
      if (state === 'disconnected') return { ok: true, state, linked: false, indexSynchronized: false, message: 'Password AutoFill is not connected.' };
      return { ok: true, state: 'unknown', linked: null, indexSynchronized: null, message: 'Password AutoFill status could not be verified. Update Thingtime and retry Connect Password AutoFill.' };
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
