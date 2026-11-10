import { randomUUID } from 'node:crypto';
import { addAbortSignal, Readable } from 'node:stream';
import { Sandbox, Snapshot } from '@vercel/sandbox';

import {
  RENDER_WORKER_PROTOCOL, formatHostedRenderResponse, hostedRenderFailure, parseRenderInput,
  type RenderInput, type RenderOutput
} from '../../../../../MCP/src/renderContract';
import { readAdminAutomationSecret, vaultConfigured } from '../admin/integrations';
import { enforceFixedRateLimit } from '../rateLimit/enforce';
import { prepareDraft } from '../../../draftPreview/prepare';

export const HOSTED_RENDER_CONFIG_LABEL = 'thingtime-hosted-render';

const SNAPSHOT_CHECK_MS = 3000;
const READINESS_CACHE_MS = 15_000;
const VM_MAX_MS = 70_000;
const WORK_MAX_MS = 45_000;
const IDENTITY_MAX_MS = 4_000;
const COMMAND_MAX_MS = 33_000;
const RECOVERY_MAX_MS = 2_000;
const STOP_MAX_MS = 4_000;
const DELETE_MAX_MS = 4_000;
const WORKER_RESPONSE_MAX_BYTES = 8 * 1024 * 1024;
const workerHome = '/home/thingtime-renderer';
const runnerPath = '/opt/thingtime/remix/dist/draft-preview/runner.js';
const inputPath = workerHome + '/render-input.json';
const outputPath = workerHome + '/render-output.json';
// The image owns this fixed identity. The ordinary Session commands and file
// APIs must already run as it: there is no sudo, root setup or resumed session.
const workerIdentity = [
  'test "$(/usr/bin/id -u):$(/usr/bin/id -g):$(/usr/bin/id -un)" = 10001:10001:thingtime-renderer',
  'test "$(/usr/bin/id -ru):$(/usr/bin/id -rg)" = 10001:10001',
  'test "$(/usr/bin/id -G)" = 10001',
  'test -d "$HOME"',
  'test ! -L "$HOME"',
  'test "$(pwd -P)" = "$HOME"',
  'test "$(/usr/bin/stat -c %u:%g:%a "$HOME")" = 10001:10001:700',
  'test -r /opt/thingtime/MCP/dist/renderJob.js',
  'test ! -w /opt/thingtime/MCP/dist/renderJob.js',
  'test -d /ms-playwright',
  'test ! -w /ms-playwright',
  'test "$(/usr/bin/grep -Ec "^(Uid|Gid):([[:space:]]+10001){4}$" /proc/self/status)" = 2',
  'test "$(/usr/bin/grep -Ec "^Cap(Inh|Prm|Eff|Bnd|Amb):[[:space:]]+0+$" /proc/self/status)" = 5',
  '/usr/bin/grep -Eq "^NoNewPrivs:[[:space:]]+1$" /proc/self/status'
].join('\n');
const workerProbe = [workerIdentity,
  'test ! -e render-input.json', 'test ! -L render-input.json',
  'test ! -e render-output.json', 'test ! -L render-output.json',
  'test ! -e render-job.lock', 'test ! -L render-job.lock',
  'test -r ' + runnerPath,
  'test ! -w ' + runnerPath,
  '/usr/bin/sha256sum ' + runnerPath + ' | /usr/bin/cut -d " " -f 1'
].join('\n');
// Only fixed constants reach the shell. The private regular input file is
// checked again in the same launch that opens it as stdin.
const workerCommand = [workerIdentity,
  'test -f render-input.json', 'test ! -L render-input.json',
  'test "$(/usr/bin/stat -c %u:%g:%a render-input.json)" = 10001:10001:600',
  'test ! -e render-output.json', 'test ! -L render-output.json',
  'umask 077', 'exec 2>/dev/null', 'mkdir render-job.lock',
  'exec /usr/local/bin/node /opt/thingtime/MCP/dist/renderJob.js < render-input.json > render-output.json'
].join('\n');

const workerInvocation = (script: string, timeoutMs: number, signal: AbortSignal) => ({
  cmd: '/usr/bin/setpriv',
  // Vercel can start a nonroot image user with ambient capabilities. Clear
  // them and the bounding set before exec, then verify all five sets above.
  args: ['--no-new-privs', '--inh-caps=-all', '--ambient-caps=-all', '--bounding-set=-all',
    '/usr/bin/env', '-i', 'PATH=/usr/local/bin:/usr/bin:/bin',
    'HOME=' + workerHome, 'TMPDIR=/tmp', 'PLAYWRIGHT_BROWSERS_PATH=/ms-playwright', '/bin/sh', '-ec', script],
  cwd: workerHome, signal, timeoutMs
});

