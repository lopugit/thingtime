import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  inspectRaycastExtensionSource,
  prepareRaycastExtensionSource,
  RaycastBuildConsentError,
  readRaycastExtension,
} from './manifest.js';

const temporaryDirectories: string[] = [];

async function extensionDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'commander-raycast-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('readRaycastExtension', () => {
  it('imports enabled and disabled Raycast commands from package.json', async () => {
    const directory = await extensionDirectory();
    await writeFile(
      path.join(directory, 'package.json'),
      JSON.stringify({
        name: 'hello',
        title: 'Hello',
        description: 'Greets',
        version: '1.2.3',
        author: 'thingtime',
        commands: [{ name: 'wave', title: 'Wave', mode: 'no-view', keywords: ['hello'] }],
        disabledCommands: [{ name: 'sleep', title: 'Sleep', mode: 'view' }],
      }),
    );
    const extension = await readRaycastExtension(directory);
    expect(extension.title).toBe('Hello');
    expect(extension.commands).toEqual([
      expect.objectContaining({ name: 'wave', mode: 'no-view', disabled: false }),
      expect.objectContaining({ name: 'sleep', mode: 'view', disabled: true }),
    ]);
  });

  it('distinguishes source-only commands from runnable build artifacts', async () => {
    const directory = await extensionDirectory();
    await mkdir(path.join(directory, 'src'));
    await writeFile(path.join(directory, 'src', 'wave.tsx'), 'export default function Wave() {}');
    await writeFile(path.join(directory, 'pnpm-lock.yaml'), 'lockfileVersion: 9');
    await writeFile(
      path.join(directory, 'package.json'),
      JSON.stringify({
        name: 'hello',
        packageManager: 'pnpm@10.12.1',
        scripts: { build: 'ray build -e dist' },
        dependencies: { '@raycast/api': '^1.100.0' },
        commands: [{ name: 'wave', title: 'Wave', mode: 'no-view' }],
      }),
    );

    const report = await inspectRaycastExtensionSource(directory);
    expect(report.packageManager).toBe('pnpm');
    expect(report.sdkDeclared).toBe(true);
    expect(report.readyNoViewCommands).toBe(0);
    expect(report.commands[0]).toMatchObject({
      status: 'source-only',
      sourceEntry: path.join(report.extensionPath, 'src', 'wave.tsx'),
    });
    expect(report.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'command.source-only', commandName: 'wave' }),
    );
  });

  it('requires explicit consent before executing an extension build script', async () => {
    const directory = await extensionDirectory();
    await mkdir(path.join(directory, 'src'));
    await writeFile(path.join(directory, 'src', 'wave.ts'), 'export default function wave() {}');
    await writeFile(
      path.join(directory, 'package.json'),
      JSON.stringify({
        name: 'hello',
        scripts: { build: 'node build.mjs' },
        commands: [{ name: 'wave', title: 'Wave', mode: 'no-view' }],
      }),
    );
    await expect(prepareRaycastExtensionSource(directory, { build: true })).rejects.toBeInstanceOf(
      RaycastBuildConsentError,
    );
  });

  it('runs an explicitly trusted build and re-inspects its output', async () => {
    const directory = await extensionDirectory();
    await mkdir(path.join(directory, 'src'));
    await writeFile(path.join(directory, 'src', 'wave.ts'), 'export default function wave() {}');
    await writeFile(
      path.join(directory, 'build.mjs'),
      "import { mkdir, writeFile } from 'node:fs/promises'; await mkdir('dist'); await writeFile('dist/wave.js', 'export default async function wave() {}');",
    );
    await writeFile(
      path.join(directory, 'package.json'),
      JSON.stringify({
        name: 'hello',
        type: 'module',
        scripts: { build: 'node build.mjs' },
        commands: [{ name: 'wave', title: 'Wave', mode: 'no-view' }],
      }),
    );

    const prepared = await prepareRaycastExtensionSource(directory, {
      build: true,
      allowUntrustedBuildScripts: true,
    });
    expect(prepared.build).toMatchObject({
      attempted: true,
      command: 'npm run build',
      exitCode: 0,
      timedOut: false,
    });
    expect(prepared.report.readyNoViewCommands).toBe(1);
    expect(prepared.report.commands[0]).toMatchObject({
      status: 'ready',
      buildEntry: path.join(prepared.report.extensionPath, 'dist', 'wave.js'),
    });
  });
});
