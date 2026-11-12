import type { Viewer } from './things';
import type { ThingsPersistence } from './persistence';
import { thingsPersistenceError } from './persistence';
import { getBoundThingsPersistence, nativeThingsReadMemoKey } from './persistenceContext';
import { nativeAudienceRows } from './nativeAudienceReads';

const identity = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && !value.includes('\0');

/** Mirror the canonical HOME link lookup. crystal.accountId is authoritative:
 * older links can legitimately lack the denormalized root parentId. Never read
 * account secure blobs, refresh provider grants, or fetch external resources. */
export async function nativeExternalAccountIds(repository: ThingsPersistence, userId: string): Promise<Set<string>> {
 const links = await nativeAudienceRows(repository, { kinds: ['external-account-link'], ownerId: userId });
 return new Set(links.map(row => row.crystal?.accountId).filter(identity));
}

/** The canonical DATA relation uses root parentId, not crystal.accountId. A
 * source row is inert after the last matching viewer link disappears; credential
 * expiry and account/provider status are not offline-content authorization. */
export async function nativeSourcesExternalPost(repository: ThingsPersistence, postId: string, accounts: ReadonlySet<string>): Promise<boolean> {
 if (!accounts.size) return false;
 const sources = await nativeAudienceRows(repository, { kinds: ['external-post-source'], targetId: postId });
 return sources.some(row => identity(row.parentId) && accounts.has(row.parentId));
}

type State = { accounts?: Promise<Set<string>>; sourced: Set<string>; sources: Map<string, Promise<void>> };
const states = new WeakMap<object, Map<string, State>>();
function stateFor(key: object, userId: string): State {
 let users = states.get(key);
 if (!users) { users = new Map(); states.set(key, users); }
 let state = users.get(userId);
 if (!state) { state = { sourced: new Set(), sources: new Map() }; users.set(userId, state); }
 return state;
}
function selection() {
 const repository = getBoundThingsPersistence(null);
 if (!repository) return null;
 const key = nativeThingsReadMemoKey();
 if (!key) return thingsPersistenceError('native audience memo scope is unavailable');
 return { repository, key };
}
const check = (key: object) => { if (nativeThingsReadMemoKey() !== key) return thingsPersistenceError('native audience memo scope changed'); };
async function accountsFor(repository: ThingsPersistence, key: object, userId: string, state: State) {
 const loading = state.accounts ?? (state.accounts = nativeExternalAccountIds(repository, userId));
 try { const ids = await loading; check(key); return ids; }
 catch (error) { if (state.accounts === loading) state.accounts = undefined; throw error; }
}
const snapshot = (viewer: NonNullable<Viewer>, ids: ReadonlySet<string>, state: State): Viewer => ({
 ...viewer, extAccountIds: new Set(ids), extSourcedPostIds: new Set(state.sourced)
});

/** null leaves the ordinary hosted implementation authoritative. Native reads
 * check their live binding even on memo hits and return a NEW Viewer snapshot.
 * The input can be shared by concurrent requests: no expando mutation can leak
 * another request/transaction's positive or negative authorization answer.
 * State is scoped by protected memo identity plus actor id, so independent
 * clones still coalesce concurrent inherited-chain reads and absent answers. */
export function ensureNativeExtAccountIds(viewer: Viewer): Promise<Viewer> | null {
 const selected = selection(); if (!selected) return null;
 if (!viewer?.id) return Promise.resolve(viewer);
 const state = stateFor(selected.key, viewer.id);
 return accountsFor(selected.repository, selected.key, viewer.id, state).then(ids => snapshot(viewer, ids, state));
}
export function ensureNativeExtSourced(viewer: Viewer, postId: string): Promise<Viewer> | null {
 const selected = selection(); if (!selected) return null;
 if (!viewer?.id || !identity(postId)) return Promise.resolve(viewer);
 const state = stateFor(selected.key, viewer.id);
 let pending = state.sources.get(postId);
 if (!pending) {
  pending = (async () => {
   const ids = await accountsFor(selected.repository, selected.key, viewer.id, state);
   const hit = await nativeSourcesExternalPost(selected.repository, postId, ids); check(selected.key);
   if (hit) state.sourced.add(postId);
  })();
  state.sources.set(postId, pending);
 }
 return pending.then(async () => {
  check(selected.key); return snapshot(viewer, await accountsFor(selected.repository, selected.key, viewer.id, state), state);
 }, error => { if (state.sources.get(postId) === pending) state.sources.delete(postId); throw error; });
}
