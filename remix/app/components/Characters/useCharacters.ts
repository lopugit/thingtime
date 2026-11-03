import React from 'react';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { characterRequest, type CharacterRoster } from './characterClient';
// Private, memory-only, identity-partitioned roster. Concurrent composers share
// one page walk; mutations invalidate it for every open composer.
const cache = new Map<string, { roster: CharacterRoster; at: number }>();
const pending = new Map<string, Promise<CharacterRoster>>();
const changed = 'thingtime-characters-changed';
let generation = 0;
export function invalidateCharacters() {
  generation++; cache.clear(); pending.clear();
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(changed));
}
function load(key: string) {
  const underway = pending.get(key);
  if (underway) return underway;
  const captured = generation;
  const promise = (async () => {
    const first = await characterRequest() as CharacterRoster;
    const characters = [...first.characters];
    const seen = new Set<string>();
    let cursor = first.nextCursor;
    while (cursor) {
      if (seen.has(cursor)) throw new Error('Character pagination did not advance');
      seen.add(cursor);
      const page = await characterRequest(undefined, { cursor }) as CharacterRoster;
      characters.push(...page.characters); cursor = page.nextCursor;
    }
    const roster = { ...first, characters, nextCursor: null };
    if (captured === generation) cache.set(key, { roster, at: Date.now() });
    return roster;
  })().finally(() => { if (pending.get(key) === promise) pending.delete(key); });
  pending.set(key, promise);
  return promise;
}
export function useCharacters() {
  const user = useCurrentUser();
  const key = `${typeof window === 'undefined' ? '' : window.location.origin}:${user?.id || ''}`;
  const [state, setState] = React.useState<{ key: string; roster: CharacterRoster | null; error: string }>(() => ({key, roster: cache.get(key)?.roster || null, error: ''}));
  const [revision, bump] = React.useReducer(n => n + 1, 0);
  const refresh = React.useCallback(() => { cache.delete(key); bump(); }, [key]);
  React.useEffect(() => { window.addEventListener(changed, refresh); return () => window.removeEventListener(changed, refresh); }, [refresh]);
  React.useEffect(() => {
    let active = true;
    const known = cache.get(key);
    setState(previous => ({ key, roster: known?.roster || (previous.key === key ? previous.roster : null), error: '' }));
    if (user && (!known || Date.now() - known.at > 20000)) {
      void load(key).then(roster => { if (active) setState({key, roster, error: ''}); })
        .catch(err => { if (active) setState(previous => ({...previous, error: err.message})); });
    }
    return () => { active = false; };
  }, [key, revision]);
  return { roster: state.key === key ? state.roster : cache.get(key)?.roster || null, error: state.key === key ? state.error : '', refresh };
}
