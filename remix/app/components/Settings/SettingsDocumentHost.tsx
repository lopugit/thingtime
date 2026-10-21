import React from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { createMemoryRouter, RouterProvider, UNSAFE_DataRouterContext } from 'react-router';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useDataPlane } from '~/hooks/useDataPlane';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import type { WebpageBlock } from '../Builder/webpageBlocks';
import type { BuilderChrome } from '../Builder/WebpageBlocksRenderer';
import type { UseWebpageDraft } from '../Builder/useWebpage';
import { useBuilderChrome } from '../Builder/useBuilderChrome';
import { BuilderDrawer } from '../Builder/BuilderDrawer';
import { accountSettingsDocumentAdapter } from './settingsDocument.client';
import { SETTINGS_BLOCK_TYPES, localSettingsDocumentAdapter, parseSettingsDocument, settingsDocumentBlocks, settingsDocumentKey, type SettingsDocument } from './settingsDocument';

export type SettingsDocumentHostProps = {
  documentKey: string;
  defaultDocument: WebpageBlock[];
  scopeKey: string;
  title?: string;
  persistence?: 'account' | 'device';
  /** Native hosts provide their selected authenticated API transport. */
  accountTransport?: { origin: string; fetch: typeof fetch; currentOrigin: () => string };
  children: (render: SettingsDocumentControls) => React.ReactNode;
};

export type SettingsDocumentControls = {
  blocks: WebpageBlock[]; chrome: BuilderChrome | null; editing: boolean;
  /** Authored blocks only; the same validation, account scope and revision fence as Builder saves. */
  setBlocks: (blocks: WebpageBlock[]) => void;
  save: () => Promise<{ ok: boolean; error?: string; id?: string }>;
  canSave: boolean; saving: boolean; dirty: boolean;
};

const OfflineContents = React.createContext<React.ReactNode>(null);
function OfflineDocument() { return <>{React.useContext(OfflineContents)}</>; }
function OfflineSettingsRouter({ children }: { children: React.ReactNode }) {
  const [router] = React.useState(() => createMemoryRouter([{ id: 'root', path: '*', element: <OfflineDocument /> }], {
    initialEntries: ['/offline-settings'], hydrationData: { loaderData: { root: { user: null, dataPlane: null } } }
  }));
  React.useEffect(() => () => router.dispose(), [router]);
  return <OfflineContents.Provider value={children}><RouterProvider router={router} /></OfflineContents.Provider>;
}

/** Offline recovery can mount outside the app router. The local boundary only
 * supplies empty route context to existing Builder controls; it never fetches
 * root data or manufactures an authenticated account. */
export function SettingsDocumentHost(props: SettingsDocumentHostProps) {
  const router = React.useContext(UNSAFE_DataRouterContext);
  return router ? <ScopedSettingsDocument {...props} /> : <OfflineSettingsRouter><ScopedSettingsDocument {...props} /></OfflineSettingsRouter>;
}

