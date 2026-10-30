import assert from 'node:assert/strict';
import test from 'node:test';
import { builtinSchemaCopySource, extendSchemaCopy } from './schemaCopies';
import { getThingtimeSchema, validateThingtimeCrystal } from './registry';
import { registryToCardSource, schemaCopyPrefill } from '../components/Schemas/schemaBrowseTypes';
import { interpolateRenderTree } from '../components/Things/thingsCore';

test('public Post copies preserve constraints, nested fields, provenance and editable image/text preview', () => {
	const source = builtinSchemaCopySource('post')!;
	assert.deepEqual(source, builtinSchemaCopySource('schema-post'));
	assert.deepEqual(source, builtinSchemaCopySource('builtin:post'));
	const copy = extendSchemaCopy(source, { name: 'Product', fields: [{ name: 'brand', type: 'string' }] });
	assert.equal(copy.ok, true);
	if (!copy.ok) return;
	assert.equal(copy.crystal.forkOf, 'schema-post');
	const fields = copy.crystal.fields as any[];
	assert.ok(fields.find(field => field.name === 'text').maxLength > 0);
	assert.ok(fields.find(field => field.name === 'images').maxItems > 0);
	assert.ok(fields.find(field => field.name === 'listing').children.find((field: any) => field.name === 'price'));
	assert.equal(fields.at(-1).name, 'brand');
	const preview = JSON.stringify(interpolateRenderTree(copy.crystal.render as any, { title: 'Shower gel', text: 'Citrus scent', images: ['/api/v1/attachments/content?id=saved'] }));
	assert.match(preview, /Shower gel/);
	assert.match(preview, /Citrus scent/);
	assert.match(preview, /content\?id=saved/);
	const ui = schemaCopyPrefill(registryToCardSource(getThingtimeSchema('post')!));
	assert.equal(validateThingtimeCrystal(['schema'], ui).ok, true);
	assert.deepEqual(ui.fields, source.crystal.fields);
	assert.deepEqual(ui.render, source.crystal.render);
});

test('copying a copy preserves a snapshot and overrides fields without duplicate names', () => {
	const original = builtinSchemaCopySource('post')!;
	const before = JSON.stringify(original);
	const product = extendSchemaCopy(original, { name: 'Product', fields: [{ name: 'type', type: 'string' }, { name: 'price', type: 'number', min: 0 }] });
	assert.equal(product.ok, true);
	if (!product.ok) return;
	const next = extendSchemaCopy({ id: 'my-product', crystal: product.crystal }, { name: 'Belonging', fields: [{ name: 'purchased', type: 'date' }] });
	assert.equal(next.ok, true);
	if (!next.ok) return;
	assert.equal(next.crystal.forkOf, 'my-product');
	assert.deepEqual(next.crystal.render, original.crystal.render);
	assert.equal((next.crystal.fields as any[]).filter(field => field.name === 'type').length, 1);
	assert.equal(JSON.stringify(original), before);
	assert.equal(extendSchemaCopy(original, { name: 'Bad', fields: [{ name: '__proto__', type: 'string' }] }).ok, false);
	assert.equal(extendSchemaCopy(original, { name: 'Bad', fields: [{ name: 'body', type: 'text' }] }).ok, false);
});

test('root, collection and crystal schemas all copy through the ordinary schema grammar', async () => {
  const { thingtimeSchemas, validateValueAgainstFields } = await import('./registry');
  for (const schema of thingtimeSchemas) {
    const source = builtinSchemaCopySource(schema.id)!;
    assert.ok(source, schema.id);
    const copied = extendSchemaCopy(source, { name: `${schema.title} copy`, fields: [{ name: 'myField', type: 'string' }] });
    assert.equal(copied.ok, true, schema.id);
    const ui = schemaCopyPrefill(registryToCardSource(schema));
    assert.equal(validateThingtimeCrystal(['schema'], ui).ok, true, schema.id);
  }
  const component = builtinSchemaCopySource('component')!;
  assert.equal((component.crystal.fields as any[]).find(field => field.name === 'render').type, 'json');
  assert.equal(validateValueAgainstFields([{ name: 'value', type: 'json' }], { value: { nested: [1, true, { hello: 'world' }] } }).ok, true);
  for (const value of [NaN, Infinity, { broken: undefined }, JSON.parse('{"__proto__":{"x":1}}')]) {
    assert.equal(validateValueAgainstFields([{ name: 'value', type: 'json' }], { value }).ok, false);
  }
});