export type HostedRenderConfig = { origin: string; snapshotId: string; rendererHash: string; protocol: typeof RENDER_WORKER_PROTOCOL };
type RpcId = string | number;
type WorkerReply = { protocol: string; result: RenderOutput | { ok: false; code: string; error: string } };
type Vm = Pick<Sandbox, 'name' | 'persistent' | 'routes' | 'currentSession' | 'stop' | 'delete'>;
type VmSession = ReturnType<Vm['currentSession']>;
type WorkerDependencies = { create: (name: string, config: HostedRenderConfig, signal: AbortSignal) => Promise<Vm>; recover: (name: string, signal: AbortSignal) => Promise<Vm>; workTimeoutMs?: number };
const workerDependencies: WorkerDependencies = {
  create: (name, config, signal) => Sandbox.create({
    name, source: { type: 'snapshot', snapshotId: config.snapshotId }, resources: { vcpus: 1 },
    networkPolicy: 'deny-all', persistent: false, ports: [], timeout: VM_MAX_MS,
    env: {}, tags: { purpose: 'thingtime-hosted-render' }, signal
  }),
  recover: (name, signal) => Sandbox.get({ name, resume: false, signal })
};

export function parseHostedRenderConfig(text: string | null, origin: string): HostedRenderConfig | null {
  if (!text || Buffer.byteLength(text) > 2048) return null;
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Object.keys(value).sort().join(',') !== 'origin,protocol,rendererHash,snapshotId' ||
        value.origin !== origin || new URL(origin).origin !== origin || !origin.startsWith('https://') ||
        value.protocol !== RENDER_WORKER_PROTOCOL || typeof value.snapshotId !== 'string' || !/^snap_[a-zA-Z0-9]{8,100}$/.test(value.snapshotId) ||
        typeof value.rendererHash !== 'string' || !/^[0-9a-f]{64}$/.test(value.rendererHash)) return null;
    return value;
  } catch {
    return null;
  }
}

type ReadinessDependencies = { read: () => Promise<string | null>; snapshot: (id: string, signal: AbortSignal) => Promise<Pick<Snapshot, 'snapshotId' | 'status' | 'expiresAt'>> };
const readinessDependencies: ReadinessDependencies = {
  // The process's platform identity is the machine actor. Only this fixed,
  // operator-supplied runtime descriptor is selected; no account credential
  // or vault value is returned to a public caller or sent to the sandbox.
  read: () => process.env.VERCEL === '1' && vaultConfigured() ? readAdminAutomationSecret(HOSTED_RENDER_CONFIG_LABEL) : Promise.resolve(null),
  snapshot: (snapshotId, signal) => Snapshot.get({ snapshotId, signal })
};

export const createHostedRenderReadiness = (dependencies = readinessDependencies) => {
  // Single bounded cache entry: request-controlled hosts cannot create a map
  // of jobs, cached credentials or provider probes. Concurrent checks share it.
  let state: { until: number; pending: Promise<HostedRenderConfig | null> } | undefined;
  return async (origin: string) => {
    if (!state || state.until <= Date.now()) {
      const signal = AbortSignal.timeout(SNAPSHOT_CHECK_MS);
      // Configuration is validated against its own declared origin first;
      // a request to a different hostname cannot suppress the canonical origin.
      const pending = (async () => {
        const raw = await dependencies.read();
        const declaredOrigin = raw && raw.length <= 2048 ? JSON.parse(raw)?.origin : null;
        const config = parseHostedRenderConfig(raw, declaredOrigin);
        if (!config || signal.aborted) return null;
        const snapshot = await dependencies.snapshot(config.snapshotId, signal);
        if (signal.aborted || snapshot.snapshotId !== config.snapshotId || snapshot.status !== 'created' ||
            (snapshot.expiresAt && snapshot.expiresAt.getTime() < Date.now() + VM_MAX_MS + READINESS_CACHE_MS)) return null;
        return config;
      })().catch(() => null);
      const expiry = new Promise<null>(resolve => signal.addEventListener('abort', () => resolve(null), { once: true }));
      state = { until: Date.now() + READINESS_CACHE_MS, pending: Promise.race([pending, expiry]) };
    }
    const config = await state.pending;
    return config?.origin === origin ? config : null;
  };
};

export const hostedRenderReady = createHostedRenderReadiness();

