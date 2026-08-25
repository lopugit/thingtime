import { randomUUID } from 'node:crypto';

import {
	ACTION_LIMIT_CEILINGS,
	ACTION_LIMIT_DEFAULTS,
	MAX_ACTION_RUN_ERROR_CHARS,
	MAX_ACTION_SEARCH_LIMIT,
	MAX_ACTION_TRACE_ENTRIES,
	parseActionRef,
	sanitizeActionCrystal,
	type ActionCapabilityEntry,
	type ActionStep
} from '~/schemas/registry';
import { getThingsCollection } from '../mongodb/collections';
import { newThingDoc } from '../messenger/shared';
import {
	ACTION_RESERVED_ID_PREFIX,
	createThing,
	fail,
	getThing,
	isFail,
	updateThing,
	type Fail,
	type Viewer
} from '../things/things';

// The Action Thing executor — the run-time half of the bounded-execution
// contract (save-time lives in registry.ts sanitizeActionCrystal).
//
// Invariants (PRs/action-thing-v1-design.md):
// - Capabilities only NARROW: every operation delegates to the ordinary
//   things utils as the invoking user, so ACL, quotas, schema validation and
//   storage accounting always apply. An action can never do something its
//   invoker couldn't do by hand.
// - Closed vocabulary: an op that isn't in the sanitized program cannot run,
//   and the executor has no fetch, no env access, and no raw Mongo writes on
//   behalf of the program (its only direct collection reads are the
//   owner-scoped searches below and the run-record insert).
// - One shared budget per root invocation: deadline, operation count, depth,
//   child-action count. actions.invoke recurses with the SAME budget object,
//   so A→B→A terminates by construction (and direct cycles are refused with
//   a clear error before the budget even drains).
// - Every run lands one protected action-run thing (targetId = the action),
//   owner-private, storageClass 'control' like the CI event family —
//   operational telemetry with hard size caps, not billable content.

export type ActionRunTraceEntry = {
	step: string;
	op: string;
	ms: number;
	target?: string;
	note?: string;
};

type ActionBudget = {
	deadline: number;
	opsRemaining: number;
	maxDepth: number;
	childActionsRemaining: number;
	maxResultBytes: number;
	maxInputBytes: number;
	opsUsed: number;
	depthUsed: number;
	childActionsUsed: number;
	trace: ActionRunTraceEntry[];
	stack: string[]; // action shareIds currently executing (cycle refusal)
};

type ActionProgram = {
	id: string;
	name: string;
	crystal: Record<string, unknown>;
	steps: ActionStep[];
	capabilities: ActionCapabilityEntry[];
	inputs: Record<string, unknown>[];
};

export type RunActionResult =
	| Fail
	| {
			ok: true;
			runId: string;
			status: 'ok' | 'error';
			actionId: string;
			result: unknown;
			error?: string;
			durationMs: number;
			opsUsed: number;
			depthUsed: number;
			childActionsUsed: number;
			trace: ActionRunTraceEntry[];
	  };

// Thrown inside step execution and converted into an error run record — never
// escapes runAction.
class ActionRunError extends Error {}

const runError = (message: string): never => {
	throw new ActionRunError(message);
};

const jsonBytes = (value: unknown): number => {
	try {
		const encoded = JSON.stringify(value);
		return typeof encoded === 'string' ? encoded.length : 0;
	} catch {
		return Number.MAX_SAFE_INTEGER;
	}
};

// ── program resolution ──────────────────────────────────────────────────────

const capabilityOf = (program: ActionProgram, capability: string): ActionCapabilityEntry | null =>
	program.capabilities.find((entry) => entry.capability === capability) || null;

