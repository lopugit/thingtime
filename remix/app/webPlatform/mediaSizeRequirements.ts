/** Only clients persisting the optional maximum-size contract need these gates. */
export const MEDIA_SIZE_WRITE_REQUIREMENTS = {
	create: { feature: 'api.things', minimumVersion: '1.42.0' },
	upsert: { feature: 'api.things', minimumVersion: '1.42.0' },
	update: { feature: 'api.things-update', minimumVersion: '1.13.0' }
} as const;

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
function hasMaximum(pipeline: unknown) {
	if (!record(pipeline) || !record(pipeline.output)) return false;
	// Recognize an actual media pipeline, rather than unrelated media/size data.
	if (!['file', 'start', 'cancel', 'status', 'progress'].every((key) => typeof pipeline[key] === 'string')) return false;
	return own(pipeline.output, 'maxOutputSize') || own(pipeline.output, 'maxOutputUnit');
}
/** Persisted Pages/Components may nest intrinsic elements, repeated templates or
 * Web Platform programs. Iterate without a depth cap, tolerating shared/cyclic data. */
export function hasMediaSizeContract(value: unknown): boolean {
	const pending: unknown[] = [value];
	const seen = new WeakSet<object>();
	while (pending.length) {
		const node = pending.pop();
		if (!node || typeof node !== 'object' || seen.has(node)) continue;
		seen.add(node);
		if (record(node)) {
			if (node.tag === 'tt-media-pipeline' && record(node.props) && hasMaximum(node.props.pipeline)) return true;
			if (node.tag === 'tt-web-platform' && record(node.props) && record(node.props.program) && hasMaximum(node.props.program.media)) return true;
			if (node.version === 1 && Array.isArray(node.document) && hasMaximum(node.media)) return true;
		}
		for (const child of Object.values(node)) pending.push(child);
	}
	return false;
}
export async function requireMediaSizeWriteCapability(
	value: unknown,
	operation: keyof typeof MEDIA_SIZE_WRITE_REQUIREMENTS,
	requireCapability: (feature: string, minimumVersion: string) => Promise<void>
) {
	if (!hasMediaSizeContract(value)) return;
	const requirement = MEDIA_SIZE_WRITE_REQUIREMENTS[operation];
	await requireCapability(requirement.feature, requirement.minimumVersion);
}
