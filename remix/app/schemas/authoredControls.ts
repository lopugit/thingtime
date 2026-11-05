export const AUTHORED_CONTROL_REQUIREMENTS = {
	'api.things': '1.50.0',
	'api.things-update': '1.19.0',
	'api.webpages-resolve': '1.12.0',
	'api.actions-run': '1.41.0'
} as const;

/** Compatibility discovery only: this never resolves references or grants
 * access. The server still validates and authorizes the stored composition. */
export function usesAuthoredControls(value: unknown): boolean {
	const pending = [value];
	const seen = new WeakSet<object>();
	while (pending.length) {
		const node = pending.pop();
		if (!node || typeof node !== 'object' || seen.has(node)) continue;
		seen.add(node);
		if (!Array.isArray(node)) {
			const record = node as Record<string, unknown>;
			if (record.tag === 'tt-rich-text' || record.tag === 'tt-menu') return true;
			const props = record.props;
			if ((record.tag === 'tt-mapbox' || record.chakra === 'Mapbox') && props && typeof props === 'object' && ['markerScale', 'markerScaleWithZoom', 'markerScaleReferenceZoom', 'markerGroupPath'].some(key => key in props)) return true;
			if (Array.isArray(record.inputs) && record.inputs.length > 16) return true;
		}
		pending.push(...Object.values(node));
	}
	return false;
}
