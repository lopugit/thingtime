import type { MediaPipeline } from './mediaPipeline';

/** IDs must also isolate native label/for resolution, which is document-wide. */
export function scopeMediaControls(root: HTMLElement, pipeline: MediaPipeline, prefix: string) {
	const scoped: MediaPipeline = { ...pipeline };
	const restore: (() => void)[] = [];
	const controls = (['file', 'start', 'cancel', 'status', 'progress', 'preview', 'imagePreview', 'download'] as const).flatMap((key) => {
		const selector = pipeline[key];
		if (!selector) return [];
		const matches = root.querySelectorAll(selector);
		if (matches.length !== 1) throw new Error('A media control must resolve to exactly one surface element');
		return [{ key, element: matches[0] }];
	});
	for (const { key, element } of controls) {
		const before = element.id,
			after = `${prefix}-${key}`;
		element.id = after;
		scoped[key] = '#' + after;
		restore.push(() => {
			if (element.id === after) element.id = before;
		});
		for (const label of root.querySelectorAll('label')) {
			if (label.htmlFor !== before) continue;
			label.htmlFor = after;
			restore.push(() => {
				if (label.htmlFor === after) label.htmlFor = before;
			});
		}
	}
	return { pipeline: scoped, restore: () => restore.reverse().forEach((reset) => reset()) };
}
