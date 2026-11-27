// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { SearchHit } from '@commander/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActionsPanel } from './ActionsPanel.js';

const item: SearchHit = {
  id: 'app:notes',
  title: 'Notes',
  kind: 'application',
  keywords: [],
  favourite: false,
  score: 100,
  matchedRanges: [],
  actions: [
    { id: 'open', title: 'Open' },
    { id: 'reveal', title: 'Reveal in Finder' },
    { id: 'copy-path', title: 'Copy Path' },
    { id: 'details', title: 'Show Details' },
  ],
};

describe('ActionsPanel selection', () => {
  afterEach(cleanup);

  it('activates the selected action when arrow keys and Enter arrive before React renders', () => {
    const onAction = vi.fn();
    render(<ActionsPanel item={item} onAction={onAction} />);

    act(() => {
      for (const key of ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowUp', 'Enter']) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
      }
    });

    expect(screen.getByRole('menuitem', { name: 'Copy Path' })).toHaveClass('selected');
    expect(onAction).toHaveBeenCalledExactlyOnceWith('copy-path');
  });

  it('keeps keyboard selection when scrolling moves a row under a stationary pointer', () => {
    const onAction = vi.fn();
    render(<ActionsPanel item={item} onAction={onAction} />);
    const open = screen.getByRole('menuitem', { name: 'Open' });

    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.scroll(screen.getByRole('menu'));
    fireEvent.mouseEnter(open);
    fireEvent.pointerEnter(open);
    expect(screen.getByRole('menuitem', { name: 'Reveal in Finder' })).toHaveClass('selected');
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onAction).toHaveBeenLastCalledWith('reveal');

    fireEvent.pointerMove(open, { clientX: 100, clientY: 60 });
    expect(open).toHaveClass('selected');
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onAction).toHaveBeenLastCalledWith('open');
  });

  it('resets the visible and executable selection when the item changes', () => {
    const onAction = vi.fn();
    const { rerender } = render(<ActionsPanel item={item} onAction={onAction} />);
    fireEvent.keyDown(window, { key: 'ArrowDown' });

    const otherItem: SearchHit = {
      ...item,
      id: 'app:mail',
      title: 'Mail',
      actions: [
        { id: 'open-mail', title: 'Open Mail' },
        { id: 'copy-mail-path', title: 'Copy Mail Path' },
      ],
    };
    rerender(<ActionsPanel item={otherItem} onAction={onAction} />);

    expect(screen.getByRole('menuitem', { name: 'Open Mail' })).toHaveClass('selected');
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onAction).toHaveBeenCalledExactlyOnceWith('open-mail');
  });
});
