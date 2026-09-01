// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@commander/protocol';
import { api } from '../lib/api.js';
import { SearchPreferencesSettings } from './SearchPreferencesSettings.js';

vi.mock('../lib/api.js', () => ({
  api: {
    searchCacheStatus: vi.fn(),
    clearSearchCache: vi.fn(),
  },
}));
vi.mock('../lib/nativeBridge.js', () => ({ nativeRequest: vi.fn(async () => undefined) }));

describe('SearchPreferencesSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.searchCacheStatus).mockResolvedValue({
      ...DEFAULT_SETTINGS.searchCache,
      effectiveDirectory: '/Users/test/Library/Caches/Commander/search-results-v1',
      sizeBytes: 1_048_576,
      entryCount: 4,
    });
    vi.mocked(api.clearSearchCache).mockResolvedValue({
      ok: true,
      status: {
        ...DEFAULT_SETTINGS.searchCache,
        effectiveDirectory: '/Users/test/Library/Caches/Commander/search-results-v1',
        sizeBytes: 0,
        entryCount: 0,
      },
    });
  });
  afterEach(cleanup);

  it('reorders result categories and saves cache folder, size, and lifetime controls', async () => {
    const onChange = vi.fn();
    render(<SearchPreferencesSettings settings={DEFAULT_SETTINGS} onChange={onChange} onError={vi.fn()} />);
    await screen.findByText('4 cached searches');

    const rows = screen.getAllByRole('listitem');
    fireEvent.dragStart(rows[2]!);
    fireEvent.dragOver(rows[0]!);
    fireEvent.drop(rows[0]!);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ resultCategoryOrder: ['files', 'applications', 'commands'] }),
    );

    fireEvent.change(screen.getByLabelText('Search cache folder override'), {
      target: { value: '~/Commander Cache' },
    });
    fireEvent.blur(screen.getByLabelText('Search cache folder override'));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        searchCache: expect.objectContaining({ directory: '~/Commander Cache' }),
      }),
    );

    fireEvent.change(screen.getByLabelText('Maximum search cache size in megabytes'), {
      target: { value: '512' },
    });
    fireEvent.blur(screen.getByLabelText('Maximum search cache size in megabytes'));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ searchCache: expect.objectContaining({ maxSizeBytes: 512 * 1_048_576 }) }),
    );

    fireEvent.change(screen.getByLabelText('Search cache lifetime in hours'), {
      target: { value: '12' },
    });
    fireEvent.blur(screen.getByLabelText('Search cache lifetime in hours'));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ searchCache: expect.objectContaining({ ttlMinutes: 720 }) }),
    );

    fireEvent.click(screen.getByRole('button', { name: /Clear/ }));
    await waitFor(() => expect(api.clearSearchCache).toHaveBeenCalledOnce());
    expect(screen.getByText('0 cached searches')).toBeVisible();
  });
});
