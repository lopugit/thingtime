import { validateRunInputs } from '../api/utils/actions/actionInputs';
import { sharedOperationAllowed } from '../api/utils/actions/sharedCompositionCore';
import type { SharedComposition } from '../api/utils/actions/sharedComposition';
import {
	ACTION_LIMIT_DEFAULTS,
	MAX_ACTION_EACH_ITEMS,
	MAX_ACTION_RUN_ERROR_CHARS,
	MAX_ACTION_TRACE_ENTRIES,
	ACL_OWNER,
	parseActionRef,
	type ActionCapabilityEntry,
	type ActionStep
} from '../schemas/registry';
import { evaluateExpression, type ExpressionContext, type ExpressionLambdaScope } from '../schemas/actionExpressions';
type Fail = { ok: false; status: number; error: string };
const isFail = (value: any): value is Fail => value?.ok === false;
export type ActionActor = { id: string; username?: string | null };

/** The canonical bounded interpreter. Hosts supply storage and external services;
 * saved programs, capabilities, expressions and nested-run budgets stay shared. */
export type ActionRuntimeHost = {
	resolveActionProgram(
		reference: string,
		options?: { ownedOnly?: boolean; shared?: SharedComposition; parentId?: string }
	): Promise<Fail | ActionProgram>;
	resolveSchemaRef(reference: string): Promise<{ id: string; name: string }>;
	getThing(id: string): Promise<Fail | { ok: true; thing: { id: string; thingtime: string[]; crystal: unknown; author?: { id: string } } }>;
	createThing(input: Record<string, unknown>): Promise<Fail | { ok: true; doc: { shareId: string; crystal?: unknown } }>;
	updateThing(id: string, input: { crystal: Record<string, unknown> }): Promise<Fail | { ok: true; thing: { id: string; crystal: unknown } }>;
	deleteThing(id: string): Promise<Fail | { ok: true }>;
	search(
		step: Record<string, any>,
		readScope: ActionCapabilityEntry | null,
		shared: SharedComposition | undefined,
		programId: string,
		label: string
	): Promise<{ shareId: string; crystal: unknown; createdAt?: unknown; ownerId?: string }[]>;
	packs(): Record<string, (args: unknown[]) => unknown>;
	lookup(step: ActionStep, query: unknown, deadline: number): Promise<unknown>;
};

export type ActionRunTraceEntry = {
	step: string;
	op: string;
	ms: number;
	target?: string;
	note?: string;
};

export type ActionBudget = {
	assertAuthorized?: () => Promise<void>;
	usedLookup?: boolean;
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
	shared?: SharedComposition;
	// expression evaluations left for the whole run (shared like the rest)
	expressionNodes: { nodes: number };
};

export type ActionProgram = {
	id: string;
	ownerId?: string;
	name: string;
	crystal: Record<string, unknown>;
	steps: ActionStep[];
	capabilities: ActionCapabilityEntry[];
	inputs: Record<string, unknown>[];
};

// Thrown inside step execution and converted into an error run record — never
// escapes runAction.
class ActionRunError extends Error {}

export const runError = (message: string): never => {
	throw new ActionRunError(message);
};

export const jsonBytes = (value: unknown): number => {
	try {
		const encoded = JSON.stringify(value);
		return typeof encoded === 'string' ? encoded.length : 0;
	} catch {
		return Number.MAX_SAFE_INTEGER;
	}
};

const capabilityOf = (capabilities: ActionCapabilityEntry[], capability: string): ActionCapabilityEntry | null =>
	capabilities.find((entry) => entry.capability === capability) || null;

