import type { ComponentBindings } from './componentBindings';
import React from 'react';
import { useApi } from '../hooks/useApi';
import { branchCheckoutRequest, branchEditableSnapshot, parseBranchCheckout } from './branchCheckout';
import type { TimelineBranchEntry } from './branches';
import type { TimelineEvent, TimelineSnapshot } from './contract';
import type { useTimelineSession } from './TimelineProvider';
import { TimelineBranchWorkingCopy, type BranchSaveState } from './branchWorkingCopy';
import { TIMELINE_CHANGED_EVENT } from './clientEvents';

type Connection = NonNullable<ReturnType<typeof useTimelineSession>['connection']>;
const announce = () => window.dispatchEvent(new Event(TIMELINE_CHANGED_EVENT));
const message = (failure: any) => failure?.error || failure?.message || 'Could not save this branch. Your local edits are preserved.';
const noticeFor = (state: BranchSaveState, name: string) =>
	state === 'saved'
		? `Saved to ${name} in your account.`
		: state === 'pending'
		? 'Branch edit saved on this device. Waiting to sync to your account.'
		: 'The branch changed. Your edit is preserved in History; review a merge before continuing.';

/** Caller mounts by account, source, branch and initial head identity. Reads
 * may fill a cold session but never replace an existing working copy. */
