import { defaultsFromArgs, sanitizeArgSpecs, visitStoredTemplateActions } from '../../../components/ComponentsLibrary/componentTemplate';

// Only executable, persisted references form composition edges. Runtime input
// and arbitrary metadata never grant read authority.
export type CompositionReference = { kind: 'component' | 'action' | 'data' | 'schema'; ref: string; optional?: true; args?: Record<string, unknown> };
const literal = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && value.length <= 128 && !/[{}$\s]/.test(value);

export const storedComponentScope = (crystal: Record<string, any>, args?: Record<string, unknown>): Record<string, unknown> => {
	const scope: Record<string, unknown> = { ...defaultsFromArgs(sanitizeArgSpecs(crystal.args)), ...crystal.savedArgs, ...args };
	// Runtime source scope overrides these even when an author saved an arg
	// with the same name. Loop locals are bound only by their actual wrapper.
	for (const key of ['result', 'state', 'error', 'last', 'viewer', 'query', 'installing', 'hasSource', 'item', 'index', 'n', 'count', 'first', '__proto__', 'constructor', 'prototype']) delete scope[key];
	return scope;
};

export const compositionReferences = (kinds: string[], crystal: Record<string, any>, args?: Record<string, unknown>): CompositionReference[] => {
	const refs = new Map<string, CompositionReference>();
	const add = (kind: CompositionReference['kind'], ref: unknown, optional = false) => {
		if (!literal(ref)) return;
		const key = `${kind}:${ref}`;
		if (refs.has(key) && !refs.get(key)?.optional) return;
		refs.set(key, { kind, ref, ...(optional ? { optional: true as const } : {}) });
	};
	const source = (value: any) => add('action', value?.action);
	const render = () => visitStoredTemplateActions(crystal.render, kinds.includes('component') ? storedComponentScope(crystal, args) : {}, (ref) => add('action', ref));
	let visited = 0;
	const blocks = (value: any, depth = 0): void => {
		if (!Array.isArray(value) || depth > 16) return;
		for (const block of value) {
			if (++visited > 1600) return;
			if (!block || typeof block !== 'object') continue;
			if (block.type === 'component') {
				if (literal(block.component)) {
					const blockArgs = block.args && typeof block.args === 'object' && !Array.isArray(block.args) ? block.args : undefined;
					refs.set(`component:${block.component}:${JSON.stringify(blockArgs)}`, { kind: 'component', ref: block.component, ...(blockArgs ? { args: blockArgs } : {}) });
				}
				source(block.source);
			}
			if (block.type === 'container') blocks(block.children, depth + 1);
		}
	};
	if (kinds.includes('webpage')) blocks(crystal.blocks);
	if (kinds.includes('component')) { source(crystal.source); render(); }
	if (kinds.includes('schema')) render();
	if (kinds.includes('action') && Array.isArray(crystal.steps)) {
		for (const step of crystal.steps) {
			if (step?.op === 'actions.invoke' || step?.op === 'each') add('action', step.action);
			if (['things.get', 'things.update', 'things.delete'].includes(step?.op)) add('data', step.id);
			if (typeof step?.op === 'string' && step.op.startsWith('things.')) add('schema', step.schema);
		}
		for (const capability of crystal.capabilities || []) {
			// A read scope can be a descriptive data.schema label without a
			// physical schema Thing. Copy its definition when one exists.
			if (Array.isArray(capability?.schemas)) capability.schemas.forEach((ref: unknown) => add('schema', ref, true));
		}
	}
	if (kinds.includes('data')) add('schema', crystal.schemaId);
	return [...refs.values()];
};

export const sharedOperationAllowed = (op: string): boolean =>
	['return', 'compute', 'fail', 'things.get', 'things.search', 'actions.invoke', 'each'].includes(op);
