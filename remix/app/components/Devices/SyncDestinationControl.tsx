import React from 'react';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useDataPlane } from '~/hooks/useDataPlane';
import type { ConfigurationDraft } from '~/fileSync/configurationEditor';
import type { CloudFolderPath } from '~/fileSync/folderPaths';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { TransientBlockHost } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import type { WebpageBlock } from '../Builder/webpageBlocks';
import type { SettingsDocumentHostProps } from '../Settings/SettingsDocumentHost';

const blocks: WebpageBlock[] = [{ id: 'sync-destination', type: 'element', tag: 'section', props: { 'aria-label': 'Cloud destination' }, css: { display: 'grid', gap: '8px', 'min-width': '0' }, children: [
 { id: 'sync-destination-label', type: 'element', tag: 'p', text: 'Cloud folder', css: { 'font-size': '12px', margin: '0' } },
 { id: 'sync-destination-path', type: 'element', tag: 'p', text: '{destination.path}', css: { margin: '0', 'overflow-wrap': 'anywhere' } },
 { id: 'sync-destination-change', type: 'element', tag: 'button', text: '{destination.changeLabel}', props: { type: 'button', disabled: '{destination.disabled}', 'aria-expanded': '{destination.changing}', 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation: 'change' } }, css: { 'justify-self': 'start', 'min-height': '40px', padding: '6px 10px', border: '1px solid var(--tt-border, #d4d4d8)', 'border-radius': '8px', background: 'var(--tt-card, #fff)' } },
 { id: 'sync-destination-picker', type: 'condition', condition: { arg: 'destination.changing', equals: true }, children: [
  { id: 'sync-destination-default', type: 'condition', condition: { arg: 'destination.newConnection', equals: true }, children: [
   { id: 'sync-destination-default-button', type: 'element', tag: 'button', text: '{destination.defaultPath} (default)', props: { type: 'button', disabled: '{destination.disabled}', 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation: 'choose', id: '' } }, css: { 'min-height': '44px', 'text-align': 'left', 'overflow-wrap': 'anywhere', 'white-space': 'normal' } }
  ] },
  { id: 'sync-destination-device-options', type: 'collection', props: { itemsPath: 'destination.devices', label: 'Device folders', hideSearch: false, hideSize: false, size: 10, empty: 'No other device folders.' }, children: [
   { id: 'sync-destination-device-option', type: 'element', tag: 'button', text: '{item.name}', props: { type: 'button', disabled: '{destination.disabled}', 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation: 'choose-device', deviceId: '{item.deviceId}' } }, css: { 'min-height': '44px', width: '100%', padding: '8px 12px', border: '1px solid var(--tt-border, #d4d4d8)', 'border-radius': '8px', 'text-align': 'left', 'white-space': 'normal', 'overflow-wrap': 'anywhere', background: 'var(--tt-card, #fff)' } }
  ] },
  { id: 'sync-destination-more-device-state', type: 'condition', condition: { arg: 'destination.hasMoreDevices', equals: true }, children: [
   { id: 'sync-destination-more-devices', type: 'element', tag: 'button', text: 'More devices', props: { type: 'button', disabled: '{destination.disabled}', 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation: 'more-devices' } }, css: { 'min-height': '44px' } }
  ] },
  { id: 'sync-destination-options', type: 'collection', props: { itemsPath: 'destination.folders', label: 'Private cloud folders', hideSearch: false, hideSize: false, hideCount: false, size: 10, empty: 'No private folders available. New connections use their device folder by default.' }, children: [
   { id: 'sync-destination-option', type: 'element', tag: 'button', text: '{item.path}', props: { type: 'button', disabled: '{destination.disabled}', 'aria-pressed': '{item.selected}', 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation: 'choose', id: '{item.id}' } }, css: { 'min-height': '44px', width: '100%', padding: '8px 12px', border: '1px solid var(--tt-border, #d4d4d8)', 'border-radius': '8px', 'text-align': 'left', 'white-space': 'normal', 'overflow-wrap': 'anywhere', background: 'var(--tt-card, #fff)' } }
  ] }
 ] },
 { id: 'sync-destination-error', type: 'element', tag: 'p', text: '{destination.error}', props: { role: 'status' }, css: { margin: '0', 'font-size': '12px' } }
]}];

