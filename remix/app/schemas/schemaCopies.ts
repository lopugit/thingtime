import { getThingtimeSchema, projectBuiltinSchemaCrystal, validateThingtimeCrystal, type SchemaThingField } from './registry';

// A copied schema is a snapshot, with explicit provenance. Source changes or
// deletion never rewrite the owner's fields or preview behind their back.
export function builtinSchemaCopySource(key: string) {
	const id = key.replace(/^(builtin:|schema-)/, '');
	const schema = getThingtimeSchema(id);
	if (!schema) return null;
	return { id: `schema-${schema.id}`, crystal: projectBuiltinSchemaCrystal(schema) };
}

export function extendSchemaCopy(
	source: { id: string; crystal: Record<string, unknown> },
	input: { name: string; description?: string; fields?: unknown[]; render?: Record<string, unknown> }
) {
	const base = validateThingtimeCrystal(['schema'], source.crystal);
	if (base.ok === false) return base;
	const additions = validateThingtimeCrystal(['schema'], { name: input.name, fields: input.fields || [], ...(input.render ? { render: input.render } : {}) });
	if (additions.ok === false) return additions;
	const fields = new Map((base.crystal.fields as SchemaThingField[]).map(field => [field.name.toLowerCase(), field]));
	for (const field of additions.crystal.fields as SchemaThingField[]) fields.set(field.name.toLowerCase(), field);
	return validateThingtimeCrystal(['schema'], {
		...base.crystal,
		name: input.name,
		description: input.description ?? base.crystal.description,
		fields: [...fields.values()],
		forkOf: source.id,
		...(input.render ? { render: input.render } : {})
	});
}

// Native records still use their bounded, kind-specific write paths. Copying a
// schema gives ownership of a shape, never authority to create protected rows.
export const GENERIC_NATIVE_SCHEMA_KINDS = new Set(['post', 'data', 'schema', 'component', 'webpage', 'action', 'folder']);
export function schemaThingCreateInput(source: { origin: 'builtin' | 'community'; id: string; name: string }, values: Record<string, unknown>) {
  if (source.origin === 'builtin') {
    if (!GENERIC_NATIVE_SCHEMA_KINDS.has(source.id)) throw new Error('Copy and extend this schema first to create your own Things. System records use their dedicated features.');
    return { thingtime: [source.id], crystal: values, acl: ['tt:user'] };
  }
  return { thingtime: ['data'], crystal: { ...values, schema: source.name, schemaId: source.id }, acl: ['tt:user'] };
}
