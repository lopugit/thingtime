import {
	ACTION_LIMIT_CEILINGS,
	ACTION_LIMIT_DEFAULTS,
	deriveActionEffects,
	type ActionCapabilityEntry,
	type ActionEffects
} from '~/schemas/registry';

// Pure inspection helpers shared by the /actions cards and the detail
// inspector — everything here derives from the program itself (steps +
// declared capabilities), never from author-written prose, so the display
// cannot drift from the behaviour.

export type ActionCrystal = {
	name?: string;
	description?: string;
	actionKey?: string;
	category?: string;
	version?: number;
	forkOf?: string;
	inputs?: Record<string, unknown>[];
	steps?: Record<string, unknown>[];
	capabilities?: ActionCapabilityEntry[];
	limits?: Record<string, number>;
};

export type ActionThing = {
	id: string;
	thingtime: string[];
	crystal: ActionCrystal;
	acl?: string[];
	visibility?: string;
	createdAt?: string;
	updatedAt?: string;
};

export const isActionThing = (thing: { thingtime?: unknown } | null | undefined): boolean =>
	!!thing && Array.isArray(thing.thingtime) && thing.thingtime.includes('action');

export const actionEffectsOf = (crystal: ActionCrystal | null | undefined): ActionEffects =>
	deriveActionEffects(crystal?.steps);

// The typed inputs the run form renders. `crystal.inputs` is OMITTED (not [])
// when an action declares none — registry.ts writes the key only when it is
// non-empty, and the builder advertises "the action runs parameterless" — so
// the empty case MUST hand back one shared reference. Callers feed this list
// straight into hook dependencies to derive the form defaults; a fresh []
// per render gives those defaults a new identity every time, and the effect
// that syncs them into state re-fires forever (React's Object.is bail-out
// never matches a fresh object).
const NO_INPUT_DESCRIPTORS: Record<string, unknown>[] = [];
export const runInputDescriptorsOf = (crystal: ActionCrystal | null | undefined): Record<string, unknown>[] =>
	Array.isArray(crystal?.inputs) ? crystal.inputs : NO_INPUT_DESCRIPTORS;

// The merged envelope an invocation actually runs under: author overrides
// clamped by the server ceilings, defaults elsewhere.
export const actionLimitsOf = (crystal: ActionCrystal | null | undefined): Record<string, number> => {
	const declared = crystal?.limits || {};
	const merged: Record<string, number> = {};
	for (const key of Object.keys(ACTION_LIMIT_DEFAULTS) as (keyof typeof ACTION_LIMIT_DEFAULTS)[]) {
		const value = typeof declared[key] === 'number' ? declared[key] : ACTION_LIMIT_DEFAULTS[key];
		merged[key] = Math.min(value, ACTION_LIMIT_CEILINGS[key]);
	}
	return merged;
};

// Long opaque ids (UUIDs, seeded shareIds) read badly in chips — shorten
// them unless a resolved display name is available.
const LONG_REF_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const displayRef = (ref: string, names?: Record<string, string>): string => {
	if (names?.[ref]) return names[ref];
	return LONG_REF_PATTERN.test(ref) ? `${ref.slice(0, 8)}…` : ref;
};

export const describeActionStep = (step: Record<string, unknown>, names?: Record<string, string>): string => {
	const op = String(step.op || '');
	const schema = typeof step.schema === 'string' ? displayRef(step.schema, names) : 'data';
	if (op === 'things.create') return `Create a ${schema} thing`;
	if (op === 'things.get') return `Read ${String(step.id || 'a thing')}`;
	if (op === 'things.search') return `Search your ${schema} things${step.limit ? ` (max ${step.limit})` : ''}`;
	if (op === 'things.update') return `Update ${String(step.id || 'a thing')}`;
	if (op === 'actions.invoke') return `Invoke ⚡ ${String(step.action || '')}`;
	if (op === 'return') return 'Return the result';
	return op;
};

