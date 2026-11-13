import assert from 'node:assert/strict';
import test from 'node:test';
import { installThingAclWriteFence, isThingAclWriteFenceReady, THING_ACL_WRITE_FENCE } from './aclWriteFence';

const fixture = (initial: any = { options: {} }) => {
  let current = initial;
  const commands: any[] = [];
  const db = {
    listCollections: () => ({ toArray: async () => current ? [current] : [] }),
    async createCollection(_name: string, options: any) { current = { options }; },
    async command(command: any) {
      commands.push(command);
      current = { options: { validator: command.validator, validationLevel: command.validationLevel, validationAction: command.validationAction } };
    }
  };
  return { db, commands, current: () => current };
};

test('storage fence preserves existing validation and is idempotent after readback', async () => {
  const previous = { ownerId: { $type: 'string' } };
  const f = fixture({ options: { validator: previous, validationLevel: 'moderate', validationAction: 'warn' } });
  await installThingAclWriteFence(f.db, 'fixture');
  assert.deepEqual(f.commands[0].validator, { $and: [previous, THING_ACL_WRITE_FENCE] });
  assert.equal(f.commands[0].validationLevel, 'strict');
  assert.equal(f.commands[0].validationAction, 'error');
  await installThingAclWriteFence(f.db, 'fixture');
  assert.equal(f.commands.length, 1);
});

test('new collection is born protected and concurrent creation is verified', async () => {
  const f = fixture(null);
  await installThingAclWriteFence(f.db, 'fixture');
  assert.deepEqual(f.current().options.validator, THING_ACL_WRITE_FENCE);
  assert.equal(f.commands.length, 0);
  const raced = fixture(null);
  const originalCreate = raced.db.createCollection;
  raced.db.createCollection = async () => { await originalCreate('fixture', {}); throw Object.assign(new Error('exists'), { code: 48 }); };
  await installThingAclWriteFence(raced.db, 'fixture');
  assert.equal(raced.commands.length, 1);
});

test('unsupported or unauthorized validation never reports storage readiness', async () => {
  const f = fixture();
  f.db.command = async () => { throw Object.assign(new Error('denied'), { code: 13 }); };
  await assert.rejects(installThingAclWriteFence(f.db, 'fixture'), /modify\/unauthorized/);
  const ignored = fixture();
  ignored.db.command = async () => {};
  await assert.rejects(installThingAclWriteFence(ignored.db, 'fixture'), /verify\/not-ready/);
});


const previousWriteFence = () => ({ $expr: { $and: [
  ...structuredClone(THING_ACL_WRITE_FENCE.$expr.$and.slice(0, 2)),
  { $cond: [(THING_ACL_WRITE_FENCE.$expr.$and[2] as any).$cond[0], true, { $and: [
    { $eq: [{ $type: '$aclWriteFenceAfter' }, 'date'] }, { $eq: [{ $type: '$updatedAt' }, 'date'] },
    { $gte: ['$updatedAt', '$aclWriteFenceAfter'] }
  ] }] }
] } });

test('known previous own rule upgrades inside nested conjunctions while unrelated constraints survive', async () => {
  const unrelated = { ownerId: { $type: 'string' } }, another = { 'crystal.retained': { $exists: true } };
  const f = fixture({ options: { validator: { $and: [unrelated, { $and: [previousWriteFence(), another] }] }, validationLevel: 'strict', validationAction: 'error' } });
  await installThingAclWriteFence(f.db, 'fixture');
  assert.deepEqual(f.commands[0].validator, { $and: [unrelated, { $and: [THING_ACL_WRITE_FENCE, another] }] });
  assert.equal(await isThingAclWriteFenceReady(f.db, 'fixture'), true);
  await installThingAclWriteFence(f.db, 'fixture');
  assert.equal(f.commands.length, 1);
});

test('old plus new conjunction is not ready and unknown modified validators remain enforced', async () => {
  const both = fixture({ options: { validator: { $and: [THING_ACL_WRITE_FENCE, previousWriteFence()] } } });
  assert.equal(await isThingAclWriteFenceReady(both.db, 'fixture'), false);
  await installThingAclWriteFence(both.db, 'fixture');
  assert.equal(await isThingAclWriteFenceReady(both.db, 'fixture'), true);
  const unknown = { ...previousWriteFence(), ownerId: 'additional-constraint' };
  const f = fixture({ options: { validator: unknown } });
  await installThingAclWriteFence(f.db, 'fixture');
  assert.deepEqual(f.commands[0].validator, { $and: [unknown, THING_ACL_WRITE_FENCE] });
});

test('provisioning failures expose only closed stage/category without retaining driver secrets', async () => {
  for (const [error, category] of [
    [{ code: 13 }, 'unauthorized'], [{ code: 18 }, 'authentication'], [{ code: 50 }, 'timeout'],
    [{ name: 'MongoOperationTimeoutError' }, 'timeout'], [{ name: 'MongoNetworkTimeoutError' }, 'timeout'],
    [{ name: 'MongoServerSelectionError' }, 'connection'], [{ code: 2 }, 'unsupported'], [{ code: 987654 }, 'unknown']
  ] as const) {
    const f = fixture();
    f.db.command = async () => { throw Object.assign(new Error('mongodb://secret-user:secret-pass@private-host/?private=data'), error); };
    await assert.rejects(() => installThingAclWriteFence(f.db, 'fixture'), (failure: any) => {
      assert.equal(failure.stage, 'modify'); assert.equal(failure.category, category);
      assert.doesNotMatch(failure.message + JSON.stringify(failure), /secret|private-host|private=data/);
      assert.equal(failure.cause, undefined); return true;
    });
  }
  const f = fixture();
  f.db.listCollections = () => ({ toArray: async () => { throw Object.assign(new Error('sensitive'), { code: 13 }); } });
  await assert.rejects(() => isThingAclWriteFenceReady(f.db, 'fixture'), (error: any) => error.stage === 'inspect' && error.category === 'unauthorized');
});