// Resolve "<shareId>" or "<actionKey>" to a runnable, viewer-visible action
// program. shareId wins (it covers seeded action-<slug> ids); actionKey falls
// back to the invoker's OWN actions so a key reference can't be hijacked by
// someone else publishing the same key.
const resolveActionProgram = async (viewer: Viewer, reference: string): Promise<Fail | ActionProgram> => {
	if (!viewer) return fail(401, 'Running actions requires signing in');
	const trimmed = typeof reference === 'string' ? reference.trim() : '';
	if (!trimmed) return fail(400, 'Which action? Pass its id or actionKey');

	let doc: { id: string; crystal: Record<string, unknown> } | null = null;
	const byId = await getThing(viewer, trimmed);
	if (byId.ok !== false && byId.thing && Array.isArray(byId.thing.thingtime) && byId.thing.thingtime.includes('action')) {
		doc = { id: byId.thing.id, crystal: (byId.thing.crystal || {}) as Record<string, unknown> };
	}
	if (!doc) {
		const things = await getThingsCollection();
		const own = await things.findOne({
			ownerId: viewer.id,
			thingtime: 'action',
			'crystal.actionKey': trimmed
		} as any);
		if (own) doc = { id: own.shareId, crystal: (own.crystal || {}) as Record<string, unknown> };
	}
	if (!doc) return fail(404, `No runnable action matches "${trimmed.slice(0, 80)}"`);

	// Re-sanitize so run-time enforces the exact save-time contract (steps
	// grammar, capability coverage, ref validity) even for legacy documents.
	const sanitized = sanitizeActionCrystal(doc.crystal);
	if (isFail(sanitized)) return fail(422, `This action no longer passes the program grammar: ${sanitized.error}`);
	const crystal = sanitized.crystal;
	return {
		id: doc.id,
		name: typeof crystal.name === 'string' ? crystal.name : 'Action',
		crystal,
		steps: (crystal.steps || []) as ActionStep[],
		capabilities: (crystal.capabilities || []) as ActionCapabilityEntry[],
		inputs: (crystal.inputs || []) as Record<string, unknown>[]
	};
};

// ── input validation ────────────────────────────────────────────────────────

const validateRunInputs = (
	descriptors: Record<string, unknown>[],
	provided: unknown
): Fail | { ok: true; inputs: Record<string, unknown> } => {
	if (provided !== undefined && provided !== null && (typeof provided !== 'object' || Array.isArray(provided))) {
		return fail(400, 'inputs must be an object of input values');
	}
	const raw = (provided || {}) as Record<string, unknown>;
	const inputs: Record<string, unknown> = {};
	for (const descriptor of descriptors) {
		const name = String(descriptor.name);
		const type = String(descriptor.type);
		let value = raw[name];
		if (value === undefined || value === null || value === '') {
			if (descriptor.default !== undefined) value = descriptor.default;
			else if (descriptor.required === true) return fail(400, `Input ${name} is required`);
			else continue;
		}
		if (type === 'number') {
			const num = typeof value === 'number' ? value : Number(value);
			if (!Number.isFinite(num)) return fail(400, `Input ${name} must be a number`);
			if (typeof descriptor.min === 'number' && num < descriptor.min) return fail(400, `Input ${name} min is ${descriptor.min}`);
			if (typeof descriptor.max === 'number' && num > descriptor.max) return fail(400, `Input ${name} max is ${descriptor.max}`);
			inputs[name] = num;
		} else if (type === 'boolean') {
			inputs[name] = value === true || value === 'true';
		} else if (type === 'enum') {
			const values = Array.isArray(descriptor.values) ? descriptor.values.map(String) : [];
			const candidate = String(value);
			if (!values.includes(candidate)) return fail(400, `Input ${name} must be one of ${values.join(', ')}`);
			inputs[name] = candidate;
		} else {
			if (typeof value !== 'string') return fail(400, `Input ${name} must be text`);
			const maxLength = typeof descriptor.maxLength === 'number' ? descriptor.maxLength : 2000;
			if (value.length > maxLength) return fail(400, `Input ${name} caps at ${maxLength} characters`);
			inputs[name] = value;
		}
	}
	const declared = new Set(descriptors.map((descriptor) => String(descriptor.name)));
	const unknown = Object.keys(raw).find((key) => !declared.has(key));
	if (unknown) return fail(400, `Unknown input "${unknown.slice(0, 40)}"`);
	return { ok: true, inputs };
};

// ── reference resolution ────────────────────────────────────────────────────

type StepScope = {
	inputs: Record<string, unknown>;
	// index n-1 = the (JSON-safe) result of step n
	steps: unknown[];
};

const resolvePath = (root: unknown, path: string[]): unknown => {
	let current = root;
	for (const segment of path) {
		if (current === null || typeof current !== 'object') return undefined;
		if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
		current = (current as Record<string, unknown>)[segment];
	}
	return current;
};

