import { timelineScopeKey, TIMELINE_PAGE_SIZE, type TimelineScope, type TimelineEvent } from './contract';
import {
	canNameTimelineVersion,
	parseTimelineVersionName,
	parseTimelineVersionNameCommand,
	parseTimelineVersionNameResult,
	timelineVersionNameId,
	type TimelineVersionName,
	type TimelineVersionNameCommand
} from './versionNames';
import { TIMELINE_NAME_CACHE_LIMIT, timelineVersionNameEffect } from './nameStore';

export const TIMELINE_NAME_PENDING_LIMIT = 128;
type CachedName = { scope: string; eventId: string; name: TimelineVersionName | null; clearedAt: string | null; observedAt: number };
export type QueuedVersionName = {
	scope: string;
	command: TimelineVersionNameCommand;
	queuedAt: number;
	parent: string | null;
	baseRevision: number;
	sent: TimelineVersionNameCommand | null;
	failure: { status: number; message: string } | null;
};
export type NameLocalState = { names: CachedName[]; pending: QueuedVersionName[] };
export interface TimelineNameBackend {
	readNameState(scope: string): Promise<NameLocalState>;
	changeNameState(scope: string, update: (state: NameLocalState) => NameLocalState): Promise<void>;
}
const definitive = [400, 404, 409, 413, 422];
const fail = (message: string): never => {
	throw new Error(message);
};
export class TimelineNameQueueConflict extends Error {
	readonly status = 409;
}
const canonical = (value: unknown) =>
	JSON.stringify(value, (_key, item) =>
		item && typeof item === 'object' && !Array.isArray(item)
			? Object.fromEntries(
					Object.keys(item)
						.sort()
						.map((key) => [key, item[key]])
			  )
			: item
	);
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const ordered = (state: NameLocalState) => [...state.pending].sort((a, b) => a.queuedAt - b.queuedAt);

/** Canonical name commands and accepted name records, each a separate scoped
 * row. Pending display names are projections only: they never invent effects
 * or account receipts. A command freezes only after its predecessor resolves. */
