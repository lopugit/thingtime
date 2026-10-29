import React from 'react';
import type { FileSyncResourceLimits } from '~/fileSync/configuration';
import { TransientBlockHost } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { SettingsDocumentHost, type SettingsDocumentHostProps } from '../Settings/SettingsDocumentHost';
import { parseSyncResourceDraft, syncResourceDraft, syncResourceControlsBlocks, syncResourceOperation, SYNC_SPEED_UNITS, type SyncResourceDraft } from './syncResourceControlsBlocks';
const signature = (value?: FileSyncResourceLimits) => JSON.stringify([value?.uploadBytesPerSecond, value?.downloadBytesPerSecond, value?.transferConcurrency, value?.indexingConcurrency, value?.cpuPercent]);
export function SyncResourceControls({ resourceLimits, disabled, scopeKey, accountTransport, onChange, onValidityChange }: {
 resourceLimits?: FileSyncResourceLimits; disabled: boolean; scopeKey: string;
 accountTransport?: SettingsDocumentHostProps['accountTransport']; onChange(limits?: FileSyncResourceLimits): void; onValidityChange?(valid: boolean): void;
}) {
 const prefix = React.useId(), [draft, setDraft] = React.useState(() => syncResourceDraft(resourceLimits)), [error, setError] = React.useState('');
 const [valid, setValid] = React.useState(true), validityCallback = React.useRef(onValidityChange);
 validityCallback.current = onValidityChange;
 React.useEffect(() => { validityCallback.current?.(valid); }, [valid, scopeKey]);
 const last = React.useRef({ scopeKey, signature: signature(resourceLimits), draft: syncResourceDraft(resourceLimits), limits: resourceLimits });
 const incoming = signature(resourceLimits);
 React.useEffect(() => {
  // Parent echoes of valid edits must preserve the user's decimal spelling and
  // incomplete next keystroke. Only external replacement resets the draft.
  if (last.current.scopeKey !== scopeKey || last.current.signature !== incoming) {
   const next = syncResourceDraft(resourceLimits); setDraft(next); setError(''); setValid(true);
   last.current = { scopeKey, signature: incoming, draft: next, limits: resourceLimits };
  }
 }, [scopeKey, incoming]); // eslint-disable-line react-hooks/exhaustive-deps
 const change = (key: keyof SyncResourceDraft, value: unknown) => {
  if (disabled) return;
  if ((key === 'uploadUnit' || key === 'downloadUnit') && !Object.prototype.hasOwnProperty.call(SYNC_SPEED_UNITS, String(value))) return;
  const next = { ...draft, [key]: String(value ?? '') }; setDraft(next);
  try {
   let limits = parseSyncResourceDraft(next);
   // Formatting an existing binary float for a unit control must not mutate an
   // untouched ceiling when the user changes a different field.
   const previous = last.current;
   for (const [name, field] of [['upload', 'uploadBytesPerSecond'], ['download', 'downloadBytesPerSecond']] as const) {
    if (next[name] === previous.draft[name] && next[`${name}Unit`] === previous.draft[`${name}Unit`] && previous.limits?.[field] !== undefined)
     limits = { ...limits, [field]: previous.limits[field] };
   }
   const canonical = signature(limits); setError(''); setValid(true);
   if (canonical !== previous.signature) onChange(limits);
   last.current = { scopeKey, signature: canonical, draft: next, limits };
  } catch (cause) { setValid(false); setError(cause instanceof Error ? cause.message : 'The resource limit edit was not accepted. Your draft is preserved.'); }
 };
 const ids = Object.fromEntries(Object.keys(draft).map(key => [key, `${prefix}-${key}`]));
 return <SettingsDocumentHost documentKey="file-sync-resources" defaultDocument={syncResourceControlsBlocks} scopeKey={scopeKey} title="Sync resource limits" accountTransport={accountTransport}>
  {({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={scopeKey} enabled={!editing} scope={{ resources: { ...draft, ids, disabled, error } }} actions={Object.fromEntries(Object.keys(draft).map(key => [syncResourceOperation(key), ({ value }: { value?: unknown }) => change(key as keyof SyncResourceDraft, value)]))}
   onError={() => { setValid(false); setError('The resource limit edit was not accepted. Your draft is preserved.'); }}>
   <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} />
  </TransientBlockHost>}
 </SettingsDocumentHost>;
}
