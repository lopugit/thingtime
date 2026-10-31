// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@commander/protocol';
import { api } from '../lib/api.js';
import { IndexingSettings } from './IndexingSettings.js';

vi.mock('../lib/api.js', () => ({ api: { indexingStatus: vi.fn() } }));
vi.mock('../lib/nativeBridge.js', () => ({ nativeRequest: vi.fn(async () => undefined) }));
afterEach(cleanup);

it('does not label eligibility-filtered legacy counts as exact current totals', async () => {
  vi.mocked(api.indexingStatus).mockResolvedValue({
    available: true, running: ['all'], totalRecords: 4_300_000, countsCurrent: false,
    databaseSizeBytes: 1024,
    kinds: [{ kind: 'application', count: 12 }, { kind: 'file', count: 0 }, { kind: 'directory', count: 0 }],
    commands: { count: 20 }, automaticRefresh: { applicationsMinutes: 360, filesystemMinutes: 360 },
    customTimeoutMs: null, resourceLimits: DEFAULT_SETTINGS.indexing.resourceLimits,
    timing: { samples: 0 }, timeoutAttempts: [],
  });
  render(<IndexingSettings settings={DEFAULT_SETTINGS} onChange={vi.fn()} onError={vi.fn()} />);
  expect(await screen.findAllByText('Not measured yet')).toHaveLength(2);
  expect(screen.getByText('12 indexed')).toBeVisible();
  expect(screen.getByText('20 indexed')).toBeVisible();
  expect(screen.queryByText('0 indexed')).toBeNull();
});
