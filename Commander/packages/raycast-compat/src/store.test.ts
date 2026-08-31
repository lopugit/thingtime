import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browseRaycastStore, materializePublicRaycastExtensionSource } from './store.js';

const temporaryDirectories: string[] = [];

async function cacheDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'commander-raycast-cache-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('browseRaycastStore', () => {
  it('fuzzy-ranks feed extensions when the search contains a transposition', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              items: [
                {
                  id: 'https://www.raycast.com/raycast/github',
                  url: 'https://www.raycast.com/raycast/github',
                  title: 'GitHub',
                  summary: 'Search repositories and issues',
                  author: { name: 'Raycast' },
                },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );

    await expect(browseRaycastStore('githbu')).resolves.toEqual([
      expect.objectContaining({ name: 'github', title: 'GitHub' }),
      expect.objectContaining({ name: 'raycast-store-search' }),
    ]);
  });
});

function sourceFetch(
  items: unknown[],
  files: Record<string, string>,
): (input: string | URL) => Promise<Response> {
  return async (input) => {
    const url = new URL(input);
    if (url.hostname === 'api.github.com')
      return new Response(JSON.stringify(items), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    const body = files[url.pathname];
    return body === undefined
      ? new Response('missing', { status: 404 })
      : new Response(body, { status: 200 });
  };
}

describe('materializePublicRaycastExtensionSource', () => {
  it('materializes one bounded extension from a single sparse checkout', async () => {
    const root = await cacheDirectory();
    let checkouts = 0;
    const result = await materializePublicRaycastExtensionSource('hello', root, {
      checkout: async (name, checkoutRoot) => {
        checkouts += 1;
        const source = path.join(checkoutRoot, 'repository', 'extensions', name);
        await mkdir(path.join(source, 'src'), { recursive: true });
        await writeFile(
          path.join(source, 'package.json'),
          JSON.stringify({
            name: 'hello',
            commands: [{ name: 'wave', title: 'Wave', mode: 'no-view' }],
          }),
        );
        await writeFile(path.join(source, 'src', 'wave.ts'), 'export default function wave() {}');
        return source;
      },
    });

    expect(checkouts).toBe(1);
    expect(result).toMatchObject({ files: 2, path: result.report.extensionPath });
    expect(await readdir(result.path)).toEqual(['package.json', 'src']);
  });

  it('copies one bounded public source folder without executing it', async () => {
    const root = await cacheDirectory();
    const manifest = JSON.stringify({
      name: 'hello',
      type: 'module',
      scripts: { build: 'exit 99' },
      commands: [{ name: 'wave', title: 'Wave', mode: 'no-view' }],
    });
    const items = [
      {
        type: 'file',
        path: 'extensions/hello/package.json',
        size: manifest.length,
        download_url:
          'https://raw.githubusercontent.com/raycast/extensions/main/extensions/hello/package.json',
      },
      {
        type: 'file',
        path: 'extensions/hello/wave.js',
        size: 45,
        download_url:
          'https://raw.githubusercontent.com/raycast/extensions/main/extensions/hello/dist/wave.js',
      },
    ];
    // The second API entry deliberately maps to a nested destination even though the display path is flat.
    (items[1] as { path: string }).path = 'extensions/hello/dist/wave.js';
    const result = await materializePublicRaycastExtensionSource('hello', root, {
      fetch: sourceFetch(items, {
        '/raycast/extensions/main/extensions/hello/package.json': manifest,
        '/raycast/extensions/main/extensions/hello/dist/wave.js': 'export default async function wave() {}',
      }),
    });
    expect(result).toMatchObject({ files: 2, path: result.report.extensionPath });
    expect(result.report.readyNoViewCommands).toBe(1);
    expect(result.report.commands[0]?.buildEntry).toBe(
      path.join(result.report.extensionPath, 'dist', 'wave.js'),
    );
  });

  it('rejects traversal-like source listings and removes its temporary folder', async () => {
    const root = await cacheDirectory();
    await expect(
      materializePublicRaycastExtensionSource('hello', root, {
        fetch: sourceFetch(
          [
            {
              type: 'file',
              path: 'extensions/other/package.json',
              size: 2,
              download_url:
                'https://raw.githubusercontent.com/raycast/extensions/main/extensions/other/package.json',
            },
          ],
          {},
        ),
      }),
    ).rejects.toThrow('Unsafe Raycast source path');
    expect(await readdir(root)).toEqual([]);
  });

  it('enforces the declared aggregate byte limit before download', async () => {
    const root = await cacheDirectory();
    await expect(
      materializePublicRaycastExtensionSource('hello', root, {
        maxBytes: 10,
        fetch: sourceFetch(
          [
            {
              type: 'file',
              path: 'extensions/hello/package.json',
              size: 11,
              download_url:
                'https://raw.githubusercontent.com/raycast/extensions/main/extensions/hello/package.json',
            },
          ],
          {},
        ),
      }),
    ).rejects.toThrow('byte limit');
  });
});
