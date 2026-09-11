import { THINGS_KIND_FILTERS, THINGS_SORT_OPTIONS, THINGS_GROUP_OPTIONS, isFolder, thingOpenHref, type ThingsThing, type ThingsCache, type ThingsView, type ThingsDisplayMode, type ThingsSort, type ThingsGroupBy, type ThingsKindFilter } from './thingsCore';

export type ThingsLocationState = { q: string; view: ThingsView; display: ThingsDisplayMode; sort: ThingsSort; group: ThingsGroupBy; kind: ThingsKindFilter };
const choice = <T extends string>(value: string | null | undefined, choices: readonly T[], fallback: T): T =>
  choices.includes(value as T) ? value as T : fallback;

export const readThingsLocation = (params: URLSearchParams, cache?: ThingsCache | null): ThingsLocationState => ({
  q: params.get('q') || '',
  view: choice(params.get('view') ?? cache?.view, ['grid', 'list', 'columns'], 'grid'),
  display: choice(params.get('display') ?? cache?.displayMode, ['name', 'preview'], 'name'),
  sort: choice(params.get('sort') ?? cache?.sort, THINGS_SORT_OPTIONS.map(x => x.id), 'newest'),
  group: choice(params.get('group') ?? cache?.groupBy, THINGS_GROUP_OPTIONS.map(x => x.id), 'none'),
  kind: choice(params.get('kind'), THINGS_KIND_FILTERS.map(x => x.id), 'all')
});

// Preserve folder/device/preview and unrelated parameters. Explicit preference
// defaults make each history entry independent of later local-cache changes.
export const writeThingsLocation = (params: URLSearchParams, state: ThingsLocationState): URLSearchParams => {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(state)) {
    if (key === 'q' && !value) next.delete(key);
    else next.set(key, value);
  }
  return next;
};

export const thingBrowseHref = (thing: Pick<ThingsThing, 'id' | 'thingtime'>, search = '') => {
  if (!isFolder(thing)) return thingOpenHref(thing, 'things');
  const next = new URLSearchParams(search);
  next.set('folder', thing.id);
  for (const key of ['q', 'preview', 'device']) next.delete(key);
  return `/things?${next}`;
};
