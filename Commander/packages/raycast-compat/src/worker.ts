import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parentPort, workerData } from 'node:worker_threads';

interface WorkerInput {
  extensionPath: string;
  entryPath: string;
  commandName: string;
  preferences: Record<string, unknown>;
}
interface WorkerFailure {
  name: string;
  message: string;
}
const input = workerData as WorkerInput;

async function run(): Promise<void> {
  const [extensionPath, entryPath] = await Promise.all([
    realpath(input.extensionPath),
    realpath(input.entryPath),
  ]);
  if (!entryPath.startsWith(`${extensionPath}${path.sep}`))
    throw new Error('Built command entry resolves outside the extension directory');

  // This worker is a fault/lifecycle boundary, not a security sandbox. Imported code has the
  // same filesystem and network privileges as Commander until process isolation is implemented.
  const module = (await import(pathToFileURL(entryPath).href)) as { default?: unknown };
  if (typeof module.default !== 'function')
    throw new Error(`No default command function was exported by ${input.commandName}`);
  await module.default();
}

function failure(error: unknown): WorkerFailure {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: 'Error', message: String(error) };
}

void run()
  .then(() => parentPort?.postMessage({ ok: true }))
  .catch((error: unknown) => parentPort?.postMessage({ ok: false, error: failure(error) }));
