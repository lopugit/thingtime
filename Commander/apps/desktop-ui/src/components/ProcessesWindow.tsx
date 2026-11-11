import { useEffect, useState } from 'react';
import type { CommanderState } from '../hooks/useCommander.js';
import { useSystemMetrics } from '../hooks/useSystemMetrics.js';
import { beginTitlebarDrag, nativeRequest } from '../lib/nativeBridge.js';
import { ProcessesPanel, useProcessPreferences } from './ProcessesPanel.js';

export function ProcessesWindow({ state }: { state: CommanderState }) {
  const [preferences, setPreferences] = useProcessPreferences();
  const { metrics } = useSystemMetrics(state.reportError, preferences.averageSeconds);
  const [keepAbove, setKeepAbove] = useState(false);
  const [changingLevel, setChangingLevel] = useState(false);
  useEffect(() => {
    void nativeRequest<{ keepAbove: boolean }>('window.state')
      .then((result) => {
        if (result) setKeepAbove(result.keepAbove);
      })
      .catch((error: unknown) =>
        state.reportError(error instanceof Error ? error.message : 'Could not read window state'),
      );
  }, [state.reportError]);
  return (
    <main className="processes-window">
      <header className="settings-titlebar" onMouseDown={beginTitlebarDrag}>
        <strong>Commander Processes</strong>
        <label className="process-checkbox" data-no-window-drag>
          <input
            type="checkbox"
            checked={keepAbove}
            disabled={changingLevel}
            onChange={(event) => {
              setChangingLevel(true);
              void nativeRequest<{ keepAbove: boolean }>('window.keepAbove', {
                enabled: event.target.checked,
              })
                .then((result) => {
                  if (result) setKeepAbove(result.keepAbove);
                })
                .catch((error: unknown) =>
                  state.reportError(error instanceof Error ? error.message : 'Could not change window level'),
                )
                .finally(() => setChangingLevel(false));
            }}
          />
          Keep above
        </label>
      </header>
      <div className="processes-window-content">
        {state.error && <p role="alert">{state.error}</p>}
        <ProcessesPanel
          processes={metrics?.machine.processes ?? []}
          preferences={preferences}
          onPreferencesChange={setPreferences}
          onError={state.reportError}
          detached
        />
      </div>
    </main>
  );
}
