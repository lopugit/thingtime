import assert from 'node:assert/strict';
import test from 'node:test';
import { restoreDefinitionDraft, parseDefinitionSource, hasInvalidDefinitionNumbers, remapDefinitionFields } from './definitionDraft';
import { restoreComponentSourceDraft } from '../../../drafts/componentSourceDraft';

test('definition recovery preserves incomplete source, numeric controls, view mode and field structure', () => {
 const snapshot = { source: '{ incomplete', baseUpdatedAt: '2026-10-16T00:00:00Z', mode: 'source', fields: { '["version"]': { number: '1e-' }, '[]': { newKey: 'unfinished key', expanded: false } } };
 assert.deepEqual(restoreDefinitionDraft(JSON.stringify(snapshot)), snapshot);
 assert.equal(hasInvalidDefinitionNumbers(snapshot.fields, { version: 1 }), true);
 assert.equal(hasInvalidDefinitionNumbers(snapshot.fields, { version: 'text now' }), false);
 assert.equal(hasInvalidDefinitionNumbers({ '["version"]': { number: '1e2' } }, { version: 1 }), false);
 assert.equal(restoreDefinitionDraft(JSON.stringify({ source: '{}', baseUpdatedAt: null })).mode, 'source');
 assert.equal(restoreDefinitionDraft(JSON.stringify({ source: '{ legacy unfinished' })).baseUpdatedAt, null, 'legacy recovery cannot borrow the current write version');
});
test('malformed recovery envelopes and unsafe recursive source remain rejected without parsing authored source as a prerequisite', () => {
 for (const fields of [[], { invalid: {} }, { '[]': { surprise: true } }, { '[]': { expanded: 'yes' } }, { '[]': { number: {} } }])
  assert.throws(() => restoreDefinitionDraft(JSON.stringify({ source: '{}', baseUpdatedAt: null, fields })), /kept/);
 assert.throws(() => parseDefinitionSource('{"__proto__":{"bad":true}}'));
 assert.throws(() => parseDefinitionSource('['.repeat(100) + '0' + ']'.repeat(100)));
 assert.equal(restoreDefinitionDraft(JSON.stringify({ source: 'not JSON yet', baseUpdatedAt: null })).source, 'not JSON yet');
});
test('array moves and explicit removal preserve unfinished input on the corresponding field', () => {
 const fields = { '["items","0","number"]': { number: '1e-' }, '["items","1","number"]': { number: '-' }, '["else"]': { newKey: 'waiting' } };
 const moved = remapDefinitionFields(fields, ['items'], { move: [0,1] });
 assert.equal(moved['["items","1","number"]'].number, '1e-'); assert.equal(moved['["items","0","number"]'].number, '-');
 const removed = remapDefinitionFields(moved, ['items'], { remove: '0' });
 assert.equal(removed['["items","0","number"]'].number, '1e-'); assert.equal(Object.keys(removed).length, 2);
 assert.deepEqual(remapDefinitionFields(removed, ['items'], { reset: true }), { '["else"]': { newKey: 'waiting' } });
});
test('source-control recovery preserves invalid authored strings and never interprets or executes them', () => {
 const saved = { binding: 'null', draft: { action: 'Not a slug yet', refresh: 'interval', intervalMs: '-', inputs: '{ invalid' } };
 assert.deepEqual(restoreComponentSourceDraft(JSON.stringify(saved)), saved);
 for (const value of [{ ...saved, binding: {} }, { ...saved, draft: { ...saved.draft, refresh: 'eval' } }, { ...saved, draft: { ...saved.draft, inputs: {} } }])
  assert.throws(() => restoreComponentSourceDraft(JSON.stringify(value)), /kept/);
});