function SyncDestinationControlContent({ draft, sourceName, folders, disabled, scopeKey, accountTransport, onChange }: {
 sourceName: string; draft: ConfigurationDraft; folders: CloudFolderPath[]; disabled: boolean; scopeKey?: string;
 accountTransport?: SettingsDocumentHostProps['accountTransport']; onChange(id: string): void;
}) {
 const api = useApi(), apiRef = React.useRef(api); apiRef.current = api;
 const owner = useCurrentUser(), plane = useDataPlane();
 const [devices, setDevices] = React.useState<{ deviceId: string; name: string; rootFolderId: string }[]>([]);
 const [deviceCursor, setDeviceCursor] = React.useState<string | null>(null);
 const devicePages = React.useRef(new Set<string>());
 const [choice, setChoice] = React.useState<{ id: string; path: string } | null>(null);
 const [resolving, setResolving] = React.useState(false);
 const [deviceName, setDeviceName] = React.useState('Device'), [error, setError] = React.useState(''), [changing, setChanging] = React.useState(false);
 React.useEffect(() => {
  const controller = new AbortController();
  if (owner?.id && plane) void apiRef.current.v1.deviceFolders.inspect(draft.configuration.deviceId, { expectedActor: owner.id, expectedDataPlane: plane, expectedApiOrigin: accountTransport?.origin, signal: controller.signal }).then(result => {
   if (!controller.signal.aborted) setDeviceName(result.folder?.crystal?.name || result.deviceName);
  }).catch(() => { if (!controller.signal.aborted) setError('Device folder preview unavailable. Your destination is preserved.'); });
  if (owner?.id && plane) void apiRef.current.v1.deviceFolders.inspect(undefined, { expectedActor: owner.id, expectedDataPlane: plane, expectedApiOrigin: accountTransport?.origin, signal: controller.signal }).then(result => { if (!controller.signal.aborted) { setDevices(result.devices); setDeviceCursor(result.nextCursor ?? null); } }).catch(() => {});
  return () => controller.abort();
 }, [scopeKey, owner?.id, plane, draft.configuration.deviceId, accountTransport?.origin]);
 const selected = folders.find(folder => folder.id === draft.configuration.remoteFolderId);
 const defaultPath = `${deviceName} / Files / ${sourceName || 'Connection'}`;
 const automatic = draft.baseUpdatedAt === null && !draft.configuration.remoteFolderId;
 const path = selected?.path || (choice?.id === draft.configuration.remoteFolderId ? choice.path : undefined) || (automatic ? defaultPath : 'Saved destination · refresh folders to view its path');
 return <SettingsDocumentHost documentKey="file-sync-destination" defaultDocument={blocks} scopeKey={scopeKey || draft.id} title="Cloud destination" accountTransport={accountTransport}>
  {({ blocks, chrome, editing }) => <><TransientBlockHost scopeKey={scopeKey || draft.id} enabled={!editing} scope={{ destination: { path, error, changing, disabled: disabled || resolving, defaultPath, newConnection: draft.baseUpdatedAt === null, devices, hasMoreDevices: !!deviceCursor, folders: folders.map(folder => ({ ...folder, selected: folder.id === draft.configuration.remoteFolderId })), changeLabel: changing ? 'Done' : 'Change' } }} actions={{ 'more-devices': async ({ signal }) => {
   if (disabled || resolving || !deviceCursor || !owner?.id || !plane) return;
   const cursor = deviceCursor; setResolving(true); setError('');
   try {
    const result = await apiRef.current.v1.deviceFolders.inspect(undefined, { expectedActor: owner.id, expectedDataPlane: plane, expectedApiOrigin: accountTransport?.origin, signal }, cursor);
    signal.throwIfAborted();
    if (!Array.isArray(result.devices) || (result.nextCursor && (result.nextCursor === cursor || devicePages.current.has(result.nextCursor)))) throw Error('The device folder list could not continue. Refresh and retry.');
    devicePages.current.add(cursor);
    setDevices(previous => [...new Map([...previous, ...result.devices].map(device => [device.deviceId, device])).values()]);
    setDeviceCursor(result.nextCursor ?? null);
   } catch (cause) { if (!signal.aborted) setError(cause instanceof Error ? cause.message : 'Device folders could not be loaded.'); }
   finally { if (!signal.aborted) setResolving(false); }
  }, 'choose-device': async ({ inputs, signal }) => {
   if (disabled || resolving || !owner?.id || !plane || !devices.some(device => device.deviceId === inputs.deviceId)) return;
   setResolving(true); setError('');
   try {
    const options = { expectedActor: owner.id, expectedDataPlane: plane, expectedApiOrigin: accountTransport?.origin, signal };
    const reference = await apiRef.current.v1.deviceFolders.inspect(String(inputs.deviceId), options);
    signal.throwIfAborted();
    const result = reference.folder ? reference : await apiRef.current.v1.deviceFolders.resolve({ deviceId: String(inputs.deviceId) }, options);
    signal.throwIfAborted();
    const device = devices.find(device => device.deviceId === inputs.deviceId);
    setChoice({ id: result.rootFolderId, path: result.path || result.folder?.path || result.folder?.crystal?.name || device?.name || 'Device folder' });
    onChange(result.rootFolderId); setChanging(false);
   } catch (cause) { if (!signal.aborted) setError(cause instanceof Error ? cause.message : 'The device folder is unavailable.'); }
   finally { if (!signal.aborted) setResolving(false); }
  }, change: () => setChanging(value => !value), choose: ({ inputs }) => { const id = inputs.id; if (disabled || typeof id !== 'string' || (id === '' ? draft.baseUpdatedAt !== null : !folders.some(folder => folder.id === id))) return; onChange(id); setChanging(false); } }}>
   <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} />
  </TransientBlockHost></>}
 </SettingsDocumentHost>;
}

export function SyncDestinationControl(props: Parameters<typeof SyncDestinationControlContent>[0]) {
 const owner = useCurrentUser(), plane = useDataPlane();
 return <SyncDestinationControlContent key={`${owner?.id}:${plane}:${props.accountTransport?.origin || window.location.origin}:${props.scopeKey || props.draft.id}`} {...props} />;
}
