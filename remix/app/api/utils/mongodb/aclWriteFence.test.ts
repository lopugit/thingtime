import assert from 'node:assert/strict';
import test from 'node:test';
import { installThingAclWriteFence, THING_ACL_WRITE_FENCE } from './aclWriteFence';

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
  await assert.rejects(installThingAclWriteFence(f.db, 'fixture'), /denied/);
  const ignored = fixture();
  ignored.db.command = async () => {};
  await assert.rejects(installThingAclWriteFence(ignored.db, 'fixture'), /not ready/);
});
