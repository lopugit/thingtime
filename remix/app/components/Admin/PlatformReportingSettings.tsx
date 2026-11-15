import React from 'react';
import { SettingsDocumentHost } from '~/components/Settings/SettingsDocumentHost';
import { WebpageBlocksRenderer } from '~/components/Builder/WebpageBlocksRenderer';
import { TransientBlockHost, type TransientBlockActions } from '~/components/Builder/TransientBlockHost';
import { PLATFORM_REPORTING_SETTINGS_BLOCKS } from './platformReportingSettingsBlocks';
import { createFolderHostFetch } from '~/fileSync/folderHostFetch.client';
import { useDataPlane } from '~/hooks/useDataPlane';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { rootIdentity } from '~/utils/rootIdentity';
import { getElectronBridge } from '~/utils/electronBridge';
import { requireThingtimeCapability, type CapabilityTransport } from '~/api/utils/capabilities/requireCapability.client';

type Scope = { expectedActor: string; expectedApiOrigin: string };
type Transport = CapabilityTransport & { origin: string };
type Config = { enabled: boolean; ownerId: string; characterId: string; groupId: string; groupOwnerId: string; updatedBy: string; revision: string };
type Group = { id: string; name: string };
type Saved = { config: Config | null; status: string; owner: { id: string; username: string } | null; character: { id: string; username: string } | null; group: Group | null; lastReport?: { deliveryStatus: string; runStatus?: string; observedAt: string } | null };
type Draft = { enabled: boolean; ownerUsername: string; characterUsername: string; groupId: string; groupOwnerId: string };
const draftFor = (saved: Saved): Draft => ({ enabled: saved.config?.enabled ?? false, ownerUsername: saved.owner?.username ?? '', characterUsername: saved.character?.username ?? '', groupId: saved.config?.groupId ?? '', groupOwnerId: saved.config?.groupOwnerId ?? '' });
const usernameFor = (value: string) => value.trim().replace(/^@/, '').toLowerCase();

export function PlatformReportingSettings() {
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
  if (!user?.isAdmin || identity.pending || selected?.generation !== identity.generation) return null;
  return <ScopedPlatformReportingEditor key={JSON.stringify([user.id, selected.origin, identity.generation])} scope={{ expectedActor: user.id, expectedApiOrigin: selected.origin }} />;
}
function ScopedPlatformReportingEditor({ scope }: { scope: Scope }) {
  const dataPlane = useDataPlane();
  const { expectedActor, expectedApiOrigin } = scope;
  const transport = React.useMemo(() => {
    const generation = rootIdentity.read().generation;
    const check = () => {
      const identity = rootIdentity.read();
      if (identity.pending || identity.generation !== generation) throw new Error('The settings account or server changed.');
    };
    return { origin: expectedApiOrigin, currentOrigin: () => { check(); return expectedApiOrigin; },
      fetch: createFolderHostFetch({ origin: expectedApiOrigin, localOrigin: window.location.origin, ownerId: expectedActor,
        expectedDataPlane: dataPlane ?? 'unavailable', signal: new AbortController().signal, check, fetch: window.fetch.bind(window) }) };
  }, [expectedActor, expectedApiOrigin, dataPlane]);
  return <PlatformReportingSettingsEditor key={dataPlane ?? 'unavailable'} scope={scope} transport={transport} dataPlane={dataPlane ?? 'unavailable'} />;
}