const unavailable = (id: RpcId) => hostedRenderFailure(id, 'RENDER_UNAVAILABLE', 'No verified isolated renderer is available on this Thingtime origin.');
const workerFailed = (id: RpcId) => hostedRenderFailure(id, 'RENDER_FAILED', 'The isolated renderer could not complete; no artifacts returned.');

const verifyVm = (vm: Vm, session: VmSession, config: HostedRenderConfig, expectedName: string) => {
  return vm.name === expectedName && vm.persistent === false && vm.routes.length === 0 &&
    session.status === 'running' && session.sourceSnapshotId === config.snapshotId && session.networkPolicy === 'deny-all' &&
    session.routes.length === 0 && Number.isFinite(session.timeout) && session.timeout > 0 && session.timeout <= VM_MAX_MS &&
    session.vcpus === 1 && Number.isFinite(session.memory) && session.memory > 0 && session.memory <= 2048;
};

export async function verifyHostedRenderWorkerIdentity(session: Pick<VmSession, 'runCommand'>, rendererHash: string, signal: AbortSignal) {
  if (!/^[0-9a-f]{64}$/.test(rendererHash)) return false;
  const result = await session.runCommand(workerInvocation(workerProbe, IDENTITY_MAX_MS, signal));
  return result.exitCode === 0 && (await result.stdout()) === rendererHash + '\n';
}

async function readWorkerReply(session: VmSession, signal: AbortSignal): Promise<WorkerReply> {
  const stream = await session.readFile({ path: outputPath }, { signal });
  if (!(stream instanceof Readable)) throw new Error('missing output');
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of addAbortSignal(signal, stream)) {
    signal.throwIfAborted();
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > WORKER_RESPONSE_MAX_BYTES) throw new RangeError('output exceeded');
    chunks.push(buffer);
  }
  const reply = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (reply?.protocol !== RENDER_WORKER_PROTOCOL || typeof reply.result?.ok !== 'boolean') throw new Error('worker protocol refused');
  return reply;
}

export async function executeHostedRender(
  config: HostedRenderConfig, id: RpcId, input: RenderInput, requestSignal: AbortSignal,
  dependencies = workerDependencies, expectedDraftHash?: string
): Promise<string> {
  const vmName = 'thingtime-render-' + randomUUID();
  const workDeadline = AbortSignal.timeout(dependencies.workTimeoutMs ?? WORK_MAX_MS);
  const signal = AbortSignal.any([requestSignal, workDeadline]);
  let vm: Vm | undefined;
  let attempted = false;
  let response: string;
  try {
    signal.throwIfAborted();
    attempted = true;
    vm = await dependencies.create(vmName, config, signal);
    // Sandbox-level operations can resume a stopped VM; these operations stay
    // on the one session whose snapshot and isolation were just checked.
    const session = vm.currentSession();
    if (!verifyVm(vm, session, config, vmName) || !await verifyHostedRenderWorkerIdentity(session, config.rendererHash, signal)) throw new Error('isolation refused');
    signal.throwIfAborted();
    await session.writeFiles([{ path: inputPath, content: Buffer.from(JSON.stringify(input)), mode: 0o600 }], { signal });
    const command = await session.runCommand(workerInvocation(workerCommand, COMMAND_MAX_MS, signal));
    if (command.exitCode !== 0) throw new Error('worker exited');
    const { result } = await readWorkerReply(session, signal);
    if (result.ok === true) response = expectedDraftHash && result.hash !== expectedDraftHash
      ? hostedRenderFailure(id, 'RENDER_INVALID_OUTPUT', 'The worker did not return the exact validated draft; no artifacts returned.')
      : formatHostedRenderResponse(id, result, input, config.rendererHash);
    else if (['RENDER_REJECTED', 'RENDER_TIMEOUT', 'RENDER_OUTPUT_LIMIT', 'RENDER_INVALID_INPUT', 'RENDER_INPUT_LIMIT', 'RENDER_ISOLATION'].includes(result.code) &&
        typeof result.error === 'string' && result.error.length <= 400 && !/[\r\n]/.test(result.error)) response = hostedRenderFailure(id, result.code, result.error);
    else response = workerFailed(id);
  } catch (error) {
    response = requestSignal.aborted ? hostedRenderFailure(id, 'RENDER_CANCELLED', 'The caller cancelled the render; no artifacts returned.')
      : workDeadline.aborted ? hostedRenderFailure(id, 'RENDER_TIMEOUT', 'The isolated render exceeded its deadline; no artifacts returned.')
      : error instanceof RangeError ? hostedRenderFailure(id, 'RENDER_OUTPUT_LIMIT', 'The isolated renderer exceeded its output budget; no artifacts returned.')
      : workerFailed(id);
  }
  if (attempted) {
    try {
      // Do not reuse a cancelled caller signal. If create returned no handle,
      // recover only the same random name, never resume it or list other VMs.
      const owned = vm ?? await dependencies.recover(vmName, AbortSignal.timeout(RECOVERY_MAX_MS));
      if (owned.name !== vmName) throw new Error('unexpected sandbox identity');
      // Reserve separate deadlines; a stalled stop must not prevent deletion.
      try {
        const stopped = await owned.stop({ signal: AbortSignal.timeout(STOP_MAX_MS) });
        if (!['stopped', 'failed', 'aborted'].includes(stopped.status)) throw new Error('nonterminal sandbox state');
      } finally {
        await owned.delete({ signal: AbortSignal.timeout(DELETE_MAX_MS) });
      }
    } catch {
      // The nonpersistent VM has an independent provider-enforced lifetime.
      return hostedRenderFailure(id, 'RENDER_CLEANUP_UNVERIFIED', 'The isolated renderer cleanup could not be verified; no artifacts returned.');
    }
  }
  return requestSignal.aborted ? hostedRenderFailure(id, 'RENDER_CANCELLED', 'The caller cancelled the render; no artifacts returned.') : response;
}

