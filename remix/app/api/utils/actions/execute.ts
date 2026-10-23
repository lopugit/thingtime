import {
	executeProgram,
	jsonBytes,
	runError,
	schemaScopeAllows,
	schemaIdentityOf,
	type ActionBudget,
	type ActionProgram,
	type ActionRuntimeHost,
	type ActionRunTraceEntry
} from '../../../actions/runtime';
import { validateRunInputs } from './actionInputs';
import { browserActionMinimumVersion } from '~/schemas/actionRequestPagination';
import { capabilitySatisfies } from '../capabilities/capabilityContract';
import type { PreparedBrowserAction } from '~/schemas/browserActions';
import { runLookup } from './lookup';
import { revealUserVaultValue } from '../lopu/userVault';
import { randomUUID } from 'node:crypto';
import { withTimelineMutationContext } from '../timeline/mutationContext';
import { actionTimelineRecorder } from '../timeline/actionOutcome';
import type { ActionTimelineReport } from '../../../timeline/actionOutcome';
import { StorageMutationError } from '../storage/storageCore';

import {
	ACL_ALL,
	ACTION_LIMIT_CEILINGS,
	ACTION_LIMIT_DEFAULTS,
	MAX_ACTION_RUN_ERROR_CHARS,
	MAX_ACTION_RUN_HISTORY,
	MAX_ACTION_RUNS_RETAINED,
	MAX_ACTION_SEARCH_LIMIT,
	MAX_ACTION_SEARCH_MATCH_CHARS,
	deriveActionEffects,
	sanitizeActionCrystal,
	type ActionCapabilityEntry,
	type ActionEffects,
	type ActionStep
} from '~/schemas/registry';
import { MAX_EXPRESSION_NODES_PER_RUN } from '~/schemas/actionExpressions';
import { getThingsCollection } from '../mongodb/collections';
import { newThingDoc } from '../messenger/shared';
import {
	ACTION_RESERVED_ID_PREFIX,
	createThing,
	canViewInherited,
	deleteThing,
	fail,
	getThing,
	isFail,
	updateThing,
	type Fail,
	type Viewer
} from '../things/things';
import { emitSystemNotification } from '../notifications/notifications';
import { bindPacks } from './packs/index';
import type { SharedComposition } from './sharedComposition';
export type { ActionRunTraceEntry } from '../../../actions/runtime';

// The Action Thing executor — the run-time half of the bounded-execution
// contract (save-time lives in registry.ts sanitizeActionCrystal).
//
// Invariants (PRs/action-thing-v1-design.md):
// - Capabilities only NARROW: every operation delegates to the ordinary
//   things utils as the invoking user, so ACL, quotas, schema validation and
//   storage accounting always apply. An action can never do something its
//   invoker couldn't do by hand.
// - Closed vocabulary: an op that isn't in the sanitized program cannot run,
//   and authored programs have no arbitrary fetch, env access or raw Mongo
//   writes. Registered lookup adapters alone can use owner-scoped Vault
//   credentials for a fixed provider destination.
// - One shared budget per root invocation: deadline, operation count, depth,
//   child-action count, and (v2) expression evaluations. actions.invoke and
//   each recurse with the SAME budget object, so A→B→A terminates by
//   construction (and direct cycles are refused with a clear error before the
//   budget even drains).
// - v2 compute: step values may hold `{ ttExpr: [fn, ...args] }` expressions
//   over the closed catalogue in schemas/actionExpressions.ts (math, logic,
//   text, list, object, date, random, and the domain packs bound in
//   ./packs). Expressions are pure: they read refs and return values, never
//   touch the database, and are bounded by a per-run node budget. Pack calls
//   count as operations because they are the only non-trivial CPU.
// - Every run lands one protected action-run thing (targetId = the action),
//   owner-private, storageClass 'control' like the CI event family —
//   operational telemetry with hard size caps, not billable content. Because
//   'control' also means "outside the storage ledger", the trail is bounded by
//   COUNT as well as by bytes: writeRunRecord keeps the newest
//   MAX_ACTION_RUNS_RETAINED per (owner, action). That prune only fires during
//   a run OF THAT ACTION, so the other end of the lifecycle is the delete
//   cascade — action-run rides CASCADE_CHILD_THINGTIME, so deleting an action
//   takes its trail with it instead of stranding unaccounted records that
//   nothing would prune again (and that the owner could never remove, the kind
//   being protected). The cascade can only take the trail it can SEE, and this
//   record is written when the run ENDS, so writeRunRecord closes its own half:
//   a record whose action went away mid-run deletes itself.

