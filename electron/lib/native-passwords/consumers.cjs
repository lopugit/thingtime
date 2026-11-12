'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { BrowserDriver } = require('../agent-browsers/runtime/browser-driver.cjs');
const { fail, PasswordBridgeError } = require('./contract.cjs');
const { privateDirectory } = require('./store.cjs');

async function browserExecutable(platform = process.platform) {
  // Ubuntu's installed Google Chrome has a vendor sandbox path. Prefer it to
  // developer Chromium builds which may be unable to use restricted userns.
  const candidates = platform === 'linux' ? ['/usr/bin/google-chrome', '/opt/google/chrome/chrome', '/usr/bin/chromium', '/snap/bin/chromium', '/usr/bin/chromium-browser'] : platform === 'win32' ? [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft/Edge/Application/msedge.exe'),
  ] : [];
  for (const candidate of candidates) {
    try {
      const real = await fs.realpath(candidate), stat = await fs.stat(real);
      if (stat.isFile() && (platform === 'win32' || stat.uid === 0 && !(stat.mode & 0o022))) {
        // Snap dispatches by the invoked alias. Resolving this link for launch
        // would run plain snapd, not Chromium. Its target is still verified.
        if (candidate === '/snap/bin/chromium') {
          if (!['/usr/bin/snap', '/usr/lib/snapd/snapd'].includes(real)) continue;
          const parent = await fs.stat('/snap/bin'), alias = await fs.lstat(candidate);
          if (parent.uid !== 0 || parent.mode & 0o022 || alias.uid !== 0) continue;
          return candidate;
        }
        return real;
      }
    } catch { /* Try the next supported installation, never a PATH command. */ }
  }
  fail('BROWSER_UNAVAILABLE', 'Install Chromium or Google Chrome on Linux, or Chrome or Edge on Windows.');
}
function browserProfileRoot(directory, executable, id, home = os.userInfo().homedir) {
  // Snap confinement permits its own common directory, not another app's
  // hidden profile. Only this unique child is used and removed on release.
  return path.join(executable === '/snap/bin/chromium' ? path.join(home, 'snap/chromium/common/thingtime-native-passwords') : directory, id);
}
class PasswordBrowser {
  constructor({ directory, executable = browserExecutable, driver = new BrowserDriver(), headless = false }) {
    this.id = randomUUID(); this.directory = directory; this.root = path.join(directory, this.id); this.driver = driver; this.executable = executable; this.headless = headless;
  }
  async open(target, url) {
    const parsed = new URL(url || `${target.origin}/`);
    if (parsed.origin !== target.origin || parsed.username || parsed.password) fail('TARGET_CHANGED', 'The browser URL must belong to the authorized website.');
    const executable = await this.executable();
    this.root = browserProfileRoot(this.directory, executable, this.id);
    if (executable === '/snap/bin/chromium') await privateDirectory(path.dirname(this.root));
    await privateDirectory(this.root);
    const environment = Object.fromEntries(['PATH', 'HOME', 'USER', 'LOGNAME', 'DISPLAY', 'WAYLAND_DISPLAY', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR', 'XDG_SESSION_TYPE', 'XAUTHORITY', 'LANG', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'ProgramFiles', 'ProgramFiles(x86)'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
    try {
      if (executable === '/snap/bin/chromium') environment.HOME = os.userInfo().homedir;
      await this.driver.launch({ executable, root: this.root, headless: this.headless, environment, logger: () => {} });
      const created = await this.driver.call('newPage'); this.page = this.driver.page(created.id);
      await this.page.goto(parsed.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
      if (new URL(this.page.url()).origin !== target.origin) fail('TARGET_CHANGED', 'The website redirected to a different origin. Authorize that exact origin separately.');
      await this.page.bringToFront(); this.target = target;
    } catch (error) { await this.close(); throw error; }
  }
  async bind(selectors) {
    if (!this.page || this.page.isClosed()) fail('TARGET_CLOSED', 'Open this grant’s task browser first.');
    if (typeof selectors?.password !== 'string' || selectors.username !== undefined && typeof selectors.username !== 'string') fail('INVALID_TARGET', 'Supply one password selector and an optional username selector.');
    // Capture the actual Document and actual elements before retrieving a value.
    // Navigation destroys their execution context; selector reuse cannot retarget.
    const capture = (origin, selectors) => {
      const pick = (selector, password) => {
        const found = document.querySelectorAll(selector);
        if (found.length !== 1) throw new Error('ambiguous');
        const input = found[0], rect = input.getBoundingClientRect(), style = getComputedStyle(input);
        if (!(input instanceof HTMLInputElement) || input.disabled || input.readOnly || !rect.width || !rect.height || !input.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) || style.visibility !== 'visible' || style.display === 'none' || (password ? input.type !== 'password' : !['text', 'email'].includes(input.type))) throw new Error('field');
        if (input.form && new URL(input.form.action || location.href).origin !== origin) throw new Error('action');
        return input;
      };
      if (location.origin !== origin || window.top !== window) throw new Error('origin');
      return { document, origin, password: pick(selectors.password, true), username: selectors.username ? pick(selectors.username, false) : null };
    };
    // A documented CDP isolated world keeps page scripts from replacing URL,
    // DOM prototypes, style checks or value setters used by this verifier.
    const cdp = await this.page.createCDPSession();
    const objectGroup = randomUUID(); let objectId;
    const close = async () => { await cdp.send('Runtime.releaseObjectGroup', { objectGroup }).catch(() => {}); await cdp.detach().catch(() => {}); };
    try {
      const { frameTree } = await cdp.send('Page.getFrameTree');
      const { executionContextId } = await cdp.send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: `thingtime-password-${objectGroup}`, grantUniveralAccess: false });
      const result = await cdp.send('Runtime.evaluate', { expression: `(${capture.toString()})(${JSON.stringify(this.target.origin)},${JSON.stringify(selectors)})`, contextId: executionContextId, objectGroup });
      if (result.exceptionDetails || !result.result.objectId) throw new Error(); objectId = result.result.objectId;
    } catch { await close(); fail('INVALID_TARGET', 'Choose unique visible fields in the authorized main document with a same-origin form action.'); }
    return {
      deliver: async ({ username, password }) => {
        const deliver = function(username, password) {
          const bound = this;
          if (bound.document !== document || location.origin !== bound.origin || !bound.password.isConnected || bound.username && !bound.username.isConnected) throw new Error('changed');
          for (const [element, value, isPassword] of [[bound.username, username, false], [bound.password, password, true]]) {
            if (!element) continue;
            const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
            if (bound.document !== document || location.origin !== bound.origin || !element.isConnected || element.ownerDocument !== document || element.disabled || element.readOnly || !rect.width || !rect.height || !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) || style.visibility !== 'visible' || (isPassword ? element.type !== 'password' : !['text', 'email'].includes(element.type)) || element.form && new URL(element.form.action || location.href).origin !== bound.origin) throw new Error('changed');
            // Use the platform setter; never a page-owned replacement setter.
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, value);
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
          }
        };
        try {
          const result = await cdp.send('Runtime.callFunctionOn', { objectId, functionDeclaration: deliver.toString(), arguments: [{ value: username }, { value: password }], returnByValue: true });
          if (result.exceptionDetails) throw new Error();
        } catch { fail('TARGET_CHANGED', 'The document or fields changed before delivery. No retry was attempted.'); }
      },
      close,
    };
  }
  async close() { await this.driver.close(); await fs.rm(this.root, { recursive: true, force: true }); }
}
async function trustedSystemExecutable(executable) {
  const real = await fs.realpath(executable), stat = await fs.stat(real);
  if (!stat.isFile() || stat.uid !== 0 || (stat.mode & 0o022)) fail('UNSAFE_CONSUMER', 'The native consumer must be installed by the operating system.');
  return real;
}
async function fixedSystemCommand(executable, args, input, capture = false) {
  const real = await trustedSystemExecutable(executable);
  return new Promise((resolve, reject) => {
    const child = spawn(real, args, { stdio: ['pipe', capture ? 'pipe' : 'ignore', 'ignore'], env: Object.fromEntries(['HOME', 'USER', 'DISPLAY', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR'].filter(key => process.env[key]).map(key => [key, process.env[key]])) });
    let output = '';
    const timer = setTimeout(() => child.kill(), 15000);
    child.stdout?.on('data', chunk => { if (output.length + chunk.length <= 4096) output += chunk.toString(); else child.kill(); });
    child.stdin.on('error', () => {});
    child.once('error', () => { clearTimeout(timer); reject(new Error('consumer')); });
    child.once('close', code => { clearTimeout(timer); code === 0 ? resolve(output) : reject(new Error('consumer')); });
    child.stdin.end(input);
  });
}
async function keyringState() {
  if (process.platform !== 'linux') fail('UNSUPPORTED_TARGET', 'The GNOME keyring consumer is only available on Linux.');
  try {
    const bus = ['call', '--session', '--dest', 'org.freedesktop.DBus', '--object-path', '/org/freedesktop/DBus'];
    const ownerReply = await fixedSystemCommand('/usr/bin/gdbus', [...bus, '--method', 'org.freedesktop.DBus.GetNameOwner', 'org.freedesktop.secrets'], '', true);
    const owner = /^\('(:[0-9]+\.[0-9]+)',?\)\s*$/.exec(ownerReply)?.[1];
    if (!owner) throw new Error();
    const pidReply = await fixedSystemCommand('/usr/bin/gdbus', [...bus, '--method', 'org.freedesktop.DBus.GetConnectionUnixProcessID', owner], '', true);
    const pid = Number(/^\(uint32 ([0-9]+),?\)\s*$/.exec(pidReply)?.[1]);
    if (!Number.isSafeInteger(pid) || pid <= 0 || (await fs.stat(`/proc/${pid}`)).uid !== process.getuid() || await fs.realpath(`/proc/${pid}/exe`) !== await trustedSystemExecutable('/usr/bin/gnome-keyring-daemon')) throw new Error();
    const output = await fixedSystemCommand('/usr/bin/gdbus', ['call', '--session', '--dest', owner, '--object-path', '/org/freedesktop/secrets/collection/login', '--method', 'org.freedesktop.DBus.Properties.Get', 'org.freedesktop.Secret.Collection', 'Locked'], '', true);
    const locked = /^\(\s*<(true|false)>\s*,?\s*\)\s*$/.exec(output)?.[1];
    if (!locked) throw new Error();
    return { locked: locked === 'true', owner, pid };
  } catch { fail('CONSUMER_UNAVAILABLE', 'An existing GNOME login keyring owned by this device user is required. No keyring was created or changed.'); }
}
// GNOME's PAM module uses the existing daemon's control socket for login
// keyring unlock. Keep this helper fixed to that operation and authenticate
// the connected peer before requesting bytes on its private input pipe.
const GNOME_UNLOCK = String.raw`
import os, resource, socket, stat, struct, sys

resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
pid = int(sys.argv[1])
uid = os.geteuid()

def check_peer(conn):
    peer_pid, peer_uid, _ = struct.unpack('=iII', conn.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
    if peer_pid != pid or peer_uid != uid or not os.path.samefile('/proc/%d/exe' % pid, '/usr/bin/gnome-keyring-daemon'):
        raise OSError('peer')

def connect():
    for name in sys.argv[2:]:
        conn = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        conn.settimeout(5)
        try:
            parent = os.lstat(os.path.dirname(name))
            node = os.lstat(name)
            if parent.st_uid != uid or not stat.S_ISDIR(parent.st_mode) or parent.st_mode & 0o077 or node.st_uid != uid or not stat.S_ISSOCK(node.st_mode):
                raise OSError('socket')
            conn.connect(name)
            check_peer(conn)
            return conn
        except OSError:
            conn.close()
    raise OSError('consumer')

with connect() as conn:
    sys.stdout.buffer.write(b'R')
    sys.stdout.buffer.flush()
    value = bytearray(sys.stdin.buffer.read())
    try:
        if not value or 0 in value:
            raise ValueError('password')
        check_peer(conn)
        # Linux credentials marker, total length, unlock opcode, string length.
        conn.sendall(b'\0' + struct.pack('!III', 12 + len(value), 1, len(value)))
        conn.sendall(value)
        with conn.makefile('rb') as reply:
            if reply.read(8) != struct.pack('!II', 8, 0):
                raise OSError('refused')
    finally:
        value[:] = bytes(len(value))
`;

async function unlockExistingDaemon(password, pid, assertCurrent) {
  const executable = await trustedSystemExecutable('/usr/bin/python3');
  const runtime = process.env.XDG_RUNTIME_DIR;
  const directories = [process.env.GNOME_KEYRING_CONTROL, runtime && path.join(runtime, 'keyring')];
  const sockets = [...new Set(directories.filter(directory => directory && path.isAbsolute(directory)).map(directory => path.join(directory, 'control')))];
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['-I', '-S', '-c', GNOME_UNLOCK, String(pid), ...sockets], { stdio: ['pipe', 'pipe', 'ignore'], env: {} });
    const timer = setTimeout(() => child.kill(), 10000);
    let delivered = false;
    child.stdin.on('error', () => {});
    child.stdout.once('data', marker => {
      try {
        if (marker.length !== 1 || marker[0] !== 0x52) throw new Error('consumer');
        assertCurrent();
        child.stdin.end(password);
        delivered = true;
      } catch (error) { child.kill(); reject(error); }
    });
    child.once('error', () => { clearTimeout(timer); reject(new Error('consumer')); });
    child.once('close', code => { clearTimeout(timer); code === 0 && delivered ? resolve() : reject(new Error('consumer')); });
  });
}

async function unlockKeyring(password, previous, assertCurrent) {
  const before = await keyringState();
  if (!before.locked || before.owner !== previous.owner || before.pid !== previous.pid) fail('CONSUMER_CHANGED', 'The keyring changed before credential delivery.');
  try {
    await unlockExistingDaemon(password, before.pid, assertCurrent);
    const after = await keyringState();
    if (after.locked || after.owner !== before.owner || after.pid !== before.pid) throw new Error();
  } catch (error) {
    if (error instanceof PasswordBridgeError) throw error;
    fail('CONSUMER_REFUSED', 'The existing GNOME login keyring did not confirm it was unlocked.');
  }
}
module.exports = { PasswordBrowser, browserExecutable, browserProfileRoot, unlockKeyring, keyringState };
