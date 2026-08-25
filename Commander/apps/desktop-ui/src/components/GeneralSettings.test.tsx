// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DEFAULT_SETTINGS } from '@commander/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nativeRequest } from '../lib/nativeBridge.js';
import { GeneralSettings } from './GeneralSettings.js';

vi.mock('../lib/nativeBridge.js', () => ({
  nativeRequest: vi.fn(async () => ({ registered: true })),
}));

describe('General settings shortcut recorder', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it('captures a new modified shortcut even after the recorder button loses focus', async () => {
    const onChange = vi.fn();
    const onError = vi.fn();
    render(<GeneralSettings settings={DEFAULT_SETTINGS} onChange={onChange} onError={onError} />);

    const recorder = screen.getByRole('button', { name: 'Record new shortcut' });
    fireEvent.click(recorder);
    recorder.blur();
    fireEvent.keyDown(window, { key: '∆', code: 'KeyJ', metaKey: true, altKey: true });

    await waitFor(() =>
      expect(nativeRequest).toHaveBeenCalledWith('hotkey.update', {
        shortcut: 'Command+Option+J',
      }),
    );
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, hotkey: 'Command+Option+J' });
    expect(onError).toHaveBeenCalledWith(null);
  });

  it('cancels recording with Escape without changing the shortcut', () => {
    const onChange = vi.fn();
    render(<GeneralSettings settings={DEFAULT_SETTINGS} onChange={onChange} onError={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Record new shortcut' }));
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(nativeRequest).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Record new shortcut' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('persists the macOS resize handling choice through the settings change callback', () => {
    const onChange = vi.fn();
    render(<GeneralSettings settings={DEFAULT_SETTINGS} onChange={onChange} onError={vi.fn()} />);

    fireEvent.click(screen.getByRole('checkbox', { name: /custom resize handling/i }));

    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_SETTINGS,
      useCustomWindowResizeHandling: false,
    });
  });

  it('does not show the AppKit-specific resize switch on Windows', () => {
    render(
      <GeneralSettings platform="windows" settings={DEFAULT_SETTINGS} onChange={vi.fn()} onError={vi.fn()} />,
    );

    expect(screen.queryByRole('checkbox', { name: /custom resize handling/i })).not.toBeInTheDocument();
  });
});