export type RunActionResult =
	| PreparedBrowserAction
	| Fail
	| {
			ok: true;
			runId: string;
			status: 'ok' | 'error';
			actionId: string;
			result: unknown;
			cache?: 'no-store';
			history?: ActionTimelineReport;
			error?: string;
			durationMs: number;
			opsUsed: number;
			depthUsed: number;
			childActionsUsed: number;
			trace: ActionRunTraceEntry[];
	  };

// ── program resolution ──────────────────────────────────────────────────────

// Resolve "<shareId>" or "<actionKey>" to a runnable action program.
//
// TWO MODES, because the reference arrives from two very different places:
// - Deliberate (`/actions` inspector): the viewer read the program's derived
//   effects and pressed Run, so a FOREIGN readable action resolves by id.
// - Delegated (`ownedOnly` — a ttAction click inside rendered component
//   markup): the viewer approved a control, not a program. Markup can name any
//   id, so an id lookup here is owner-pinned like the actionKey branch already
//   is. Otherwise foreign markup could lend the viewer's authority to a
//   stranger's program — exactly the hijack the key branch was hardened
//   against, reintroduced through the id path.
// actionKey ALWAYS resolves owner-scoped, in both modes.
const resolveActionProgram = async (
	viewer: Viewer,
	reference: string,
	options?: { ownedOnly?: boolean; shared?: SharedComposition; parentId?: string }
): Promise<Fail | ActionProgram> => {
	if (!viewer) return fail(401, 'Running actions requires signing in');
	const trimmed = typeof reference === 'string' ? reference.trim() : '';
	if (!trimmed) return fail(400, 'Which action? Pass its id or actionKey');

	let doc: { id: string; ownerId?: string; crystal: Record<string, unknown> } | null = null;
	if (options?.shared) {
		const included = options.parentId ? options.shared.children.get(`${options.parentId}:${trimmed}`) : options.shared.actions.get(trimmed);
		if (!included) return fail(404, 'This action is not included in the shared app');
		doc = { id: included.shareId, crystal: included.crystal || {} };
	} else if (options?.ownedOnly) {
		const things = await getThingsCollection();
		const own = await things.findOne({ shareId: trimmed, ownerId: viewer.id, thingtime: 'action' } as any);
		if (own) doc = { id: own.shareId, ownerId: own.ownerId, crystal: (own.crystal || {}) as Record<string, unknown> };
	} else {
		const byId = await getThing(viewer, trimmed);
		if (byId.ok !== false && byId.thing && Array.isArray(byId.thing.thingtime) && byId.thing.thingtime.includes('action')) {
			doc = { id: byId.thing.id, ownerId: byId.thing.author?.id, crystal: (byId.thing.crystal || {}) as Record<string, unknown> };
		}
	}
	if (!doc) {
		const things = await getThingsCollection();
		// Deterministic under duplicate keys: nothing index-enforces per-owner
		// actionKey uniqueness yet, so resolve to the LATEST revision (highest
		// crystal.version, newest doc as the tiebreak) — matching the schema's
		// "version counter for saved revisions of an actionKey" story instead
		// of Mongo natural order.
		const [own] = await things
			.find({
				ownerId: viewer.id,
				thingtime: 'action',
				'crystal.actionKey': trimmed
			} as any)
			.sort({ 'crystal.version': -1, createdAt: -1 })
			.limit(1)
			.toArray();
		if (own) doc = { id: own.shareId, ownerId: own.ownerId, crystal: (own.crystal || {}) as Record<string, unknown> };
	}
	if (!doc) {
		return fail(
			404,
			options?.ownedOnly
				? `No action you own matches "${trimmed.slice(0, 80)}" — a component control can only run your own actions`
				: `No runnable action matches "${trimmed.slice(0, 80)}"`
		);
	}

	// Re-sanitize so run-time enforces the exact save-time contract (steps
	// grammar, capability coverage, ref validity) even for legacy documents.
	const sanitized = sanitizeActionCrystal(doc.crystal);
	if (isFail(sanitized)) return fail(422, `This action no longer passes the program grammar: ${sanitized.error}`);
	const crystal = sanitized.crystal;
	return {
		id: doc.id,
		ownerId: doc.ownerId,
		name: typeof crystal.name === 'string' ? crystal.name : 'Action',
		crystal,
		steps: (crystal.steps || []) as ActionStep[],
		capabilities: (crystal.capabilities || []) as ActionCapabilityEntry[],
		inputs: (crystal.inputs || []) as Record<string, unknown>[]
	};
};

