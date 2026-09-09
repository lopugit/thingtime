// Only executable, stored references form composition edges. Input values,
// arbitrary metadata and template substitutions never grant read authority.
export type CompositionReference = { kind: 'component' | 'action' | 'data' | 'schema'; ref: string; optional?: true };
const literal = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && value.length <= 128 && !/[{}$\s]/.test(value);

export const compositionReferences = (kinds: string[], crystal: Record<string, any>): CompositionReference[] => {
	const refs = new Map<string, CompositionReference>();
	const add = (kind: CompositionReference['kind'], ref: unknown, optional = false) => {
		if (!literal(ref)) return;
		const key = `${kind}:${ref}`;
		if (refs.has(key) && !refs.get(key)?.optional) return;
		refs.set(key, { kind, ref, ...(optional ? { optional: true as const } : {}) });
	};
	const source = (value: any) => add('action', value?.action);
	const render = (value: any, depth = 0): void => {
		if (!value || typeof value !== 'object' || depth > 64) return;
		if (Array.isArray(value)) { value.forEach((item) => render(item, depth + 1)); return; }
		add('action', value.ttAction);
		// Render children/conditional/repeat templates contain controls; inputs
		// and arbitrary attributes do not. Never scan ttActionInputs for edges.
		render(value.children, depth + 1);
		render(value.rawChildren, depth + 1);
		render(value.ttMerge, depth + 1);
		render(value.ttIf?.then, depth + 1);
		render(value.ttIf?.else, depth + 1);
		render(value.ttRepeat?.node, depth + 1);
		render(value.ttEach?.node, depth + 1);
		render(value.ttEach?.empty, depth + 1);
		render(value.ttMap?.default, depth + 1);
		if (value.ttMap?.values && typeof value.ttMap.values === 'object') {
			Object.values(value.ttMap.values).forEach((node) => render(node, depth + 1));
		}
	};
	const blocks = (value: any): void => {
		if (!Array.isArray(value)) return;
		for (const block of value) {
			if (!block || typeof block !== 'object') continue;
			if (block.type === 'component') { add('component', block.component); source(block.source); }
			if (block.type === 'container') blocks(block.children);
		}
	};
	if (kinds.includes('webpage')) blocks(crystal.blocks);
	if (kinds.includes('component')) { source(crystal.source); render(crystal.render); }
	if (kinds.includes('schema')) render(crystal.render);
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