// Exported for the isolated synthetic component fixture; the installed surface
// always supplies its identity-fenced selected-origin account transport above.
export function PlatformReportingSettingsEditor({ scope, transport, dataPlane }: { scope: Scope; transport: Transport; dataPlane: string }) {
  const { expectedActor, expectedApiOrigin } = scope;
  const [saved, setSaved] = React.useState<Saved | null>(null);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [groups, setGroups] = React.useState<Group[]>([]);
  const [groupName, setGroupName] = React.useState('Thingtime admin');
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [groupNotice, setGroupNotice] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [conflict, setConflict] = React.useState(false);
  const current = React.useRef({ saved, draft }); current.current = { saved, draft };
  const busy = React.useRef(false);
  const attemptedGroups = React.useRef(new Set<string>());
  const pending = React.useRef(new Set<AbortController>());
  const epoch = React.useRef(0);
  const readSequence = React.useRef(0);
  React.useEffect(() => () => {
    epoch.current++;
    for (const controller of pending.current) controller.abort();
    pending.current.clear();
  }, []);
  const request = React.useCallback(async (path: string, feature: string, version: string, signal: AbortSignal, body?: unknown) => {
    if (dataPlane !== 'home') throw new Error('Select the Home data plane to manage private scheduled run logs.');
    await requireThingtimeCapability(feature, version, expectedApiOrigin, { ...transport, signal });
    const response = await transport.fetch(new URL(path, expectedApiOrigin).href, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Thingtime-Expected-Actor': expectedActor, 'X-Thingtime-Expected-Data-Plane': dataPlane },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const result = await response.json(); signal.throwIfAborted(); transport.currentOrigin();
    if (!response.ok || result?.ok !== true) throw new Error(result?.error || 'The reporting request could not complete.');
    return result;
  }, [expectedActor, expectedApiOrigin, transport, dataPlane]);
  const readGroups = React.useCallback(async (signal: AbortSignal): Promise<Group[]> => {
    const result = await request('/api/v1/groups', 'api.groups', '1.2.1', signal);
    if (!Array.isArray(result.groups)) throw new Error('Private audience groups are unavailable.');
    return result.groups.map((group: any) => ({ id: String(group.id), name: String(group.name) }));
  }, [request]);
  const load = React.useCallback(async () => {
    if (busy.current) return;
    if (dataPlane !== 'home') { setLoading(false); setSaved(null); setDraft(null); setGroups([]); setError('Select the Home data plane to manage private scheduled run logs.'); return; }
    const sequence = ++readSequence.current, lifetime = epoch.current;
    const controller = new AbortController(); pending.current.add(controller);
    setLoading(true); setError('');
    const result = await Promise.allSettled([
      request('/api/v1/admin/platform-reporting', 'api.admin-platform-reporting', '1.0.0', controller.signal),
      readGroups(controller.signal)
    ]);
    try {
      if (epoch.current !== lifetime || readSequence.current !== sequence || controller.signal.aborted) return;
      const [configuration, audiences] = result;
      if (audiences.status === 'fulfilled') setGroups(audiences.value);
      if (configuration.status === 'rejected') throw configuration.reason;
      const next: Saved = configuration.value;
      const previous = current.current;
      const dirty = previous.saved && previous.draft && JSON.stringify(previous.draft) !== JSON.stringify(draftFor(previous.saved));
      if (!dirty) { setDraft(draftFor(next)); setConflict(false); }
      else if (previous.saved?.config?.revision !== next.config?.revision) {
        setConflict(true); setNotice('Saved settings changed. Your draft is retained; use the saved configuration before making a new change.');
      }
      setSaved(next);
      if (audiences.status === 'rejected') throw audiences.reason;
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load platform reporting.'); }
    finally { pending.current.delete(controller); if (epoch.current === lifetime && readSequence.current === sequence) setLoading(false); }
  }, [request, readGroups, dataPlane]);
  React.useEffect(() => { void load(); }, [load]);
  const patch = (value: Partial<Draft>) => { if (!busy.current) { setDraft(previous => previous && { ...previous, ...value }); setNotice(''); } };
  const save = async () => {
    if (busy.current || !draft || !saved || conflict) return;
    busy.current = true; readSequence.current++; setLoading(false); setSaving(true); setError(''); setNotice('');
    const lifetime = epoch.current;
    const controller = new AbortController(); pending.current.add(controller);
    try {
      const names = [usernameFor(draft.ownerUsername), usernameFor(draft.characterUsername)];
      if (!names.every(Boolean) || !draft.groupId) throw new Error('Choose an owner username, Character username and private audience group.');
      const profiles = await Promise.all(names.map(username => request(`/api/v1/users/profile?${new URLSearchParams({ username })}`, 'api.users-profile', '1.2.0', controller.signal)));
      if (epoch.current !== lifetime) return;
      const [owner, character] = profiles.map(result => result.profile);
      if (!owner?.id || !character?.id || usernameFor(owner.username) !== names[0] || usernameFor(character.username) !== names[1]) throw new Error('The selected usernames could not be verified on this server.');
      const groupOwnerId = saved.config?.groupId === draft.groupId ? saved.config.groupOwnerId : expectedActor;
      await request('/api/v1/admin/platform-reporting', 'api.admin-platform-reporting', '1.0.0', controller.signal, {
        enabled: draft.enabled, ownerId: owner.id, characterId: character.id, groupId: draft.groupId, groupOwnerId, revision: saved.config?.revision ?? null
      });
      const verified: Saved = await request('/api/v1/admin/platform-reporting', 'api.admin-platform-reporting', '1.0.0', controller.signal);
      if (epoch.current !== lifetime) return;
      if (!verified.config || verified.config.enabled !== draft.enabled || verified.config.ownerId !== owner.id || verified.config.characterId !== character.id || verified.config.groupId !== draft.groupId || verified.config.groupOwnerId !== groupOwnerId) throw new Error('The saved configuration could not be verified. Reload to inspect its current state.');
      setSaved(verified); setDraft(draftFor(verified)); setConflict(false); setNotice('Reporting settings saved and verified.');
    } catch (reason) {
      if (epoch.current === lifetime && !controller.signal.aborted) setError(`${reason instanceof Error ? reason.message : 'The settings could not be saved.'} Reload saved settings before retrying an uncertain save.`);
    } finally { pending.current.delete(controller); if (epoch.current === lifetime) { busy.current = false; setSaving(false); } }
  };
  const createGroup = async () => {
    if (busy.current || !draft || !groupName.trim()) return;
    busy.current = true; readSequence.current++; setLoading(false); setCreating(true); setError(''); setGroupNotice('');
    const name = groupName.trim(), lifetime = epoch.current;
    const controller = new AbortController(); pending.current.add(controller);
    let submitted = false;
    try {
      const existing = await readGroups(controller.signal);
      if (epoch.current !== lifetime) return;
      setGroups(existing);
      if (existing.some(group => group.name === name) || attemptedGroups.current.has(name)) {
        setGroupNotice('Choose an existing matching group from the audience list. A repeated creation will not be submitted.');
        return;
      }
      attemptedGroups.current.add(name); submitted = true;
      const result = await request('/api/v1/groups', 'api.groups', '1.2.1', controller.signal, { name });
      if (epoch.current !== lifetime) return;
      if (!result.group?.id || result.group.name !== name) throw new Error('Group creation could not be verified.');
      const fresh = await readGroups(controller.signal);
      if (epoch.current !== lifetime) return;
      setGroups(fresh);
      if (!fresh.some(group => group.id === result.group.id)) throw new Error('The new group is not present in your audience list.');
      setDraft(previous => previous && { ...previous, groupId: result.group.id, groupOwnerId: expectedActor });
      setGroupNotice('Private group created and selected. Save the reporting settings to use it.');
    } catch (reason) {
      if (epoch.current !== lifetime || controller.signal.aborted) return;
      if (submitted) {
        try { const refreshed = await readGroups(controller.signal); if (epoch.current === lifetime) setGroups(refreshed); } catch { /* Keep prior groups and uncertain-attempt guard. */ }
        if (epoch.current === lifetime) setGroupNotice('Creation could not be confirmed. Reload the audience list and select any matching group; this name will not be created again in this editor.');
      }
      setError(reason instanceof Error ? reason.message : 'The private group could not be created.');
    } finally { pending.current.delete(controller); if (epoch.current === lifetime) { busy.current = false; setCreating(false); } }
  };
  const ids = React.useId();
  const options = saved?.group && !groups.some(group => group.id === saved.group!.id) ? [saved.group, ...groups] : groups;
  const dirty = !!saved && !!draft && JSON.stringify(draft) !== JSON.stringify(draftFor(saved));
  const disabled = saving || creating;
  const display = {
    ids: Object.fromEntries(['enabled', 'ownerUsername', 'ownerUsernameHelp', 'characterUsername', 'characterUsernameHelp', 'groupId', 'groupName', 'groupNameHelp'].map(name => [name, `${ids}-${name}`])),
    ...draft, groups: options, groupName, ready: !!draft, loading: loading || disabled, busy: loading || disabled, disabled, conflict, dirty,
    summary: saved ? saved.config ? saved.config.enabled ? 'Private run logs are enabled.' : 'Private run logs are disabled.' : 'Reporting is unconfigured and disabled.' : 'Saved reporting configuration is unavailable.',
    error, hasError: !!error, notice: notice || (saved?.lastReport ? `Latest invocation: ${saved.lastReport.runStatus ?? 'unknown'} · log delivery ${saved.lastReport.deliveryStatus} · ${saved.lastReport.observedAt}` : ''), hasNotice: !!notice || !!saved?.lastReport,
    groupNotice, hasGroupNotice: !!groupNotice,
    saveLabel: saving ? 'Saving reporting settings…' : 'Save reporting settings',
    saveDisabled: disabled || loading || !dirty || conflict || !draft?.ownerUsername.trim() || !draft?.characterUsername.trim() || !draft?.groupId,
    createDisabled: disabled || loading || !groupName.trim(), reloadDisabled: disabled || loading
  };
  const actions: TransientBlockActions = {
    'reporting.enabled': ({ value }) => patch({ enabled: value === true }),
    'reporting.owner': ({ value }) => patch({ ownerUsername: String(value ?? '') }),
    'reporting.character': ({ value }) => patch({ characterUsername: String(value ?? '') }),
    'reporting.group': ({ value }) => patch({ groupId: String(value ?? ''), groupOwnerId: saved?.config?.groupId === value ? saved.config.groupOwnerId : expectedActor }),
    'reporting.group-name': ({ value }) => { if (!busy.current) setGroupName(String(value ?? '')); },
    'reporting.create-group': createGroup, 'reporting.save': save, 'reporting.reload': load,
    'reporting.reset': () => { if (saved && !busy.current) { setDraft(draftFor(saved)); setConflict(false); setNotice('Saved configuration loaded.'); } }
  };
  const scopeKey = JSON.stringify([expectedActor, expectedApiOrigin]);
  return <SettingsDocumentHost documentKey="platform-reporting-settings" title="Platform reporting settings layout" defaultDocument={PLATFORM_REPORTING_SETTINGS_BLOCKS} scopeKey={scopeKey} accountTransport={transport} layoutEditingDisabled={disabled}>
    {({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={scopeKey} scope={{ reporting: display }} actions={actions} enabled={!editing} onError={() => setError('This control could not complete. Reload saved settings and try again.')}>
      <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} interactive={!editing} bare />
    </TransientBlockHost>}
  </SettingsDocumentHost>;
}