// ── schema + capability helpers ─────────────────────────────────────────────

type ResolvedSchema = { id: string; name: string };

// A step's schema ref is a schema thing shareId or its crystal.name. Data
// things created by the executor are stamped exactly the way the schema form
// publishes them (crystal.schema = name, crystal.schemaId = shareId).
const resolveSchemaRef = async (viewer: Viewer, ref: string): Promise<ResolvedSchema> => {
	const byId = await getThing(viewer, ref);
	if (byId.ok !== false && byId.thing && Array.isArray(byId.thing.thingtime) && byId.thing.thingtime.includes('schema')) {
		const crystal = (byId.thing.crystal || {}) as Record<string, unknown>;
		return { id: byId.thing.id, name: typeof crystal.name === 'string' ? crystal.name : ref };
	}
	const things = await getThingsCollection();
	const own = await things.findOne({ ownerId: viewer!.id, thingtime: 'schema', 'crystal.name': ref } as any);
	if (own) {
		const crystal = (own.crystal || {}) as Record<string, unknown>;
		return { id: own.shareId, name: typeof crystal.name === 'string' ? crystal.name : ref };
	}
	// A seeded system schema is addressable by its NAME too (its shareId is
	// `schema-<slug>` and its crystal.name the slug), so an installed program
	// that names a public shape still resolves when the viewer owns no copy.
	const seeded = await things.findOne({ ownerId: 'system', thingtime: 'schema', 'crystal.name': ref } as any);
	if (seeded) {
		const crystal = (seeded.crystal || {}) as Record<string, unknown>;
		return { id: seeded.shareId, name: typeof crystal.name === 'string' ? crystal.name : ref };
	}
	return runError(`Schema "${ref.slice(0, 80)}" was not found (pass a schema thing id or one of your schema names)`) as never;
};

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const scalarFilterValue = (value: unknown, label: string): string | number | boolean | null => {
	if (value === null || value === undefined) return null;
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
	return runError(`${label} resolved to a non-scalar filter value`);
};

// ── the engine ──────────────────────────────────────────────────────────────