const resolveValue = (value: unknown, scope: StepScope): unknown => {
	if (typeof value === 'string') {
		if (value.startsWith('$$')) return value.slice(1);
		const ref = parseActionRef(value);
		if (isFail(ref)) return runError(ref.error);
		if (!ref) return value;
		if (ref.kind === 'now') return new Date().toISOString();
		if (ref.kind === 'input') return scope.inputs[ref.name];
		const stepResult = scope.steps[ref.step - 1];
		if (stepResult === undefined) return runError(`$step.${ref.step} has no result yet`);
		return ref.path.length ? resolvePath(stepResult, ref.path) : stepResult;
	}
	if (Array.isArray(value)) return value.map((entry) => resolveValue(entry, scope));
	if (value && typeof value === 'object') {
		const record = value as Record<string, unknown>;
		const keys = Object.keys(record);
		if (keys.length === 1 && keys[0] === 'ttConcat' && Array.isArray(record.ttConcat)) {
			return record.ttConcat
				.map((part) => {
					const resolved = resolveValue(part, scope);
					return resolved === undefined || resolved === null ? '' : String(resolved);
				})
				.join('');
		}
		const resolved: Record<string, unknown> = {};
		for (const key of keys) {
			const entry = resolveValue(record[key], scope);
			if (entry !== undefined) resolved[key] = entry;
		}
		return resolved;
	}
	return value;
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
	return runError(`Schema "${ref.slice(0, 80)}" was not found (pass a schema thing id or one of your schema names)`) as never;
};

// Run-time defense-in-depth on top of the save-time coverage check: when a
// capability carries a schema scope, the CONCRETE thing an op touched must
// match it (save time can only check literal step.schema strings).
const schemaScopeAllows = (entry: ActionCapabilityEntry | null, candidates: (string | null | undefined)[]): boolean => {
	if (!entry || !entry.schemas || !entry.schemas.length) return true;
	return candidates.some((candidate) => typeof candidate === 'string' && entry.schemas!.includes(candidate));
};

const schemaIdentityOf = (crystal: unknown): (string | null)[] => {
	if (!crystal || typeof crystal !== 'object') return [null];
	const record = crystal as Record<string, unknown>;
	return [
		typeof record.schema === 'string' ? record.schema : null,
		typeof record.schemaId === 'string' ? record.schemaId : null
	];
};

// ── the engine ──────────────────────────────────────────────────────────────

const consumeOp = (budget: ActionBudget): void => {
	if (Date.now() > budget.deadline) runError('Time budget exhausted');
	if (budget.opsRemaining <= 0) runError('Operation budget exhausted');
	budget.opsRemaining -= 1;
	budget.opsUsed += 1;
};

const pushTrace = (budget: ActionBudget, entry: ActionRunTraceEntry): void => {
	if (budget.trace.length < MAX_ACTION_TRACE_ENTRIES) budget.trace.push(entry);
};

