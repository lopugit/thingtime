import React from 'react';
import { SettingsDocumentHost } from '~/components/Settings/SettingsDocumentHost';
import { WebpageBlocksRenderer } from '~/components/Builder/WebpageBlocksRenderer';
import { TransientBlockHost, type TransientBlockActions } from '~/components/Builder/TransientBlockHost';
import { PREVIEW_RETENTION_SETTINGS_BLOCKS } from './previewRetentionSettingsBlocks';
import { useApi } from '~/hooks/useApi';
import { createFolderHostFetch } from '~/fileSync/folderHostFetch.client';
import { useDataPlane } from '~/hooks/useDataPlane';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { rootIdentity } from '~/utils/rootIdentity';
import { getElectronBridge } from '~/utils/electronBridge';
import { useLopu } from '~/components/Lopu/useLopu';
import { parsePreviewRetentionPolicy, type PreviewRetentionSettings as SavedSettings, type PreviewRetentionPolicy } from '~/api/utils/ciControl/previewRetentionCore';

// A shared infrastructure settings editor, used in Admin and Settings → Admin.
// Never paint defaults as saved state when the durable read is unavailable.
export const PreviewRetentionSettings = () => {
  const user = useCurrentUser();
  const identity = React.useSyncExternalStore(rootIdentity.subscribe, rootIdentity.read, rootIdentity.read);
  const [selected, setSelected] = React.useState<{ generation: number; origin: string } | null>(null);
  React.useEffect(() => {
    let active = true;
    const bridge = getElectronBridge();
    if (!bridge) setSelected({ generation: identity.generation, origin: window.location.origin });
    else void bridge.getInfo?.().then(info => {
      if (active && info.apiOrigin) setSelected({ generation: identity.generation, origin: new URL(info.apiOrigin).origin });
    }).catch(() => { if (active) setSelected(null); });
    return () => { active = false; };
  }, [identity.generation]);
  // Keyed ownership clears both saved values and drafts before a new identity
  // paints; old read/save completions belong to the unmounted editor only.
  if (!user?.isAdmin || identity.pending || selected?.generation !== identity.generation) return null;
  const scope = { expectedActor: user.id, expectedApiOrigin: selected.origin };
  return <PreviewRetentionEditor key={JSON.stringify([user.id, selected.origin, identity.generation])} scope={scope} />;
};

