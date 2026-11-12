'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomBytes, randomUUID } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

const root = process.env.THINGTIME_NATIVE_PASSWORD_TEST_ROOT || path.join(os.homedir(), '.thingtime-native-password-tests', randomUUID());
const run = (executable, args, env) => new Promise((resolve, reject) => {
  const child = spawn(executable, args, { env, stdio: 'inherit', windowsHide: true });
  const timer = setTimeout(() => child.kill(), 180000);
  child.once('error', error => { clearTimeout(timer); reject(error); }); child.once('close', code => { clearTimeout(timer); resolve(code ?? 1); });
});
(async () => {
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  if (process.platform === 'linux' && !process.argv.includes('--inside-session')) {
    process.exitCode = await run('/usr/bin/dbus-run-session', ['--', process.execPath, __filename, '--inside-session'], { ...process.env, THINGTIME_NATIVE_PASSWORD_TEST_ROOT: root }); return;
  }
  const env = { ...process.env, THINGTIME_NATIVE_PASSWORD_TEST_ROOT: root };
  delete env.ELECTRON_RUN_AS_NODE;
  let keyring;
  try {
    if (process.platform === 'linux') {
      env.HOME = path.join(root, 'home'); env.XDG_CONFIG_HOME = path.join(env.HOME, '.config'); env.XDG_DATA_HOME = path.join(env.HOME, '.local/share'); env.XDG_RUNTIME_DIR = path.join(root, 'runtime');
      env.XAUTHORITY = process.env.XAUTHORITY || path.join(os.homedir(), '.Xauthority');
      for (const directory of [env.HOME, env.XDG_CONFIG_HOME, env.XDG_DATA_HOME, env.XDG_RUNTIME_DIR]) await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      // Synthetic test-only keyring on a separate D-Bus session and HOME.
      // No real login keyring, password or browser profile is opened or copied.
      keyring = spawn('/usr/bin/gnome-keyring-daemon', ['--foreground', '--unlock', '--components=secrets'], { env, stdio: ['pipe', 'ignore', 'ignore'] });
      keyring.stdin.end(randomBytes(32).toString('base64url'));
      keyring.on('error', () => {});
      let ready = false;
      for (let attempt = 0; attempt < 30; attempt++) {
        if (spawnSync('/usr/bin/gdbus', ['call', '--session', '--dest', 'org.freedesktop.DBus', '--object-path', '/org/freedesktop/DBus', '--method', 'org.freedesktop.DBus.GetNameOwner', 'org.freedesktop.secrets'], { env, stdio: 'ignore' }).status === 0) { ready = true; break; }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!ready) throw new Error('Synthetic keyring did not start.');
    }
    process.exitCode = await run(require('electron'), [path.join(__dirname, 'test-native-password-runtime.cjs')], env);
    if (process.exitCode === 0) {
      const report = JSON.parse(await fs.readFile(path.join(root, 'report.json'), 'utf8'));
      if (!report.osEncryption || !report.sandboxedApprovalWindow || !report.browserDirectDelivery || !report.grantReleased) throw new Error('The runtime exited before completing its assertions.');
    }
    process.stdout.write(`Native password fixture evidence: ${root}\n`);
  } finally {
    if (keyring && keyring.exitCode === null) { keyring.kill(); await new Promise(resolve => { keyring.once('close', resolve); setTimeout(resolve, 5000).unref(); }); }
    for (const name of ['home', 'runtime', 'profile', 'electron-profile', 'browser', 'sockets', 'grant.json']) await fs.rm(path.join(root, name), { recursive: true, force: true });
  }
})().catch(() => { process.stderr.write('Native password runtime setup failed.\n'); process.exitCode = 1; });
