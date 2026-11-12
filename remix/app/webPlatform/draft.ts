import { compilePlatformProgram, validatePlatformProgram } from './compiler';
import type { PlatformProgram } from './types';

type Parameter = NonNullable<PlatformProgram['parameters']>[number];
export type PlatformInputEdits = Record<string, { type: Parameter['type']; value: unknown }>;
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

export function platformFieldValue(parameter: Parameter, edits: PlatformInputEdits): unknown {
	if (own(edits, parameter.name) && edits[parameter.name].type === parameter.type) return edits[parameter.name].value;
	return parameter.type === 'json' ? JSON.stringify(parameter.default) : parameter.default;
}

export function reconcilePlatformInputs(program: PlatformProgram, edits: PlatformInputEdits): PlatformInputEdits {
	return Object.fromEntries((program.parameters || []).filter(p => own(edits, p.name) && edits[p.name].type === p.type).map(p => [p.name, edits[p.name]]));
}

/** Run and save consume this same snapshot; falsy values and JSON null survive.
 * Saved defaults contain actual values, not the form's JSON text encoding. */
export function snapshotPlatformDraft(definition: string, edits: PlatformInputEdits = {}) {
	const parsed = validatePlatformProgram(JSON.parse(definition));
	const input = Object.fromEntries((parsed.parameters || []).map(parameter => {
		const raw = platformFieldValue(parameter, edits);
		let value: unknown = raw;
		if (parameter.type === 'json') value = JSON.parse(String(raw));
		if (parameter.type === 'number') {
			if ((typeof raw !== 'string' && typeof raw !== 'number') || String(raw).trim() === '' || !Number.isFinite(Number(raw)))
				throw new Error(`${parameter.label} must be a finite number`);
			value = Number(raw);
		}
		if (parameter.type === 'boolean' && typeof raw !== 'boolean') throw new Error(`${parameter.label} must be true or false`);
		if (parameter.type === 'text' && typeof raw !== 'string') throw new Error(`${parameter.label} must be text`);
		return [parameter.name, value];
	}));
	if (JSON.stringify(input).length > 16384) throw new Error('Inputs exceed 16 KB');
	const program = { ...parsed, ...(parsed.parameters ? { parameters: parsed.parameters.map(p => ({ ...p, default: input[p.name] })) } : {}) };
	compilePlatformProgram(program);
	return { program, input };
}
