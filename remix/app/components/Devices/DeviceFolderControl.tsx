import React from 'react';
import { useNavigate } from 'react-router';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useDataPlane } from '~/hooks/useDataPlane';
import { rootIdentity } from '~/utils/rootIdentity';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { TransientBlockHost } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import type { WebpageBlock } from '../Builder/webpageBlocks';
const blocks: WebpageBlock[] = [{ id: 'device-folder-navigation', type: 'element', tag: 'nav', props: { 'aria-label': 'Device folder' }, css: { display: 'grid', gap: '8px', 'min-width': '0' }, children: [
 { id: 'device-folder-open', type: 'element', tag: 'button', text: 'Show Folder', props: { type: 'button', disabled: '{folder.busy}', 'aria-busy': '{folder.busy}', 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation: 'open' } }, css: { 'justify-self': 'start', 'min-height': '44px', padding: '8px 12px', border: '1px solid var(--tt-border, #d4d4d8)', 'border-radius': '8px', background: 'var(--tt-card, #fff)' } },
 { id: 'device-folder-error', type: 'element', tag: 'p', text: '{folder.error}', props: { role: 'status' }, css: { margin: '0', 'font-size': '12px' } }
]}];
/** Opening a readable cloud reference is independent of native device presence. */
function DeviceFolderControlContent({ deviceId }: { deviceId: string }) {
 const api = useApi(), owner = useCurrentUser(), plane = useDataPlane(), navigate = useNavigate();
 const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
 const active = React.useRef(false), mounted = React.useRef(true);
 React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
 const open = async () => {
  if (active.current || !owner?.id || !plane || rootIdentity.read().pending) return;
  const generation = rootIdentity.read().generation, origin = window.location.origin;
  active.current = true; setBusy(true); setError('');
  const check = () => { if (window.location.origin !== origin || !mounted.current || rootIdentity.read().pending || rootIdentity.read().generation !== generation) throw Error('The active account changed.'); };
  const options = { expectedActor: owner.id, expectedDataPlane: plane, expectedApiOrigin: origin };
  try {
   const reference = await api.v1.deviceFolders.inspect(deviceId, options); check();
   const result = reference.folder ? reference : await api.v1.deviceFolders.resolve({ deviceId }, options); check();
   navigate(`/things?${new URLSearchParams({ folder: result.rootFolderId })}`);
  } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'The device folder is unavailable.'); }
  finally { active.current = false; if (mounted.current) setBusy(false); }
 };
 return <SettingsDocumentHost documentKey="device-folder-navigation" defaultDocument={blocks} scopeKey={`${owner?.id}:${plane}:${deviceId}`} title="Device folder">
  {({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={`${owner?.id}:${plane}:${deviceId}`} enabled={!editing} scope={{ folder: { busy, error } }} actions={{ open }}><WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} /></TransientBlockHost>}
 </SettingsDocumentHost>;
}

export function DeviceFolderControl({ deviceId }: { deviceId: string }) {
 const owner = useCurrentUser(), plane = useDataPlane();
 return <DeviceFolderControlContent key={`${owner?.id}:${plane}:${window.location.origin}:${deviceId}`} deviceId={deviceId} />;
}