// Derive the MINIMAL-AND-SUFFICIENT capability set a step list needs — the
// builder prefixes authoring with this so a UI-authored action's declaration
// is true by construction (the save-time coverage check in registry.ts stays
// the real gate). Literal step schemas seed the scopes, but a single
// schema-less step (a dynamic-id get, a bare search) makes the WHOLE
// capability unscoped: the run-time scope check applies to every step, so a
// sibling-seeded narrower scope would save fine and then refuse mid-run —
// while contradicting the '*' broad-read effect deriveActionEffects already
// reports for that same step. The wider declaration is the honest one.
export const deriveRequiredCapabilities = (steps: Record<string, unknown>[]): ActionCapabilityEntry[] => {
	const scopes = new Map<string, Set<string>>();
	const unscoped = new Set<string>();
	const invoked = new Set<string>();
	let invokeUnscoped = false;
	const need = (capability: string, schema?: string | null) => {
		if (!scopes.has(capability)) scopes.set(capability, new Set());
		if (schema) scopes.get(capability)!.add(schema);
		else unscoped.add(capability);
	};
	for (const step of steps) {
		if (!step || typeof step !== 'object') continue;
		const schema = typeof step.schema === 'string' ? step.schema : null;
		if (step.op === 'things.create') need('things.create', schema);
		if (step.op === 'things.get' || step.op === 'things.search') need('things.read', schema);
		if (step.op === 'things.update') need('things.update');
		if (step.op === 'actions.invoke') {
			need('actions.invoke');
			if (typeof step.action === 'string' && step.action) invoked.add(step.action);
			else invokeUnscoped = true;
		}
	}
	return [...scopes.entries()].map(([capability, schemaSet]) => ({
		capability,
		...(schemaSet.size && !unscoped.has(capability) ? { schemas: [...schemaSet] } : {}),
		...(capability === 'actions.invoke' && invoked.size && !invokeUnscoped ? { actions: [...invoked] } : {})
	}));
};

// Builder form values are strings; interpret them the way an author expects:
// refs and $$-escapes stay verbatim, "true"/"false" become booleans, and only
// CANONICAL decimal text becomes a number. The canonical test matters: naive
// Number() coercion turns "0412345678" into 412345678 and "1e3" into 1000 —
// lossy for zero-padded text, and a string schema field then rejects the
// number outright, making such values unauthorable in the builder.
const CANONICAL_DECIMAL = /^-?(0|[1-9]\d*)(\.\d+)?$/;
export const coerceValueText = (raw: string): unknown => {
	const text = raw.trim();
	if (text.startsWith('$')) return text; // refs and $$-escapes stay verbatim
	if (text === 'true') return true;
	if (text === 'false') return false;
	if (CANONICAL_DECIMAL.test(text)) return Number(text);
	return raw;
};

// Type-aware default coercion for input descriptors: the grammar refuses
// defaults that don't match the declared type (the executor substitutes them
// verbatim when the input is omitted), so coerce only toward the type the
// author picked — a number input's '42' becomes 42, while a string input's
// '42' (or 'true') stays text. Incongruent leftovers (e.g. 'abc' on a number
// input) pass through as text so the save fails with the grammar's message
// instead of silently mislabeling.
export const coerceInputDefault = (raw: string, type: string): string | number | boolean => {
	const text = raw.trim();
	if (type === 'number') {
		const coerced = coerceValueText(text);
		return typeof coerced === 'number' ? coerced : text;
	}
	if (type === 'boolean') {
		if (text === 'true') return true;
		if (text === 'false') return false;
		return text;
	}
	return text;
};

// Selects the action a route key refers to from a list: an exact id match
// wins; otherwise the LATEST revision among actionKey matches (highest
// crystal.version — mirroring the executor's resolution order) so the
// inspector shows the same program the executor would run when keys
// collide across saved revisions.
export const selectActionByKey = <T extends { id?: string; crystal?: Record<string, unknown> }>(
	list: T[],
	key: string
): T | null => {
	const byId = list.find((entry) => entry?.id === key);
	if (byId) return byId;
	const matches = list.filter((entry) => entry?.crystal?.actionKey === key);
	if (!matches.length) return null;
	return matches.reduce((best, entry) => {
		const bestVersion = typeof best?.crystal?.version === 'number' ? (best.crystal.version as number) : 0;
		const version = typeof entry?.crystal?.version === 'number' ? (entry.crystal.version as number) : 0;
		return version > bestVersion ? entry : best;
	});
};

