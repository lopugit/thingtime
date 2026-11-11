import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { APPLICATION_DISCOVERY_MAX_DEPTH, discoverApplicationsIn } from './applications.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('macOS application discovery', () => {
  it('finds an application inside a managed /Applications container without descending into bundles', async () => {
    const applications = await mkdtemp(path.join(os.tmpdir(), 'commander-applications-'));
    temporaryDirectories.push(applications);
    await mkdir(path.join(applications, 'Setapp', 'CleanMyMac.app', 'Contents', 'Helpers', 'Internal.app'), {
      recursive: true,
    });

    const discovered = await discoverApplicationsIn([applications]);

    expect(APPLICATION_DISCOVERY_MAX_DEPTH).toBeGreaterThanOrEqual(2);
    expect(discovered).toEqual([
      expect.objectContaining({
        id: `app:${path.join(applications, 'Setapp', 'CleanMyMac.app')}`,
        title: 'CleanMyMac',
        subtitle: path.join(applications, 'Setapp', 'CleanMyMac.app'),
        kind: 'application',
      }),
    ]);
  });

  it('keeps separate application installs with the same display name across scan roots', async () => {
    const first = await mkdtemp(path.join(os.tmpdir(), 'commander-applications-first-'));
    const second = await mkdtemp(path.join(os.tmpdir(), 'commander-applications-second-'));
    temporaryDirectories.push(first, second);
    await Promise.all([
      mkdir(path.join(first, 'CleanMyMac.app')),
      mkdir(path.join(second, 'Setapp', 'CleanMyMac.app'), { recursive: true }),
    ]);

    const discovered = await discoverApplicationsIn([first, second]);

    expect(discovered).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: 'CleanMyMac', subtitle: path.join(first, 'CleanMyMac.app') }),
        expect.objectContaining({
          title: 'CleanMyMac',
          subtitle: path.join(second, 'Setapp', 'CleanMyMac.app'),
        }),
      ]),
    );
  });
});
