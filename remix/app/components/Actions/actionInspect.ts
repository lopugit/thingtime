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

// Derive the MINIMAL capability set a step list needs — the builder prefixes
// authoring with this so a UI-authored action's declaration is true by
// construction (the save-time coverage check in registry.ts stays the real
// gate). Literal step schemas seed the scopes; get/update steps (id-based)
// leave their capability unscoped until the author narrows it.
export const deriveRequiredCapabilities = (steps: Record<string, unknown>[]): ActionCapabilityEntry[] => {
	const scopes = new Map<string, Set<string>>();
	const invoked = new Set<string>();
	const need = (capability: string, schema?: string | null) => {
		if (!scopes.has(capability)) scopes.set(capability, new Set());
		if (schema) scopes.get(capability)!.add(schema);
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
		}
	}
	return [...scopes.entries()].map(([capability, schemaSet]) => ({
		capability,
		...(schemaSet.size ? { schemas: [...schemaSet] } : {}),
		...(capability === 'actions.invoke' && invoked.size ? { actions: [...invoked] } : {})
	}));
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
	if (!has('things.read')) list.push('Cannot read things');
	if (!has('things.create')) list.push('Cannot create things');
	if (!has('things.update')) list.push('Cannot update things');
	if (!has('actions.invoke')) list.push('Cannot invoke other actions');
	for (const entry of declared) {
		if (entry.schemas?.length) list.push(`${entry.capability} only: ${entry.schemas.map((ref) => displayRef(ref, names)).join(', ')}`);
		if (entry.actions?.length) list.push(`invoke only: ${entry.actions.join(', ')}`);
	}
	return list;
};