// Does a component's render template bind this action via ttAction? A static
// scan over the serialized template catches literal bindings (the common
// case); {arg}-driven dynamic keys resolve per-instance and are out of scope
// for the back-reference panel.
export const componentBindsAction = (
	render: unknown,
	action: { id: string; actionKey?: string | null }
): boolean => {
	if (!render || typeof render !== 'object') return false;
	let serialized = '';
	try {
		serialized = JSON.stringify(render);
	} catch {
		return false;
	}
	if (action.actionKey && serialized.includes(`"ttAction":${JSON.stringify(action.actionKey)}`)) return true;
	return serialized.includes(`"ttAction":${JSON.stringify(action.id)}`);
};

// Collect every schema ref an action mentions (steps + capability scopes) so
// pages can resolve them to display names in one pass.
export const collectSchemaRefs = (crystal: ActionCrystal | null | undefined): string[] => {
	const refs = new Set<string>();
	for (const step of crystal?.steps || []) {
		if (step && typeof step.schema === 'string') refs.add(step.schema);
	}
	for (const entry of crystal?.capabilities || []) {
		for (const ref of entry.schemas || []) refs.add(ref);
	}
	return [...refs];
};

export const ACTION_OP_TONES: Record<string, { label: string; tone: 'read' | 'write' | 'invoke' | 'pure' }> = {
	'things.create': { label: 'write', tone: 'write' },
	'things.get': { label: 'read', tone: 'read' },
	'things.search': { label: 'read', tone: 'read' },
	'things.update': { label: 'write', tone: 'write' },
	'actions.invoke': { label: 'invoke', tone: 'invoke' },
	return: { label: 'pure', tone: 'pure' }
};

export const ACTION_LIMIT_LABELS: Record<string, (value: number) => string> = {
	timeoutMs: (value) => `${value / 1000}s timeout`,
	maxOperations: (value) => `${value} operations`,
	maxDepth: (value) => `depth ${value}`,
	maxChildActions: (value) => `${value} child actions`,
	maxResultBytes: (value) => `${Math.round(value / 1024)}KB result`,
	maxInputBytes: (value) => `${Math.round(value / 1024)}KB input`
};

// The complement summary — what this program can NEVER touch. The first
// three are v1 vocabulary invariants; the rest derive from the declared
// capability scopes.
export const actionCannotAccess = (
	capabilities: ActionCapabilityEntry[] | undefined,
	names?: Record<string, string>
): string[] => {
	const list = ['No network', 'No secrets', 'No deletes'];
	const declared = capabilities || [];
	const has = (capability: string) => declared.some((entry) => entry.capability === capability);
	// An action that invokes another action cannot honestly claim the absolute
	// negatives: the child runs on ITS own declaration, so "Cannot create
	// things" would be a claim about code this page never read. Only the three
	// vocabulary-level negatives above hold unconditionally (no op reaches the
	// network, secrets, or a delete). The composed case says so instead, and
	// the Does list links each invoked child so its effects are one click away.
	const composes = has('actions.invoke');
	if (!has('things.read') && !composes) list.push('Cannot read things');
	if (!has('things.create') && !composes) list.push('Cannot create things');
	if (!has('things.update') && !composes) list.push('Cannot update things');
	if (!composes) list.push('Cannot invoke other actions');
	else list.push('Runs other actions — their effects are listed on their own pages');
	for (const entry of declared) {
		if (entry.schemas?.length) list.push(`${entry.capability} only: ${entry.schemas.map((ref) => displayRef(ref, names)).join(', ')}`);
		if (entry.actions?.length) list.push(`invoke only: ${entry.actions.join(', ')}`);
	}
	return list;
};
