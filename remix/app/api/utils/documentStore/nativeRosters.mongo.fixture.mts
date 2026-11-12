import assert from 'node:assert/strict';
import { mock } from 'node:test';
import Module from 'node:module';

const original = Module._load;
Module._load = function (name, ...args) {
 if (name === 'node:sqlite' || String(name).includes('nativeRosters')) throw new Error('Unexpected native roster import');
 return Reflect.apply(original, this, [name, ...args]);
};
const calls: unknown[] = [];
const saved = { rosterId: 'synthetic-roster', type: 'tt.roster', entries: [], version: 'old', createdAt: new Date(0), updatedAt: new Date(0), expiresAt: null };
const collection = {
 async findOne(filter: unknown) { calls.push(['findOne', filter]); return saved; },
 async insertOne(doc: unknown) { calls.push(['insertOne', doc]); },
 async updateOne(filter: unknown, update: unknown) { calls.push(['updateOne', filter, update]); return { matchedCount: 1 }; },
 async deleteOne(filter: unknown) { calls.push(['deleteOne', filter]); return { deletedCount: 0 }; }
};
mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, { namedExports: { getRostersCollection: async () => collection } });
const { currentRosterRepository } = await import('../auth/rosterRepository.ts');
const repository = currentRosterRepository();
assert.equal(repository.kind, 'mongo-home');
assert.deepEqual(await repository.findById(saved.rosterId), saved);
await repository.insert(saved);
const update = { entries: [], updatedAt: new Date(1), expiresAt: new Date(2), version: 'new' };
assert.equal(await repository.replace(saved.rosterId, update, 'old'), true);
assert.deepEqual(await repository.remove(saved.rosterId, 'stale'), { deleted: false, exists: true });
assert.deepEqual(calls, [
 ['findOne', { rosterId: saved.rosterId }], ['insertOne', saved],
 ['updateOne', { rosterId: saved.rosterId, version: 'old' }, { $set: update }],
 ['deleteOne', { rosterId: saved.rosterId, version: 'stale' }], ['findOne', { rosterId: saved.rosterId }]
]);
console.log('hosted-roster-contract-ok');