const searchActionThings = async (
	viewer: Viewer,
	step: Record<string, any>,
	readScope: ActionCapabilityEntry | null,
	shared: SharedComposition | undefined,
	programId: string,
	label: string
) => {
	// Scope 'own' (default) = YOUR OWN data things; 'public' = tt:all
	// data things of ONE schema from ANYONE; 'system' = tt:all data
	// things of ONE schema that the SEED owns (the sanitizer requires
	// the schema for both cross-owner scopes). All three keep ACL
	// trivially correct without dragging the full search pipeline into
	// the executor: own docs are yours, public and system docs are
	// already world-readable.
	//
	// 'system' is not a convenience alias for 'public'. `crystal.schema`
	// is a free-form field on the open `data` crystal and a seeded
	// schema is world-readable, so ANY signed-in account can publish a
	// public data thing wearing a platform schema's stamp. A platform
	// program that reads its own seeded corpus in 'public' scope reads
	// a corpus strangers can write into — and with the default
	// newest-first sort, a forged row sorts ABOVE the seeded one.
	const limit = typeof step.limit === 'number' ? step.limit : Math.min(20, MAX_ACTION_SEARCH_LIMIT);
	const offset = typeof step.offset === 'number' ? step.offset : 0;
	const scopeKind = step.scope === 'public' || step.scope === 'system' ? step.scope : 'own';
	const clauses: Record<string, unknown>[] = [];
	if (typeof step.schema === 'string') {
		// Resolve the schema through this program's freshly authorized
		// stored edge, without changing the search's account/ACL scope.
		const included = shared?.references.get(`${programId}:schema:${step.schema}`);
		const schema = included
			? { id: included.shareId, name: typeof included.crystal?.name === 'string' ? included.crystal.name : step.schema }
			: await resolveSchemaRef(viewer, step.schema);
		clauses.push({ $or: [{ 'crystal.schemaId': schema.id }, { 'crystal.schema': schema.name }] });
	}
	// A scoped things.read capability constrains the QUERY too — a bare
	// search step must not read outside the declared scope while the
	// inspector shows the narrow one (things.get closes this same gap
	// via schemaScopeAllows below; search needs both halves).

	if (readScope?.schemas?.length) {
		clauses.push({
			$or: readScope.schemas.flatMap((ref) => [{ 'crystal.schemaId': ref }, { 'crystal.schema': ref }])
		});
	}
	// where: equality on crystal fields; match: case-insensitive
	// substring. Field names were pattern-checked at save time.
	if (step.where && typeof step.where === 'object') {
		for (const [field, raw] of Object.entries(step.where as Record<string, unknown>)) {
			clauses.push({ [`crystal.${field}`]: scalarFilterValue(raw, `Step ${label} where.${field}`) });
		}
	}
	if (step.match && typeof step.match === 'object') {
		for (const [field, raw] of Object.entries(step.match as Record<string, unknown>)) {
			const needle = String(scalarFilterValue(raw, `Step ${label} match.${field}`) ?? '').slice(0, MAX_ACTION_SEARCH_MATCH_CHARS);
			if (needle.trim()) clauses.push({ [`crystal.${field}`]: { $regex: escapeRegExp(needle), $options: 'i' } });
		}
	}
	const filter: Record<string, unknown> = {
		thingtime: 'data',
		...(scopeKind === 'public' ? { acl: ACL_ALL } : scopeKind === 'system' ? { acl: ACL_ALL, ownerId: 'system' } : { ownerId: viewer!.id }),
		...(clauses.length ? { $and: clauses } : {})
	};
	const sortSpec = step.sort as { field: string; dir: string } | undefined;
	const sortField = sortSpec
		? sortSpec.field === 'createdAt' || sortSpec.field === 'updatedAt'
			? sortSpec.field
			: `crystal.${sortSpec.field}`
		: 'createdAt';
	const sortDir = sortSpec?.dir === 'asc' ? 1 : -1;
	const things = await getThingsCollection();
	let docs = (
		await things
			.find(filter as any)
			.sort({ [sortField]: sortDir, shareId: 1 })
			.skip(offset)
			.limit(limit)
			.toArray()
	).filter((doc: any) => schemaScopeAllows(readScope, schemaIdentityOf(doc.crystal)));
	if (shared) {
		const permissions = await Promise.all(docs.map((doc: any) => canViewInherited(doc, null)));
		docs = docs.filter((_doc: any, index: number) => permissions[index]);
	}
	return docs;
};