export class TimelineNameQueue {
	readonly key: string;
	constructor(readonly scope: TimelineScope, private backend: TimelineNameBackend, private now = Date.now) {
		this.key = timelineScopeKey(scope);
		this.scope = Object.freeze({ ...scope });
	}
	private validate(state: NameLocalState): NameLocalState {
		if (state.names.length > TIMELINE_NAME_CACHE_LIMIT || state.pending.length > TIMELINE_NAME_PENDING_LIMIT)
			fail('Version name storage exceeds its bound. Pending names are preserved.');
		const names = state.names.map((row) => {
			const name = row.name === null ? null : parseTimelineVersionName(row.name);
			if (
				row.scope !== this.key ||
				!row.eventId ||
				!Number.isFinite(row.observedAt) ||
				(row.clearedAt !== null && !Number.isFinite(Date.parse(row.clearedAt))) ||
				(name && (name.ownerId !== this.scope.ownerId || name.eventId !== row.eventId))
			)
				fail('Version name storage scope is damaged.');
			return { ...row, name };
		});
		const pending = state.pending.map((row) => {
			const command = parseTimelineVersionNameCommand(row.command),
				sent = row.sent === null ? null : parseTimelineVersionNameCommand(row.sent);
			if (
				row.scope !== this.key ||
				row.scope !== this.key ||
				!Number.isFinite(row.queuedAt) ||
				!Number.isSafeInteger(row.baseRevision) ||
				row.baseRevision < 0 ||
				(row.parent !== null && typeof row.parent !== 'string') ||
				(sent && !same({ ...sent, expectedRevision: command.expectedRevision }, command)) ||
				(row.failure && (!definitive.includes(row.failure.status) || typeof row.failure.message !== 'string' || row.failure.message.length > 512))
			)
				fail('Version name queue is damaged.');
			return { ...row, command, sent };
		});
		if (
			new Set(names.map((row) => row.eventId)).size !== names.length ||
			new Set(pending.map((row) => row.command.operationId)).size !== pending.length
		)
			fail('Duplicate version name records.');
		for (const row of pending)
			if (
				row.parent &&
				!pending.some(
					(parent) => parent.command.operationId === row.parent && parent.command.eventId === row.command.eventId && parent.queuedAt < row.queuedAt
				)
			)
				fail('Version name queue ancestry is damaged.');
		return { names, pending };
	}
	private prune(state: NameLocalState): NameLocalState {
		const pinned = new Set(state.pending.map((row) => row.command.eventId));
		return {
			...state,
			names: [...state.names]
				.sort((a, b) => Number(pinned.has(b.eventId)) - Number(pinned.has(a.eventId)) || b.observedAt - a.observedAt)
				.slice(0, TIMELINE_NAME_CACHE_LIMIT)
		};
	}
	private change(update: (state: NameLocalState) => NameLocalState) {
		return this.backend.changeNameState(this.key, (state) => this.validate(this.prune(update(this.validate(state)))));
	}
	private async read() {
		return this.validate(await this.backend.readNameState(this.key));
	}
	private projected(state: NameLocalState): Map<string, TimelineVersionName> {
		const names = new Map(state.names.flatMap((row) => (row.name ? [[row.eventId, row.name] as const] : [])));
		for (const row of ordered(state)) {
			const command = row.command,
				prior = names.get(command.eventId);
			if (command.name === null) {
				names.delete(command.eventId);
				continue;
			}
			const stamp = new Date(row.queuedAt).toISOString();
			names.set(
				command.eventId,
				parseTimelineVersionName({
					formatVersion: 1,
					id: timelineVersionNameId(command.eventId),
					ownerId: this.scope.ownerId,
					eventId: command.eventId,
					thingId: command.thingId,
					name: command.name,
					revision: (prior?.revision ?? 0) + 1,
					createdAt: prior?.createdAt ?? stamp,
					updatedAt: new Date(Math.max(row.queuedAt, prior ? Date.parse(prior.updatedAt) + 1 : 0)).toISOString()
				})
			);
		}
		return names;
	}
	async view(eventIds: string[]) {
		const names = this.projected(await this.read());
		return new Map(eventIds.flatMap((id) => (names.has(id) ? [[id, names.get(id)!] as const] : [])));
	}
	/** Actual retained account records only; pending display projections never
	 * masquerade as accepted name metadata in an archive. */
	async accepted(eventIds: string[]) {
		const wanted = new Set(eventIds);
		return new Map((await this.read()).names.filter((row) => wanted.has(row.eventId)).map((row) => [row.eventId, row.name] as const));
	}
	async queued() {
		return ordered(await this.read());
	}
	async enqueue(input: TimelineVersionNameCommand, target: TimelineEvent) {
		const command = parseTimelineVersionNameCommand(input);
		if (
			target.ownerId !== this.scope.ownerId ||
			target.id !== command.eventId ||
			target.thingId !== command.thingId ||
			!canNameTimelineVersion(target)
		)
			fail('Only a retained content version can be named.');
		await this.change((state) => {
			const duplicate = state.pending.find((row) => row.command.operationId === command.operationId);
			if (duplicate) {
				if (!same(duplicate.command, command)) fail('Version name operation identity was reused.');
				return state;
			}
			if (state.pending.length >= TIMELINE_NAME_PENDING_LIMIT) fail('Too many version names are waiting to sync.');
			const current = this.projected(state).get(command.eventId);
			if ((current?.revision ?? 0) !== command.expectedRevision)
				throw new TimelineNameQueueConflict('This version name changed on this device. Refresh and try again.');
			const previous = ordered(state)
				.filter((row) => row.command.eventId === command.eventId)
				.at(-1);
			if (previous?.failure) fail('Review the refused version name before editing it again.');
			const queuedAt = Math.max(this.now(), ...state.pending.map((row) => row.queuedAt + 1));
			return {
				...state,
				pending: [
					...state.pending,
					{
						scope: this.key,
						command,
						queuedAt,
						parent: previous?.command.operationId ?? null,
						baseRevision: command.expectedRevision,
						sent: null,
						failure: null
					}
				]
			};
		});
	}
	/** Frozen requests are identical across reloads/tabs; the server's operation
	 * identity handles duplicate sends. A later local edit cannot replace one. */
	async freeze(operationId: string) {
		let result: TimelineVersionNameCommand | null = null;
		await this.change((state) => ({
			...state,
			pending: state.pending.map((row) => {
				if (row.command.operationId !== operationId || row.parent || row.failure) return row;
				result = row.sent ?? { ...row.command, expectedRevision: row.baseRevision };
				return { ...row, sent: result };
			})
		}));
		return result;
	}
	async reject(operationId: string, status: number, message: string) {
		if (!definitive.includes(status)) fail('An uncertain name command must remain pending.');
		await this.change((state) => ({
			...state,
			pending: state.pending.map((row) =>
				row.command.operationId === operationId ? { ...row, failure: { status, message: message.slice(0, 512) } } : row
			)
		}));
	}
	private effect(state: NameLocalState, event: TimelineEvent): NameLocalState {
		const effect = timelineVersionNameEffect(event);
		if (!effect) return state;
		if (event.ownerId !== this.scope.ownerId) fail('Version name effect belongs to another account.');
		const prior = state.names.find((row) => row.eventId === effect.eventId),
			name = effect.name;
		const old = prior?.name;
		if (
			name &&
			((old && (name.updatedAt < old.updatedAt || (name.updatedAt === old.updatedAt && name.revision < old.revision))) ||
				(prior?.clearedAt && name.updatedAt <= prior.clearedAt))
		)
			return state;
		if (
			!name &&
			old &&
			effect.prior &&
			(effect.prior.updatedAt < old.updatedAt || (effect.prior.updatedAt === old.updatedAt && effect.prior.revision < old.revision))
		)
			return state;
		const observedAt = Math.max(this.now(), (prior?.observedAt ?? 0) + 1);
		return {
			...state,
			names: [
				...state.names.filter((row) => row.eventId !== effect.eventId),
				{
					scope: this.key,
					eventId: effect.eventId,
					name,
					clearedAt: name ? null : [prior?.clearedAt, event.occurredAt].filter(Boolean).sort().at(-1)!,
					observedAt
				}
			]
		};
	}
	async effects(events: TimelineEvent[]) {
		await this.change((state) => events.reduce((value, event) => this.effect(value, event), state));
	}
	async accept(names: TimelineVersionName[], eventIds: string[], startedAt = this.now()) {
		const parsed = names.map(parseTimelineVersionName),
			ids = new Set(parsed.map((name) => name.eventId));
		if (
			parsed.length > TIMELINE_PAGE_SIZE ||
			ids.size !== parsed.length ||
			parsed.some((name) => name.ownerId !== this.scope.ownerId || !eventIds.includes(name.eventId))
		)
			fail('Invalid version name response scope.');
		await this.change((state) => {
			for (const eventId of eventIds) {
				const old = state.names.find((row) => row.eventId === eventId);
				if (old && old.observedAt > startedAt) continue;
				const name = parsed.find((row) => row.eventId === eventId) ?? null;
				if (name && old?.name && (name.revision < old.name.revision || name.updatedAt < old.name.updatedAt)) continue;
				state = {
					...state,
					names: [
						...state.names.filter((row) => row.eventId !== eventId),
						{
							scope: this.key,
							eventId,
							name,
							clearedAt: name ? null : new Date(startedAt).toISOString(),
							observedAt: Math.max(this.now(), (old?.observedAt ?? 0) + 1)
						}
					]
				};
			}
			return state;
		});
	}
	async acknowledge(command: TimelineVersionNameCommand, input: unknown) {
		const result = parseTimelineVersionNameResult(input, this.scope.ownerId, command);
		await this.change((state) => {
			const row = state.pending.find((row) => row.command.operationId === command.operationId);
			if (!row) return state;
			if (!row.sent || !same(row.sent, command)) fail('Server acknowledged a different queued name.');
			if (result.entry) state = this.effect(state, result.entry.event);
			// A no-op reply carries the actual accepted record too.
			else if (result.name) {
				const old = state.names.find((row) => row.eventId === command.eventId);
				if (!old?.name || result.name.revision >= old.name.revision)
					state = {
						...state,
						names: [
							...state.names.filter((row) => row.eventId !== command.eventId),
							{
								scope: this.key,
								eventId: command.eventId,
								name: result.name,
								clearedAt: null,
								observedAt: Math.max(this.now(), (old?.observedAt ?? 0) + 1)
							}
						]
					};
			}
			return {
				...state,
				pending: state.pending
					.filter((row) => row.command.operationId !== command.operationId)
					.map((row) => (row.parent === command.operationId ? { ...row, parent: null, baseRevision: result.name?.revision ?? 0 } : row))
			};
		});
		return result;
	}
	/** Discard is explicit and only follows a definitive refusal; uncertain
	 * writes and their later intents cannot be silently dropped. */
	async dismiss(eventId: string) {
		await this.change((state) => {
			const rows = ordered(state).filter((row) => row.command.eventId === eventId);
			if (!rows[0]?.failure) fail('Resolve the uncertain version name before discarding it.');
			return { ...state, pending: state.pending.filter((row) => row.command.eventId !== eventId) };
		});
	}
	async retry(eventId: string, operationId: string) {
		await this.change((state) => {
			const row = ordered(state).find((row) => row.command.eventId === eventId);
			if (!row?.failure) fail('This version name is not waiting for conflict review.');
			const oldId = row.command.operationId,
				current = state.names.find((row) => row.eventId === eventId)?.name;
			const command = parseTimelineVersionNameCommand({ ...row.command, operationId, expectedRevision: current?.revision ?? 0 });
			if (state.pending.some((item) => item.command.operationId === operationId)) fail('Version name operation identity was reused.');
			return {
				...state,
				pending: state.pending.map((item) =>
					item === row
						? { ...row, command, sent: null, baseRevision: command.expectedRevision, failure: null }
						: item.parent === oldId
						? { ...item, parent: operationId }
						: item
				)
			};
		});
	}
	async clearCache() {
		await this.change((state) => ({
			...state,
			names: state.names.filter((row) => state.pending.some((command) => command.command.eventId === row.eventId))
		}));
	}
}
