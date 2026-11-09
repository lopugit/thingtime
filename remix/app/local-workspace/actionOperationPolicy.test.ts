import assert from 'node:assert/strict';
import test from 'node:test';
import { executeProgram, type ActionRuntimeHost, type ActionBudget, type ActionProgram } from '../actions/runtime';

const program: ActionProgram = { id: 'program', ownerId: 'owner', name: 'Policy', crystal: {}, inputs: [], capabilities: [{ capability: 'things.create', schemas: ['schema'] }, { capability: 'things.read', schemas: ['schema'] }, { capability: 'things.update', schemas: ['schema'] }], steps: [
 { op: 'things.create', schema: 'schema', values: { text: 'initial' } },
 { op: 'things.get', id: '$step.1.id' },
 { op: 'things.search', schema: 'schema' },
 { op: 'things.update', id: '$step.1.id', values: { text: 'edited' } },
 { op: 'return', value: '$step.4' }
] };
const budget = (policy: ActionBudget['operationPolicy']): ActionBudget => ({ operationPolicy: policy, deadline: Date.now() + 5000, opsRemaining: 20, maxDepth: 5, childActionsRemaining: 5, maxResultBytes: 10000, maxInputBytes: 10000, opsUsed: 0, depthUsed: 0, childActionsUsed: 0, trace: [], stack: [], ownedOnly: true, expressionNodes: { nodes: 100 } });

test('the shared interpreter applies trusted server policy at every storage operation', async () => {
 const calls: string[] = []; let created: any;
 const thing = () => ({ id: 'protected-id', thingtime: ['data'], crystal: { schema: 'schema', schemaId: 'schema', text: 'initial' }, author: { id: 'owner' } });
 const host: ActionRuntimeHost = {
  resolveActionProgram: async () => program, resolveSchemaRef: async () => ({ id: 'schema', name: 'schema' }),
  createThing: async input => { created = input; return { ok: true, doc: { shareId: 'protected-id', crystal: input.crystal } }; },
  getThing: async () => ({ ok: true, thing: thing() }), updateThing: async () => ({ ok: true, thing: thing() }), deleteThing: async () => ({ ok: true }),
  search: async () => [{ shareId: 'protected-id', crystal: thing().crystal }], packs: () => ({}), lookup: async () => null
 };
 const policy: NonNullable<ActionBudget['operationPolicy']> = { step: async op => { calls.push(op); }, create: async () => ({ acl: ['tt:user'], shareId: 'protected-id', crystal: { bound: true } }), access: async (id, op) => { calls.push(`${op}:${id}`); }, search: async () => { calls.push('search-policy'); }, update: async () => { calls.push('update-policy'); } };
 await executeProgram({ id: 'owner' }, program, {}, budget(policy), '', host);
 assert.equal(created.shareId, 'protected-id'); assert.equal(created.crystal.bound, true);
 assert.deepEqual(calls, ['things.create', 'things.get', 'read:protected-id', 'things.search', 'search-policy', 'read:protected-id', 'things.update', 'update:protected-id', 'update-policy', 'return']);
 let reads = 0;
 await assert.rejects(executeProgram({ id: 'owner' }, { ...program, steps: [{ op: 'things.get', id: 'protected-id' }] }, {}, budget({ ...policy, access: async () => { throw Error('Binding revoked'); } }), '', { ...host, getThing: async () => { reads++; return { ok: true, thing: thing() }; } }), /Binding revoked/);
 assert.equal(reads, 0);
});

test('trusted policy blocks child frames, creates, and search-result disclosure', async () => {
 let writes = 0;
 const item = { id: 'private-id', thingtime: ['data'], crystal: { schema: 'schema', schemaId: 'schema' } };
 const child: ActionProgram = { ...program, id: 'child', steps: [{ op: 'things.get', id: 'private-id' }] };
 const host: ActionRuntimeHost = {
  resolveActionProgram: async () => child, resolveSchemaRef: async () => ({ id: 'schema', name: 'schema' }),
  createThing: async () => { writes++; return { ok: true, doc: { shareId: 'created' } }; },
  getThing: async () => ({ ok: true, thing: item }), updateThing: async () => ({ ok: true, thing: item }), deleteThing: async () => ({ ok: true }),
  search: async () => [{ shareId: item.id, crystal: item.crystal }], packs: () => ({}), lookup: async () => null
 };
 const policy: NonNullable<ActionBudget['operationPolicy']> = {
  step: async () => {}, create: async () => { throw Error('Creation refused'); },
  access: async () => { throw Error('Binding revoked'); }, update: async () => {}, search: async () => {}
 };
 await assert.rejects(executeProgram({ id: 'owner' }, { ...program, steps: [program.steps[0]] }, {}, budget(policy), '', host), /Creation refused/);
 assert.equal(writes, 0, 'a refused policy must run before the host writer');
 await assert.rejects(executeProgram({ id: 'owner' }, { ...program, steps: [{ op: 'things.search', schema: 'schema' }, { op: 'return', value: '$step.1' }] }, {}, budget(policy), '', host), /Binding revoked/);
 const parent: ActionProgram = { ...program, capabilities: [{ capability: 'actions.invoke', actions: ['child'] }], steps: [{ op: 'actions.invoke', action: 'child' }] };
 await assert.rejects(executeProgram({ id: 'owner' }, parent, {}, budget(policy), '', host), /Binding revoked/);
});

