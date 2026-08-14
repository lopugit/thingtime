import { useEffect, useMemo } from 'react';
import { Launcher } from './components/Launcher.js';
import { Settings } from './components/Settings.js';
import { useCommander } from './hooks/useCommander.js';
import { nativeRequest } from './lib/nativeBridge.js';

export function App({ surface: surfaceOverride }: { surface?: 'launcher' | 'settings' } = {}) {
  const state = useCommander();
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const surface = surfaceOverride ?? params.get('surface') ?? 'launcher';

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
      openAtLogin: settings.openAtLogin,
      showMenuBarIcon: settings.showMenuBarIcon,
      windowMode: settings.windowMode,
    }).catch((error: unknown) => {
      state.reportError(error instanceof Error ? error.message : 'Could not apply native settings');
    });
  }, [
    state.bootstrap?.settings.hotkey,
    state.bootstrap?.settings.openAtLogin,
    state.bootstrap?.settings.showMenuBarIcon,
    state.bootstrap?.settings.windowMode,
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

  return surface === 'settings' ? <Settings state={state} /> : <Launcher state={state} />;
}
