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
    const child = spawn(executable, [`--${action}`], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Password AutoFill connection timed out.')); }, 60000);
    child.once('error', () => { clearTimeout(timer); reject(new Error('Install the Thingtime Passwords native helper to enable AutoFill.')); });
    child.once('exit', code => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error('Could not connect Password AutoFill. Sign in and try again.')); });
    child.stdin.on('error', () => {}); child.stdin.end(value ? JSON.stringify(value) : '');
  });
}
function createPasswordProvider({ app, root, origin, endpoint, helper = runHelper }) {
  // One serial queue keeps logout/account switches ordered after pending connects.
  let queue = Promise.resolve();
  const executable = app.isPackaged ? path.join(process.resourcesPath, '..', 'Helpers', 'Thingtime Passwords.app', 'Contents', 'MacOS', 'Thingtime Passwords') : path.join(root, 'dist', 'native', 'Thingtime Passwords.app', 'Contents', 'MacOS', 'Thingtime Passwords');
  const enqueue = work => { const pending = queue.then(work, work); queue = pending.catch(() => {}); return pending; };
  const handle = async (event, input) => {
    const activeOrigin = new URL(origin()).origin;
    requirePasswordSender(event, activeOrigin, app.isPackaged);
    if (process.platform !== 'darwin' || !['connect', 'sync', 'disconnect'].includes(input?.action)) throw new Error('Unsupported Password AutoFill request.');
    const authority = new URL(endpoint()).origin;
    if (!authority.startsWith('https://')) throw new Error('System AutoFill requires an HTTPS account endpoint.');
    const work = async () => {
      requirePasswordSender(event, activeOrigin, app.isPackaged);
      if (new URL(origin()).origin !== activeOrigin || new URL(endpoint()).origin !== authority) throw new Error('Your Thingtime endpoint changed.');
      if (input.action === 'disconnect' || !input.ownerId) { await helper(executable, 'disconnect'); return { ok: true, message: 'Password AutoFill disconnected.' }; }
      if (typeof input.ownerId !== 'string' || input.ownerId.length > 200) throw new Error('Invalid account.');
      const cookies = await event.sender.session.cookies.get({ url: activeOrigin, name: 'tt_auth' });
      const matches = cookies.filter(cookie => cookie.httpOnly && (cookie.secure || activeOrigin.startsWith('http://127.0.0.1:') && app.isPackaged) && cookie.path === '/');
      if (matches.length !== 1) throw new Error('Sign in to Thingtime before connecting Password AutoFill.');
      await helper(executable, input.action, { origin: authority, ownerId: input.ownerId, cookie: `tt_auth=${matches[0].value}` });
      requirePasswordSender(event, activeOrigin, app.isPackaged);
      return { ok: true, message: 'Connected. Enable Thingtime in System Settings → General → AutoFill & Passwords.' };
    };
    return enqueue(work);
  };
  // Endpoint changes clear the OS vault before switching the app's authority.
  handle.disconnect = () => process.platform === 'darwin' ? enqueue(() => helper(executable, 'disconnect')) : Promise.resolve();
  return handle;
}
module.exports = { createPasswordProvider, requirePasswordSender };
