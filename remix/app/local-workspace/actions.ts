import {
	executeProgram,
	jsonBytes,
	schemaIdentityOf,
	schemaScopeAllows,
	type ActionBudget,
	type ActionProgram,
	type ActionRuntimeHost
} from '../actions/runtime';
import { validateRunInputs } from '../api/utils/actions/actionInputs';
import { bindPacks } from '../api/utils/actions/packs';
import { finishBrowserAction } from '../components/Actions/actionFlowResult';
import {
	ACTION_LIMIT_CEILINGS,
	ACTION_LIMIT_DEFAULTS,
	MAX_ACTION_RUN_ERROR_CHARS,
	MAX_ACTION_RUN_HISTORY,
	MAX_ACTION_RUNS_RETAINED,
	MAX_ACTION_SEARCH_LIMIT,
	MAX_ACTION_SEARCH_MATCH_CHARS,
	sanitizeActionCrystal,
	type ActionCapabilityEntry,
	type ActionStep
} from '../schemas/registry';
import { MAX_EXPRESSION_NODES_PER_RUN } from '../schemas/actionExpressions';
import type { PreparedBrowserAction } from '../schemas/browserActions';
import { snapshotTransferValue } from '../utils/thingTransfer/value';
import { LocalThings, localThingProjection, type LocalThing } from './things';
import { WorkspaceError, type WorkspaceDatabase, type WorkspaceLease, type WorkspaceScope } from './storage';

const fail = (message: string, status = 400): never => {
	throw new WorkspaceError('LOCAL_ACTION_ERROR', message, status);
};
const activeRuns = new WeakMap<WorkspaceDatabase, number>();
const actorId = 'local-workspace'; // Display/reference identity, never account authority.
const newest = (a: LocalThing, b: LocalThing) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
const scalar = (value: unknown, label: string) =>
	value == null || ['string', 'number', 'boolean'].includes(typeof value) ? value ?? null : fail(`${label} resolved to a non-scalar filter value`);
const read = (value: unknown, path: string): unknown =>
	path
		.split('.')
		.reduce<unknown>(
			(parent, key) =>
				parent && typeof parent === 'object' && Object.prototype.hasOwnProperty.call(parent, key)
					? (parent as Record<string, unknown>)[key]
					: undefined,
			value
		);

/** Same saved programs and interpreters as account Actions, with a closed local
 * host. No fetch, credentials, remote IDs, or implicit public-data fallback. */