const serverActionHost = (viewer: Viewer): ActionRuntimeHost => ({
	resolveActionProgram: (reference, options) => resolveActionProgram(viewer, reference, options),
	resolveSchemaRef: (reference) => resolveSchemaRef(viewer, reference),
	getThing: (id) => getThing(viewer, id),
	createThing: (input) => createThing(viewer!.id, input, viewer),
	updateThing: (id, input) => updateThing(viewer, id, input),
	deleteThing: (id) => deleteThing(viewer, id),
	search: (step, readScope, shared, programId, label) => searchActionThings(viewer, step, readScope, shared, programId, label),
	packs: () => bindPacks({ random: Math.random, now: () => new Date() }),
	lookup: async (step, query, deadline) => {
		const credential = await revealUserVaultValue(viewer!.id, String(step.credentialId));
		if (!credential) runError('Lookup credential is unavailable in your Vault');
		return runLookup({ provider: step.provider, query, credential: credential!, deadline });
	}
});

// ── run records ─────────────────────────────────────────────────────────────

const capBytes = (value: unknown, maxBytes: number): unknown => {
	if (value === undefined) return null;
	return jsonBytes(value) <= maxBytes ? value ?? null : { truncated: true, bytes: jsonBytes(value) };
};

const writeRunRecord = async (viewer: Viewer, actionId: string, crystal: Record<string, unknown>, runId: string): Promise<string> => {
	const things = await getThingsCollection();
	// Direct insert (newThingDoc posture): action-run is PROTECTED, so
	// createThing refuses it by design. storageClass control = operational
	// telemetry (CI-event precedent), hard-capped by the byte limits above.
	await things
		.insertOne({
			...newThingDoc('action-run', { ownerId: viewer!.id, targetId: actionId, crystal, shareId: runId }),
			storageClass: 'control'
		} as any)
		.catch(() => null); // a failed audit write must not mask the run result

	// The record lands at the END of the run, so the action it names can have
	// been deleted at any point WHILE the program was executing (a run gets up
	// to timeoutMs). The delete cascade only takes the trail it can SEE:
	// discoverCascadeDescendants and deleteDrainedRootAtomically both snapshot
	// before this insert exists. createThing survives that race because it
	// transacts its insert together with a touch of the target doc, so a
	// concurrent cascade cannot commit an orphan between the two writes
	// (things.ts) — this direct insert writes no parent doc, so there is no
	// write conflict to make Mongo retry either side.
	//
	// An orphan is PERMANENT: the retention prune only ever fires during a run
	// OF THAT ACTION (gone), action-run is PROTECTED so no route lets its owner
	// delete one, and storageClass 'control' keeps it off the storage ledger.
	// So reconcile in the direction the delete already chose. Deliberately NOT
	// owner-scoped: a public action is owned by its author while the run record
	// is owned by the invoker.
	//
	// This closes the realistic window — the whole duration of the run. It does
	// not close commit ordering: a record that lands after the root-delete
	// transaction's snapshot but is read back before that transaction commits
	// still strands. That residue is one round trip wide instead of one run
	// wide, and the cascade owns the other interleaving — a record committed
	// before the snapshot BLOCKS the root delete, and the re-walk removes it.
	try {
		const parent = await things.findOne({ shareId: actionId } as any, { projection: { _id: 1 } });
		if (!parent) {
			await things.deleteOne({ shareId: runId, thingtime: 'action-run' } as any);
			return runId;
		}
	} catch {
		// best-effort like the insert — never mask the run result
	}

	// Bound accumulation (issueAppToken posture): keep the newest N records for
	// this (owner, action) and drop the rest. The CI-event precedent this kind
	// borrows its storageClass from is written by trusted webhook deliveries as
	// ownerId 'system'; THIS one is minted by an authenticated user at up to
	// actions.run's 60/min, and 'control' takes it out of the storage ledger
	// entirely — so per-record byte caps alone leave the trail unbounded.
	// Same scope, filter and sort as listActionRuns, so what survives is
	// exactly what the history endpoint can still show.
	//
	// Best-effort like the insert: a failed prune must not mask the run result.
	// Racing runs of one action can briefly overshoot N (each keeps its own
	// newest-N view); the next run prunes the drift. Deleting directly is
	// correct here for the same reason inserting directly is — these records
	// were never ledger-accounted, so there is nothing to refund.
	try {
		const scope = { ownerId: viewer!.id, thingtime: 'action-run', targetId: actionId };
		const keep = await things
			.find(scope as any, { projection: { shareId: 1 } })
			.sort({ createdAt: -1, shareId: 1 })
			.limit(MAX_ACTION_RUNS_RETAINED)
			.toArray();
		// Never widen to "delete everything" on an empty read: $nin: [] matches
		// every doc in scope, so a read that came back empty for any reason
		// other than "there are none" would take the whole trail with it.
		if (keep.length >= MAX_ACTION_RUNS_RETAINED) {
			await things.deleteMany({ ...scope, shareId: { $nin: keep.map((doc: any) => doc.shareId) } } as any);
		}
	} catch {
		// leave the surplus for the next run to prune
	}
	return runId;
};

