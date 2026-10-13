import type { SchemaItemSpec, SchemaThingField } from '~/schemas/registry';

// JSON inputs keep their source text in drafts. Parse only for validation and
// publication, so incomplete syntax and whitespace survive account recovery.
function mapValue(spec: SchemaItemSpec, value: unknown, json: (value: unknown) => unknown): unknown {
	if (value === undefined) return value;
	if (spec.type === 'json') return json(value);
	if (spec.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
		return mapFields(spec.children || [], value as Record<string, unknown>, json);
	}
	if (spec.type === 'array' && spec.items && Array.isArray(value)) return value.map(item => mapValue(spec.items!, item, json));
	return value;
}

function mapFields(fields: SchemaThingField[], value: Record<string, unknown>, json: (value: unknown) => unknown): Record<string, unknown> {
	const result = { ...value };
	for (const field of fields) {
		if (Object.prototype.hasOwnProperty.call(value, field.name)) result[field.name] = mapValue(field, value[field.name], json);
	}
	return result;
}

export function restoreSchemaFormDraft(snapshot: string, fields: SchemaThingField[]): Record<string, unknown> {
	const saved = JSON.parse(snapshot);
	const value = saved.value && typeof saved.value === 'object' && !Array.isArray(saved.value) ? saved.value : {};
	return saved.version === 2 ? value : mapFields(fields, value, item => JSON.stringify(item, null, 2));
}

export function schemaFormValue(fields: SchemaThingField[], value: Record<string, unknown>): Record<string, unknown> {
	return mapFields(fields, value, text => {
		if (typeof text !== 'string') return Number.NaN;
		if (!text.trim()) return undefined;
		try { return JSON.parse(text); } catch { return Number.NaN; }
	});
}
