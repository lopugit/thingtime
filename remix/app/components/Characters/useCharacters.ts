import React from 'react';
import { characterRequest, type CharacterRoster } from './characterClient';
import { workspaceStorageBinding, workspaceStorageIdentity, subscribeWorkspaceStorage } from '../../local-workspace/storageStatus.client';
import { canSyncAccountWorkspace, workspaceDatabase } from '../../local-workspace/runtime.client';
import { createCharacterRequest } from '../../local-workspace/characterRequest.client';
import { readCharacterRoster, retainCharacterRoster } from '../../local-workspace/characterRoster.client';
// Concurrent composers share one fenced page walk. Device retention contains
// only labels for local editors; it never restores management/session authority.
const cache = new Map<string, { roster: CharacterRoster; at: number }>();
type Loaded = {roster:CharacterRoster;error:string};
const pending = new Map<string, Promise<Loaded>>();
const changed = 'thingtime-characters-changed';
const workspaceConfirmed = () => {
  const scope = workspaceStorageBinding()?.scope;
  return scope?.kind === 'account' && canSyncAccountWorkspace(scope);
};
let generation = 0;
export function invalidateCharacters() {
  generation++; cache.clear(); pending.clear();
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(changed));
}
function load(key: string, binding: NonNullable<ReturnType<typeof workspaceStorageBinding>>) {
  const underway = pending.get(key);
  if (underway) return underway;
  const captured = generation, request = createCharacterRequest();
  const promise = request(async signal => {
    const first = await characterRequest(undefined, undefined, signal) as CharacterRoster;
    const characters = [...first.characters];
    const seen = new Set<string>();
    let cursor = first.nextCursor;
    while (cursor) {
      if (seen.has(cursor)) throw new Error('Character pagination did not advance');
      seen.add(cursor);
      const page = await characterRequest(undefined, { cursor }, signal) as CharacterRoster;
      characters.push(...page.characters); cursor = page.nextCursor;
    }
    const roster = { ...first, characters, nextCursor: null };
    binding.lease.assertCurrent();
    let error = '';
    if (captured === generation && binding.scope.kind === 'account') {
      try { await retainCharacterRoster(workspaceDatabase(),binding.scope,binding.lease,roster); }
      catch(failure) {
        binding.lease.assertCurrent();
        if((failure as any)?.code === 'CHARACTER_ROSTER_INVALID')throw failure;
        error = 'Character choices are available online but could not be saved on this device.';
      }
      binding.lease.assertCurrent();
      if (captured === generation) cache.set(key, { roster, at: Date.now() });
    }
    return {roster,error};
  }).finally(() => { if (pending.get(key) === promise) pending.delete(key); });
  pending.set(key, promise);
  return promise;
}
export function useCharacters() {
  const key = React.useSyncExternalStore(subscribeWorkspaceStorage,workspaceStorageIdentity,()=> '');
  const confirmed = React.useSyncExternalStore(subscribeWorkspaceStorage,workspaceConfirmed,()=> false);
  // Capture root identity rather than a nested composer's actor override.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const binding = React.useMemo(()=>workspaceStorageBinding(),[key]);
  const [state, setState] = React.useState<{ key: string; roster: CharacterRoster | null; error: string }>(() => ({key, roster: cache.get(key)?.roster || null, error: ''}));
  const [revision, bump] = React.useReducer(n => n + 1, 0);
  const refresh = React.useCallback(() => { cache.delete(key); bump(); }, [key]);
  React.useEffect(() => {
    for(const event of [changed,'online'])window.addEventListener(event,refresh);
    return () => {for(const event of [changed,'online'])window.removeEventListener(event,refresh);};
  }, [refresh]);
  React.useEffect(() => {
    let active = true, remoteLoaded = false;
    const known = cache.get(key);
    setState(previous => ({ key, roster: known?.roster || (previous.key === key ? previous.roster : null), error: '' }));
    if(binding?.scope.kind === 'account') {
      void readCharacterRoster(workspaceDatabase(),binding.scope,binding.lease).then(roster=>{
        if(active && !remoteLoaded && !known && roster)setState({key,roster,error:''});
      }).catch(()=>{if(active && !remoteLoaded && !known)setState({key,roster:null,error:'Saved Character choices could not be opened. Reconnect and retry.'});});
      if(navigator.onLine !== false && confirmed && (!known || Date.now()-known.at>20000)) {
        void load(key,binding).then(result=>{remoteLoaded=true;if(active)setState({key,...result});})
          .catch(err=>{if(active)setState(previous=>({...previous,error:err.message}));});
      }
    }
    return () => { active = false; };
  }, [key, revision, binding, confirmed]);
  return { roster: state.key === key ? state.roster : cache.get(key)?.roster || null, error: state.key === key ? state.error : '', refresh };
}