// ── entry point ─────────────────────────────────────────────────────────────

// The program's identity + derived effects WITHOUT running it — what Lopu's
// confirmation gate reads before run_action (a deleting program needs the
// user's approval first). Same deliberate-path resolution as runAction.
export type InspectActionProgramResult =
	| Fail
	| {
			ok: true;
			id: string;
			name: string;
			actionKey: string | null;
			effects: ActionEffects;
			runtime: 'browser' | 'server';
			inputs: Record<string, unknown>[];
	  };

export const inspectActionProgram = async (viewer: Viewer, reference: string): Promise<InspectActionProgramResult> => {
	const program = await resolveActionProgram(viewer, reference);
	if (isFail(program)) return program;
	return {
		ok: true,
		id: program.id,
		name: program.name,
		actionKey: typeof program.crystal.actionKey === 'string' ? program.crystal.actionKey : null,
		runtime: program.crystal.runtime === 'browser' ? 'browser' : 'server',
		inputs: program.inputs,
		effects: deriveActionEffects(program.steps)
	};
};

const executeActionRun = async (
	viewer: Viewer,
	request: { action?: unknown; inputs?: unknown; source?: unknown; execution?: unknown; executionVersion?: unknown },
	shared?: SharedComposition,
	context?: { firstPartyActorId?: string; browserOnly?: boolean; assertAuthorized?: () => Promise<void> }
): Promise<RunActionResult> => {
	// Shared programs receive neither the author's nor the visitor's private
	// account authority. Only stored composition reads are added below.
	if (shared) viewer = { id: '' };
	if (!viewer) return fail(401, 'Running actions requires signing in');
	// 'component' = the delegated path (a click inside rendered markup). The
	// flag only ever NARROWS resolution, so honouring a client-supplied value
	// is safe: the viewer's own client always sends it, and a caller who omits
	// it is acting as themselves on their own behalf.
	const ownedOnly = request.source === 'component';
	const program = await resolveActionProgram(viewer, typeof request.action === 'string' ? request.action : '', { ownedOnly, shared });
	if (isFail(program)) return program;

	const declaredLimits = (program.crystal.limits || {}) as Record<string, number>;
	// Walk the CEILINGS, never the merged object: an unrecognised declared key
	// has no ceiling (Math.min(value, undefined) → NaN in the budget), and the
	// executor must not depend on the sanitizer having refused it upstream.
	const limits: Record<keyof typeof ACTION_LIMIT_CEILINGS, number> = { ...ACTION_LIMIT_DEFAULTS };
	for (const key of Object.keys(ACTION_LIMIT_CEILINGS) as (keyof typeof ACTION_LIMIT_CEILINGS)[]) {
		const declared = declaredLimits[key];
		limits[key] = Math.min(
			typeof declared === 'number' && Number.isFinite(declared) ? declared : ACTION_LIMIT_DEFAULTS[key],
			ACTION_LIMIT_CEILINGS[key]
		);
	}

	if (jsonBytes(request.inputs ?? {}) > limits.maxInputBytes) {
		return fail(413, `Inputs exceed this action's ${limits.maxInputBytes}-byte cap`);
	}
	const validated = validateRunInputs(program.inputs, request.inputs);
	if (isFail(validated)) return validated;
	if (jsonBytes(validated.inputs) > limits.maxInputBytes) return fail(413, `Resolved inputs exceed this action's ${limits.maxInputBytes}-byte cap`);
	if (context?.browserOnly && program.crystal.runtime !== 'browser') return fail(409, 'Use a browser Action when composing browser flows');
	if (program.crystal.runtime === 'browser') {
		if (shared || program.ownerId !== viewer.id || viewer.pat || context?.firstPartyActorId !== viewer.id)
			return fail(403, 'Browser flows require your own Action and a first-party session');
		if (request.execution !== 'browser') return fail(409, 'This Action runs in the browser. Use a client supporting api.actions-run 1.7.0');
		if (
			browserActionMinimumVersion(program.crystal) !== '1.7.0' &&
			!capabilitySatisfies(
				typeof request.executionVersion === 'string' ? request.executionVersion : undefined,
				browserActionMinimumVersion(program.crystal)
			)
		)
			return fail(
				409,
				`This Action needs a client supporting api.actions-run ${browserActionMinimumVersion(program.crystal)} for its configured limits`
			);
		// This is preparation, not execution. Do not record a successful run.
		return {
			ok: true,
			status: 'prepared',
			execution: 'browser',
			actionId: program.id,
			viewer: { id: viewer.id, username: viewer.username },
			program: program.crystal,
			inputs: validated.inputs
		};
	}

	const runId = shared ? `shared-run-${randomUUID()}` : `${ACTION_RESERVED_ID_PREFIX}run-${randomUUID()}`;
	let admission: Awaited<ReturnType<typeof actionTimelineRecorder.begin>> | null = null;
	if (!shared) {
		try {
			admission = await actionTimelineRecorder.begin(viewer.id, program.id, runId, program.name);
		} catch (error) {
			return fail(
				error instanceof StorageMutationError ? error.status : 503,
				'Action did not run because its History could not be saved. Check account storage and try again.'
			);
		}
	}
	const startedAt = new Date();
	const budget: ActionBudget = {
		assertAuthorized: context?.assertAuthorized,
		deadline: Date.now() + limits.timeoutMs,
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
		ownedOnly,
		shared,
		expressionNodes: { nodes: MAX_EXPRESSION_NODES_PER_RUN }
	};

	let status: 'ok' | 'error' = 'ok';
	let result: unknown = null;
	let errorMessage: string | undefined;
	try {
		result = await executeProgram(viewer, program, validated.inputs, budget, '', serverActionHost(viewer));
		if (jsonBytes(result) > limits.maxResultBytes) {
			status = 'error';
			errorMessage = `Result exceeds the ${limits.maxResultBytes}-byte cap`;
			result = null;
		}
	} catch (error) {
		status = 'error';
		errorMessage = (error instanceof Error ? error.message : String(error)).slice(0, MAX_ACTION_RUN_ERROR_CHARS);
		result = null;
	}
	const durationMs = Math.max(0, Date.now() - startedAt.getTime());
	const history = admission
		? await actionTimelineRecorder.finish(admission, {
				status,
				durationMs,
				opsUsed: budget.opsUsed,
				depthUsed: budget.depthUsed,
				childActionsUsed: budget.childActionsUsed
		  })
		: undefined;

	// The bounded debug cache is supplementary. Canonical Timeline outcomes
	// survive pruning/deleting this cache and omit its sensitive runtime data.
	if (!shared)
		await writeRunRecord(
			viewer,
			program.id,
			{
				status,
				startedAt: startedAt.toISOString(),
				durationMs,
				opsUsed: budget.opsUsed,
				depthUsed: budget.depthUsed,
				childActionsUsed: budget.childActionsUsed,
				...(errorMessage ? { error: errorMessage } : {}),
				inputs: capBytes(validated.inputs, budget.maxInputBytes),
				result: budget.usedLookup ? { omitted: 'External lookup results are transient' } : capBytes(result, budget.maxResultBytes),
				trace: budget.trace
			},
			runId
		).catch(() => runId);

	// Save every ordinary run, including successful component refreshes.
	// Quiet delivery never means missing history. Await the non-throwing writer
	// so a serverless response cannot cut off the history write. Shared runs
	// are anonymous, ephemeral interactions and never write account history.
	if (!shared) {
		const actionKey =
			typeof program.crystal.actionKey === 'string' && program.crystal.actionKey.trim() ? program.crystal.actionKey.trim() : program.id;
		const opsLabel = `${budget.opsUsed} op${budget.opsUsed === 1 ? '' : 's'}`;
		await emitSystemNotification({
			historyOnly: ownedOnly && status === 'ok',
			recipientId: viewer.id,
			type: 'action-run',
			title: status === 'ok' ? `Action “${program.name}” finished ✅` : `Action “${program.name}” failed 🌧️`,
			preview: status === 'ok' ? `${durationMs} ms · ${opsLabel}` : errorMessage || 'The run stopped with an error.',
			href: `/actions/${encodeURIComponent(actionKey)}`,
			targetId: runId,
			outcome: status
		}).catch(() => {});
	}

	return {
		ok: true,
		runId,
		...(history ? { history } : {}),
		status,
		actionId: program.id,
		...(budget.usedLookup ? { cache: 'no-store' as const } : {}),
		result,
		...(errorMessage ? { error: errorMessage } : {}),
		durationMs,
		opsUsed: budget.opsUsed,
		depthUsed: budget.depthUsed,
		childActionsUsed: budget.childActionsUsed,
		trace: budget.trace
	};
};

