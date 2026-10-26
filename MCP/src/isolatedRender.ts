import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { CallToolResult, JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { parseRenderInput, type RenderExecutor } from './renderExport.js';

// The renderer itself retains its 30s job/6MiB artifact bounds. This larger
// outer deadline includes the existing launcher's private asset staging.
export const ISOLATED_RENDER_DEADLINE_MS = 150000;
export const ISOLATED_RENDER_CLEANUP_MAX_MS = 76000;
export const ISOLATED_RENDER_OUTPUT_BYTES = 10 * 1024 * 1024;
export type RenderLaunch = { command: string; args: string[]; cwd: string; env: Record<string, string> };
type Configuration = { launch: RenderLaunch; error?: never } | { error: string; launch?: never };

export function isolatedRenderConfiguration(env: NodeJS.ProcessEnv = process.env): Configuration {
  const image = env.THINGTIME_MCP_RENDER_IMAGE;
  const socket = env.THINGTIME_MCP_RENDER_SOCKET;
  if (!image || !socket) return { error: 'Isolated rendering is disabled: configure THINGTIME_MCP_RENDER_IMAGE and THINGTIME_MCP_RENDER_SOCKET.' };
  if (!/^sha256:[a-f0-9]{64}$/.test(image)) return { error: 'Isolated rendering is disabled: THINGTIME_MCP_RENDER_IMAGE must be an exact cached sha256 image ID.' };
  if (!isAbsolute(socket)) return { error: 'Isolated rendering is disabled: THINGTIME_MCP_RENDER_SOCKET must be an absolute Unix socket path.' };
  const docker = env.THINGTIME_MCP_RENDER_DOCKER || '/opt/homebrew/bin/docker';
  const assets = env.THINGTIME_MCP_RENDER_ASSETS;
  if (!isAbsolute(docker) || (assets && !isAbsolute(assets))) return { error: 'Isolated rendering is disabled: Docker and renderer asset paths must be absolute.' };
  return { launch: {
    command: process.execPath,
    args: [fileURLToPath(new URL('../scripts/render-isolated.mjs', import.meta.url)), '--socket', socket,
      '--image', image, '--docker', docker, '--lifetime-seconds', '120', ...(assets ? ['--renderer', assets] : [])],
    cwd: tmpdir(),
    // No host HOME, Node options, proxy variables, Docker credentials, account
    // tokens or import/store settings reach the launcher. It creates its own
    // private Docker config and stages only its verified code/assets trees.
    env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: tmpdir(), TMPDIR: tmpdir() }
  } };
}

/** A bounded stdio transport, without the SDK transport's inherited env or
 * early SIGKILL. Allow the existing ownership-checking guardian to finish. */
export class IsolatedRenderTransport implements Transport {
  onclose?: Transport['onclose'];
  onerror?: Transport['onerror'];
  onmessage?: Transport['onmessage'];
  private child?: ChildProcessWithoutNullStreams;
  private exited?: Promise<void>;
  private closing?: Promise<void>;
  private terminalError?: Error;
  private bytes = 0;
  private buffer = new ReadBuffer({ maxBufferSize: ISOLATED_RENDER_OUTPUT_BYTES });
  constructor(private launch: RenderLaunch) {}

  async start(): Promise<void> {
    if (this.child) throw new Error('Isolated renderer transport already started');
    const child = this.child = spawn(this.launch.command, this.launch.args, {
      cwd: this.launch.cwd, env: this.launch.env, stdio: ['pipe', 'pipe', 'pipe'], shell: false
    });
    this.exited = new Promise(resolve => child.once('close', (code, signal) => {
      if (code !== 0 || signal) this.terminalError ||= new Error('Isolated renderer exited unsuccessfully; verify Docker, pinned image, assets and owned cleanup.');
      this.onclose?.(); resolve();
    }));
    // Diagnostics may contain local paths or private configuration. Drain them
    // without retaining/echoing them; failure returns a fixed actionable label.
    child.stderr.resume();
    child.stdout.on('data', (chunk: Buffer) => {
      if (this.terminalError) return;
      try {
        this.bytes += chunk.length;
        if (this.bytes > ISOLATED_RENDER_OUTPUT_BYTES) throw new Error('Isolated renderer exceeded its 10 MiB protocol output budget');
        this.buffer.append(chunk);
        let message: JSONRPCMessage | null;
        while ((message = this.buffer.readMessage()) !== null) this.onmessage?.(message);
      } catch {
        this.terminalError = new Error('Isolated renderer returned invalid or excessive protocol output; no artifacts returned');
        this.onerror?.(this.terminalError);
        void this.close().catch(() => {});
      }
    });
    child.stdout.on('error', () => this.fail());
    child.stdin.on('error', () => this.fail());
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', () => { this.fail(); reject(this.terminalError); });
    });
  }

  private fail() {
    this.terminalError ||= new Error('Isolated renderer transport failed; no artifacts returned');
    this.onerror?.(this.terminalError);
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this.child || this.closing || this.terminalError) throw this.terminalError || new Error('Isolated renderer is not connected');
    await new Promise<void>((resolve, reject) => this.child!.stdin.write(serializeMessage(message), error => error ? reject(new Error('Isolated renderer input failed')) : resolve()));
  }

  close(): Promise<void> {
    return this.closing ||= this.stop();
  }

  private async stop(): Promise<void> {
    const child = this.child;
    if (!child || !this.exited) return;
    const wait = async (milliseconds: number) => {
      let timer: NodeJS.Timeout | undefined;
      try { await Promise.race([this.exited, new Promise<void>(resolve => { timer = setTimeout(resolve, milliseconds); })]); }
      finally { clearTimeout(timer); }
    };
    child.stdin.end();
    // The launcher waits for its guardian's exact-label cleanup receipt.
    await wait(40000);
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await wait(35000); }
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL'); await wait(1000);
      this.terminalError = new Error('Isolated renderer cleanup could not be verified; no artifacts returned');
    }
    this.buffer.clear();
    if (this.terminalError) throw this.terminalError;
  }
}

