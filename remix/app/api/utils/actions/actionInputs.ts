import { copyActionJson } from '../../../schemas/actionJsonInput';
type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

export const validateRunInputs = (
	descriptors: Record<string, unknown>[],
	provided: unknown
): Fail | { ok: true; inputs: Record<string, unknown> } => {
	if (provided !== undefined && provided !== null && (typeof provided !== 'object' || Array.isArray(provided))) {
		return fail(400, 'inputs must be an object of input values');
	}
	const raw = (provided || {}) as Record<string, unknown>;
	const inputs: Record<string, unknown> = Object.create(null);
	for (const descriptor of descriptors) {
		const name = String(descriptor.name);
		const type = String(descriptor.type);
		// Own-property gate, same posture as resolvePath above. Input NAMES are
		// only pattern-checked (COMPONENT_ARG_NAME_PATTERN), so an action may
		// declare one that collides with an Object.prototype member. A bare
		// `raw[name]` then reads through the prototype chain of the caller's JSON
		// object: an omitted `constructor` arrives as the native Object function
		// rather than undefined, so the descriptor's default never applies, the
		// "is required" refusal never fires (the type check rejects it first with
		// a misleading message), and `$input.<name>` hands a native function to a
		// step value. $step paths are already gated both ways (banned segments in
		// parseActionRef + hasOwnProperty in resolvePath); $input is now too.
		let value = Object.prototype.hasOwnProperty.call(raw, name) ? raw[name] : undefined;
		if (type === 'json') {
			try {
				if (value === undefined) {
					if (descriptor.default !== undefined) inputs[name] = copyActionJson(descriptor.default);
					else if (descriptor.required === true) return fail(400, `Input ${name} is required`);
				} else inputs[name] = copyActionJson(value);
			} catch (error) {
				return fail(400, `Input ${name}: ${error instanceof Error ? error.message : 'Invalid JSON'}`);
			}
			continue;
		}
		if (value === '' && descriptor.required === true) return fail(400, `Input ${name} is required`);
		if (value === undefined || value === null || (value === '' && type !== 'string' && type !== 'text')) {
			if (descriptor.default !== undefined) value = descriptor.default;
			else if (descriptor.required === true) return fail(400, `Input ${name} is required`);
			else continue;
		}
		if (type === 'number') {
			const num = typeof value === 'number' ? value : Number(value);
			if (!Number.isFinite(num)) return fail(400, `Input ${name} must be a number`);
			if (typeof descriptor.min === 'number' && num < descriptor.min) return fail(400, `Input ${name} min is ${descriptor.min}`);
			if (typeof descriptor.max === 'number' && num > descriptor.max) return fail(400, `Input ${name} max is ${descriptor.max}`);
			inputs[name] = num;
		} else if (type === 'boolean') {
			inputs[name] = value === true || value === 'true' || value === 'on' || value === 1 || value === '1';
		} else if (type === 'enum') {
			const values = Array.isArray(descriptor.values) ? descriptor.values.map(String) : [];
			const candidate = String(value);
			if (!values.includes(candidate)) return fail(400, `Input ${name} must be one of ${values.join(', ')}`);
			inputs[name] = candidate;
		} else {
			// text inputs accept scalars from form controls (a number input's
			// value arrives as text anyway; a boolean is coerced to its word)
			const text = typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : null;
			if (text === null) return fail(400, `Input ${name} must be text`);
			const maxLength = typeof descriptor.maxLength === 'number' ? descriptor.maxLength : 2000;
			if (text.length > maxLength) return fail(400, `Input ${name} caps at ${maxLength} characters`);
			inputs[name] = text;
		}
	}
	const declared = new Set(descriptors.map((descriptor) => String(descriptor.name)));
	const unknown = Object.keys(raw).find((key) => !declared.has(key));
	if (unknown) return fail(400, `Unknown input "${unknown.slice(0, 40)}"`);
	return { ok: true, inputs: { ...inputs } };
};
