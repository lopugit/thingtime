// Opt-in native acceptance only. Never imported by application code.
import { WorkspaceDatabase } from './storage';
import { LocalThemes } from './themes';
import { LocalAlgorithms } from './algorithms';
import { LocalThings } from './things';
import { LocalTimeline } from './timeline';
import { AccountThemeSync } from './accountThemes';
import { AccountAlgorithmSync } from './accountAlgorithms';
import { AccountThingSync } from './accountSync';
import { AccountTimeline } from './accountTimeline';
import type { WorkspaceScope } from './storage';

const db = new WorkspaceDatabase(indexedDB);
let scope: WorkspaceScope = { kind: 'anonymous' };
let accountHistory: AccountTimeline | undefined;
const lease = { assertCurrent() {}, onInvalidate: () => () => {} };
let themes = new LocalThemes(db, lease), algorithms = new LocalAlgorithms(db, lease);
let things = new LocalThings(db, scope, lease), history = new LocalTimeline(db, lease, location.origin);

export function configure(ownerId: string) {
 scope = { kind: 'account', origin: location.origin, ownerId, dataPlane: 'home' };
 const themeSync = new AccountThemeSync(db, scope, lease), algorithmSync = new AccountAlgorithmSync(db, scope, lease);
 themes = themeSync.themes; algorithms = algorithmSync.algorithms;
 things = new AccountThingSync(db, scope, lease, undefined, undefined, undefined, themeSync, algorithmSync).things;
 accountHistory = new AccountTimeline(db, scope, lease);
}
const entriesFor = async (id: string) => accountHistory ? accountHistory.rows({ thingId: id }) : (await history.page({ thingId: id, before: null, after: null, limit: 40 })).entries;
export async function seed(deferDelete = false) {
 const theme = (await themes.save({ name: 'Recovery theme original', theme: { colors: { accent: '#775533' } } })).theme;
 const algorithm = (await algorithms.create({ name: 'Recovery algorithm original', description: 'Disposable local profile' })).algorithm;
 await themes.setActive(theme.id); await algorithms.setActive(algorithm.id);
 const folder = await things.create({ thingtime: ['folder'], crystal: { name: 'Recovery fixture folder' } });
 const profiles = [{ kind: 'theme', id: theme.id, title: 'Recovered theme library title', name: 'Recovery theme deleted' },
  { kind: 'feed-algorithm', id: algorithm.id, title: 'Recovered algorithm library title', name: 'Recovery algorithm deleted' }];
 for (const profile of profiles) {
  await things.renameLibrary({ id: profile.id, displayTitle: profile.title });
  await things.move([profile.id], folder.id);
 }
 await themes.save({ id: theme.id, name: profiles[0].name, theme: { colors: { accent: '#553377' } } });
 await algorithms.update({ id: algorithm.id, name: profiles[1].name });
 if (deferDelete) return { profiles, folderId: folder.id };
 return remove({ profiles, folderId: folder.id });
}
export async function remove(seeded: any) {
 const { profiles, folderId } = seeded;
 await themes.remove(profiles[0].id); await algorithms.remove(profiles[1].id);
 const snapshots = [];
 for (const profile of profiles) {
  const entries = await entriesFor(profile.id);
  const deletion = entries.find(row => row.event.operation === 'delete')!;
  if (!deletion) throw Error('The dedicated writer did not retain its deletion');
  snapshots.push({ ...profile, deletionId: deletion.event.id, expected: deletion.event.before });
 }
 return { profiles: snapshots, folderId };
}

export async function proof(ids: string[]) {
 const rows = await db.transaction(scope, 'readonly', lease, async tx => {
  const result = [];
  for (const id of ids) result.push({ id, row: await tx.get('things', id) ?? null, themeState: await tx.get('account-theme-sync', id) ?? null, algorithmState: await tx.get('account-algorithm-sync', id) ?? null });
  return result;
 });
 const entries = [];
 for (const id of ids) entries.push({ id, entries: await entriesFor(id) });
 return { rows, entries, themes: await themes.list(), algorithms: await algorithms.list(),
  authority: scope.kind === 'account' ? 'account-home-device-history' : 'anonymous-device-only' };
}