test('ensure uses only the authorized server adapter and does not run in a restricted or device Action', async () => {
 const action: ActionProgram = {
  ...program,
  steps: [{ op: 'things.ensure', schema: 'schema', key: '$input.key', values: { text: '$input.text' } }, { op: 'return', value: '$step.1' }]
 };
 const calls: string[] = [];
 const unexpected = async (): Promise<never> => { throw Error('unexpected host call'); };
 const host: ActionRuntimeHost = {
  resolveActionProgram: unexpected, getThing: unexpected, createThing: unexpected, updateThing: unexpected, deleteThing: unexpected,
  search: unexpected, lookup: unexpected, packs: () => ({}),
  resolveSchemaRef: async () => { calls.push('schema'); return { id: 'schema', name: 'schema' }; }
 };
 const server: ActionRuntimeHost = { ...host, ensureThing: async ({ actionId, key }, schema, values) => {
  calls.push('ensure');
  assert.deepEqual({ actionId, key, schema, values }, { actionId: 'program', key: 'day', schema: { id: 'schema', name: 'schema' }, values: { text: 'saved' } });
  return { ok: true, doc: { shareId: 'confirmed', crystal: values } };
 } };
 const policy: NonNullable<ActionBudget['operationPolicy']> = { step: async op => { calls.push(op); }, create: unexpected, access: unexpected, update: unexpected, search: unexpected };
 const inputs = { key: ' day ', text: 'saved' };
 await assert.rejects(executeProgram({ id: 'owner' }, action, inputs, budget(policy), '', server), /restricted Action run/);
 assert.deepEqual(calls.splice(0), ['things.ensure'], 'the trusted restriction runs before schema lookup or mutation');
 await assert.rejects(executeProgram({ id: 'owner' }, action, inputs, budget(undefined), '', host), /cannot ensure Things in this workspace/);
 assert.deepEqual(calls, []);
 assert.deepEqual(await executeProgram({ id: 'owner' }, action, inputs, budget(undefined), '', server), { id: 'confirmed', crystal: { text: 'saved' }, schema: 'schema', schemaId: 'schema' });
 assert.deepEqual(calls, ['schema', 'ensure']);
});

test('ordered ensure batches prepare unique keys and recheck authority before each write', async () => {
 const action: ActionProgram = { ...program, steps: [
  { op: 'things.ensure', schema: 'schema', each: '$input.days', key: '$item', values: { day: '$item' }, matchFields: ['day'] },
  { op: 'return', value: '$step.1' }
 ] };
 const written: string[] = [];
 const unexpected = async (): Promise<never> => { throw Error('unexpected host call'); };
 const host: ActionRuntimeHost = {
  resolveActionProgram: unexpected, resolveSchemaRef: async () => ({ id: 'schema', name: 'schema' }),
  getThing: unexpected, createThing: unexpected, updateThing: unexpected, deleteThing: unexpected,
  search: unexpected, lookup: unexpected, packs: () => ({}),
  ensureThing: async ({ key }, _schema, values, _folder, match) => {
   assert.deepEqual(match, { day: key });
   written.push(key);
   return { ok: true, doc: { shareId: key, crystal: values } };
  }
 };
 const invoke = (days: string[], limits = budget(undefined)) => executeProgram({ id: 'owner' }, action, { days }, limits, '', host);
 await assert.rejects(invoke(['second', 'second']), /duplicate ensure keys/);
 assert.deepEqual(written, []);
 await assert.rejects(invoke(['second', 'first'], { ...budget(undefined), assertAuthorized: async () => {
  if (written.length === 1) throw Error('Page revision changed');
 } }), /Page revision changed/);
 assert.deepEqual(written.splice(0), ['second']);
 const results = await invoke(['second', 'first']) as { id: string }[];
 assert.deepEqual(results.map(entry => entry.id), ['second', 'first']);
});
