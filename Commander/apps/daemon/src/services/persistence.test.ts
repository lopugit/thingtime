import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COMMANDER_THINGTIME_CLIENT_ID, DEFAULT_SETTINGS } from '@commander/protocol';
import { PersistentStore } from './persistence.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('PersistentStore Thingtime defaults', () => {
  it('migrates a legacy blank client ID and refuses to persist a blank override', async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'commander-persistence-test-'));
    const dataDirectory = path.join(temporary, 'data');
    await mkdir(dataDirectory);
    vi.stubEnv('COMMANDER_DATA_DIR', dataDirectory);
    await writeFile(
      path.join(dataDirectory, 'state.json'),
      `${JSON.stringify({
        version: 1,
        settings: { ...DEFAULT_SETTINGS, thingtimeClientId: '' },
        accounts: [],
        extensions: [],
      })}\n`,
    );

    try {
      const store = new PersistentStore();
      await store.load();
      expect(store.snapshot().settings.thingtimeClientId).toBe(COMMANDER_THINGTIME_CLIENT_ID);
      expect(
        JSON.parse(await readFile(path.join(dataDirectory, 'state.json'), 'utf8')).settings.thingtimeClientId,
      ).toBe(COMMANDER_THINGTIME_CLIENT_ID);

      await store.setSettings({ ...store.snapshot().settings, thingtimeClientId: '   ' });
      expect(store.snapshot().settings.thingtimeClientId).toBe(COMMANDER_THINGTIME_CLIENT_ID);
      expect(
        JSON.parse(await readFile(path.join(dataDirectory, 'state.json'), 'utf8')).settings.thingtimeClientId,
      ).toBe(COMMANDER_THINGTIME_CLIENT_ID);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  it('preserves an explicit client ID override for another Thingtime deployment', async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'commander-persistence-test-'));
    vi.stubEnv('COMMANDER_DATA_DIR', path.join(temporary, 'data'));

    try {
      const store = new PersistentStore();
      await store.load();
      await store.setSettings({ ...store.snapshot().settings, thingtimeClientId: 'ttapp_custom' });
      expect(store.snapshot().settings.thingtimeClientId).toBe('ttapp_custom');
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
});