const executeProgram = async (
	viewer: Viewer,
	program: ActionProgram,
	inputs: Record<string, unknown>,
	budget: ActionBudget,
	stepPrefix: string
): Promise<unknown> => {
	if (budget.stack.includes(program.id)) {
		runError(`Recursive invocation refused: ${program.id} is already running (stack: ${budget.stack.join(' → ')})`);
	}
	budget.stack.push(program.id);
	const depth = budget.stack.length - 1;
	if (depth > budget.depthUsed) budget.depthUsed = depth;
	try {
		const scope: StepScope = { inputs, steps: [] };
		let returned: unknown = null;
		for (let index = 0; index < program.steps.length; index += 1) {
			const step = program.steps[index];
			const label = stepPrefix ? `${stepPrefix}.${index + 1}` : String(index + 1);
			const startedAt = Date.now();
			let target: string | undefined;
			let note: string | undefined;

			if (step.op === 'return') {
				returned = resolveValue(step.value, scope);
				scope.steps[index] = returned;
				pushTrace(budget, { step: label, op: step.op, ms: Date.now() - startedAt });
				break;
			}

			consumeOp(budget);

			if (step.op === 'things.create') {
				const schema = await resolveSchemaRef(viewer, String(step.schema));
				const values = resolveValue(step.values, scope);
				if (!values || typeof values !== 'object' || Array.isArray(values)) runError(`Step ${label} values resolved to non-object data`);
				const created = await createThing(
					viewer!.id,
					{
						thingtime: ['data'],
						// scope/provenance stamps spread LAST so no resolved value
						// can clobber them (SchemaThingForm posture)
						crystal: { ...(values as Record<string, unknown>), schema: schema.name, schemaId: schema.id }
					},
					viewer
				);
				if (isFail(created)) runError(`Step ${label} create failed: ${created.error}`);
				const doc = (created as { ok: true; doc: { shareId: string; crystal?: unknown; createdAt?: Date } }).doc;
				target = doc.shareId;
				scope.steps[index] = { id: doc.shareId, crystal: doc.crystal || values, schema: schema.name, schemaId: schema.id };
			} else if (step.op === 'things.get') {
				const id = resolveValue(step.id, scope);
				if (typeof id !== 'string' || !id.trim()) runError(`Step ${label} id resolved to a non-string`);
				const got = await getThing(viewer, String(id));
				if (got.ok === false) runError(`Step ${label} get failed: ${got.error}`);
				const thing = (got as { ok: true; thing: { id: string; thingtime: string[]; crystal: unknown } }).thing;
				const readScope = capabilityOf(program, 'things.read');
				if (!schemaScopeAllows(readScope, schemaIdentityOf(thing.crystal))) {
					runError(`Step ${label} read "${thing.id}" outside the declared things.read schema scope`);
				}
				target = thing.id;
				scope.steps[index] = { id: thing.id, thingtime: thing.thingtime, crystal: thing.crystal };
			} else if (step.op === 'things.search') {
				// v1 search = YOUR OWN data things of one schema, newest first.
				// Own-docs-only keeps ACL trivially correct without dragging the
				// full search pipeline into the executor.
				const limit = typeof step.limit === 'number' ? step.limit : Math.min(20, MAX_ACTION_SEARCH_LIMIT);
				const clauses: Record<string, unknown>[] = [];
				if (typeof step.schema === 'string') {
					const schema = await resolveSchemaRef(viewer, step.schema);
					clauses.push({ $or: [{ 'crystal.schemaId': schema.id }, { 'crystal.schema': schema.name }] });
				}
				// A scoped things.read capability constrains the QUERY too — a bare
				// search step must not read outside the declared scope while the
				// inspector shows the narrow one (things.get closes this same gap
				// via schemaScopeAllows below; search needs both halves).
				const readScope = capabilityOf(program, 'things.read');
				if (readScope?.schemas?.length) {
					clauses.push({
						$or: readScope.schemas.flatMap((ref) => [{ 'crystal.schemaId': ref }, { 'crystal.schema': ref }])
					});
				}
				const filter: Record<string, unknown> = { ownerId: viewer!.id, thingtime: 'data', ...(clauses.length ? { $and: clauses } : {}) };
				const things = await getThingsCollection();
				const docs = (
					await things
						.find(filter as any)
						.sort({ createdAt: -1, shareId: 1 })
						.limit(limit)
						.toArray()
				).filter((doc: any) => schemaScopeAllows(readScope, schemaIdentityOf(doc.crystal)));
				note = `${docs.length} match${docs.length === 1 ? '' : 'es'}`;
				scope.steps[index] = docs.map((doc: any) => ({ id: doc.shareId, crystal: doc.crystal || {}, createdAt: doc.createdAt }));
			} else if (step.op === 'things.update') {
				const id = resolveValue(step.id, scope);
				if (typeof id !== 'string' || !id.trim()) runError(`Step ${label} id resolved to a non-string`);
				const current = await getThing(viewer, String(id));
				if (current.ok === false) runError(`Step ${label} update target unreadable: ${current.error}`);
				const currentThing = (current as { ok: true; thing: { id: string; crystal: unknown } }).thing;
				const updateScope = capabilityOf(program, 'things.update');
				if (!schemaScopeAllows(updateScope, schemaIdentityOf(currentThing.crystal))) {
					runError(`Step ${label} updates "${currentThing.id}" outside the declared things.update schema scope`);
				}
				const values = resolveValue(step.values, scope);
				if (!values || typeof values !== 'object' || Array.isArray(values)) runError(`Step ${label} values resolved to non-object data`);
				// Re-stamp provenance from the CURRENT doc: updateThing merges the
				// crystal, so a resolved value named schema/schemaId would relabel
				// the thing into a different schema and out of the scope check on
				// every later step and run (things.create guards this by spreading
				// its stamps last — this is the update-path equivalent).
				const patch = values as Record<string, unknown>;
				const currentCrystal = (currentThing.crystal || {}) as Record<string, unknown>;
				if (typeof currentCrystal.schema === 'string') patch.schema = currentCrystal.schema;
				else delete patch.schema;
				if (typeof currentCrystal.schemaId === 'string') patch.schemaId = currentCrystal.schemaId;
				else delete patch.schemaId;
				const updated = await updateThing(viewer, String(id), { crystal: patch });
				if (isFail(updated)) runError(`Step ${label} update failed: ${updated.error}`);
				const thing = (updated as { ok: true; thing: { id: string; crystal: unknown } }).thing;
				target = thing.id;
				scope.steps[index] = { id: thing.id, crystal: thing.crystal };
			} else if (step.op === 'actions.invoke') {
				if (budget.stack.length > budget.maxDepth) runError(`Depth budget exhausted (max ${budget.maxDepth})`);
				if (budget.childActionsRemaining <= 0) runError('Child-action budget exhausted');
				budget.childActionsRemaining -= 1;
				budget.childActionsUsed += 1;
				const child = await resolveActionProgram(viewer, String(step.action));
				if (isFail(child)) runError(`Step ${label} invoke failed: ${child.error}`);
				const childProgram = child as ActionProgram;
				const rawInputs = step.inputs === undefined ? {} : resolveValue(step.inputs, scope);
				const childInputs = validateRunInputs(childProgram.inputs, rawInputs);
				if (isFail(childInputs)) runError(`Step ${label} invoke inputs invalid: ${childInputs.error}`);
				target = childProgram.id;
				scope.steps[index] = await executeProgram(
					viewer,
					childProgram,
					(childInputs as { ok: true; inputs: Record<string, unknown> }).inputs,
					budget,
					label
				);
			}

			pushTrace(budget, { step: label, op: step.op, ms: Date.now() - startedAt, ...(target ? { target } : {}), ...(note ? { note } : {}) });
			if (jsonBytes(scope.steps[index]) > budget.maxResultBytes) {
				runError(`Step ${label} result exceeds the ${budget.maxResultBytes}-byte cap`);
			}
		}
		return returned;
	} finally {
		budget.stack.pop();
	}
};

