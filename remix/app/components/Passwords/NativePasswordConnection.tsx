import React from 'react';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { TransientBlockHost } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { hasNativePasswordStatus, nativePasswordConnectionEvent, nativePasswordProvider } from '~/passwords/native.client';
import { NativePasswordConnectionController, nativeConnectionPresentation } from '~/passwords/nativeConnection';
import { NATIVE_PASSWORD_CONNECTION_BLOCKS } from './nativePasswordConnectionBlocks';

export function NativePasswordConnection({ ownerId }: { ownerId: string }) {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const scopeKey = `${origin}:${ownerId}`;
  const controller = React.useMemo(() => new NativePasswordConnectionController(ownerId, nativePasswordProvider), [ownerId]);
  const snapshot = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  React.useEffect(() => {
    controller.start();
    const refresh = () => { void controller.refresh(); };
    const events = ['focus', 'thingtime:native-bridge-ready', nativePasswordConnectionEvent];
    events.forEach(event => window.addEventListener(event, refresh));
    return () => { controller.dispose(); events.forEach(event => window.removeEventListener(event, refresh)); };
  }, [controller]);
  const presentation = nativeConnectionPresentation(snapshot, hasNativePasswordStatus());
  return <SettingsDocumentHost documentKey="password-native-connection" title="Password AutoFill layout" defaultDocument={NATIVE_PASSWORD_CONNECTION_BLOCKS} scopeKey={scopeKey} layoutEditingDisabled={snapshot.busy}>
    {({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={scopeKey} enabled={!editing} actions={{ 'autofill.activate': async invocation => { if (!invocation.signal.aborted && !presentation.disabled) await controller.activate(); } }} scope={{ result: { ...presentation, notice: snapshot.notice, hasNotice: !!snapshot.notice } }}>
      <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} interactive={!editing} bare />
    </TransientBlockHost>}
  </SettingsDocumentHost>;
}
