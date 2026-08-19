import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INDEXING_RESOURCE_LIMITS,
  DEFAULT_INDEXING_SETTINGS,
  normalizeIndexingSettings,
} from './index.js';

describe('normalizeIndexingSettings', () => {
  it('migrates legacy settings to safe local indexing defaults', () => {
    expect(normalizeIndexingSettings(undefined)).toEqual(DEFAULT_INDEXING_SETTINGS);
  });

  it('preserves valid roots and wildcard/regex rules while enforcing resource bounds', () => {
    expect(
      normalizeIndexingSettings({
        enabled: false,
        roots: [' ~/Documents ', '~/Documents', '/Volumes/Work'],
        respectGitIgnore: false,
        includeHidden: true,
        customIgnores: [
          { kind: 'glob', pattern: ' **/build/** ' },
          { kind: 'regex', pattern: '(^|/)scratch-[0-9]+' },
          { kind: 'unknown', pattern: 'discarded' },
        ],
        refreshIntervalMinutes: 1,
        maxEntries: 99_000_000,
        resourceLimits: {
          maxThreads: 99,
          maxParallelism: 0,
          maxOpenDirectories: 999,
          maxCpuPercent: 1,
          maxMemoryMiB: 999_999,
        },
      }),
    ).toEqual({
      enabled: false,
      roots: ['~/Documents', '/Volumes/Work'],
      respectGitIgnore: false,
      includeHidden: true,
      customIgnores: [
        { kind: 'glob', pattern: '**/build/**' },
        { kind: 'regex', pattern: '(^|/)scratch-[0-9]+' },
      ],
      refreshIntervalMinutes: 5,
      maxEntries: 10_000_000,
      resourceLimits: {
        maxThreads: 64,
        maxParallelism: 1,
        maxOpenDirectories: 256,
        maxCpuPercent: 5,
        maxMemoryMiB: 131_072,
      },
    });
  });

  it('allows an intentionally empty custom ignore list', () => {
    expect(normalizeIndexingSettings({ customIgnores: [] }).customIgnores).toEqual([]);
  });

  it('migrates missing machine resource limits without changing valid custom values', () => {
    expect(normalizeIndexingSettings({}).resourceLimits).toEqual(DEFAULT_INDEXING_RESOURCE_LIMITS);
    expect(
      normalizeIndexingSettings({
        resourceLimits: {
          maxThreads: 7,
          maxParallelism: 3,
          maxOpenDirectories: 11,
          maxCpuPercent: 42,
          maxMemoryMiB: 768,
        },
      }).resourceLimits,
    ).toEqual({
      maxThreads: 7,
      maxParallelism: 3,
      maxOpenDirectories: 11,
      maxCpuPercent: 42,
      maxMemoryMiB: 768,
    });
  });

  it('adds the noindex default to the previous built-in ignore set', () => {
    const migrated = normalizeIndexingSettings({
      customIgnores: DEFAULT_INDEXING_SETTINGS.customIgnores.slice(0, -1),
      refreshIntervalMinutes: 30,
      maxEntries: 2_000_000,
    });
    expect(migrated.customIgnores).toEqual(DEFAULT_INDEXING_SETTINGS.customIgnores);
    expect(migrated.refreshIntervalMinutes).toBe(360);
    expect(migrated.maxEntries).toBe(500_000);
  });
});