export type IsolatedRenderer = {
  execute: RenderExecutor;
  close(): Promise<void>;
  capabilities: { mode: 'isolated-per-render'; configured: boolean; diagnostic: string; accountAccess: false; persistence: false; network: 'none'; hostFallback: false; workDeadlineMs: number; cleanupMaxMs: number; totalMaxMs: number };
};

export function createIsolatedRenderer(env: NodeJS.ProcessEnv = process.env, dependencies: {
  transport?: (launch: RenderLaunch) => Transport;
  deadlineMs?: number;
} = {}): IsolatedRenderer {
  const configuration = isolatedRenderConfiguration(env);
  let active: { client: Client; transport: Transport } | undefined;
  let closed = false;
  return {
    capabilities: {
      mode: 'isolated-per-render', configured: !!configuration.launch,
      diagnostic: configuration.error || 'Configured; Docker endpoint, cached image and offline assets are verified lazily on each render. This status is configuration evidence only.',
      accountAccess: false, persistence: false, network: 'none', hostFallback: false,
      workDeadlineMs: ISOLATED_RENDER_DEADLINE_MS, cleanupMaxMs: ISOLATED_RENDER_CLEANUP_MAX_MS,
      totalMaxMs: ISOLATED_RENDER_DEADLINE_MS + ISOLATED_RENDER_CLEANUP_MAX_MS
    },
    async close() { closed = true; await active?.transport.close(); },
    async execute(raw, signal) {
      const input = parseRenderInput(raw);
      if (closed) throw new Error('Thingtime MCP is closing');
      if (signal?.aborted) throw new Error('Isolated render cancelled; no artifacts returned');
      if (!configuration.launch) throw new Error(configuration.error);
      if (active) throw new Error('Renderer busy; retry after the current request finishes');
      const client = new Client({ name: 'thingtime-mcp-isolated-render', version: '0.1.0' });
      const transport = (dependencies.transport || (launch => new IsolatedRenderTransport(launch)))(configuration.launch);
      active = { client, transport };
      let timer: NodeJS.Timeout | undefined;
      let abort: (() => void) | undefined;
      try {
        const result = await Promise.race([
          (async (): Promise<CallToolResult> => {
            await client.connect(transport, { timeout: dependencies.deadlineMs || ISOLATED_RENDER_DEADLINE_MS });
            if (client.getServerVersion()?.name !== 'thingtime-draft-renderer') throw new Error('Unexpected isolated renderer identity');
            const tools = (await client.listTools({}, { timeout: dependencies.deadlineMs || ISOLATED_RENDER_DEADLINE_MS })).tools.map(tool => tool.name).sort();
            if (JSON.stringify(tools) !== JSON.stringify(['thingtime_capabilities', 'thingtime_render_and_export'])) throw new Error('Unexpected isolated renderer tool surface');
            return await client.callTool({ name: 'thingtime_render_and_export', arguments: input }, undefined, { timeout: dependencies.deadlineMs || ISOLATED_RENDER_DEADLINE_MS }) as CallToolResult;
          })(),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Isolated render deadline exceeded; no artifacts returned')), dependencies.deadlineMs || ISOLATED_RENDER_DEADLINE_MS); }),
          new Promise<never>((_, reject) => {
            abort = () => reject(new Error('Isolated render cancelled; no artifacts returned'));
            signal?.addEventListener('abort', abort, { once: true });
            if (signal?.aborted) abort();
          })
        ]);
        return result;
      } finally {
        clearTimeout(timer);
        if (abort) signal?.removeEventListener('abort', abort);
        try { await transport.close(); }
        finally { await client.close().catch(() => {}); active = undefined; }
      }
    }
  };
}
