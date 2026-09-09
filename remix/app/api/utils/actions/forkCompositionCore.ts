import type { CompositionReference } from './sharedCompositionCore';

// Rewrite executable references, not arbitrary text containing an id. All
// copied ids are allocated before writing, so cycles and forward references
// can be rewritten without ever pointing the fork at the original program.
export const rewriteComposition = (
	kinds: string[], original: Record<string, any>,
	map: (kind: CompositionReference['kind'], ref: string) => string
): Record<string, any> => {
	const crystal = JSON.parse(JSON.stringify(original));
	const field = (object: any, name: string, kind: CompositionReference['kind']) => {
		if (object && typeof object[name] === 'string') object[name] = map(kind, object[name]);
	};
	const render = (node: any, depth = 0): void => {
		if (!node || typeof node !== 'object' || depth > 64) return;
		if (Array.isArray(node)) { node.forEach((child) => render(child, depth + 1)); return; }
		field(node, 'ttAction', 'action');
		render(node.children, depth + 1);
		render(node.rawChildren, depth + 1);
		render(node.ttMerge, depth + 1);
		for (const part of [node.ttIf?.then, node.ttIf?.else, node.ttRepeat?.node, node.ttEach?.node, node.ttEach?.empty, node.ttMap?.default]) render(part, depth + 1);
		if (node.ttMap?.values && typeof node.ttMap.values === 'object') Object.values(node.ttMap.values).forEach((child) => render(child, depth + 1));
	};
	const blocks = (items: any): void => {
		if (!Array.isArray(items)) return;
		for (const block of items) {
			if (block?.type === 'component') { field(block, 'component', 'component'); field(block.source, 'action', 'action'); }
			if (block?.type === 'container') blocks(block.children);
		}
	};
	if (kinds.includes('webpage')) blocks(crystal.blocks);
	if (kinds.includes('component')) { render(crystal.render); field(crystal.source, 'action', 'action'); }
	if (kinds.includes('action')) {
		for (const step of crystal.steps || []) {
			if (step.op === 'actions.invoke' || step.op === 'each') field(step, 'action', 'action');
			if (['things.get', 'things.update', 'things.delete'].includes(step.op)) field(step, 'id', 'data');
			if (step.op?.startsWith('things.')) field(step, 'schema', 'schema');
		}
		for (const capability of crystal.capabilities || []) {
			if (Array.isArray(capability.actions)) capability.actions = capability.actions.map((ref: string) => map('action', ref));
			if (Array.isArray(capability.schemas)) capability.schemas = capability.schemas.map((ref: string) => map('schema', ref));
		}
	}
	if (kinds.includes('data')) { field(crystal, 'schemaId', 'schema'); field(crystal, 'schema', 'schema'); }
	return crystal;
};
