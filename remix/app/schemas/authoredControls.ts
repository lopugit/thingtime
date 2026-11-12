import { parseSourceInputArgument } from './sourceInputs';

export const COMPONENT_ARGUMENT_BINDING_REQUIREMENTS = {
	'api.things': '1.62.0',
	'api.things-update': '1.27.0',
	'api.webpages-resolve': '1.19.0'
} as const;

export const AUTHORED_CONTROL_REQUIREMENTS = {
	'api.things': '1.50.0',
	'api.things-update': '1.19.0',
	'api.webpages-resolve': '1.12.0',
	'api.actions-run': '1.41.0'
} as const;

export const MAP_POINTS_SOURCE_REQUIREMENTS = {
	'api.things': '1.56.0',
	'api.things-update': '1.22.0',
	'api.webpages-resolve': '1.14.0',
	'api.actions-run': '1.44.0'
} as const;

export const PASSIVE_SOURCE_REQUIREMENTS = {
	'api.things': '1.57.0',
	'api.things-update': '1.23.0',
	'api.webpages-resolve': '1.15.0'
} as const;

export const SOURCE_INPUT_REFERENCE_REQUIREMENTS = {
	'api.things': '1.60.0',
	'api.things-update': '1.25.0',
	'api.webpages-resolve': '1.17.0'
} as const;

function hasAuthoredNode(value: unknown, matches: (node: Record<string, unknown>) => boolean): boolean {
	const pending = [value];
	const seen = new WeakSet<object>();
	while (pending.length) {
		const node = pending.pop();
		if (!node || typeof node !== 'object' || seen.has(node)) continue;
		seen.add(node);
		if (!Array.isArray(node) && matches(node as Record<string, unknown>)) return true;
		for (const child of Object.values(node)) pending.push(child);
	}
	return false;
}

/** Compatibility discovery only. Stored composition still owns access. */
export function usesAuthoredControls(value: unknown): boolean {
	return hasAuthoredNode(value, ({ tag, chakra, props, inputs }) => {
		if (tag === 'tt-rich-text' || tag === 'tt-menu') return true;
		if ((tag === 'tt-mapbox' || chakra === 'Mapbox') && props && typeof props === 'object' &&
			['markerScale', 'markerScaleWithZoom', 'markerScaleReferenceZoom', 'markerGroupPath'].some(key => key in props)) return true;
		return Array.isArray(inputs) && inputs.length > 16;
	});
}

export function usesMapPointsSource(value: unknown): boolean {
	return hasAuthoredNode(value, ({ tag, props }) => tag === 'tt-mapbox' && !!props && typeof props === 'object' &&
		(props as Record<string, unknown>).pointsSource != null);
}

export function usesPassiveSource(value: unknown): boolean {
	return hasAuthoredNode(value, ({ type, source }) => typeof type === 'string' && type !== 'component' &&
		!!source && typeof source === 'object' && (source as Record<string, unknown>).passive === true);
}

export const PAGE_COLLECTION_REQUIREMENTS = {
	'api.things': '1.58.0',
	'api.things-update': '1.24.0',
	'api.webpages-resolve': '1.16.0',
	'api.actions-run': '1.46.0'
} as const;

export function usesPageCollections(value: unknown): boolean {
	return hasAuthoredNode(value, ({ source, props, ttEach, ttIf, condition, op, ownedFolderId }) =>
		(!!source && typeof source === 'object' && 'collection' in source) ||
		(!!props && typeof props === 'object' && ('data-tt-modifier-action-inputs' in props || 'data-tt-action-batch' in props || 'itemsKeyArg' in props)) ||
		(!!ttEach && typeof ttEach === 'object' && 'keyArg' in ttEach) ||
		([ttIf, condition].some(value => !!value && typeof value === 'object' && 'valueArg' in value)) ||
		(op === 'things.get' && ownedFolderId !== undefined));
}

export function usesSourceInputReferences(value: unknown): boolean {
	return hasAuthoredNode(value, ({ source }) => {
		if (!source || typeof source !== 'object' || !('action' in source) || typeof source.action !== 'string' || !('inputs' in source)) return false;
		const { inputs } = source;
		return !!inputs && typeof inputs === 'object' && !Array.isArray(inputs) &&
			Object.values(inputs).some(parseSourceInputArgument);
	});
}

export function usesComponentArgumentBindings(value: unknown): boolean {
	return hasAuthoredNode(value, ({ type, argBindings }) => typeof type === 'string' && !!argBindings &&
		typeof argBindings === 'object' && !Array.isArray(argBindings) && Object.keys(argBindings).length > 0);
}
