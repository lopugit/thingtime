import { describe, expect, it } from 'vitest';
import { DEFAULT_INDEXING_SETTINGS, normalizeIndexingSettings } from './index.js';

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
    });
  });

  it('allows an intentionally empty custom ignore list', () => {
    expect(normalizeIndexingSettings({ customIgnores: [] }).customIgnores).toEqual([]);
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