type StepScope = {
	inputs: Record<string, unknown>;
	// index n-1 = the (JSON-safe) result of step n
	steps: unknown[];
	viewer: { id: string; username: string | null };
	expressions: ExpressionContext;
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

const resolveValue = (value: unknown, scope: StepScope, lambda?: ExpressionLambdaScope): unknown => {
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
		if (ref.kind === 'viewer') return scope.viewer[ref.field];
		if (ref.kind === 'item') {
			if (!lambda) return runError(`${value.slice(0, 40)} is only bound inside an each step or a list lambda`);
			return ref.path.length ? resolvePath(lambda.item, ref.path) : lambda.item;
		}
		if (ref.kind === 'index') {
			if (!lambda) return runError('$index is only bound inside an each step or a list lambda');
			return lambda.index;
		}
		const stepResult = scope.steps[ref.step - 1];
		if (stepResult === undefined) return runError(`$step.${ref.step} has no result yet`);
		return ref.path.length ? resolvePath(stepResult, ref.path) : stepResult;
	}
	if (Array.isArray(value)) return value.map((entry) => resolveValue(entry, scope, lambda));
	if (value && typeof value === 'object') {
		const record = value as Record<string, unknown>;
		const keys = Object.keys(record);
		if (keys.length === 1 && keys[0] === 'ttConcat' && Array.isArray(record.ttConcat)) {
			return record.ttConcat
				.map((part) => {
					const resolved = resolveValue(part, scope, lambda);
					return resolved === undefined || resolved === null ? '' : String(resolved);
				})
				.join('');
		}
		if (keys.length === 1 && keys[0] === 'ttExpr' && Array.isArray(record.ttExpr)) {
			return evaluateExpression(record.ttExpr, scope.expressions, lambda);
		}
		const resolved: Record<string, unknown> = {};
		for (const key of keys) {
			const entry = resolveValue(record[key], scope, lambda);
			if (entry !== undefined) resolved[key] = entry;
		}
		return resolved;
	}
	return value;
};

const truthy = (value: unknown): boolean => {
	if (value === null || value === undefined) return false;
	if (typeof value === 'string') return value.trim() !== '' && value !== 'false' && value !== '0';
	if (Array.isArray(value)) return value.length > 0;
	if (typeof value === 'object') return Object.keys(value as object).length > 0;
	return !!value;
};

// Actions read and write Data Things only — the same kind boundary that
// things.create (`thingtime: ['data']`) and things.search (`thingtime:
// 'data'`) already enforce. things.get/things.update/things.delete resolve a
// target by dynamic id, and a schema scope only constrains BY schema;
// non-data kinds (action, schema, post, component, folder) carry no schema,
// so a schema check alone can't hold this line. Requiring the resolved target
// to be a data thing keeps every data-op inside one kind and out of the
// program's own definition and other kinds. Data things carry 'data' in
// `thingtime`.
const isDataThing = (thingtime: unknown): boolean => Array.isArray(thingtime) && thingtime.includes('data');

// Run-time defense-in-depth on top of the save-time coverage check: when a
// capability carries a schema scope, the CONCRETE thing an op touched must
// match it (save time can only check literal step.schema strings).
export const schemaScopeAllows = (entry: ActionCapabilityEntry | null, candidates: (string | null | undefined)[]): boolean => {
	if (!entry || !entry.schemas || !entry.schemas.length) return true;
	return candidates.some((candidate) => typeof candidate === 'string' && entry.schemas!.includes(candidate));
};

export const schemaIdentityOf = (crystal: unknown): (string | null)[] => {
	if (!crystal || typeof crystal !== 'object') return [null];
	const record = crystal as Record<string, unknown>;
	return [typeof record.schema === 'string' ? record.schema : null, typeof record.schemaId === 'string' ? record.schemaId : null];
};

const consumeOp = (budget: ActionBudget): void => {
	if (Date.now() > budget.deadline) runError('Time budget exhausted');
	if (budget.opsRemaining <= 0) runError('Operation budget exhausted');
	budget.opsRemaining -= 1;
	budget.opsUsed += 1;
};

const pushTrace = (budget: ActionBudget, entry: ActionRunTraceEntry): void => {
	if (budget.trace.length < MAX_ACTION_TRACE_ENTRIES) budget.trace.push(entry);
};

const stepValueLabel = (value: unknown): string => {
	if (typeof value === 'string') return value.slice(0, 200);
	try {
		return JSON.stringify(value).slice(0, 200);
	} catch {
		return 'a value';
	}
};

