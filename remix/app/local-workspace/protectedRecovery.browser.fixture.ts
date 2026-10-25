// Opt-in native acceptance only. Never imported by application code.
import { WorkspaceDatabase } from './storage';
import { LocalThemes } from './themes';
import { LocalAlgorithms } from './algorithms';
import { LocalThings } from './things';
import { LocalTimeline } from './timeline';

const db = new WorkspaceDatabase(indexedDB);
const scope = { kind: 'anonymous' } as const;
const lease = { assertCurrent() {}, onInvalidate: () => () => {} };
const themes = new LocalThemes(db, lease), algorithms = new LocalAlgorithms(db, lease);
const things = new LocalThings(db, scope, lease), history = new LocalTimeline(db, lease, location.origin);

export async function seed() {
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
 await themes.remove(theme.id); await algorithms.remove(algorithm.id);
 const snapshots = [];
 for (const profile of profiles) {
  const entries = (await history.page({ thingId: profile.id, before: null, after: null, limit: 40 })).entries;
  const deletion = entries.find(row => row.event.operation === 'delete')!;
  if (!deletion) throw Error('The dedicated writer did not retain its deletion');
  snapshots.push({ ...profile, deletionId: deletion.event.id, expected: deletion.event.before });
 }
 return { profiles: snapshots, folderId: folder.id };
}

export async function proof(ids: string[]) {
 const rows = await db.transaction(scope, 'readonly', lease, async tx => {
  const result = [];
  for (const id of ids) result.push({ id, row: await tx.get('things', id) ?? null });
  return result;
 });
 const entries = [];
 for (const id of ids) entries.push({ id, entries: (await history.page({ thingId: id, before: null, after: null, limit: 40 })).entries });
 return { rows, entries, themes: await themes.list(), algorithms: await algorithms.list(),
  authority: 'anonymous-device-only' as const };
}
