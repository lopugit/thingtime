import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CommanderExtension } from '@commander/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import {
  discoverRaycastInstallations,
  parsePropertyListXML,
  preferenceValuesForCommand,
  RaycastLocalService,
} from './raycastLocal.js';

const temporaryDirectories: string[] = [];
const installationId = '11111111-1111-1111-1111-111111111111';

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('Raycast local profile import', () => {
  it('parses a normalized plist and keeps preference values out of the renderer-facing list', async () => {
    const preferences = parsePropertyListXML(`<?xml version="1.0" encoding="UTF-8"?>
      <plist version="1.0"><dict>
        <key>commandsPreferencesExpandedItemIds</key><array>
          <string>extension_github__${installationId}</string>
          <string>extension_local-helper__dev</string>
        </array>
        <key>extension_github.open__${installationId}_repository</key><string>private-setting-value</string>
        <key>command-extension_github.open__${installationId}_activated</key><true/>
      </dict></plist>`);

    expect(discoverRaycastInstallations(preferences)).toEqual([
      {
        name: 'github',
        installationId,
        development: false,
        detectedPreferenceCount: 1,
      },
      {
        name: 'local-helper',
        installationId: 'dev',
        development: true,
        detectedPreferenceCount: 0,
      },
    ]);

    const response = await new RaycastLocalService({
      platform: 'darwin',
      loadPreferences: async () => preferences,
    }).list([], []);
    expect(response.extensions).toHaveLength(2);
    expect(JSON.stringify(response)).not.toContain('private-setting-value');
  });

  it('copies declared non-password settings and exposes merged command preferences to the worker', async () => {
    const extensionPath = await mkdtemp(path.join(os.tmpdir(), 'commander-raycast-local-'));
    temporaryDirectories.push(extensionPath);
    await writeFile(
      path.join(extensionPath, 'package.json'),
      JSON.stringify({
        name: 'github',
        title: 'GitHub',
        author: 'raycast',
        preferences: [
          { name: 'repository', type: 'textfield' },
          { name: 'theme', type: 'dropdown', default: 'system' },
          { name: 'accessToken', type: 'password' },
        ],
        commands: [
          {
            name: 'open',
            title: 'Open',
            mode: 'no-view',
            preferences: [{ name: 'includeDrafts', type: 'checkbox' }],
          },
        ],
      }),
    );
    const preferences = {
      commandsPreferencesExpandedItemIds: [`extension_github__${installationId}`],
      [`extension_github__${installationId}_repository`]: 'thingtime',
      [`extension_github__${installationId}_accessToken`]: 'fixture-protected-value',
      [`extension_github.open__${installationId}_includeDrafts`]: true,
    };
    const service = new RaycastLocalService({
      platform: 'darwin',
      loadPreferences: async () => preferences,
      now: () => new Date('2026-08-17T00:00:00.000Z'),
    });
    const extension: CommanderExtension = {
      id: 'raycast:raycast/github',
      name: 'github',
      title: 'GitHub',
      description: 'GitHub tools',
      version: '1.0.0',
      source: 'store',
      path: extensionPath,
      enabled: true,
      compatibility: 'partial',
      commands: [{ name: 'open', title: 'Open', mode: 'no-view', keywords: [], disabled: false }],
    };

    const sync = await service.syncPreferences(extension, { name: 'github', installationId });

    expect(sync.summary).toEqual({
      copied: 2,
      defaultsApplied: 1,
      missing: 0,
      protected: 1,
      syncedAt: '2026-08-17T00:00:00.000Z',
    });
    expect(sync.state.values).toEqual({ repository: 'thingtime', theme: 'system' });
    expect(sync.state.commandValues).toEqual({ open: { includeDrafts: true } });
    expect(preferenceValuesForCommand(sync.state, 'open')).toEqual({
      repository: 'thingtime',
      theme: 'system',
      includeDrafts: true,
    });
    expect(JSON.stringify(sync.state)).not.toContain('fixture-protected-value');
  });
});
