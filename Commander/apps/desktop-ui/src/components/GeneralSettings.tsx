import { useEffect, useState } from 'react';
import type { CommanderSettings, Platform } from '@commander/protocol';
import { Laptop, Moon, Sun } from 'lucide-react';
import { nativeRequest } from '../lib/nativeBridge.js';
import { formatShortcut, shortcutFromKeyboardEvent } from '../lib/shortcuts.js';

export function GeneralSettings({
  platform = 'macos',
  settings,
  onChange,
  onError,
}: {
  platform?: Platform;
  settings: CommanderSettings;
  onChange(next: CommanderSettings): void;
  onError(message: string | null): void;
}) {
  const [recordingHotkey, setRecordingHotkey] = useState(false);
  const [recordingPinHotkey, setRecordingPinHotkey] = useState(false);
  const update = <Key extends keyof CommanderSettings>(key: Key, value: CommanderSettings[Key]) => {
    const next = { ...settings, [key]: value };
    onChange(next);
  };
  const updateNativeToggle = async (
    key: 'openAtLogin' | 'showMenuBarIcon',
    value: boolean,
    method: 'loginItem.update' | 'menuBar.update',
  ) => {
    try {
      await nativeRequest(method, { enabled: value });
      update(key, value);
      onError(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Could not apply the native setting');
    }
  };

  useEffect(() => {
    if (!recordingHotkey) return;
    const captureShortcut = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        setRecordingHotkey(false);
        return;
      }
      const shortcut = shortcutFromKeyboardEvent(event);
      if (!shortcut) return;
      setRecordingHotkey(false);
      void nativeRequest('hotkey.update', { shortcut })
        .then(() => {
          onChange({ ...settings, hotkey: shortcut });
          onError(null);
        })
        .catch((error: unknown) => {
          onError(error instanceof Error ? error.message : 'Could not register that shortcut');
        });
    };
    window.addEventListener('keydown', captureShortcut, true);
    return () => window.removeEventListener('keydown', captureShortcut, true);
  }, [recordingHotkey, settings, onChange, onError]);

  useEffect(() => {
    if (!recordingPinHotkey) return;
    const captureShortcut = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        setRecordingPinHotkey(false);
        return;
      }
      const shortcut = shortcutFromKeyboardEvent(event);
      if (!shortcut) return;
      setRecordingPinHotkey(false);
      onChange({
        ...settings,
        windowPinning: { ...settings.windowPinning, shortcut },
      });
      onError(null);
    };
    window.addEventListener('keydown', captureShortcut, true);
    return () => window.removeEventListener('keydown', captureShortcut, true);
  }, [onChange, onError, recordingPinHotkey, settings]);

  return (
    <div className="settings-page general-settings">
      <section className="settings-group">
        <SettingRow label="Startup">
          <Toggle
            label="Launch Commander at login"
            checked={settings.openAtLogin}
            onChange={(value) => void updateNativeToggle('openAtLogin', value, 'loginItem.update')}
          />
        </SettingRow>
        <SettingRow label="Commander Hotkey">
          <button
            className={recordingHotkey ? 'hotkey-recorder recording' : 'hotkey-recorder'}
            type="button"
            aria-label={recordingHotkey ? 'Recording a new shortcut' : 'Record new shortcut'}
            aria-pressed={recordingHotkey}
            onClick={() => setRecordingHotkey((current) => !current)}
          >
            {recordingHotkey ? 'Press a shortcut…' : formatShortcut(settings.hotkey)}
          </button>
        </SettingRow>
        <SettingRow label="Menu Bar Icon">
          <Toggle
            label="Show Commander in menu bar"
            checked={settings.showMenuBarIcon}
            onChange={(value) => void updateNativeToggle('showMenuBarIcon', value, 'menuBar.update')}
          />
        </SettingRow>
      </section>

      <section className="settings-group lower-settings">
        <SettingRow label="Text Size">
          <div className="segmented icon-segmented text-size-control">
            <Segment selected={settings.textSize === 'default'} onClick={() => update('textSize', 'default')}>
              <strong>Aa</strong>
              <span>Default</span>
            </Segment>
            <Segment selected={settings.textSize === 'large'} onClick={() => update('textSize', 'large')}>
              <strong className="large-aa">Aa</strong>
              <span>Large</span>
            </Segment>
          </div>
        </SettingRow>
        <SettingRow label="Appearance">
          <div className="segmented icon-segmented appearance-control">
            <Segment selected={settings.appearance === 'light'} onClick={() => update('appearance', 'light')}>
              <Sun />
              <span>Light</span>
            </Segment>
            <Segment selected={settings.appearance === 'dark'} onClick={() => update('appearance', 'dark')}>
              <Moon />
              <span>Dark</span>
            </Segment>
            <Segment
              selected={settings.appearance === 'system'}
              onClick={() => update('appearance', 'system')}
            >
              <Laptop />
              <span>System</span>
            </Segment>
          </div>
        </SettingRow>
        <SettingRow label="Window Mode">
          <div className="window-modes">
            <button
              type="button"
              className={settings.windowMode === 'default' ? 'window-mode selected' : 'window-mode'}
              onClick={() => update('windowMode', 'default')}
            >
              <span className="window-preview default-preview">
                <i />
                <i />
              </span>
              <span>Default</span>
            </button>
            <button
              type="button"
              className={settings.windowMode === 'compact' ? 'window-mode selected' : 'window-mode'}
              onClick={() => update('windowMode', 'compact')}
            >
              <span className="window-preview compact-preview">
                <i />
                <i />
              </span>
              <span>Compact</span>
            </button>
          </div>
        </SettingRow>
        {platform === 'macos' ? (
          <SettingRow label="Window Resizing">
            <Toggle
              label="Use Commander’s custom resize handling (off uses AppKit)"
              checked={settings.useCustomWindowResizeHandling}
              onChange={(useCustomWindowResizeHandling) =>
                update('useCustomWindowResizeHandling', useCustomWindowResizeHandling)
              }
            />
          </SettingRow>
        ) : null}
        <SettingRow label="Favourites">
          <Toggle
            label="Show favourites in compact mode"
            checked={settings.showFavouritesInCompactMode}
            disabled={settings.windowMode !== 'compact'}
            onChange={(value) => update('showFavouritesInCompactMode', value)}
          />
        </SettingRow>
      </section>

      <section className="settings-group lower-settings window-pinning-settings">
        <SettingRow label="Pinned Windows">
          <Toggle
            label="Allow Commander windows to stay open"
            checked={settings.windowPinning.enabled}
            onChange={(enabled) => update('windowPinning', { ...settings.windowPinning, enabled })}
          />
        </SettingRow>
        <SettingRow label="New Windows">
          <Toggle
            label="Open new Commander windows pinned"
            checked={settings.windowPinning.defaultPinned}
            disabled={!settings.windowPinning.enabled}
            onChange={(defaultPinned) =>
              update('windowPinning', { ...settings.windowPinning, defaultPinned })
            }
          />
        </SettingRow>
        <SettingRow label="Commander Hotkey">
          <Toggle
            label="Focus the most recent window on the current display"
            checked={settings.windowPinning.focusRecentOnCurrentDisplay}
            disabled={!settings.windowPinning.enabled}
            onChange={(focusRecentOnCurrentDisplay) =>
              update('windowPinning', { ...settings.windowPinning, focusRecentOnCurrentDisplay })
            }
          />
        </SettingRow>
        <SettingRow label="Pin / Unpin Shortcut">
          <button
            className={recordingPinHotkey ? 'hotkey-recorder recording' : 'hotkey-recorder'}
            type="button"
            aria-label={recordingPinHotkey ? 'Recording pin window shortcut' : 'Record pin window shortcut'}
            aria-pressed={recordingPinHotkey}
            disabled={!settings.windowPinning.enabled}
            onClick={() => setRecordingPinHotkey((current) => !current)}
          >
            {recordingPinHotkey ? 'Press a shortcut…' : formatShortcut(settings.windowPinning.shortcut)}
          </button>
        </SettingRow>
      </section>
    </div>
  );
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="setting-row">
      <div className="setting-label">{label}</div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange(value: boolean): void;
}) {
  return (
    <label className={disabled ? 'toggle-row disabled' : 'toggle-row'}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="toggle-box" aria-hidden="true">
        {checked ? '✓' : ''}
      </span>
      <span>{label}</span>
    </label>
  );
}

function Segment({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick(): void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" className={selected ? 'segment selected' : 'segment'} onClick={onClick}>
      {children}
    </button>
  );
}
