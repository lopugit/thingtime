import { lazy, Suspense, useEffect, useMemo } from 'react';
import { extensionCommandItemId } from '@commander/protocol';
import { Launcher } from './components/Launcher.js';
import { Settings } from './components/Settings.js';
import { useCommander } from './hooks/useCommander.js';
import { nativeRequest } from './lib/nativeBridge.js';

const EmojiPicker = lazy(async () => {
  const module = await import('./components/EmojiPicker.js');
  return { default: module.EmojiPicker };
});

export function App({ surface: surfaceOverride }: { surface?: 'launcher' | 'settings' } = {}) {
  const state = useCommander();
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const surface = surfaceOverride ?? params.get('surface') ?? 'launcher';
  const nativeCommandShortcuts = useMemo(() => {
    const bootstrap = state.bootstrap;
    if (!bootstrap) return {};
    const active = new Set(
      bootstrap.extensions.flatMap((extension) =>
        extension.enabled
          ? extension.commands
              .filter((command) => !command.disabled)
              .map((command) => extensionCommandItemId(extension.id, command.name))
          : [],
      ),
    );
    return Object.fromEntries(
      Object.entries(bootstrap.settings.commandShortcuts).filter(([itemId]) => active.has(itemId)),
    );
  }, [state.bootstrap]);

  useEffect(() => {
    const id = state.bootstrap?.settings.activeAccountId;
    if (!id) return;
    void nativeRequest('credential.unlock', {
      accountId: id,
      issuer: state.bootstrap?.settings.thingtimeBaseUrl,
      clientId: state.bootstrap?.settings.thingtimeClientId,
    }).catch(() => undefined);
  }, [
    state.bootstrap?.settings.activeAccountId,
    state.bootstrap?.settings.thingtimeBaseUrl,
    state.bootstrap?.settings.thingtimeClientId,
  ]);

  useEffect(() => {
    const settings = state.bootstrap?.settings;
    if (!settings) return;
    void nativeRequest('settings.applyNative', {
      hotkey: settings.hotkey,
      commandShortcuts: nativeCommandShortcuts,
      openAtLogin: settings.openAtLogin,
      showMenuBarIcon: settings.showMenuBarIcon,
      windowMode: settings.windowMode,
      useCustomWindowResizeHandling: settings.useCustomWindowResizeHandling,
      windowPinning: settings.windowPinning,
    }).catch((error: unknown) => {
      state.reportError(error instanceof Error ? error.message : 'Could not apply native settings');
    });
  }, [
    state.bootstrap?.settings.hotkey,
    nativeCommandShortcuts,
    state.bootstrap?.settings.openAtLogin,
    state.bootstrap?.settings.showMenuBarIcon,
    state.bootstrap?.settings.windowMode,
    state.bootstrap?.settings.useCustomWindowResizeHandling,
    state.bootstrap?.settings.windowPinning,
  ]);

  if (!state.bootstrap) {
    return (
      <main className={`loading-shell ${surface}-loading-shell`} role="status">
        <section className="loading-card">
          <span className="commander-mark" aria-hidden="true">
            ›_
          </span>
          <span>{state.error ?? 'Starting Commander…'}</span>
        </section>
      </main>
    );
  }

  document.documentElement.dataset.appearance = state.bootstrap.settings.appearance;
  document.documentElement.dataset.textSize = state.bootstrap.settings.textSize;
  document.documentElement.dataset.windowMode = state.bootstrap.settings.windowMode;

  if (surface === 'settings') return <Settings state={state} />;
  if (state.activeView === 'emoji-symbols')
    return (
      <Suspense fallback={<Launcher state={state} />}>
        <EmojiPicker
          platform={state.bootstrap.platform}
          defaultAction={state.bootstrap.settings.emojiDefaultAction}
          onBack={() => {
            state.setActiveView(null);
            state.setActionsOpen(false);
          }}
        />
      </Suspense>
    );
  return <Launcher state={state} />;
}
