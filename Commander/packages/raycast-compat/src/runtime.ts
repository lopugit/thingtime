import { Worker, type ResourceLimits } from 'node:worker_threads';
import type { CommanderExtension } from '@commander/protocol';
import { inspectRaycastExtensionSource, type RaycastExtensionSourceReport } from './manifest.js';

export type CompatibilityCapability =
  | 'command-metadata'
  | 'no-view-command'
  | 'list-view'
  | 'detail-view'
  | 'form-view'
  | 'preferences'
  | 'storage'
  | 'clipboard'
  | 'notifications'
  | 'oauth'
  | 'menu-bar';

export const compatibilityCapabilities: Record<CompatibilityCapability, 'supported' | 'partial' | 'planned'> =
  {
    'command-metadata': 'supported',
    'no-view-command': 'partial',
    'list-view': 'planned',
    'detail-view': 'planned',
    'form-view': 'planned',
    preferences: 'partial',
    storage: 'planned',
    clipboard: 'planned',
    notifications: 'planned',
    oauth: 'planned',
    'menu-bar': 'planned',
  };

/** Worker threads contain lifecycle and JS heap pressure; they are not a permissions or OS security sandbox. */
export const RAYCAST_WORKER_ISOLATION_NOTICE =
  'Worker threads isolate extension lifecycle and JavaScript heaps, but retain the Commander process permissions and are not a security sandbox.';

export interface RaycastExtensionRuntimeOptions {
  timeoutMs?: number;
  resourceLimits?: ResourceLimits;
}

export interface RaycastCommandExecutionOptions {
  timeoutMs?: number;
  preferences?: Record<string, unknown>;
}

export class UnsupportedRaycastCapabilityError extends Error {
  constructor(public readonly capability: CompatibilityCapability) {
    super(`Raycast capability is not implemented yet: ${capability}`);
    this.name = 'UnsupportedRaycastCapabilityError';
  }
}

export class RaycastExtensionPreparationError extends Error {
  constructor(
    public readonly report: RaycastExtensionSourceReport,
    public readonly commandName: string,
  ) {
    const commandDiagnostics = report.diagnostics.filter(
      (diagnostic) => diagnostic.commandName === commandName || diagnostic.severity === 'error',
    );
    super(
      commandDiagnostics.map((diagnostic) => diagnostic.message).join(' ') ||
        `Raycast command is not ready: ${commandName}`,
    );
    this.name = 'RaycastExtensionPreparationError';
  }
}

export class RaycastExtensionTimeoutError extends Error {
  constructor(
    public readonly commandName: string,
    public readonly timeoutMs: number,
  ) {
    super(`Raycast command “${commandName}” exceeded ${timeoutMs}ms and its worker was terminated`);
    this.name = 'RaycastExtensionTimeoutError';
  }
}

export class RaycastExtensionWorkerError extends Error {
  constructor(
    public readonly commandName: string,
    message: string,
    public readonly causeName?: string,
  ) {
    super(`Raycast command “${commandName}” failed: ${message}`);
    this.name = 'RaycastExtensionWorkerError';
  }
}

interface WorkerMessage {
  ok: boolean;
  error?: { name?: string; message?: string };
}

export class RaycastExtensionRuntime {
  private readonly timeoutMs: number;
  private readonly resourceLimits: ResourceLimits;

  constructor(options: RaycastExtensionRuntimeOptions = {}) {
    this.timeoutMs = boundedTimeout(options.timeoutMs ?? 15_000);
    this.resourceLimits = options.resourceLimits ?? { maxOldGenerationSizeMb: 128, stackSizeMb: 4 };
  }

  async execute(
    extension: CommanderExtension,
    commandName: string,
    options: RaycastCommandExecutionOptions = {},
  ): Promise<void> {
    const command = extension.commands.find((item) => item.name === commandName && !item.disabled);
    if (!command) throw new Error(`Extension command not found or disabled: ${commandName}`);
    if (!extension.path) throw new Error('Extension path is unavailable');
    if (command.mode !== 'no-view')
      throw new UnsupportedRaycastCapabilityError(command.mode === 'menu-bar' ? 'menu-bar' : 'list-view');

    const report = await inspectRaycastExtensionSource(extension.path);
    const preparedCommand = report.commands.find((item) => item.command.name === commandName);
    if (!preparedCommand?.buildEntry || preparedCommand.status !== 'ready')
      throw new RaycastExtensionPreparationError(report, commandName);
    const timeoutMs = boundedTimeout(options.timeoutMs ?? this.timeoutMs);
    const worker = new Worker(new URL('./worker.js', import.meta.url), {
      workerData: {
        extensionPath: report.extensionPath,
        entryPath: preparedCommand.buildEntry,
        commandName,
        preferences: options.preferences ?? {},
      },
      resourceLimits: this.resourceLimits,
    });
    await waitForWorker(worker, commandName, timeoutMs);
  }
}

function boundedTimeout(value: number): number {
  if (!Number.isFinite(value)) return 15_000;
  return Math.max(25, Math.min(Math.floor(value), 10 * 60_000));
}

async function waitForWorker(worker: Worker, commandName: string, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = async (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.removeAllListeners();
      try {
        await worker.terminate();
      } catch {
        /* The worker may already have exited. */
      }
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      void finish(new RaycastExtensionTimeoutError(commandName, timeoutMs));
    }, timeoutMs);
    worker.once('message', (value: unknown) => {
      const message = value as WorkerMessage;
      if (message?.ok === true) void finish();
      else
        void finish(
          new RaycastExtensionWorkerError(
            commandName,
            message?.error?.message ?? 'Extension worker returned an invalid failure response',
            message?.error?.name,
          ),
        );
    });
    worker.once('error', (error) => {
      void finish(new RaycastExtensionWorkerError(commandName, error.message, error.name));
    });
    worker.once('exit', (code) => {
      if (!settled)
        void finish(
          new RaycastExtensionWorkerError(
            commandName,
            `worker exited before reporting completion (status ${code})`,
          ),
        );
    });
  });
}
