import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readRaycastExtension } from '../dist/manifest.js';
import {
  RaycastExtensionPreparationError,
  RaycastExtensionRuntime,
  RaycastExtensionTimeoutError,
  RaycastExtensionWorkerError,
} from '../dist/runtime.js';

const temporaryDirectories: string[] = [];

async function builtExtension(moduleSource?: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'commander-raycast-runtime-'));
  temporaryDirectories.push(directory);
  await mkdir(path.join(directory, moduleSource === undefined ? 'src' : 'dist'));
  await writeFile(
    path.join(
      directory,
      moduleSource === undefined ? 'src' : 'dist',
      moduleSource === undefined ? 'wave.ts' : 'wave.js',
    ),
    moduleSource ?? 'export default function wave() {}',
  );
  await writeFile(
    path.join(directory, 'package.json'),
    JSON.stringify({
      name: 'hello',
      type: 'module',
      commands: [{ name: 'wave', title: 'Wave', mode: 'no-view' }],
    }),
  );
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('RaycastExtensionRuntime', () => {
  it('invokes the default export of a built no-view command', async () => {
    const directory = await builtExtension('export default async function wave() { return 42; }');
    const extension = await readRaycastExtension(directory);
    await expect(new RaycastExtensionRuntime().execute(extension, 'wave')).resolves.toBeUndefined();
  });

  it('passes synced preferences through Raycast-compatible worker data', async () => {
    const directory = await builtExtension(`
      import { workerData } from 'node:worker_threads';
      export default async function wave() {
        if (workerData.preferences.repository !== 'thingtime') throw new Error('preferences missing');
      }
    `);
    const extension = await readRaycastExtension(directory);
    await expect(
      new RaycastExtensionRuntime().execute(extension, 'wave', {
        preferences: { repository: 'thingtime' },
      }),
    ).resolves.toBeUndefined();
  });

  it('terminates a command worker after its deadline', async () => {
    const directory = await builtExtension(
      'export default async function wave() { await new Promise(() => setInterval(() => {}, 1000)); }',
    );
    const extension = await readRaycastExtension(directory);
    await expect(
      new RaycastExtensionRuntime({ timeoutMs: 40 }).execute(extension, 'wave'),
    ).rejects.toBeInstanceOf(RaycastExtensionTimeoutError);
  });

  it('returns structured worker failures without crashing the daemon process', async () => {
    const directory = await builtExtension(
      "export default function wave() { throw new TypeError('kaboom'); }",
    );
    const extension = await readRaycastExtension(directory);
    await expect(new RaycastExtensionRuntime().execute(extension, 'wave')).rejects.toMatchObject({
      name: 'RaycastExtensionWorkerError',
      causeName: 'TypeError',
      message: expect.stringContaining('kaboom'),
    } satisfies Partial<RaycastExtensionWorkerError>);
  });

  it('reports source-only commands as a preparation error', async () => {
    const directory = await builtExtension();
    const extension = await readRaycastExtension(directory);
    await expect(new RaycastExtensionRuntime().execute(extension, 'wave')).rejects.toBeInstanceOf(
      RaycastExtensionPreparationError,
    );
  });
});