// ── run records ─────────────────────────────────────────────────────────────

const capBytes = (value: unknown, maxBytes: number): unknown => {
	if (value === undefined) return null;
	return jsonBytes(value) <= maxBytes ? value ?? null : { truncated: true, bytes: jsonBytes(value) };
};

const writeRunRecord = async (
	viewer: Viewer,
	actionId: string,
	crystal: Record<string, unknown>
): Promise<string> => {
	const runId = `${ACTION_RESERVED_ID_PREFIX}run-${randomUUID()}`;
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
	return runId;
};

// ── entry point ─────────────────────────────────────────────────────────────

export const runAction = async (
	viewer: Viewer,
	request: { action?: unknown; inputs?: unknown }
): Promise<RunActionResult> => {
	if (!viewer) return fail(401, 'Running actions requires signing in');
	const program = await resolveActionProgram(viewer, typeof request.action === 'string' ? request.action : '');
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

	const startedAt = new Date();
	const budget: ActionBudget = {
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
		stack: []
	};

	let status: 'ok' | 'error' = 'ok';
	let result: unknown = null;
	let errorMessage: string | undefined;
	try {
		result = await executeProgram(viewer, program, validated.inputs, budget, '');
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
	const durationMs = Date.now() - startedAt.getTime();

	const runId = await writeRunRecord(viewer, program.id, {
		status,
		startedAt: startedAt.toISOString(),
		durationMs,
		opsUsed: budget.opsUsed,
		depthUsed: budget.depthUsed,
		childActionsUsed: budget.childActionsUsed,
		...(errorMessage ? { error: errorMessage } : {}),
		inputs: capBytes(validated.inputs, budget.maxInputBytes),
		result: capBytes(result, budget.maxResultBytes),
		trace: budget.trace
	});

	return {
		ok: true,
		runId,
		status,
		actionId: program.id,
		result,
		...(errorMessage ? { error: errorMessage } : {}),
		durationMs,
		opsUsed: budget.opsUsed,
		depthUsed: budget.depthUsed,
		childActionsUsed: budget.childActionsUsed,
		trace: budget.trace
	};
};

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
	const limit = Math.max(1, Math.min(Number(query.limit) || 20, 50));
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