export const executeProgram = async (
	viewer: ActionActor | null,
	program: ActionProgram,
	inputs: Record<string, unknown>,
	budget: ActionBudget,
	stepPrefix: string,
	host: ActionRuntimeHost
): Promise<unknown> => {
	// Composition note: an invoked child runs on its OWN declaration, not the
	// intersection with its parent's. That is deliberate — `actions.invoke:
	// [child]` IS the parent's disclosure that the child runs, and the child's
	// own program page carries its effects. No privilege boundary rides on it
	// either way: every op executes as the invoker under the ordinary ACL.
	// What the parent must NOT do is assert absolute negatives it cannot know
	// ("Cannot create things") while invoking a child that does — that half is
	// enforced in actionInspect.actionCannotAccess.
	if (program.crystal.runtime === 'browser') runError('Browser actions must run in the browser, not inside a server program');
	const effective = program.capabilities;
	if (budget.stack.includes(program.id)) {
		runError(`Recursive invocation refused: ${program.id} is already running (stack: ${budget.stack.join(' → ')})`);
	}
	budget.stack.push(program.id);
	const depth = budget.stack.length - 1;
	if (depth > budget.depthUsed) budget.depthUsed = depth;
	try {
		const scope: StepScope = {
			inputs,
			steps: [],
			viewer: { id: viewer!.id, username: viewer!.username ?? null },
			expressions: {
				resolve: (value, lambda) => resolveValue(value, scope, lambda),
				budget: budget.expressionNodes,
				packs: host.packs(),
				onPackCall: () => consumeOp(budget),
				random: Math.random,
				fail: runError
			}
		};
		let returned: unknown = null;

		// The one composition primitive shared by actions.invoke and each.
		const invokeChild = async (
			label: string,
			actionRef: string,
			rawInputs: unknown,
			childProgram?: ActionProgram
		): Promise<{ program: ActionProgram; result: unknown }> => {
			if (budget.stack.length > budget.maxDepth) runError(`Depth budget exhausted (max ${budget.maxDepth})`);
			if (budget.childActionsRemaining <= 0) runError('Child-action budget exhausted');
			budget.childActionsRemaining -= 1;
			budget.childActionsUsed += 1;
			const invokeScope = capabilityOf(effective, 'actions.invoke');
			if (!invokeScope) runError(`Step ${label} invokes without an actions.invoke capability in the inherited envelope`);
			if (invokeScope!.actions?.length && !invokeScope!.actions.includes(actionRef)) {
				runError(`Step ${label} invokes "${actionRef}" outside the declared actions.invoke allowlist`);
			}
			// A child named by the PARENT's program text is a deliberate
			// composition, so it resolves the same way the parent did.
			let child = childProgram;
			if (!child) {
				const resolved = await host.resolveActionProgram(actionRef, { ownedOnly: budget.ownedOnly, shared: budget.shared, parentId: program.id });
				if (isFail(resolved)) runError(`Step ${label} invoke failed: ${resolved.error}`);
				child = resolved as ActionProgram;
			}
			const declaredInputCap = (child.crystal.limits as Record<string, unknown> | undefined)?.maxInputBytes;
			const childInputCap = Math.min(
				budget.maxInputBytes,
				typeof declaredInputCap === 'number' && Number.isFinite(declaredInputCap) ? declaredInputCap : ACTION_LIMIT_DEFAULTS.maxInputBytes
			);
			if (jsonBytes(rawInputs ?? {}) > childInputCap) runError(`Step ${label} invoke inputs exceed the ${childInputCap}-byte cap`);
			const childInputs = validateRunInputs(child.inputs, rawInputs);
			if (isFail(childInputs)) runError(`Step ${label} invoke inputs invalid: ${childInputs.error}`);
			if (childInputs.ok && jsonBytes(childInputs.inputs) > childInputCap)
				runError(`Step ${label} resolved inputs exceed the ${childInputCap}-byte cap`);
			const result = await executeProgram(viewer, child, (childInputs as { ok: true; inputs: Record<string, unknown> }).inputs, budget, label, host);
			return { program: child, result };
		};

		for (let index = 0; index < program.steps.length; index += 1) {
			await budget.assertAuthorized?.();
			const step = program.steps[index];
			const label = stepPrefix ? `${stepPrefix}.${index + 1}` : String(index + 1);
			const startedAt = Date.now();
			let target: string | undefined;
			let note: string | undefined;

			// `when` — branching by omission: a falsy guard skips the step and
			// its result reads null. Guards resolve before the op is charged.
			if (step.when !== undefined && !truthy(resolveValue(step.when, scope))) {
				scope.steps[index] = null;
				pushTrace(budget, { step: label, op: step.op, ms: Date.now() - startedAt, note: 'skipped' });
				continue;
			}
			if (budget.shared && !sharedOperationAllowed(step.op)) {
				runError('This control changes saved data. Fork the app to make your own editable copy.');
			}

			if (step.op === 'return') {
				returned = resolveValue(step.value, scope);
				scope.steps[index] = returned;
				pushTrace(budget, { step: label, op: step.op, ms: Date.now() - startedAt });
				break;
			}

			consumeOp(budget);

			if (step.op === 'lookup') {
				budget.usedLookup = true;
				if (budget.shared || program.ownerId !== viewer?.id) runError('Lookups require an action you own and your own Vault credential');
				if (!capabilityOf(effective, 'lookup')?.providers?.includes(String(step.provider)))
					runError('Lookup provider is outside the declared capability');
				scope.steps[index] = await host.lookup(step, resolveValue(step.query, scope), budget.deadline);
			} else if (step.op === 'compute') {
				scope.steps[index] = resolveValue(step.value, scope) ?? null;
			} else if (step.op === 'fail') {
				const message = resolveValue(step.message, scope);
				runError(typeof message === 'string' && message.trim() ? message.slice(0, MAX_ACTION_RUN_ERROR_CHARS) : `Step ${label} refused the run`);
			} else if (step.op === 'things.create') {
				const schema = await host.resolveSchemaRef(String(step.schema));
				// Save-time coverage proves the program's OWN declaration; this
				// re-check is what binds a child frame to the inherited envelope.
				const createScope = capabilityOf(effective, 'things.create');
				if (!createScope) runError(`Step ${label} creates without a things.create capability in the inherited envelope`);
				if (!schemaScopeAllows(createScope, [schema.name, schema.id])) {
					runError(`Step ${label} creates "${schema.name}" outside the declared things.create schema scope`);
				}
				const values = resolveValue(step.values, scope);
				if (!values || typeof values !== 'object' || Array.isArray(values)) runError(`Step ${label} values resolved to non-object data`);
				const created = await host.createThing({
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
				});
				if (isFail(created)) runError(`Step ${label} create failed: ${created.error}`);
				const doc = (created as { ok: true; doc: { shareId: string; crystal?: unknown; createdAt?: Date } }).doc;
				target = doc.shareId;
				scope.steps[index] = { id: doc.shareId, crystal: doc.crystal || values, schema: schema.name, schemaId: schema.id };
			} else if (step.op === 'things.get') {
				const id = resolveValue(step.id, scope);
				if (typeof id !== 'string' || !id.trim()) runError(`Step ${label} id resolved to a non-string`);
				const included = budget.shared?.data.get(String(id));
				const got = included
					? { ok: true as const, thing: { id: included.shareId, thingtime: included.thingtime, crystal: included.crystal } }
					: await host.getThing(String(id));
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
				const docs = await host.search(
					{
						...step,
						...(step.where
							? {
									where: Object.fromEntries(
										Object.entries(step.where as Record<string, unknown>).map(([key, value]) => [key, resolveValue(value, scope)])
									)
							  }
							: {}),
						...(step.match
							? {
									match: Object.fromEntries(
										Object.entries(step.match as Record<string, unknown>).map(([key, value]) => [key, resolveValue(value, scope)])
									)
							  }
							: {})
					},
					capabilityOf(effective, 'things.read'),
					budget.shared,
					program.id,
					label
				);
				note = `${docs.length} match${docs.length === 1 ? '' : 'es'}${step.scope === 'public' || step.scope === 'system' ? ` (${step.scope})` : ''}`;
				scope.steps[index] = docs.map((doc: any) => ({
					id: doc.shareId,
					crystal: doc.crystal || {},
					createdAt: doc.createdAt,
					ownerId: doc.ownerId
				}));
			} else if (step.op === 'things.update') {
				const id = resolveValue(step.id, scope);
				if (typeof id !== 'string' || !id.trim()) runError(`Step ${label} id resolved to a non-string`);
				const current = await host.getThing(String(id));
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
				//
				// COPY first. `values` is only a fresh object when the program wrote
				// an object literal; a whole-value ref (`values: "$step.2.crystal"`)
				// or an expression that returns a reference (`{ ttExpr: ['get', …] }`)
				// hands back the LIVE object held in scope.steps, and stamping it in
				// place would rewrite an earlier step's recorded result — a later
				// `$step.2.crystal` read, or a returned `$step.2`, would silently
				// carry (or lose) schema/schemaId. Spreading keeps the stamp local
				// to this update, exactly like the things.create path above.
				const patch: Record<string, unknown> = { ...(values as Record<string, unknown>) };
				const currentCrystal = (currentThing.crystal || {}) as Record<string, unknown>;
				if (typeof currentCrystal.schema === 'string') patch.schema = currentCrystal.schema;
				else delete patch.schema;
				if (typeof currentCrystal.schemaId === 'string') patch.schemaId = currentCrystal.schemaId;
				else delete patch.schemaId;
				const updated = await host.updateThing(String(id), { crystal: patch });
				if (isFail(updated)) runError(`Step ${label} update failed: ${updated.error}`);
				const thing = (updated as { ok: true; thing: { id: string; crystal: unknown } }).thing;
				target = thing.id;
				scope.steps[index] = { id: thing.id, crystal: thing.crystal };
			} else if (step.op === 'things.delete') {
				const id = resolveValue(step.id, scope);
				if (typeof id !== 'string' || !id.trim()) runError(`Step ${label} id resolved to a non-string`);
				const current = await host.getThing(String(id));
				if (current.ok === false) runError(`Step ${label} delete target unreadable: ${current.error}`);
				const currentThing = (current as { ok: true; thing: { id: string; thingtime?: string[]; crystal: unknown; author?: { id?: string } } }).thing;
				if (!isDataThing(currentThing.thingtime)) {
					runError(`Step ${label} delete target "${currentThing.id}" is not a data thing — actions read and write Data Things only`);
				}
				// Deletes are OWN data only: the delete util enforces ownership
				// itself, but refusing early keeps the message honest and the
				// scope check meaningful.
				if (currentThing.author?.id && currentThing.author.id !== viewer!.id) {
					runError(`Step ${label} cannot delete "${currentThing.id}" — actions delete only your own data things`);
				}
				const deleteScope = capabilityOf(effective, 'things.delete');
				if (!deleteScope) runError(`Step ${label} deletes without a things.delete capability in the inherited envelope`);
				if (!schemaScopeAllows(deleteScope, schemaIdentityOf(currentThing.crystal))) {
					runError(`Step ${label} deletes "${currentThing.id}" outside the declared things.delete schema scope`);
				}
				const deleted = await host.deleteThing(String(id));
				if (isFail(deleted)) runError(`Step ${label} delete failed: ${deleted.error}`);
				target = currentThing.id;
				scope.steps[index] = { id: currentThing.id, deleted: true };
			} else if (step.op === 'actions.invoke') {
				const rawInputs = step.inputs === undefined ? {} : resolveValue(step.inputs, scope);
				const invoked = await invokeChild(label, String(step.action), rawInputs);
				target = invoked.program.id;
				scope.steps[index] = invoked.result;
			} else if (step.op === 'each') {
				const list = resolveValue(step.list, scope);
				if (!Array.isArray(list)) runError(`Step ${label} list resolved to ${stepValueLabel(list)} — each needs a list`);
				const max = typeof step.max === 'number' ? step.max : MAX_ACTION_EACH_ITEMS;
				const items = (list as unknown[]).slice(0, max);
				// resolve the child ONCE; every element still consumes a child
				// budget slot and runs on the shared envelope
				const resolved = await host.resolveActionProgram(String(step.action), {
					ownedOnly: budget.ownedOnly,
					shared: budget.shared,
					parentId: program.id
				});
				if (isFail(resolved)) runError(`Step ${label} invoke failed: ${resolved.error}`);
				const child = resolved as ActionProgram;
				const results: unknown[] = [];
				for (let position = 0; position < items.length; position += 1) {
					const lambda: ExpressionLambdaScope = { item: items[position], index: position };
					const rawInputs = step.inputs === undefined ? {} : resolveValue(step.inputs, scope, lambda);
					const invoked = await invokeChild(`${label}[${position}]`, String(step.action), rawInputs, child);
					results.push(invoked.result ?? null);
				}
				target = child.id;
				note = `${items.length} item${items.length === 1 ? '' : 's'}${
					(list as unknown[]).length > items.length ? ` (of ${(list as unknown[]).length})` : ''
				}`;
				scope.steps[index] = results;
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