export type HostedRenderGateway = {
  ready: (origin: string) => Promise<HostedRenderConfig | null>;
  call: (request: Request, config: HostedRenderConfig, id: RpcId, raw: unknown) => Promise<string>;
};

type GatewayDependencies = {
  ready: HostedRenderGateway['ready'];
  admit: typeof enforceFixedRateLimit;
  execute: (config: HostedRenderConfig, id: RpcId, input: RenderInput, signal: AbortSignal, expectedDraftHash: string) => Promise<string>;
};
export const createHostedRenderGateway = (dependencies: GatewayDependencies): HostedRenderGateway => ({
  ready: dependencies.ready,
  async call(request, config, id, raw) {
    if (new URL(request.url).origin !== config.origin) return unavailable(id);
    let input: RenderInput;
    try { input = parseRenderInput(raw); }
    catch (error) { return hostedRenderFailure(id, 'RENDER_INVALID_INPUT', error instanceof Error ? error.message : 'Invalid render arguments.'); }
    if (request.signal.aborted) return hostedRenderFailure(id, 'RENDER_CANCELLED', 'The caller cancelled the render; no artifacts returned.');
    const admissionDeadline = AbortSignal.any([request.signal, AbortSignal.timeout(3000)]);
    const reserve = async (name: string, identity: string | null, limit: number, windowMs: number) => {
      if (admissionDeadline.aborted) return unavailable(id);
      let onAbort: () => void;
      const timeout = new Promise<null>(resolve => {
        onAbort = () => resolve(null);
        admissionDeadline.addEventListener('abort', onAbort, { once: true });
      });
      const admission = await Promise.race([timeout, dependencies.admit(request, name, identity, { limit, windowMs }).catch(() => null)]);
      admissionDeadline.removeEventListener('abort', onAbort!);
      if (!admission || admission.unavailable || admissionDeadline.aborted) return unavailable(id);
      if (!admission.allowed) return hostedRenderFailure(id, 'RENDER_BUSY', 'The shared renderer is busy; retry after ' + admission.resetAt + '.');
      return null;
    };

    // Bound anonymous validation before doing template expansion. Invalid
    // drafts never reach the global VM bucket or allocate a paid worker.
    const ipRefusal = await reserve('hosted-render-ip', null, 2, 60_000);
    if (ipRefusal) return ipRefusal;
    let draftHash: string;
    try {
      // This pure canonical validator resolves only the supplied dependency
      // closure; no account context or stored reference can enter this path.
      draftHash = (await prepareDraft(input.content, input.root)).hash;
    } catch (error) {
      const message = error instanceof Error ? error.message.split(/[\r\n]/)[0].slice(0, 400) : 'Invalid caller-supplied draft.';
      return hostedRenderFailure(id, 'RENDER_REJECTED', message);
    }
    // A global 120s rolling bucket bounds all origins/instances, including
    // delayed allocation plus the provider's 70s independent VM lifetime.
    const globalRefusal = await reserve('hosted-render-global', 'all-hosted-origins', 4, 120_000);
    if (globalRefusal) return globalRefusal;
    return dependencies.execute(config, id, input, request.signal, draftHash);
  }
});

export const hostedRenderGateway = createHostedRenderGateway({ ready: hostedRenderReady, admit: enforceFixedRateLimit, execute: (config, id, input, signal, hash) => executeHostedRender(config, id, input, signal, workerDependencies, hash) });
