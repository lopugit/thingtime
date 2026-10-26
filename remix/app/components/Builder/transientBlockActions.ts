/** A device/settings adapter is an explicit authority supplied by its host,
 * never an executable operation resolved from an authored Thing. Its inputs,
 * file handles and results do not enter Action history or source caches. */
export const TRANSIENT_BLOCK_ACTION = '$transient';
export const TRANSIENT_BLOCK_BOUNDARY = 'data-tt-transient-boundary';

/** Generic delegates must check this before capture handlers gather any form.
 * It applies in edit mode too: editing grants no authority to ordinary Actions. */
export const isTransientBlockTarget = (target: Element | null): boolean =>
	!!target?.closest?.(`[${TRANSIENT_BLOCK_BOUNDARY}]`);

export type TransientBlockInvocation = {
	inputs: Readonly<Record<string, string | number | boolean>>;
	value: string | boolean | undefined;
	readField: (name: string) => string | boolean | undefined;
	readFile: (name: string) => File | undefined;
	/** Trusted static validation for this exact control, never authored regex. */
	setValidity?: (message: string) => void;
	signal: AbortSignal;
};
export type TransientBlockActions = Record<string, (invocation: TransientBlockInvocation) => void | Promise<void>>;

export function parseTransientBinding(value: string | null): { operation: string; inputs: TransientBlockInvocation['inputs'] } | null {
	try {
		const parsed = JSON.parse(value || '{}');
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || typeof parsed.operation !== 'string' ||
			!/^[a-z][a-z0-9.-]*$/.test(parsed.operation)) return null;
		const inputs: Record<string, string | number | boolean> = Object.create(null);
		for (const [key, item] of Object.entries(parsed)) {
			if (key === 'operation') continue;
			if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key) || ['constructor', 'prototype'].includes(key) ||
				!['string', 'number', 'boolean'].includes(typeof item) || (typeof item === 'number' && !Number.isFinite(item))) return null;
			inputs[key] = item as string | number | boolean;
		}
		return { operation: parsed.operation, inputs: Object.freeze(inputs) };
	} catch { return null; }
}

/** Lifetime fencing stays outside the authored document. Closing a host makes
 * both queued activations and field readers unusable, including held closures. */
export function createTransientLifetime() {
	const controller = new AbortController();
	return {
		signal: controller.signal,
		close: () => controller.abort(),
		assertActive: () => controller.signal.throwIfAborted()
	};
}

export function transientFieldValue(field: Element | null): string | boolean | undefined {
	if (!field || !['INPUT', 'SELECT', 'TEXTAREA'].includes(field.tagName) || field.matches(':disabled')) return undefined;
	const input = field as HTMLInputElement;
	if (input.type === 'file') return undefined;
	if (input.type === 'checkbox' || input.type === 'radio') return input.checked;
	return input.value;
}

/** Look up a named control without evaluating a caller-supplied CSS selector.
 * Duplicate names are ambiguous and refused instead of reading another form. */
export function transientNamedField(group: Element, name: string): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null {
	const found = Array.from(group.querySelectorAll<HTMLInputElement>('input[name],select[name],textarea[name]'))
		.filter(field => field.name === name && field.closest('fieldset') === (group.tagName === 'FIELDSET' ? group : null));
	return found.length === 1 && !found[0].matches(':disabled') ? found[0] : null;
}
