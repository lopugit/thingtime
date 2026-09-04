import { randomUUID } from 'node:crypto';

import {
	ACL_OWNER,
	ACTION_LIMIT_CEILINGS,
	ACTION_LIMIT_DEFAULTS,
	MAX_ACTION_RUN_ERROR_CHARS,
	MAX_ACTION_RUN_HISTORY,
	MAX_ACTION_RUNS_RETAINED,
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
	// delegated run (a ttAction click): every action resolved anywhere in this
	// invocation tree must be one the invoker owns
	ownedOnly: boolean;
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

const capabilityOf = (capabilities: ActionCapabilityEntry[], capability: string): ActionCapabilityEntry | null =>
	capabilities.find((entry) => entry.capability === capability) || null;

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
	options?: { ownedOnly?: boolean }
): Promise<Fail | ActionProgram> => {
	if (!viewer) return fail(401, 'Running actions requires signing in');
	const trimmed = typeof reference === 'string' ? reference.trim() : '';
	if (!trimmed) return fail(400, 'Which action? Pass its id or actionKey');

	let doc: { id: string; crystal: Record<string, unknown> } | null = null;
	if (options?.ownedOnly) {
		const things = await getThingsCollection();
		const own = await things.findOne({ shareId: trimmed, ownerId: viewer.id, thingtime: 'action' } as any);
		if (own) doc = { id: own.shareId, crystal: (own.crystal || {}) as Record<string, unknown> };
	} else {
		const byId = await getThing(viewer, trimmed);
		if (byId.ok !== false && byId.thing && Array.isArray(byId.thing.thingtime) && byId.thing.thingtime.includes('action')) {
			doc = { id: byId.thing.id, crystal: (byId.thing.crystal || {}) as Record<string, unknown> };
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
		if (own) doc = { id: own.shareId, crystal: (own.crystal || {}) as Record<string, unknown> };
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
		// Own-property gate, same posture as resolvePath above. Input NAMES are
		// only pattern-checked (COMPONENT_ARG_NAME_PATTERN), so an action may
		// declare one that collides with an Object.prototype member. A bare
		// `raw[name]` then reads through the prototype chain of the caller's JSON
		// object: an omitted `constructor` arrives as the native Object function
		// rather than undefined, so the descriptor's default never applies, the
		// "is required" refusal never fires (the type check rejects it first with
		// a misleading message), and `$input.<name>` hands a native function to a
		// step value. $step paths are already gated both ways (banned segments in
		// parseActionRef + hasOwnProperty in resolvePath); $input is now too.
		let value = Object.prototype.hasOwnProperty.call(raw, name) ? raw[name] : undefined;
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
		// hasOwnProperty-gated like resolvePath: validateRunInputs builds this
		// object literal, so an unsupplied input whose name collides with an
		// Object.prototype member (notably a boolean `__proto__`, whose own-key
		// assignment is a silent no-op) must read as undefined, never as the
		// inherited member.
		if (ref.kind === 'input') {
			return Object.prototype.hasOwnProperty.call(scope.inputs, ref.name) ? scope.inputs[ref.name] : undefined;
		}
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

// Actions read and write Data Things only — the same kind boundary that
// things.create (`thingtime: ['data']`) and things.search (`thingtime:
// 'data'`) already enforce. things.get/things.update resolve a target by
// dynamic id, and a schema scope only constrains BY schema; non-data kinds
// (action, schema, post, component, folder) carry no schema, so a schema
// check alone can't hold this line. Requiring the resolved target to be a
// data thing keeps every data-op inside one kind and out of the program's
// own definition and other kinds. Data things carry 'data' in `thingtime`.
const isDataThing = (thingtime: unknown): boolean => Array.isArray(thingtime) && thingtime.includes('data');

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
	// Composition note: an invoked child runs on its OWN declaration, not the
	// intersection with its parent's. That is deliberate — `actions.invoke:
	// [child]` IS the parent's disclosure that the child runs, and the child's
	// own program page carries its effects. No privilege boundary rides on it
	// either way: every op executes as the invoker under the ordinary ACL.
	// What the parent must NOT do is assert absolute negatives it cannot know
	// ("Cannot create things") while invoking a child that does — that half is
	// enforced in actionInspect.actionCannotAccess.
	const effective = program.capabilities;
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
				// Save-time coverage proves the program's OWN declaration; this
				// re-check is what binds a child frame to the inherited envelope.
				const createScope = capabilityOf(effective, 'things.create');
				if (!createScope) runError(`Step ${label} creates without a things.create capability in the inherited envelope`);
				if (!schemaScopeAllows(createScope, [schema.name, schema.id])) {
					runError(`Step ${label} creates "${schema.name}" outside the declared things.create schema scope`);
				}
				const values = resolveValue(step.values, scope);
				if (!values || typeof values !== 'object' || Array.isArray(values)) runError(`Step ${label} values resolved to non-object data`);
				const created = await createThing(
					viewer!.id,
					{
						thingtime: ['data'],
						// Actions mint PRIVATE. createThing's standalone-content
						// default is the public audience, which is the right default
						// for something a human posts and the WRONG one for something
						// a program mints on their behalf: "capabilities only narrow"
						// means a run must never produce a wider audience than the
						// invoker asked for, and a step that copies a read into a new
						// thing would otherwise republish it to the world. An explicit
						// audience is a v2 grammar question (declared + derived as an
						// effect), never an implicit default.
						acl: [ACL_OWNER],
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
				if (!isDataThing(thing.thingtime)) {
					runError(`Step ${label} read "${thing.id}" is not a data thing — actions read and write Data Things only`);
				}
				const readScope = capabilityOf(effective, 'things.read');
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
				const readScope = capabilityOf(effective, 'things.read');
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
				const currentThing = (current as { ok: true; thing: { id: string; thingtime?: string[]; crystal: unknown } }).thing;
				if (!isDataThing(currentThing.thingtime)) {
					runError(`Step ${label} update target "${currentThing.id}" is not a data thing — actions read and write Data Things only`);
				}
				const updateScope = capabilityOf(effective, 'things.update');
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
				const invokeScope = capabilityOf(effective, 'actions.invoke');
				if (!invokeScope) runError(`Step ${label} invokes without an actions.invoke capability in the inherited envelope`);
				if (invokeScope!.actions?.length && !invokeScope!.actions.includes(String(step.action))) {
					runError(`Step ${label} invokes "${String(step.action)}" outside the declared actions.invoke allowlist`);
				}
				// A child named by the PARENT's program text is a deliberate
				// composition, so it resolves the same way the parent did.
				const child = await resolveActionProgram(viewer, String(step.action), { ownedOnly: budget.ownedOnly });
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

export const runAction = async (
	viewer: Viewer,
	request: { action?: unknown; inputs?: unknown; source?: unknown }
): Promise<RunActionResult> => {
	if (!viewer) return fail(401, 'Running actions requires signing in');
	// 'component' = the delegated path (a click inside rendered markup). The
	// flag only ever NARROWS resolution, so honouring a client-supplied value
	// is safe: the viewer's own client always sends it, and a caller who omits
	// it is acting as themselves on their own behalf.
	const ownedOnly = request.source === 'component';
	const program = await resolveActionProgram(viewer, typeof request.action === 'string' ? request.action : '', { ownedOnly });
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
		stack: [],
		ownedOnly
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