export class LocalActions {
	private things: LocalThings;
	constructor(private db: WorkspaceDatabase, private scope: WorkspaceScope, private lease: WorkspaceLease) {
		this.things = new LocalThings(db, scope, lease);
	}
	private assert() {
		this.lease.assertCurrent();
		if (this.scope.kind !== 'anonymous') fail('Account Actions require their dedicated sync adapter', 403);
	}
	private async resolve(reference: string): Promise<ActionProgram> {
		this.assert();
		if (typeof reference !== 'string' || !reference.trim() || reference.length > 240) fail('Which action? Pass its id or actionKey');
		const rows = (await this.things.snapshot()).filter((row) => row.thingtime.includes('action'));
		const row =
			rows.find((row) => row.id === reference) ||
			rows
				.filter((row) => row.crystal.actionKey === reference)
				.sort((a, b) => Number(b.crystal.version || 1) - Number(a.crystal.version || 1) || newest(a, b))[0];
		if (!row) return fail(`No action you own matches "${reference.slice(0, 80)}" in this local workspace`, 404);
		const checked = sanitizeActionCrystal(row.crystal);
		if (checked.ok === false) return fail(`This action no longer passes the program grammar: ${checked.error}`, 422);
		const crystal = checked.crystal;
		return {
			id: row.id,
			ownerId: actorId,
			name: String(crystal.name || 'Action'),
			crystal,
			steps: crystal.steps as ActionStep[],
			capabilities: crystal.capabilities as ActionCapabilityEntry[],
			inputs: (crystal.inputs || []) as Record<string, unknown>[]
		};
	}
	private async schema(reference: string) {
		const rows = (await this.things.snapshot()).filter((row) => row.thingtime.includes('schema')).sort(newest);
		const row = rows.find((row) => row.id === reference) || rows.find((row) => row.crystal.name === reference);
		if (!row) return fail(`Schema "${reference.slice(0, 80)}" is not in this local workspace. Import its editable definition first.`, 404);
		return { id: row.id, name: String(row.crystal.name || reference) };
	}
	private async search(step: Record<string, any>, scope: ActionCapabilityEntry | null, label: string) {
		if (step.scope === 'public' || step.scope === 'system')
			fail('Public and system data searches require an online service; this local Action did not make a request', 409);
		const schema = typeof step.schema === 'string' ? await this.schema(step.schema) : null;
		const where = Object.entries(step.where || {}).map(([key, value]) => [key, scalar(value, `Step ${label} where.${key}`)] as const);
		const match = Object.entries(step.match || {}).map(
			([key, value]) => [key, String(scalar(value, `Step ${label} match.${key}`) ?? '').slice(0, MAX_ACTION_SEARCH_MATCH_CHARS)] as const
		);
		const rows = (await this.things.snapshot()).filter(
			(row) =>
				row.thingtime.includes('data') &&
				schemaScopeAllows(scope, schemaIdentityOf(row.crystal)) &&
				(!schema || row.crystal.schemaId === schema.id || row.crystal.schema === schema.name) &&
				where.every(([key, value]) => (read(row.crystal, key) ?? null) === value) &&
				match.every(
					([key, value]) =>
						!value.trim() ||
						(typeof read(row.crystal, key) === 'string' && String(read(row.crystal, key)).toLowerCase().includes(value.toLowerCase()))
				)
		);
		const sortField = step.sort?.field || 'createdAt',
			direction = step.sort?.dir === 'asc' ? 1 : -1;
		const sortValue = (row: LocalThing) => (sortField === 'createdAt' || sortField === 'updatedAt' ? row[sortField] : read(row.crystal, sortField));
		rows.sort((a, b) => {
			const x = sortValue(a),
				y = sortValue(b);
			const order = x === y ? 0 : x == null ? -1 : y == null ? 1 : x < y ? -1 : 1;
			return order * direction || a.id.localeCompare(b.id);
		});
		const offset = Number(step.offset) || 0,
			limit = Math.min(Number(step.limit) || 20, MAX_ACTION_SEARCH_LIMIT);
		return rows.slice(offset, offset + limit).map((row) => ({ shareId: row.id, crystal: row.crystal, createdAt: row.createdAt, ownerId: actorId }));
	}
	private host(lease: WorkspaceLease): ActionRuntimeHost {
		const things = new LocalThings(this.db, this.scope, lease);
		return {
			resolveActionProgram: async (reference) => {
				const program = await this.resolve(reference);
				if (program.crystal.runtime === 'browser') fail('A data Action cannot invoke a browser Action');
				return program;
			},
			resolveSchemaRef: (reference) => this.schema(reference),
			getThing: async (id) => ({ ok: true, thing: localThingProjection(await things.get(id), actorId) }),
			createThing: async (input) => {
				const row = await things.create({ thingtime: input.thingtime, crystal: input.crystal });
				return { ok: true, doc: { shareId: row.id, crystal: row.crystal } };
			},
			updateThing: async (id, input) => ({ ok: true, thing: await things.update({ id, ...input }) }),
			deleteThing: async (id) => {
				await things.remove([id]);
				return { ok: true };
			},
			search: (step, scope, _shared, _program, label) => this.search(step, scope, label),
			packs: () => bindPacks({ random: Math.random, now: () => new Date() }),
			lookup: async () => fail('External lookups require an online service and its authorized Vault credential; no request was made', 409)
		};
	}
	private inputs(program: ActionProgram, raw: unknown) {
		const cap = Math.min(
			Number((program.crystal.limits as any)?.maxInputBytes) || ACTION_LIMIT_DEFAULTS.maxInputBytes,
			ACTION_LIMIT_CEILINGS.maxInputBytes
		);
		const copied = snapshotTransferValue(raw ?? {});
		if (jsonBytes(copied) > cap) fail(`Inputs exceed this action's ${cap}-byte cap`, 413);
		const checked = validateRunInputs(program.inputs, copied);
		if (checked.ok === false) return fail(checked.error, checked.status);
		if (jsonBytes(checked.inputs) > cap) fail(`Resolved inputs exceed this action's ${cap}-byte cap`, 413);
		return checked.inputs;
	}
	private async prepare(reference: string, raw: unknown): Promise<PreparedBrowserAction> {
		const program = await this.resolve(reference);
		if (program.crystal.runtime !== 'browser') return fail('Use a browser Action when composing browser flows', 409);
		return {
			ok: true,
			status: 'prepared',
			execution: 'browser',
			actionId: program.id,
			viewer: { id: actorId, username: 'local' },
			program: program.crystal,
			inputs: this.inputs(program, raw)
		};
	}
	async run(request: { action: string; inputs?: unknown; source?: string }) {
		this.assert();
		const count = activeRuns.get(this.db) || 0;
		if (count >= 4) return fail('Four local Actions are already running. Wait for one to finish.', 429);
		activeRuns.set(this.db, count + 1);
		try {
			return await this.execute(request);
		} finally {
			activeRuns.set(this.db, (activeRuns.get(this.db) || 1) - 1);
		}
	}
	private async execute(request: { action: string; inputs?: unknown; source?: string }) {
		this.assert();
		const program = await this.resolve(request.action),
			inputs = this.inputs(program, request.inputs);
		const startedAt = new Date().toISOString(),
			start = Date.now();
		const limits: Record<keyof typeof ACTION_LIMIT_DEFAULTS, number> = { ...ACTION_LIMIT_DEFAULTS };
		for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
			const declared = (program.crystal.limits as Record<string, unknown> | undefined)?.[key];
			limits[key] = Math.min(typeof declared === 'number' && Number.isFinite(declared) ? declared : limits[key], ACTION_LIMIT_CEILINGS[key]);
		}
		const deadline = start + limits.timeoutMs;
		const runLease: WorkspaceLease = {
			...this.lease,
			assertCurrent: () => {
				this.assert();
				if (Date.now() >= deadline) fail('Action execution timed out', 408);
			}
		};
		const budget: ActionBudget = {
			assertAuthorized: async () => runLease.assertCurrent(),
			deadline,
			opsRemaining: limits.maxOperations,
			maxDepth: limits.maxDepth,
			childActionsRemaining: limits.maxChildActions,
			maxResultBytes: limits.maxResultBytes,
			maxInputBytes: limits.maxInputBytes,
			opsUsed: 0,
			depthUsed: 0,
			childActionsUsed: 0,
			trace: [],
			stack: [],
			ownedOnly: true,
			expressionNodes: { nodes: MAX_EXPRESSION_NODES_PER_RUN }
		};
		let outcome: { status: string; result: unknown; error?: string; durationMs: number; opsUsed: number; trace: unknown[]; [key: string]: unknown };
		if (program.crystal.runtime === 'browser') {
			outcome = await finishBrowserAction(await this.prepare(program.id, inputs), {
				assertIdentity: (id) => {
					this.assert();
					if (id !== actorId) fail('Workspace changed', 409);
				},
				prepare: async (reference, values, id, signal) => {
					this.assert();
					signal.throwIfAborted();
					if (id !== actorId) fail('Workspace changed', 409);
					return this.prepare(reference, values);
				},
				// Each endpoint requires a dedicated local adapter. Never reuse the cloud
				// host or fallback to fetch, even for a same-origin authored request.
				request: async () => fail('This browser Action requests a service without a local adapter; no network request was made', 409)
			});
		} else {
			let result: unknown = null,
				error: string | undefined;
			try {
				result = await executeProgram({ id: actorId, username: 'local' }, program, inputs, budget, '', this.host(runLease));
				runLease.assertCurrent();
				if (jsonBytes(result) > limits.maxResultBytes) fail(`Result exceeds the ${limits.maxResultBytes}-byte cap`);
			} catch (cause) {
				result = null;
				error = (cause instanceof Error ? cause.message : String(cause)).slice(0, MAX_ACTION_RUN_ERROR_CHARS);
			}
			outcome = {
				status: error ? 'error' : 'ok',
				result,
				...(error ? { error } : {}),
				durationMs: Date.now() - start,
				opsUsed: budget.opsUsed,
				depthUsed: budget.depthUsed,
				childActionsUsed: budget.childActionsUsed,
				trace: budget.trace
			};
		}
		this.assert();
		const runId = `local-action-run-${crypto.randomUUID()}`;
		let historyError: string | undefined;
		try {
			await this.db.transaction(this.scope, 'readwrite', this.lease, async (tx) => {
				if (!(await tx.get<LocalThing>('things', program.id))?.thingtime.includes('action')) return;
				const prior = (await tx.list<LocalThing>('things'))
					.map((row) => row.value)
					.filter((row) => row.thingtime.includes('action-run') && row.targetId === program.id)
					.sort(newest);
				for (const row of prior.slice(MAX_ACTION_RUNS_RETAINED - 1)) await tx.delete('things', row.id);
				const cap = (value: unknown) => (jsonBytes(value) > ACTION_LIMIT_CEILINGS.maxResultBytes ? { truncated: true } : value ?? null);
				await tx.put('things', runId, {
					id: runId,
					thingtime: ['action-run'],
					targetId: program.id,
					crystal: snapshotTransferValue({
						...Object.fromEntries(Object.entries(outcome).filter(([, value]) => value !== undefined)),
						result: cap(outcome.result),
						inputs: cap(inputs),
						startedAt
					}),
					createdAt: startedAt,
					updatedAt: startedAt,
					revision: 1
				});
			});
		} catch (cause) {
			this.assert();
			historyError = cause instanceof Error ? cause.message : 'Local run history could not be saved';
		}
		return { ...outcome, ok: true, actionId: program.id, runId, localOnly: true, cache: 'no-store', ...(historyError ? { historyError } : {}) };
	}
	async runs(query: { action?: string; limit?: number } = {}) {
		this.assert();
		const rows = (await this.things.snapshot())
			.filter((row) => row.thingtime.includes('action-run') && (!query.action || row.targetId === query.action))
			.sort(newest)
			.slice(0, Math.max(1, Math.min(Number(query.limit) || 20, MAX_ACTION_RUN_HISTORY)));
		return {
			ok: true,
			runs: rows.map((row) => ({
				id: row.id,
				actionId: row.targetId || null,
				createdAt: row.createdAt,
				status: typeof row.crystal.status === 'string' ? row.crystal.status : 'error',
				startedAt: typeof row.crystal.startedAt === 'string' ? row.crystal.startedAt : null,
				durationMs: typeof row.crystal.durationMs === 'number' ? row.crystal.durationMs : null,
				opsUsed: typeof row.crystal.opsUsed === 'number' ? row.crystal.opsUsed : null,
				error: typeof row.crystal.error === 'string' ? row.crystal.error : null,
				trace: Array.isArray(row.crystal.trace) ? row.crystal.trace : [],
				result: row.crystal.result ?? null,
				inputs: row.crystal.inputs ?? null
			}))
		};
	}
}
