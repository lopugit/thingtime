/** Trusted form controls register their latest-save boundary; authored attributes
 * alone never provide executable behavior. Registrations die with their nodes. */
type SavedFields = Record<string, unknown>;
const fields = new WeakMap<HTMLElement, () => Promise<SavedFields | void>>();

export function registerComponentFormField(element: HTMLElement, flush: () => Promise<SavedFields | void>): () => void {
	fields.set(element, flush);
	return () => { if (fields.get(element) === flush) fields.delete(element); };
}

export async function flushComponentFormFields(root: HTMLElement, current: () => boolean = () => true): Promise<SavedFields> {
	const nodes = [...(root.matches('[data-tt-form-field]') ? [root] : []), ...Array.from(root.querySelectorAll<HTMLElement>('[data-tt-form-field]'))];
	const pending = nodes.map(element => ({ element, flush: fields.get(element) })).filter(entry => !!entry.flush);
	if (!current()) throw new Error('The form changed before it could be saved.');
	const saved = await Promise.all(pending.map(async ({ element, flush }) => {
		const values = await flush!();
		if (!current() || !root.contains(element) || fields.get(element) !== flush) throw new Error('The form changed while it was being saved.');
		return values || {};
	}));
	if (!current()) throw new Error('The form changed while it was being saved.');
	return Object.assign({}, ...saved);
}

/** Freeze ordinary inputs at the original activation; only registered controls
 * may replace their values after their awaited latest-save boundary. */
export async function captureComponentFormFields(root: HTMLElement, gather: (node: HTMLElement) => Record<string, unknown>, current: () => boolean): Promise<Record<string, unknown>> {
	const snapshot = gather(root);
	const saved = await flushComponentFormFields(root, current);
	return { ...snapshot, ...saved };
}