export function useTimelineBranchDraft(target: TimelineBranchEntry, connection: Connection) {
	const api = useApi();
	const apiRef = React.useRef(api);
	apiRef.current = api;
	const copy = React.useRef<TimelineBranchWorkingCopy | null>(null);
	const [, redraw] = React.useReducer((value) => value + 1, 0);
	const [recovery, setRecovery] = React.useState<TimelineEvent[]>([]);
	const [error, setError] = React.useState('');
	const [notice, setNotice] = React.useState('');
	const [loading, setLoading] = React.useState(true);
	const [writing, setWriting] = React.useState(false);
	const [saving, setSaving] = React.useState(false);
	const alive = React.useRef(true);
	const loadingRef = React.useRef(false);
	const controller = React.useRef<AbortController | null>(null);
	const pendingElsewhere = React.useRef(false);
	const load = async () => {
		if (loadingRef.current) return;
		loadingRef.current = true;
		setLoading(true);
		setError('');
		const attempt = new AbortController();
		controller.current = attempt;
		const active = () => alive.current && !attempt.signal.aborted;
		try {
			const [rows, commands] = await Promise.all([connection.store.forThing(target.head.thingId), connection.branches.queued()]);
			if (!active()) return;
			pendingElsewhere.current = commands.some((row) => row.command.branchId === target.branch.id && row.command.thingId === target.head.thingId);
			setRecovery(
				rows
					.filter(
						(row) =>
							row.draftKey &&
							row.event.branchId === target.branch.id &&
							row.event.id !== target.head.eventId &&
							row.event.after?.adapter === 'thing-content'
					)
					.map((row) => row.event)
			);
			const waiting = commands.find((row) => row.command.branchId === target.branch.id && row.command.thingId === target.head.thingId);
			const queuedDraft = waiting && rows.find((row) => row.event.id === waiting.command.eventId);
			if (!copy.current && queuedDraft?.event.after?.adapter === 'thing-content') {
				copy.current = new TimelineBranchWorkingCopy(connection, target, queuedDraft.event.after, false, queuedDraft.event);
				redraw();
			}
			const local = rows.find((row) => row.event.id === target.head.eventId);
			if (local?.draftKey) await connection.store.releaseDraft(local.event.id);
			if (active() && !copy.current && local?.event.after?.adapter === 'thing-content') {
				try {
					copy.current = new TimelineBranchWorkingCopy(connection, target, local.event.after, true, local.event);
					redraw();
				} catch {
					/* Load a supported full projection below. */
				}
			}
			const request = branchCheckoutRequest(target);
			const result = await apiRef.current.v1.timeline.checkoutBranch(connection.scope, request, { signal: attempt.signal });
			if (result?.ok !== true) throw new Error(result?.error || 'Could not open this branch.');
			const checked = parseBranchCheckout(result.checkout, connection.scope.ownerId, request);
			if (!active()) return;
			await connection.store.accept([checked.entry]);
			if (active() && !copy.current) {
				copy.current = new TimelineBranchWorkingCopy(connection, target, checked.snapshot, true, checked.entry.event);
				redraw();
			}
		} catch (failure) {
			if (active()) setError(message(failure));
		} finally {
			if (controller.current === attempt) {
				loadingRef.current = false;
				if (active()) setLoading(false);
			}
		}
	};
	React.useEffect(() => {
		alive.current = true;
		void load();
		const changed = () => {
			if (!copy.current || !copy.current.locked || copy.current.saving) return;
			void copy.current
				.reconcile()
				.then((state) => {
					if (alive.current) {
						setNotice(noticeFor(state, target.branch.name));
						redraw();
					}
				})
				.catch((failure) => {
					if (alive.current) setError(message(failure));
				});
		};
		window.addEventListener(TIMELINE_CHANGED_EVENT, changed);
		return () => {
			alive.current = false;
			controller.current?.abort();
			controller.current = null;
			loadingRef.current = false;
			window.removeEventListener(TIMELINE_CHANGED_EVENT, changed);
		};
		// Exact identity remounts the owning editor.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	const change = (next: TimelineSnapshot, components?: ComponentBindings) => {
		if (!copy.current || pendingElsewhere.current) return;
		try {
			const pending = copy.current.change(next, undefined, components);
			setWriting(true);
			setError('');
			redraw();
			void pending
				.then(() => {
					if (alive.current) {
						setWriting(copy.current!.hasUnwrittenChanges);
						setNotice('Draft saved on this device.');
						redraw();
					}
					announce();
				})
				.catch((failure) => {
					if (alive.current) {
						setWriting(false);
						setError(message(failure));
						redraw();
					}
				});
		} catch (failure) {
			setError(message(failure));
		}
	};
	const save = async () => {
		if (!copy.current || pendingElsewhere.current)
			return { ok: false, error: 'A branch push is already waiting. Open History to review or sync it.' };
		setSaving(true);
		setError('');
		try {
			const state = await copy.current.save();
			if (alive.current) {
				setNotice(noticeFor(state, target.branch.name));
				redraw();
			}
			announce();
			return {
				ok: state === 'saved' || state === 'pending',
				error: state === 'refused' || state === 'advanced' ? noticeFor(state, target.branch.name) : undefined
			};
		} catch (failure) {
			const error = message(failure);
			if (alive.current) setError(error);
			return { ok: false, error };
		} finally {
			if (alive.current) {
				setSaving(false);
				setWriting(false);
				redraw();
			}
		}
	};
	const recover = async (event: TimelineEvent) => {
		if (pendingElsewhere.current) throw new Error('Check the waiting branch push in History before resuming a draft.');
		const working = copy.current ?? new TimelineBranchWorkingCopy(connection, target, branchEditableSnapshot(event.after!), false);
		working.resume(event);
		copy.current = working;
		setRecovery((rows) => rows.filter((row) => row.id !== event.id));
		setError('');
		setNotice('Draft resumed. Saving checks whether the branch changed.');
		redraw();
	};
	const dismiss = async (event: TimelineEvent) => {
		await connection.store.releaseDraft(event.id);
		if (alive.current) setRecovery((rows) => rows.filter((row) => row.id !== event.id));
	};
	const discard = async () => {
		setSaving(true);
		try {
			await copy.current?.discard();
			if (alive.current) {
				setNotice('Draft discarded. Its changes remain in History.');
				redraw();
			}
			announce();
		} catch (failure) {
			if (alive.current) setError(message(failure));
		} finally {
			if (alive.current) {
				setSaving(false);
				redraw();
			}
		}
	};
	return {
		canRefresh: () => !pendingElsewhere.current && !copy.current?.edited && !copy.current?.locked,
		getSnapshot: () => copy.current?.snapshot ?? null,
		snapshot: copy.current?.snapshot ?? null,
		event: copy.current?.event ?? null,
		target: copy.current?.target ?? target,
		edited: copy.current?.edited ?? false,
		locked: pendingElsewhere.current || !!copy.current?.locked,
		unwritten: copy.current?.hasUnwrittenChanges ?? false,
		loading,
		writing,
		saving,
		error,
		notice: pendingElsewhere.current ? 'A branch push is waiting. Open History to review or sync it, then reopen this branch.' : notice,
		recoverable: recovery,
		change,
		save,
		recover,
		dismiss,
		discard,
		load
	};
}
