import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useDataPlane } from '~/hooks/useDataPlane';
import { useCharacterScope } from '../Characters/CharacterScope';
import { rootIdentity } from '~/utils/rootIdentity';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import type { PublicThing } from '~/api/utils/things/things';
import { applyPinIntent, pinPathKey, type ThingPinIntent, type ThingPinPath, type ThingPinSnapshot } from './thingPathPins';

type PinState = { ids: string[]; revision: string | null; busy: boolean; loaded: boolean; error: string | null; presentations?: Record<string, PublicThing> };
const empty: PinState = { ids: [], revision: null, busy: false, loaded: false, error: null };

/** One identity-fenced controller may serve each visible column independently.
 * Reads preserve usable cached order; writes are optimistic, serialized per path,
 * and revision conflicts reload before reapplying the original user intent. */
export function useThingPathPins(paths: ThingPinPath[], enabled = true, dataPlaneOverride?: string) {
  const api = useApi();
  const user = useCurrentUser();
  const owner = user?.id;
  const permitted = enabled && user?.accountKind === 'user' && !user.temporary;
  const selectedPlane = useDataPlane();
  const dataPlane = dataPlaneOverride || selectedPlane;
  const character = useCharacterScope();
  const root = useSyncExternalStore(rootIdentity.subscribe, rootIdentity.read, rootIdentity.read);
  const cacheIdentity = JSON.stringify([typeof window === 'undefined' ? '' : window.location.origin, owner, dataPlane, character?.id]);
  const identity = JSON.stringify([cacheIdentity, root.generation, root.pending]);
  const pathKeys = JSON.stringify(paths.map(pinPathKey));
  const cacheKey = `tt-path-pins-v1-${cacheIdentity}`;
  const [stored, setStored] = useState<{ identity: string; states: Record<string, PinState> }>(() => ({ identity, states: readLocalCache<Record<string, PinState>>(cacheKey) || {} }));
  const states = !permitted || root.pending ? {} : stored.identity === identity ? stored.states : readLocalCache<Record<string, PinState>>(cacheKey) || {};
  const stateRef = useRef({ identity, states });
  stateRef.current = { identity, states };
  const apiRef = useRef(api); apiRef.current = api;
  const active = useRef(identity); active.current = identity;
  const alive = useRef(true);
  const queues = useRef(new Map<string, Promise<void>>());
  const loading = useRef(new Map<string, Promise<ThingPinSnapshot>>());
  const controllers = useRef(new Map<string, AbortController>());
  const confirmed = useRef(new Map<string, ThingPinSnapshot>());
  const failed = useRef(new Map<string, { intent: ThingPinIntent; error: string }[]>());
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => () => { for (const [key, controller] of controllers.current) if (key.startsWith(`${identity}:`)) controller.abort(); }, [identity]);
  const current = useCallback((key: string) => stateRef.current.states[key] || empty, []);
  const update = useCallback((key: string, patch: Partial<PinState>, expected = identity) => {
    if (!alive.current || active.current !== expected || rootIdentity.read().pending || rootIdentity.read().generation !== root.generation) return;
    const next = { ...stateRef.current.states, [key]: { ...current(key), ...patch } };
    stateRef.current = { identity: expected, states: next };
    setStored({ identity: expected, states: next });
    writeLocalCache(cacheKey, Object.fromEntries(Object.entries(next).map(([id, value]) => [id, { ...value, busy: false, error: null }])));
  }, [identity, current, cacheKey, root.generation]);
  const options = useMemo(() => ({ expectedActor: owner, expectedDataPlane: dataPlane, expectedApiOrigin: typeof window === 'undefined' ? '' : window.location.origin }), [owner, dataPlane]);
  const read = useCallback(async (path: ThingPinPath) => {
    const key = pinPathKey(path), operationKey = `${identity}:${key}`;
    const existing = loading.current.get(operationKey);
    if (existing) return existing;
    const controller = new AbortController(); controllers.current.set(operationKey, controller);
    const guard = () => { if (!alive.current || active.current !== identity || rootIdentity.read().pending || rootIdentity.read().generation !== root.generation) throw new DOMException('Account changed', 'AbortError'); controller.signal.throwIfAborted(); };
    const request = (async (): Promise<ThingPinSnapshot> => {
      for (let attempt = 0; ; attempt++) {
        try {
          let cursor: string | undefined, revision: string | undefined;
          const pins: ThingPinSnapshot['pins'] = [];
          const cursors = new Set<string>();
          do {
            guard();
            const page = await apiRef.current.v1.things.pins.get({ path, cursor, revision }, { ...options, signal: controller.signal });
            guard();
            revision = page.revision; pins.push(...page.pins); cursor = page.nextCursor || undefined;
            if (cursor && cursors.has(cursor)) throw Error('Pin pagination repeated a cursor. Retry pins.');
            if (cursor) cursors.add(cursor);
          } while (cursor);
          return { revision: revision!, pins: pins.sort((a, b) => a.order - b.order) };
        } catch (cause: any) { if (attempt === 0 && cause?.status === 409) continue; throw cause; }
      }
    })().then((result: ThingPinSnapshot) => {
      confirmed.current.set(operationKey, result);
      if (active.current === identity && !queues.current.has(operationKey)) update(key, { ids: result.pins.map(pin => pin.thingId), revision: result.revision, presentations: Object.fromEntries(result.pins.filter(pin => pin.presentation).map(pin => [pin.thingId, pin.presentation!])), loaded: true, error: null });
      return result;
    }).catch((cause: unknown) => { if (cause instanceof Error && cause.name === 'AbortError') throw cause; update(key, { error: cause instanceof Error ? cause.message : 'Could not load pins. Retry to reconnect.' }); throw cause; }).finally(() => { loading.current.delete(operationKey); controllers.current.delete(operationKey); });
    loading.current.set(operationKey, request);
    return request;
  }, [identity, options, update, root.generation]);
  useEffect(() => {
    if (!permitted || !owner || !dataPlane || root.pending) return;
    for (const key of JSON.parse(pathKeys) as string[]) void read(JSON.parse(key)).catch(() => {});
  }, [permitted, owner, dataPlane, identity, pathKeys, read, root.pending]);
  const mutate = useCallback((path: ThingPinPath, intent: ThingPinIntent) => {
    if (!permitted || !owner || !dataPlane || root.pending) return Promise.resolve();
    const key = pinPathKey(path), operationKey = `${identity}:${key}`;
    const previous = queues.current.get(operationKey) || Promise.resolve();
    update(key, { ids: applyPinIntent(current(key).ids, intent), busy: true, error: null });
    const operation = previous.catch(() => {}).then(async () => {
      if (!alive.current || active.current !== identity) return;
      try {
        let snapshot = confirmed.current.get(operationKey) || await read(path);
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const requestIntent = intent.operation === 'reorder' ? { ...intent, thingIds: applyPinIntent(snapshot.pins.map(pin => pin.thingId), intent) } : intent;
            await apiRef.current.v1.things.pins.update({ path, ...requestIntent, revision: snapshot.revision }, options);
            await loading.current.get(operationKey)?.catch(() => {});
            const result = await read(path);
            confirmed.current.set(operationKey, result);
            const remaining = (failed.current.get(operationKey) || []).filter(failure => failure.intent !== intent);
            if (remaining.length) failed.current.set(operationKey, remaining); else failed.current.delete(operationKey);
            // A newer queued intent already owns the displayed order.
            update(key, { revision: result.revision, presentations: Object.fromEntries(result.pins.filter(pin => pin.presentation).map(pin => [pin.thingId, pin.presentation!])), loaded: true,
              ...(queues.current.get(operationKey) === operation ? { ids: result.pins.map(pin => pin.thingId), error: remaining[0]?.error || null } : {}) });
            return;
          } catch (cause: any) {
            if (attempt === 0 && (cause?.status === 409 || cause?.code === 'REVISION_CONFLICT')) { snapshot = await read(path); continue; }
            throw cause;
          }
        }
      } catch (cause: any) {
        if (cause?.name === 'AbortError' || active.current !== identity) throw cause;
        // Reconcile a failed save without erasing newer optimistic user input.
        try { const result = await read(path); update(key, { revision: result.revision,
          ...(queues.current.get(operationKey) === operation ? { ids: result.pins.map(pin => pin.thingId) } : {}) }); } catch { /* Retain cached order with explicit failure. */ }
        const error = cause?.error || cause?.message || 'Could not save pins. Retry after reconnecting.';
        const failures = (failed.current.get(operationKey) || []).filter(failure => failure.intent !== intent);
        failed.current.set(operationKey, [...failures, { intent, error }]);
        update(key, { error });
        throw cause;
      }
    }).finally(() => {
      if (queues.current.get(operationKey) === operation) { queues.current.delete(operationKey); update(key, { busy: false }); }
    });
    queues.current.set(operationKey, operation);
    return operation;
  }, [permitted, owner, dataPlane, identity, update, current, read, options, root.pending]);
  return { identity, state: (path: ThingPinPath) => states[pinPathKey(path)] || empty, mutate, reload: read, retry: (path: ThingPinPath) => { const failures = failed.current.get(`${identity}:${pinPathKey(path)}`); return failures?.length ? Promise.allSettled(failures.map(failure => mutate(path, failure.intent))) : read(path); }, enabled: permitted && !!owner && !!dataPlane && !root.pending };
}
export type ThingPathPinsController = ReturnType<typeof useThingPathPins>;
