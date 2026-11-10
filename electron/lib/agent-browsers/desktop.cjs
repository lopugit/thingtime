'use strict';
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { DockerEngine } = require('./containers.cjs');
const { BrowserImages } = require('./images.cjs');
const { BrowserBundles } = require('./bundles.cjs');
const { AgentBrowserManager } = require('./manager.cjs');
const { dispatch, startControlSocket } = require('./control.cjs');

async function createDesktopAgentBrowsers({ userData, resourcesRoot, applicationRoot, applicationsRoot = path.join(os.homedir(), 'Applications', 'Thingtime Browsers') }) {
  const stateRoot = path.join(userData, 'agent-browsers');
  const executable = await fs.access('/opt/homebrew/bin/docker').then(() => '/opt/homebrew/bin/docker').catch(() => '/usr/local/bin/docker');
  const engine = new DockerEngine({ executable, socketPath: path.join(os.homedir(), '.colima/thingtime-agents/docker.sock'), stateRoot, seccompPath: path.join(resourcesRoot, 'seccomp.json') });
  const images = new BrowserImages({ engine, stateRoot: path.join(stateRoot, 'images'), sourceRoot: resourcesRoot, applicationRoot });
  const bundles = new BrowserBundles({ stateRoot: path.join(stateRoot, 'bundles'), applicationsRoot });
  const manager = await new AgentBrowserManager({ engine, images, bundles, stateRoot }).initialize();
  const identity = createHash('sha256').update(userData).digest('hex').slice(0, 16);
  const socketPath = path.join(os.homedir(), '.thingtime', 'agents', identity, 'control.sock');
  let socket, socketError;
  try { socket = await startControlSocket(manager, socketPath); }
  catch { socketError = 'The local agent connection is already in use or unavailable. Browser controls in this window remain available.'; }
  let preparation;
  const status = async () => {
    try { await manager.ensureRuntime(); return { available: true, socketPath, socketError }; }
    catch { return { available: false, socketPath, socketError, message: 'Start the dedicated thingtime-agents runtime. Colima and the Docker CLI must be installed on this device.' }; }
  };
  return {
    manager,
    async request(request) {
      if (request?.method === 'runtime.status') return status();
      if (request?.method === 'runtime.prepare') {
        if (!preparation) preparation = (async () => {
          const colima = path.join(path.dirname(executable), 'colima');
          try { await fs.access(colima); await fs.access(executable); }
          catch { throw new Error('Install Colima and the Docker CLI on this Mac, then choose Start isolated runtime again. See the Agent browsers setup guide.'); }
          if ((await status()).available) return status();
          await new Promise((resolve, reject) => {
            const child = spawn(colima, ['start', '--profile', 'thingtime-agents', '--runtime', 'docker', '--vm-type', 'vz',
              '--arch', process.arch === 'arm64' ? 'aarch64' : 'x86_64', '--cpus', '2', '--memory', '4', '--disk', '20',
              '--mount', 'none', '--port-forwarder', 'none', '--ssh-agent=false', '--ssh-config=false', '--activate=false'], {
              env: { PATH: `${path.dirname(executable)}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: os.homedir() }, stdio: 'ignore'
            });
            const timer = setTimeout(() => child.kill('SIGTERM'), 6 * 60 * 1000);
            child.once('error', () => { clearTimeout(timer); reject(new Error('The isolated runtime could not start.')); });
            child.once('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('The isolated runtime did not finish starting. Check Colima before retrying.')); });
          });
          return status();
        })().finally(() => { preparation = null; });
        return preparation;
      }
      return dispatch(manager, request, { desktop: true });
    },
    async close() { await socket?.close(); await manager.close(); }
  };
}
module.exports = { createDesktopAgentBrowsers };