function ScopedSettingsDocument(props: SettingsDocumentHostProps) {
  const user = useCurrentUser();
  const dataPlane = useDataPlane();
  const origin = props.accountTransport?.origin ?? (typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
  const ownerId = props.persistence === 'device' ? 'device' : user?.id || 'anonymous';
  const plane = props.persistence === 'device' ? props.scopeKey : dataPlane || 'unavailable';
  const scope = React.useMemo(() => ({ origin, ownerId, dataPlane: plane, documentKey: props.documentKey }), [origin, ownerId, plane, props.documentKey]);
  const key = settingsDocumentKey(scope);
  return <SettingsDocumentSession key={`${key}:${props.scopeKey}`} {...props} documentScope={scope}
    writable={props.persistence === 'device' || (!!user?.id && !!dataPlane && !user.temporary)} />;
}

function SettingsDocumentSession({ defaultDocument, title = 'Settings layout', persistence = 'account', accountTransport, children, documentScope, writable }: SettingsDocumentHostProps & {
  documentScope: Parameters<typeof settingsDocumentKey>[0]; writable: boolean;
}) {
  const key = settingsDocumentKey(documentScope);
  const [defaults] = React.useState(() => settingsDocumentBlocks(defaultDocument));
  const cacheKey = `tt-settings-preview:${key}`;
  const initial = (): SettingsDocument => {
    try { const cached = readLocalCache<unknown>(persistence === 'device' ? key : cacheKey); if (cached) return parseSettingsDocument(cached); } catch { /* load reports invalid durable data */ }
    return { blocks: defaults, name: title, revision: null };
  };
  const [document, setDocument] = React.useState<SettingsDocument>(initial);
  const [saved, setSaved] = React.useState(document);
  const [editing, setEditing] = React.useState(false);
  const [ready, setReady] = React.useState(!writable);
  const [error, setError] = React.useState('');
  const [reload, setReload] = React.useState(0);
  const controller = React.useRef(new AbortController());
  const current = React.useRef(document); current.current = document;
  const revision = React.useRef(0);
  const loadingRevision = React.useRef(0);
  const dirty = JSON.stringify(document.blocks) !== JSON.stringify(saved.blocks) || document.name !== saved.name;
  const dirtyRef = React.useRef(dirty); dirtyRef.current = dirty;
  const adapter = React.useMemo(() => typeof window === 'undefined' ? null : persistence === 'device'
    ? localSettingsDocumentAdapter(documentScope, window.localStorage, navigator.locks)
    : accountSettingsDocumentAdapter(documentScope, accountTransport), [documentScope, persistence, accountTransport]);
  React.useEffect(() => {
    if (controller.current.signal.aborted) controller.current = new AbortController();
    return () => controller.current.abort();
  }, []);
  React.useEffect(() => {
    if (!writable || !adapter) return;
    const signal = controller.current.signal;
    let active = true;
    const load = ++loadingRevision.current;
    const edit = revision.current;
    void adapter.load(signal).then(value => {
      if (!active || signal.aborted || load !== loadingRevision.current) return;
      setReady(true); setError('');
      if (revision.current !== edit || dirtyRef.current) return;
      const next = value || { blocks: defaults, name: title, revision: null };
      setDocument(next); setSaved(next);
      if (persistence === 'account' && value) writeLocalCache(cacheKey, value);
    }).catch(() => { if (active && !signal.aborted && load === loadingRevision.current) { setReady(false); setError('Could not load your layout. The current view is preserved; retry before saving.'); } });
    return () => { active = false; };
  }, [adapter, reload, writable, cacheKey, defaults, persistence, title]);
  const update = (blocks: WebpageBlock[]) => {
    if (saving.current) return;
    try { const safe = settingsDocumentBlocks(blocks); revision.current++; setDocument(previous => ({ ...previous, blocks: safe })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'This layout change is unavailable.'); }
  };
  const saving = React.useRef(false);
  const [saveBusy, setSaveBusy] = React.useState(false);
  const save = async () => {
    if (saving.current) return { ok: false, error: 'A layout save is already running.' };
    if (!writable || !ready || !adapter) return { ok: false, error: 'Reload the current account layout before saving.' };
    const signal = controller.current.signal;
    saving.current = true; setSaveBusy(true);
    const snapshot = current.current;
    const edit = revision.current;
    try {
      const next = await adapter.save(snapshot, signal);
      if (signal.aborted) return { ok: false, error: 'Settings scope changed.' };
      loadingRevision.current++;
      setSaved(next);
      setDocument(previous => revision.current === edit ? next : { ...previous, id: next.id, revision: next.revision });
      if (persistence === 'account') writeLocalCache(cacheKey, next);
      setError('');
      return { ok: true, id: next.id };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'The layout could not be saved.';
      if (!signal.aborted) setError(message);
      return { ok: false, error: message };
    } finally { saving.current = false; if (!signal.aborted) setSaveBusy(false); }
  };
  const draft: UseWebpageDraft = {
    loading: !ready, error: !!error, blocks: document.blocks, setBlocks: update, dirty,
    resolved: { page: { id: document.id || `local-${documentScope.documentKey}`, crystal: { name: document.name, blocks: document.blocks }, author: { id: documentScope.ownerId }, acl: ['tt:user'] }, source: 'user', componentsByRef: {} },
    componentsByRef: {}, addComponent: () => setError('External component sources cannot run inside this settings layout.'),
    ensureComponent: async () => { throw new Error('Use intrinsic blocks in this settings layout.'); }, markSaved: () => {},
    save, resetToDefault: async () => { update(defaults); return { ok: true }; },
    discardDraft: () => { revision.current++; setDocument(saved); }, refresh: () => setReload(value => value + 1)
  };
  return <Box minW={0} data-settings-document={documentScope.documentKey}>
    <Flex gap={2} mb={2} align="center" flexWrap="wrap">
      <Button size="xs" variant="ghost" isDisabled={saveBusy} onClick={() => setEditing(value => !value)}>{editing ? 'Done editing layout' : 'Edit layout'}</Button>
      {dirty && <Text fontSize="xs">Unsaved layout</Text>}
      {editing && <Button size="xs" isDisabled={!ready || !writable || !dirty || saveBusy} onClick={() => void save()}>Save layout</Button>}
      {!writable && <Text fontSize="xs">Sign in to save a personal layout.</Text>}
    </Flex>
    {error && <Flex gap={2} align="center"><Text role="alert" fontSize="xs">{error}</Text><Button size="xs" onClick={() => setReload(value => value + 1)}>Retry</Button></Flex>}
    {editing ? <SettingsEditor key="edit" draft={draft} name={document.name} onName={name => { if (saving.current) return; revision.current++; setDocument(previous => ({ ...previous, name })); }}>
      {chrome => children({ blocks: document.blocks, chrome, editing: true, setBlocks: update, save, canSave: ready && writable && !saveBusy, saving: saveBusy, dirty })}
    </SettingsEditor> : <React.Fragment key="view">{children({ blocks: document.blocks, chrome: null, editing: false, setBlocks: update, save, canSave: ready && writable && !saveBusy, saving: saveBusy, dirty })}</React.Fragment>}
  </Box>;
}

function SettingsEditor({ draft, name, onName, children }: { draft: UseWebpageDraft; name: string; onName: (name: string) => void; children: (chrome: BuilderChrome) => React.ReactNode }) {
  const builder = useBuilderChrome(draft, { allowedBlockTypes: SETTINGS_BLOCK_TYPES });
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => { if (builder.selectedId) setOpen(true); }, [builder.selectedId]);
  return <>
    <Button size="xs" mb={2} onClick={() => setOpen(true)}>Open Builder inspector</Button>
    {children(builder.chrome)}{builder.insertMenu}
    {open && <BuilderDrawer allowedBlockTypes={SETTINGS_BLOCK_TYPES} allowDataSources={false} title="Settings layout" mode="site" hideTransfer draft={draft} selectedId={builder.selectedId}
      onSelectBlock={id => builder.chrome.onSelect(id)} onDeselect={builder.deselect} onClose={() => setOpen(false)} pageName={name} onPageName={onName}
      audienceAcl={['tt:user']} onAudienceAcl={() => {}} helpText="Edit this layout with normal Builder blocks. Live operations pause while editing. Save stores only the authored layout." />}
  </>;
}
