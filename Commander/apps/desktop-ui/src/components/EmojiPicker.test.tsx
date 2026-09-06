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
    render(<EmojiPicker platform="macos" defaultAction="paste" onBack={vi.fn()} />);
    await waitFor(() =>
      expect(nativeRequest).toHaveBeenCalledWith('launcher.commandReady', {
        itemId: 'extension:builtin:emoji-symbols:search-emoji-symbols',
      }),
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Search emoji and symbols' }), {
      target: { value: 'red heart' },
    });

    const redHeart = await screen.findByRole('option', { name: /^red heart,/i });
    expect(redHeart).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('Paste to Notes')).toBeVisible();

    fireEvent.keyDown(window, { key: 'Enter' });

    await waitFor(() =>
      expect(nativeRequest).toHaveBeenCalledWith('clipboard.paste', {
        text: '❤️',
        preserveClipboard: true,
      }),
    );
    expect(JSON.parse(window.localStorage.getItem('commander-emoji-recents-v1') ?? '[]')).toContain(
      'emoji:2764',
    );
  });

  it('navigates the grid with arrows and opens the action selector with Command-K', async () => {
    render(<EmojiPicker platform="macos" defaultAction="paste" onBack={vi.fn()} />);
    const input = screen.getByRole('textbox', { name: 'Search emoji and symbols' });
    expect(input).toHaveAttribute('autocorrect', 'off');
    expect(input).toHaveAttribute('autocapitalize', 'none');
    expect(input).toHaveAttribute('spellcheck', 'false');
    fireEvent.change(input, { target: { value: 'heart' } });
    const grid = await screen.findByRole('listbox', { name: 'Emoji and symbol results' });
    const options = within(grid).getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(input, { key: 'ArrowRight' });
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(window, { key: 'k', metaKey: true });

    expect(screen.getByRole('menu')).toBeVisible();
    expect(screen.getByRole('menuitem', { name: /Paste .*Keep Clipboard/ })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: /Copy to Clipboard/ })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: /Reset learned score for “heart”/ })).toBeVisible();
  });

  it('opens an emoji context menu on right click and resets only its learned score for the current phrase', async () => {
    window.localStorage.setItem(
      'commander-emoji-learning-v1',
      JSON.stringify({
        version: 1,
        queries: [
          {
            query: 'heart',
            choices: [
              { emojiId: 'emoji:1F499', count: 3 },
              { emojiId: 'emoji:2764', count: 1 },
            ],
          },
        ],
      }),
    );
    render(<EmojiPicker platform="macos" defaultAction="paste" onBack={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search emoji and symbols' }), {
      target: { value: 'heart' },
    });
    const blueHeart = await screen.findByRole('option', { name: /^blue heart,/i });

    fireEvent.contextMenu(blueHeart);
    fireEvent.click(screen.getByRole('menuitem', { name: /Reset learned score for “heart”/ }));

    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem('commander-emoji-learning-v1') ?? '{}') as {
        queries?: Array<{ query: string; choices: Array<{ emojiId: string; count: number }> }>;
      };
      expect(stored.queries?.[0]).toEqual({
        query: 'heart',
        choices: [{ emojiId: 'emoji:2764', count: 1 }],
      });
    });
    expect(screen.getByRole('status')).toHaveTextContent('Reset 💙 learning for “heart”');
  });

  it('learns a selected emoji for a query and restores that ranking after remount', async () => {
    vi.mocked(nativeRequest).mockImplementation(async (method) => {
      if (method === 'application.pasteTarget') return { name: 'Notes' };
      if (method === 'clipboard.paste')
        return { copied: true, pasted: true, requiresAccessibility: false, targetApplication: 'Notes' };
      return undefined;
    });
    const firstRender = render(<EmojiPicker platform="macos" defaultAction="paste" onBack={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search emoji and symbols' }), {
      target: { value: 'heart' },
    });
    const blueHeart = await screen.findByRole('option', { name: /^blue heart,/i });
    fireEvent.click(blueHeart);
    fireEvent.keyDown(window, { key: 'Enter' });

    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem('commander-emoji-learning-v1') ?? '{}') as {
        queries?: Array<{ query: string; choices: Array<{ emojiId: string; count: number }> }>;
      };
      expect(stored.queries?.[0]).toEqual({
        query: 'heart',
        choices: [{ emojiId: 'emoji:1F499', count: 1 }],
      });
    });

    firstRender.unmount();
    render(<EmojiPicker platform="macos" defaultAction="paste" onBack={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search emoji and symbols' }), {
      target: { value: 'heart' },
    });
    const restoredGrid = await screen.findByRole('listbox', { name: 'Emoji and symbol results' });

    await waitFor(() =>
      expect(within(restoredGrid).getAllByRole('option')[0]).toHaveAccessibleName(/^blue heart,/i),
    );
  });

  it('keeps denied paste selection and history stable and offers explicit recovery', async () => {
    vi.mocked(nativeRequest).mockImplementation(async (method) => {
      if (method === 'clipboard.paste') return { copied: false, pasted: false, requiresAccessibility: true };
      return method === 'application.pasteTarget' ? { name: 'ChatGPT' } : undefined;
    });
    render(<EmojiPicker platform="macos" defaultAction="paste" onBack={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search emoji and symbols' }), {
      target: { value: 'red heart' },
    });
    await screen.findByRole('option', { name: /^red heart,/i });

    fireEvent.keyDown(window, { key: 'Enter' });

    expect(await screen.findByRole('status')).toHaveTextContent('Your clipboard is unchanged');
    expect(window.localStorage.getItem('commander-emoji-recents-v1')).toBeNull();
    expect(window.localStorage.getItem('commander-emoji-learning-v1')).not.toContain('emoji:2764');
    expect(screen.getByRole('option', { name: /^red heart,/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/If it is already enabled/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Open Accessibility Settings' }));
    await waitFor(() =>
      expect(nativeRequest).toHaveBeenCalledWith('application.open', {
        path: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy Emoji' }));
    await waitFor(() => expect(nativeRequest).toHaveBeenCalledWith('clipboard.write', { text: '❤️' }));
    expect(await screen.findByRole('status')).toHaveTextContent('❤️ copied to the clipboard');
    expect(screen.queryByRole('button', { name: 'Open Accessibility Settings' })).not.toBeInTheDocument();
  });

  it('leaves Return to a focused recovery control instead of retrying the denied paste', async () => {
    vi.mocked(nativeRequest).mockImplementation(async (method) => {
      if (method === 'clipboard.paste') return { copied: false, pasted: false, requiresAccessibility: true };
      return undefined;
    });
    const onBack = vi.fn();
    render(<EmojiPicker platform="macos" defaultAction="paste" onBack={onBack} />);

    fireEvent.keyDown(window, { key: 'Enter' });
    await screen.findByRole('status');
    const pasteAttempts = () =>
      vi.mocked(nativeRequest).mock.calls.filter(([method]) => method === 'clipboard.paste').length;
    expect(pasteAttempts()).toBe(1);

    const copyEmoji = screen.getByRole('button', { name: 'Copy Emoji' });
    copyEmoji.focus();
    fireEvent.keyDown(copyEmoji, { key: 'Enter', bubbles: true });
    expect(pasteAttempts()).toBe(1);

    // Escape and Command-Return must still reach the picker while a control holds focus.
    fireEvent.keyDown(copyEmoji, { key: 'Escape', bubbles: true });
    expect(onBack).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(copyEmoji, { key: 'Enter', metaKey: true, bubbles: true });
    await waitFor(() =>
      expect(vi.mocked(nativeRequest).mock.calls.some(([method]) => method === 'clipboard.write')).toBe(true),
    );
  });

  it('does not reorder the unfiltered grid after repeated denied double clicks', async () => {
    vi.mocked(nativeRequest).mockImplementation(async (method) => {
      if (method === 'clipboard.paste') return { copied: false, pasted: false, requiresAccessibility: true };
      return undefined;
    });
    render(<EmojiPicker platform="macos" defaultAction="paste" onBack={vi.fn()} />);
    const grid = screen.getByRole('listbox');
    const order = () =>
      within(grid)
        .getAllByRole('option')
        .map((option) => option.getAttribute('aria-label'));
    const initialOrder = order();
    const emoji = within(grid).getAllByRole('option')[5];
    if (!emoji) throw new Error('Expected a non-leading emoji');
    const label = emoji.getAttribute('aria-label');
    fireEvent.click(emoji);
    fireEvent.doubleClick(emoji);
    await screen.findByRole('status');
    fireEvent.doubleClick(emoji);
    await screen.findByRole('status');
    expect(order()).toEqual(initialOrder);
    expect(emoji).toHaveAttribute('aria-selected', 'true');
    expect(emoji).toHaveAttribute('aria-label', label);
    expect(window.localStorage.getItem('commander-emoji-recents-v1')).toBeNull();
  });

  it('serializes repeated Return while a paste is pending and permits a retry after failure', async () => {
    let finish: (value: unknown) => void = () => undefined;
    vi.mocked(nativeRequest).mockImplementation(async (method) => {
      if (method === 'clipboard.paste')
        return new Promise((resolve) => {
          finish = resolve;
        });
      return undefined;
    });
    render(<EmojiPicker platform="macos" defaultAction="paste" onBack={vi.fn()} />);
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'Enter', repeat: true });
    expect(
      vi.mocked(nativeRequest).mock.calls.filter(([method]) => method === 'clipboard.paste'),
    ).toHaveLength(1);
    finish({ copied: false, pasted: false, requiresAccessibility: true });
    await screen.findByRole('status');
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(
      vi.mocked(nativeRequest).mock.calls.filter(([method]) => method === 'clipboard.paste'),
    ).toHaveLength(2);
    finish({ copied: false, pasted: true, requiresAccessibility: false });
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Open Accessibility Settings' })).not.toBeInTheDocument();
  });

  it('returns to Commander with Escape', () => {
    const onBack = vi.fn();
    render(<EmojiPicker platform="macos" defaultAction="paste" onBack={onBack} />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onBack).toHaveBeenCalledOnce();
  });
});
