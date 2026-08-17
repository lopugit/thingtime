// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nativeRequest } from '../lib/nativeBridge.js';
import { EmojiPicker } from './EmojiPicker.js';

vi.mock('../lib/nativeBridge.js', () => ({
  beginWindowDrag: vi.fn(),
  nativeBridgeAvailable: vi.fn(() => true),
  nativeRequest: vi.fn(async (method: string) =>
    method === 'application.pasteTarget' ? { name: 'Notes' } : undefined,
  ),
}));

describe('EmojiPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    vi.mocked(nativeRequest).mockImplementation(async (method) =>
      method === 'application.pasteTarget' ? { name: 'Notes' } : undefined,
    );
  });
  afterEach(cleanup);

  it('searches by meaning and pastes the selected emoji to the active app', async () => {
    vi.mocked(nativeRequest).mockImplementation(async (method) => {
      if (method === 'application.pasteTarget') return { name: 'Notes' };
      if (method === 'clipboard.paste')
        return { copied: true, pasted: true, requiresAccessibility: false, targetApplication: 'Notes' };
      return undefined;
    });
    render(<EmojiPicker platform="macos" onBack={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search emoji and symbols' }), {
      target: { value: 'red heart' },
    });

    const redHeart = await screen.findByRole('option', { name: /^red heart,/i });
    expect(redHeart).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('Paste to Notes')).toBeVisible();

    fireEvent.keyDown(window, { key: 'Enter' });

    await waitFor(() => expect(nativeRequest).toHaveBeenCalledWith('clipboard.paste', { text: '❤️' }));
    expect(JSON.parse(window.localStorage.getItem('commander-emoji-recents-v1') ?? '[]')).toContain(
      'emoji:2764',
    );
  });

  it('navigates the grid with arrows and opens the action selector with Command-K', async () => {
    render(<EmojiPicker platform="macos" onBack={vi.fn()} />);
    const input = screen.getByRole('textbox', { name: 'Search emoji and symbols' });
    fireEvent.change(input, { target: { value: 'heart' } });
    const grid = await screen.findByRole('listbox', { name: 'Emoji and symbol results' });
    const options = within(grid).getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(window, { key: 'k', metaKey: true });

    expect(screen.getByRole('menu')).toBeVisible();
    expect(screen.getByRole('menuitem', { name: /Copy to Clipboard/ })).toBeVisible();
  });

  it('keeps the picker open and explains the accessibility copy fallback', async () => {
    vi.mocked(nativeRequest).mockImplementation(async (method) => {
      if (method === 'clipboard.paste') return { copied: true, pasted: false, requiresAccessibility: true };
      return method === 'application.pasteTarget' ? { name: 'ChatGPT' } : undefined;
    });
    render(<EmojiPicker platform="macos" onBack={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search emoji and symbols' }), {
      target: { value: 'red heart' },
    });
    await screen.findByRole('option', { name: /^red heart,/i });

    fireEvent.keyDown(window, { key: 'Enter' });

    expect(await screen.findByRole('status')).toHaveTextContent(
      'allow Commander in Accessibility to paste automatically',
    );
  });

  it('returns to Commander with Escape', () => {
    const onBack = vi.fn();
    render(<EmojiPicker platform="macos" onBack={onBack} />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onBack).toHaveBeenCalledOnce();
  });
});