export const runAction = (...args: Parameters<typeof executeActionRun>): Promise<RunActionResult> =>
	withTimelineMutationContext(args[2] ? null : args[0]?.id ?? null, 'action', () => executeActionRun(...args));

// ── run history ─────────────────────────────────────────────────────────────

export type ActionRunSummary = {
	id: string;
	actionId: string | null;
	status: string;
	startedAt: string | null;
	durationMs: number | null;
	opsUsed: number | null;
	error: string | null;
	trace: ActionRunTraceEntry[];
	result: unknown;
	inputs: unknown;
	createdAt: string | null;
};

// action-run is PROTECTED (invisible to generic reads), so history has its
// own read model: the viewer's OWN runs, optionally for one action, newest
// first. One indexed query ({ targetId, thingtime, createdAt } is covered by
// the shared child index).
export const listActionRuns = async (
	viewer: Viewer,
	query: { action?: string | null; limit?: number }
): Promise<Fail | { ok: true; runs: ActionRunSummary[] }> => {
	if (!viewer) return fail(401, 'Sign in to see your action runs');
	const limit = Math.max(1, Math.min(Number(query.limit) || 20, MAX_ACTION_RUN_HISTORY));
	const filter: Record<string, unknown> = { ownerId: viewer.id, thingtime: 'action-run' };
	if (typeof query.action === 'string' && query.action.trim()) filter.targetId = query.action.trim();
	const things = await getThingsCollection();
	const docs = await things
		.find(filter as any)
		.sort({ createdAt: -1, shareId: 1 })
		.limit(limit)
		.toArray();
	return {
		ok: true,
		runs: docs.map((doc: any) => {
			const crystal = (doc.crystal || {}) as Record<string, unknown>;
			return {
				id: doc.shareId,
				actionId: doc.targetId || null,
				status: typeof crystal.status === 'string' ? crystal.status : 'ok',
				startedAt: typeof crystal.startedAt === 'string' ? crystal.startedAt : null,
				durationMs: typeof crystal.durationMs === 'number' ? crystal.durationMs : null,
				opsUsed: typeof crystal.opsUsed === 'number' ? crystal.opsUsed : null,
				error: typeof crystal.error === 'string' ? crystal.error : null,
				trace: Array.isArray(crystal.trace) ? (crystal.trace as ActionRunTraceEntry[]) : [],
				result: crystal.result ?? null,
				inputs: crystal.inputs ?? null,
				createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : null
			};
		})
	};
};
