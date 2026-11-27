import React from 'react';
import { SettingsDocumentHost } from '~/components/Settings/SettingsDocumentHost';
import { WebpageBlocksRenderer } from '~/components/Builder/WebpageBlocksRenderer';
import { TransientBlockHost, type TransientBlockActions } from '~/components/Builder/TransientBlockHost';
import { MONGO_CONNECTION_INVENTORY_BLOCKS, migrateMongoInventoryBlocks } from './mongoConnectionInventoryBlocks';
import type { MongoConnectionInventory as Inventory } from '~/mongodb/connectionInventory';
import { presentMongoSources, presentMongoDeployments, presentMongoCoverageNotes, mergeMongoInventory } from './mongoConnectionInventoryPresentation';
import { useApi } from '~/hooks/useApi';
import { createFolderHostFetch } from '~/fileSync/folderHostFetch.client';
import { useDataPlane } from '~/hooks/useDataPlane';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { rootIdentity } from '~/utils/rootIdentity';
import { getElectronBridge } from '~/utils/electronBridge';

// The same editable inventory appears in Admin and Settings → Admin.
// Runtime observations remain in memory and never enter the saved layout.
export const MongoConnectionInventory = () => {
  const user = useCurrentUser();
  const plane = useDataPlane();
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
  return <InventoryView key={JSON.stringify([user.id, selected.origin, identity.generation, plane])} scope={scope} />;
};

const InventoryView = ({ scope }: { scope: { expectedActor: string; expectedApiOrigin: string } }) => {
 const { expectedActor, expectedApiOrigin } = scope;
 const dataPlane = useDataPlane();
 const accountTransport = React.useMemo(() => {
  const identityGeneration = rootIdentity.read().generation;
  const check = () => { const current = rootIdentity.read(); if (current.pending || current.generation !== identityGeneration) throw new Error('The account or server changed.'); };
  return { origin: expectedApiOrigin, currentOrigin: () => { check(); return expectedApiOrigin; }, fetch: createFolderHostFetch({ origin: expectedApiOrigin, localOrigin: window.location.origin, ownerId: expectedActor, expectedDataPlane: dataPlane ?? 'unavailable', signal: new AbortController().signal, check, fetch: window.fetch.bind(window) }) };
 }, [expectedApiOrigin, expectedActor, dataPlane]);
 const api = useApi(); const apiRef = React.useRef(api); apiRef.current = api;
 const [inventory, setInventory] = React.useState<Inventory | null>(null);
 const [busy, setBusy] = React.useState(false); const [error, setError] = React.useState('');
 const [query, setQuery] = React.useState(''); const [freshness, setFreshness] = React.useState('all');
 const [request, setRequest] = React.useState<{ revision: number; cursor?: string }>({ revision: 0 });
 const generation = React.useRef(0);
 React.useEffect(() => {
  const current = ++generation.current; const controller = new AbortController(); setBusy(true);
  apiRef.current.v1.admin.mongodbConnections({ limit: 50, ...(request.cursor ? { cursor: request.cursor } : {}) }, { expectedActor, expectedApiOrigin, capabilityTransport: accountTransport, signal: controller.signal }).then((response: { ok?: boolean; error?: string; inventory?: Inventory }) => {
   if (current !== generation.current) return;
   if (!response.ok || !response.inventory) throw new Error(response.error || 'Could not read MongoDB connection observations.');
   const next = response.inventory;
   setInventory(previous => mergeMongoInventory(previous, next, Boolean(request.cursor))); setError('');
  }).catch((cause: Error) => { if (current === generation.current && !controller.signal.aborted) setError(cause.message); })
   .finally(() => { if (current === generation.current) setBusy(false); });
  return () => { controller.abort(); generation.current = current + 1; };
 }, [request, expectedActor, expectedApiOrigin, accountTransport]);
 const deployments = React.useMemo(() => presentMongoDeployments(inventory?.sources || [], query, freshness), [inventory, query, freshness]);
 const rows = React.useMemo(() => presentMongoSources(inventory?.sources || [], query, freshness), [inventory, query, freshness]);
 const actions: TransientBlockActions = {
  'inventory.search': ({ value }) => setQuery(typeof value === 'string' ? value : ''),
  'inventory.filter': ({ value }) => setFreshness(['all', 'current', 'recent', 'stale'].includes(String(value)) ? String(value) : 'all'),
  'inventory.refresh': () => { if (!busy) setRequest(previous => ({ revision: previous.revision + 1 })); },
  'inventory.more': () => { if (!busy && inventory?.nextCursor) setRequest(previous => ({ revision: previous.revision + 1, cursor: inventory.nextCursor! })); }
 };
 const totals = inventory?.totals;
 const display = { origin: expectedApiOrigin, query, freshness, busy, ready: Boolean(inventory), error, rows, deployments, empty: deployments.length === 0, hasMore: Boolean(inventory?.nextCursor), refreshLabel: busy ? 'Refreshing…' : 'Refresh observations',
  status: inventory ? `${busy ? 'Refreshing; showing last successful observation. ' : error ? 'Refresh failed; showing last successful observation. ' : ''}Latest observation fetched ${new Date(inventory.checkedAt).toLocaleString()}. No automatic polling.` : busy ? 'Reading connection observations…' : 'Connection observations unavailable.',
  resultsLabel: `${deployments.length} matching deployments · ${inventory?.sources.length || 0} loaded observations${inventory?.nextCursor ? ' · more available (partial page)' : ' · coverage remains partial'}`,
  serverSummary: totals?.serverCurrent == null ? 'Unavailable — database-reported connection count was not returned' : `${totals.serverCurrent} current connections · ${totals.serverAvailable ?? 'unknown'} available · ${totals.serverTotalCreated ?? 'unknown'} created since server start`,
  serverNote: inventory?.server.note || 'Database aggregate is separate from instrumented pools.',
  observedSummary: totals ? `${totals.observedOpen} observed open across loaded snapshots · ${totals.observedCheckedOut} checked out · ${totals.freshSources} fresh sources · ${totals.staleSources} stale sources` : '',
  notes: presentMongoCoverageNotes(inventory?.coverage.notes || [])
 };
 const scopeKey = JSON.stringify([expectedActor, expectedApiOrigin]);
 return <SettingsDocumentHost clearMobileLaunchers documentKey="mongodb-connections" title="MongoDB connections layout" defaultDocument={MONGO_CONNECTION_INVENTORY_BLOCKS} migrateBlocks={migrateMongoInventoryBlocks} scopeKey={scopeKey} accountTransport={accountTransport}>
  {({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={scopeKey} scope={{ inventory: display }} actions={actions} enabled={!editing} onError={() => setError('This control could not complete. Try refreshing observations.')}>
   <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} interactive={!editing} bare />
  </TransientBlockHost>}
 </SettingsDocumentHost>;
};