const PreviewRetentionEditor = ({ scope }: { scope: { expectedActor: string; expectedApiOrigin: string } }) => {
  const { expectedActor, expectedApiOrigin } = scope;
  const dataPlane = useDataPlane();
  const accountTransport = React.useMemo(() => {
    const identityGeneration = rootIdentity.read().generation;
    const check = () => {
      const identity = rootIdentity.read();
      if (identity.pending || identity.generation !== identityGeneration) throw new Error('The settings account or server changed.');
    };
    return { origin: expectedApiOrigin, currentOrigin: () => { check(); return expectedApiOrigin; },
      fetch: createFolderHostFetch({ origin: expectedApiOrigin, localOrigin: window.location.origin, ownerId: expectedActor,
        // SettingsDocumentHost supplies its abort signal on every request;
        // duplicating that lifetime here breaks StrictMode effect remounts.
        expectedDataPlane: dataPlane ?? 'unavailable', signal: new AbortController().signal, check, fetch: window.fetch.bind(window) }) };
  }, [expectedApiOrigin, expectedActor, dataPlane]);
  const api = useApi();
  const apiRef = React.useRef(api);
  apiRef.current = api;
  const lopu = useLopu();
  const [saved, setSaved] = React.useState<SavedSettings | null>(null);
  const [draft, setDraft] = React.useState<PreviewRetentionPolicy | null>(null);
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [reload, setReload] = React.useState(0);
  const generation = React.useRef(0);
  React.useEffect(() => {
    const current = ++generation.current;
    const controller = new AbortController();
    setLoading(true);
    apiRef.current.v1.admin.ciPreviewRetention({ expectedActor, expectedApiOrigin, capabilityTransport: accountTransport, signal: controller.signal }).then((response: any) => {
      if (generation.current !== current) return;
      if (!response?.ok) throw new Error(response?.error || 'Could not load the saved policy.');
      const next = { policy: parsePreviewRetentionPolicy(response.policy), revision: response.revision };
      setSaved(next); setDraft(next.policy); setError('');
    }).catch((reason: Error) => { if (generation.current === current) setError(reason.message); })
      .finally(() => { if (generation.current === current) setLoading(false); });
    return () => { controller.abort(); generation.current = current + 1; };
  }, [reload, expectedActor, expectedApiOrigin, accountTransport]);
  const patch = (value: Partial<PreviewRetentionPolicy>) => setDraft((previous) => previous && { ...previous, ...value });
  let invalid = '';
  if (draft) { try { parsePreviewRetentionPolicy(draft); } catch (reason) { invalid = (reason as Error).message; } }
  const dirty = Boolean(saved && draft && JSON.stringify(saved.policy) !== JSON.stringify(draft));
  const pendingSaves = React.useRef(new Set<AbortController>());
  React.useEffect(() => {
    const pending = pendingSaves.current;
    return () => { for (const controller of pending) controller.abort(); pending.clear(); };
  }, []);
  const save = async () => {
    if (!saved || !draft || invalid || saving) return;
    const current = generation.current;
    const controller = new AbortController(); pendingSaves.current.add(controller);
    setSaving(true); setError('');
    try {
      const response = await apiRef.current.v1.admin.setCiPreviewRetention({ policy: draft, expectedRevision: saved.revision }, { expectedActor, expectedApiOrigin, capabilityTransport: accountTransport, signal: controller.signal });
      if (generation.current !== current) return;
      if (!response?.ok) throw new Error(response?.error || 'Could not save preview retention.');
      const next = { policy: parsePreviewRetentionPolicy(response.policy), revision: response.revision };
      setSaved(next); setDraft(next.policy);
      lopu({ title: 'Preview retention saved', status: 'success' });
    } catch (reason) { if (generation.current === current) setError((reason as Error).message); }
    finally { pendingSaves.current.delete(controller); if (generation.current === current) setSaving(false); }
  };
  const actions: TransientBlockActions = {
    'policy.enabled': ({ value }) => patch({ enabled: value === true }),
    'policy.orphan-grace': ({ value }) => patch({ noOpenPrGraceHours: value === '' ? NaN : Number(value) }),
    'policy.superseded': ({ value }) => patch({ pruneSupersededOpenPr: value === true }),
    'policy.superseded-grace': ({ value }) => patch({ supersededGraceHours: value === '' ? NaN : Number(value) }),
    'policy.inactive': ({ value }) => patch({ inactivePullRequestDays: value === true ? 30 : null }),
    'policy.inactive-days': ({ value }) => patch({ inactivePullRequestDays: value === '' ? NaN : Number(value) }),
    'policy.save': save,
    'policy.reload': () => setReload(value => value + 1)
  };
  const ids = React.useId();
  const fieldNames = ['enabled', 'noOpenPrGraceHours', 'pruneSupersededOpenPr', 'supersededGraceHours', 'inactiveEnabled', 'inactivePullRequestDays'];
  const display = {
    ids: Object.fromEntries(fieldNames.map(name => [name, `${ids}-${name}`])),
    ready: Boolean(draft), coldLoading: loading && !saved, disabled: saving,
    enabled: draft?.enabled === true, pruneSupersededOpenPr: draft?.pruneSupersededOpenPr === true,
    noOpenPrGraceHours: Number.isFinite(draft?.noOpenPrGraceHours) ? draft!.noOpenPrGraceHours : '',
    supersededGraceHours: Number.isFinite(draft?.supersededGraceHours) ? draft!.supersededGraceHours : '',
    inactiveEnabled: draft?.inactivePullRequestDays !== null && draft?.inactivePullRequestDays !== undefined,
    inactivePullRequestDays: Number.isFinite(draft?.inactivePullRequestDays) ? draft!.inactivePullRequestDays : '',
    cleanupSummary: saved ? (saved.policy.enabled ? 'Automatic cleanup enabled' : 'Automatic cleanup paused') : 'Saved policy unavailable',
    livelinessSummary: draft?.inactivePullRequestDays == null ? 'Open PRs stay live indefinitely' : `Inactive after ${draft.inactivePullRequestDays} days`,
    hasError: Boolean(error || invalid), error: error || invalid, dirty,
    saveDisabled: !dirty || Boolean(invalid) || loading || saving,
    reloadDisabled: saving || loading, saveLabel: saving ? 'Saving retention rules…' : 'Save retention rules'
  };
  const scopeKey = JSON.stringify([expectedActor, expectedApiOrigin]);
  return <SettingsDocumentHost documentKey="preview-retention-settings" title="Preview retention settings layout" defaultDocument={PREVIEW_RETENTION_SETTINGS_BLOCKS}
    scopeKey={scopeKey} accountTransport={accountTransport} layoutEditingDisabled={saving}>
    {({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={scopeKey} scope={{ retention: display }} actions={actions} enabled={!editing}
      onError={() => setError('This control could not complete. Reload the saved policy and try again.')}>
      <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} interactive={!editing} bare />
    </TransientBlockHost>}
  </SettingsDocumentHost>;
};
