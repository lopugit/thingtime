import React from 'react';
import { getElectronBridge, type ThingtimeDesktopInfo } from '~/utils/electronBridge';
import type { TransientBlockActions, TransientBlockInvocation } from '../Builder/transientBlockActions';

/** Trusted native operations receive transient field handles. The authored
 * layout can name an operation, but cannot supply credentials or native code. */
export function useDesktopSettingsAdapter(desktopInfo: ThingtimeDesktopInfo, onInfo: (info: ThingtimeDesktopInfo) => void) {
  const runtime = desktopInfo.localRuntime;
  const settings = desktopInfo.desktopSettings;
  const storage = desktopInfo.sessionStorage;
  const authority = JSON.stringify([desktopInfo.apiOrigin, runtime?.active, runtime?.origin, settings?.selectedEndpointId, storage?.mode]);
  const currentAuthority = React.useRef(authority); currentAuthority.current = authority;
  const alive = React.useRef(true);
  React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false);
  const [notice, setNotice] = React.useState('');
  const [epoch, resetFields] = React.useReducer(value => value + 1, 0);
  const [enabled, setEnabled] = React.useState(runtime?.enabled ?? false);
  const [databaseMode, setDatabaseMode] = React.useState<'managed' | 'external'>(runtime?.databaseMode || 'managed');
  React.useEffect(() => {
    setEnabled(runtime?.enabled ?? false); setDatabaseMode(runtime?.databaseMode || 'managed');
    setNotice(''); resetFields();
  }, [authority, runtime?.enabled, runtime?.databaseMode, runtime?.apiPort, runtime?.databasePort]);
  const run = async (invocation: TransientBlockInvocation, operation: () => Promise<ThingtimeDesktopInfo | void>, success = '') => {
    if (busyRef.current || invocation.signal.aborted) return;
    const selected = authority;
    const active = () => alive.current && !invocation.signal.aborted && currentAuthority.current === selected;
    busyRef.current = true; setBusy(true); setNotice('');
    try {
      if (!active()) return;
      const next = await operation();
      if (!active()) return;
      if (next) onInfo(next);
      setNotice(success);
    } catch {
      if (active()) setNotice('The desktop operation could not be completed. Check the selected API and settings, then try again.');
    } finally {
      busyRef.current = false;
      if (alive.current && currentAuthority.current === selected) setBusy(false);
    }
  };
  const field = (invocation: TransientBlockInvocation, name: string) => {
    const value = invocation.readField(name);
    if (typeof value !== 'string') throw new Error('The required field is unavailable.');
    return value.trim();
  };
  const recoveryAvailable = !!storage?.recoveryAvailable && !runtime?.active;
  const actions: TransientBlockActions = {
    'runtime.enabled': ({ value }) => { if (!busyRef.current && typeof value === 'boolean') setEnabled(value); },
    'runtime.database-mode': ({ value }) => { if (!busyRef.current && (value === 'managed' || value === 'external')) setDatabaseMode(value); },
    'runtime.save': invocation => {
      const bridge = getElectronBridge();
      if (!bridge?.configureLocalRuntime || !runtime?.encryptionAvailable) return;
      // Read once, before the busy render disables fields. Never put URI bytes
      // in React state, binding scope, saved props, toasts or action history.
      const mongoUri = enabled && databaseMode === 'external' ? field(invocation, 'desktop-mongo-uri') : '';
      const apiPort = enabled ? Number(field(invocation, 'desktop-api-port')) : runtime.apiPort;
      const databasePort = enabled && databaseMode === 'managed' ? Number(field(invocation, 'desktop-db-port')) : runtime.databasePort;
      return run(invocation, () => bridge.configureLocalRuntime!({ enabled, databaseMode, apiPort, databasePort,
        ...(mongoUri ? { mongoUri } : {}) }), 'Runtime settings saved. Restart Thingtime to apply the change.').finally(() => {
        if (alive.current && !invocation.signal.aborted) resetFields();
      });
    },
    'runtime.choose-mongod': invocation => run(invocation, async () => await getElectronBridge()?.chooseLocalMongod?.()),
    'runtime.restart': invocation => run(invocation, async () => { await getElectronBridge()?.restartRuntime?.(); }, 'If Thingtime did not restart, close and reopen the app to apply the saved settings.'),
    'endpoint.select': invocation => {
      const id = invocation.value;
      if (runtime?.active || typeof id !== 'string' || id === settings?.selectedEndpointId || !settings?.endpointProfiles.some(endpoint => endpoint.id === id)) return;
      return run(invocation, async () => await getElectronBridge()?.selectEndpoint?.({ endpointId: id }));
    },
    'endpoint.check': invocation => run(invocation, async () => await getElectronBridge()?.checkEndpointCompatibility?.()),
    'endpoint.add': invocation => {
      const label = field(invocation, 'endpoint-name'), url = field(invocation, 'endpoint-url-input');
      return run(invocation, async () => {
        const next = await getElectronBridge()?.addEndpoint?.({ label, url });
        return next ? { ...desktopInfo, desktopSettings: next } : undefined;
      }, 'API endpoint saved.');
    },
    'endpoint.remove': invocation => {
      const id = invocation.inputs.id;
      if (typeof id !== 'string' || id === settings?.selectedEndpointId || !settings?.endpointProfiles.some(endpoint => endpoint.id === id && endpoint.source === 'custom')) return;
      return run(invocation, async () => {
        const next = await getElectronBridge()?.removeEndpoint?.({ endpointId: id });
        return next ? { ...desktopInfo, desktopSettings: next } : undefined;
      });
    },
    'session.recover': invocation => {
      if (!recoveryAvailable) return;
      const apiOrigin = field(invocation, 'desktop-session-api-origin'), contentOrigin = field(invocation, 'desktop-session-content-origin');
      return run(invocation, async () => await getElectronBridge()?.recoverDesktopSession?.({ apiOrigin, contentOrigin }),
        'If you confirmed the change, Thingtime will restart with that workspace. Cancelling leaves this workspace unchanged.');
    },
    'session.current': invocation => {
      if (!recoveryAvailable || storage?.mode !== 'legacy' || !storage.legacyApiOrigin) return;
      return run(invocation, async () => await getElectronBridge()?.useCurrentDesktopSession?.({ apiOrigin: storage.legacyApiOrigin! }),
        'If you confirmed the change, Thingtime will restart with the newer workspace.');
    }
  };
  return {
    scopeKey: `${authority}:${epoch}`, documentScopeKey: authority, actions,
    onError: () => setNotice('The control could not be used. Restore the default layout or try again.'),
    scope: { result: {
      busy, runtimePresent: !!runtime, runtimeEnabled: enabled, databaseMode,
      runtimeMode: runtime?.active ? 'local API' : 'selected remote API', apiPort: String(runtime?.apiPort ?? 28631), databasePort: String(runtime?.databasePort ?? 28632),
      mongoLabel: runtime?.bundledMongoSelected ? 'MongoDB Community Server · Included with Thingtime' : runtime?.mongodPath || 'MongoDB Server was not found.',
      mongoPlaceholder: runtime?.externalDatabaseConfigured ? 'Saved securely · enter to replace' : 'mongodb:// or mongodb+srv://',
      mongoUnsupported: !!runtime?.bundledMongoSelected && runtime.bundledMongoSupported === false,
      encryptionAvailable: !!runtime?.encryptionAvailable, saveRuntimeDisabled: busy || !runtime?.encryptionAvailable,
      runtimeErrorPresent: !!runtime?.error, runtimeError: runtime?.error || '', restartRequired: !!runtime?.restartRequired,
      localActive: !!runtime?.active, selectedEndpointId: settings?.selectedEndpointId || '', selectedEndpointUrl: settings?.selectedEndpoint.url || 'No endpoint selected',
      endpoints: settings?.endpointProfiles.map(endpoint => ({ id: endpoint.id, label: endpoint.label })) || [],
      customEndpoints: settings?.endpointProfiles.filter(endpoint => endpoint.source === 'custom').map(endpoint => ({ id: endpoint.id, label: endpoint.label, url: endpoint.url, disabled: busy || endpoint.id === settings.selectedEndpointId })) || [],
      endpointDisabled: busy || !settings || !!runtime?.active,
      compatibilityMessage: desktopInfo.endpointCompatibility?.message || '', sessionPresent: !!storage,
      workspaceMode: storage?.mode === 'legacy' ? 'previous desktop workspace' : 'workspace for this API', legacy: storage?.mode === 'legacy',
      legacyApiOrigin: storage?.legacyApiOrigin || '', legacyContentOrigin: storage?.legacyContentOrigin || '', recoveryAvailable, recoveryDisabled: busy || !recoveryAvailable,
      noticePresent: !!notice, notice
    } }
  };
}
