import type { ComponentBindings } from './componentBindings';
import React from 'react';
import { useTimelineSession } from './TimelineProvider';
import { TimelineDraftRecorder } from './draftRecorder';
import { type TimelineEvent } from './contract';
import { TIMELINE_CHANGED_EVENT } from './clientEvents';
import { useThingTimeline } from './useThingTimeline';
import { historyPrefs, HISTORY_PAUSED_DRAFT_ERROR, timelineDraftFailureText } from './historyPrefsClient';

const snapshot = (adapter: string, value: unknown) => ({ adapter, version: 1, value });
/** Editors call record in the mutation callback, before starting a network
 * save. Applying a recovered draft is explicit and makes a new draft branch.
 *
 * Paused (Settings → History → Paused Things, loaded by the provider): every
 * hook stays mounted and `ready` stays true, but `record` resolves null
 * without capturing, `flush` only drains what an existing recorder already
 * captured, and `release`/`dismissRecovery` refuse so a pinned draft is never
 * let go without a capture. Canonical server revisions keep recording. */
export function useTimelineDraft(thingId: string | null, adapter: string, baseHead: string | null = null) {
	const { connection, identity: sessionIdentity, ownerId } = useTimelineSession();
	const store = connection?.store;
	// An active editor subscribes only to this Thing's recent history. Opening
	// History shares the same in-flight page; no account-wide download is needed.
	useThingTimeline(thingId, !!thingId && !!ownerId);
	const paused = React.useSyncExternalStore(historyPrefs.subscribe, () => !!ownerId && !!thingId && historyPrefs.isPaused(ownerId, thingId), () => false);
	const pausedRef = React.useRef(paused); pausedRef.current = paused;
	const held = React.useCallback(() => !!ownerId && historyPrefs.isHeld(ownerId), [ownerId]);
	const identity = ownerId && thingId ? JSON.stringify([sessionIdentity, thingId, adapter]) : '';
	const recorder = React.useRef<{ identity: string; value: TimelineDraftRecorder } | null>(null);
	const currentIdentity = React.useRef(identity); currentIdentity.current = identity;
	const [state, setState] = React.useState({ identity: '', error: '', saving: false });
	const [recovery, setRecovery] = React.useState<{ identity: string; events: TimelineEvent[] }>({ identity: '', events: [] });
	const get = React.useCallback(() => {
		if (!ownerId || !thingId) throw new Error('Open a saved Thing in your account to record its history.');
		if (recorder.current?.identity !== identity) {
			const clientId = crypto.randomUUID();
			recorder.current = { identity, value: new TimelineDraftRecorder(store ?? null, thingId, `draft-${clientId}`, clientId, baseHead, undefined, undefined, ownerId) };
		}
		if (store) recorder.current.value.connect(store);
		return recorder.current.value;
	}, [ownerId, thingId, identity, store, baseHead]);
	React.useEffect(() => {
		if (!store || !thingId) return;
		let alive = true;
		if (recorder.current?.identity === identity) {
			const draft = get();
			void draft.flush().then(() => {
				if (alive) { setState({ identity, error: '', saving: false }); window.dispatchEvent(new Event(TIMELINE_CHANGED_EVENT)); }
			}).catch(error => { if (alive) setState({ identity, saving: false, error: timelineDraftFailureText(error, held(), 'Could not save this change on your device.') }); });
		}
		void store.forThing(thingId).then(rows => {
			if (alive) setRecovery({ identity, events: rows.filter(row => row.draftKey && row.event.after?.adapter === adapter && row.event.branchId !== recorder.current?.value.branchId).map(row => row.event) });
		}).catch(error => { if (alive) setState({ identity, saving: false, error: error instanceof Error ? error.message : 'Draft recovery is unavailable.' }); });
		return () => { alive = false; };
	}, [identity, store, thingId, adapter, get, held]);
	const record = (before: unknown, after: unknown, label: string, components?: ComponentBindings) => {
		if (paused) return Promise.resolve<string | null>(null);
		let pending: Promise<string | null>;
		try { pending = get().capture(snapshot(adapter, before), snapshot(adapter, after), label, components); }
		catch (error) { pending = Promise.reject(error); }
		setState({ identity, error: '', saving: true });
		return pending.then(id => {
			if (currentIdentity.current === identity) setState({ identity, error: '', saving: false });
			window.dispatchEvent(new Event(TIMELINE_CHANGED_EVENT)); return id;
		}).catch(error => { if (currentIdentity.current === identity) setState({ identity, saving: false, error: timelineDraftFailureText(error, held(), 'Could not save this change on your device.') }); throw error; });
	};
	const flush = async () => { const draft = get(); const eventId = draft.capturedEventId; await draft.flush(); return eventId; };
	const release = async (eventId: string | null) => {
		if (!eventId) return;
		if (pausedRef.current) throw new Error(HISTORY_PAUSED_DRAFT_ERROR);
		if (connection) await connection.store.releaseDraft(eventId);
	};
	return {
		ready: !!connection && !!thingId, paused, record, flush, release,
		error: state.identity === identity ? state.error : '', saving: state.identity === identity && state.saving,
		recoverable: recovery.identity === identity ? recovery.events : [],
		dismissRecovery: async (event: TimelineEvent) => { await release(event.id); if (currentIdentity.current === identity) setRecovery(previous => ({ ...previous, events: previous.events.filter(item => item.id !== event.id) })); }
	};
}
