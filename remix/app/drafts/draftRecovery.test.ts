import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectDraftRecovery } from './draftRecovery';
import { restoreSchemaBuilderDraft } from '../components/Schemas/schemaBuilderDraft';
const field = { id: 'f', name: '', description: '', type: 'number', required: false, values: '', min: '-unfinished', max: '', unit: '', maxLength: '', minItems: '', maxItems: '', children: [], items: null };
const draft = { id: 'draft', revision: 0, content: { name: 'Draft', context: 'schema-builder:new', surface: 'schema' as const, snapshot: JSON.stringify({ name: 'Incomplete', description: '', fields: [field] }), attachmentIds: [] } };
test('schema recovery preserves incomplete authored fields and refuses corrupt trees without mutating saved data', () => {
 const recovered = inspectDraftRecovery(draft, restoreSchemaBuilderDraft); assert.equal(recovered.seed, draft); assert.equal(recovered.error, '');
 assert.equal(restoreSchemaBuilderDraft(draft.content.snapshot).fields[0].min, '-unfinished');
 for (const fields of [[{ ...field, children: {} }], [field, field], [{ ...field, type: 'unknown' }], [null]]) {
  const bad = { ...draft, content: { ...draft.content, snapshot: JSON.stringify({ name: 'Bad', description: '', fields }) } };
  const original = structuredClone(bad), result = inspectDraftRecovery(bad, restoreSchemaBuilderDraft);
  assert.equal(result.seed, null); assert.match(result.error, /has been kept/); assert.deepEqual(bad, original);
 }
 for (const bad of [{}, { ...draft, content: undefined }, { ...draft, pending: { writeId: 'write', revision: 0, content: { ...draft.content, snapshot: '{}' } } }]) assert.equal(inspectDraftRecovery(bad as any, restoreSchemaBuilderDraft).seed, null);
});
