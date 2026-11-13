#!/usr/bin/env node
// DDL-only integration acceptance with Mongo authentication enabled. No
// application/business documents are inserted or modified.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { MongoClient } from 'mongodb';
import { installThingAclWriteFence, isThingAclWriteFenceReady, THING_ACL_WRITE_FENCE } from '../app/api/utils/mongodb/aclWriteFence';

const dir = await mkdtemp('/private/tmp/tt-acl-validator-');
const evidence = process.env.AGENT_REPORTING_EVIDENCE_DIR;
assert(evidence, 'An external evidence directory is required');
const listener = createServer(); await new Promise<void>(done => listener.listen(0, '127.0.0.1', done));
const port = (listener.address() as any).port; await new Promise<void>(done => listener.close(() => done()));
const uri = `mongodb://127.0.0.1:${port}/?directConnection=true`;
const child = spawn(process.env.MONGOD_PATH || '/opt/homebrew/bin/mongod', ['--dbpath', dir, '--port', String(port), '--bind_ip', '127.0.0.1', '--nounixsocket', '--auth'], {
  cwd: dir, env: { PATH: process.env.PATH, HOME: dir, TMPDIR: dir }, stdio: 'ignore', detached: true
});
const clients: MongoClient[] = [];
const connect = async (username?: string, password?: string) => {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 700, ...(username ? { auth: { username, password: password! }, authSource: 'admin' } : {}) });
  clients.push(client); await client.connect(); return client;
};
const password = () => randomBytes(32).toString('base64url');
let passed = false;
const checks: string[] = [];
try {
  let bootstrap: MongoClient | undefined;
  const deadline = Date.now() + 20000;
  while (!bootstrap && Date.now() < deadline) {
    assert.equal(child.exitCode, null, 'Authenticated disposable Mongo stays running');
    try { bootstrap = await connect(); } catch { await new Promise(done => setTimeout(done, 200)); }
  }
  assert(bootstrap, 'Authenticated disposable Mongo starts');
  const adminPassword = password();
  await bootstrap.db('admin').command({ createUser: 'acceptanceAdmin', pwd: adminPassword, roles: ['root'] });
  await bootstrap.close();
  const admin = await connect('acceptanceAdmin', adminPassword);
  const db = admin.db('acl_fence_acceptance');
  await installThingAclWriteFence(db, 'new_empty_validator_fixture');
  assert.equal(await isThingAclWriteFenceReady(db, 'new_empty_validator_fixture'), true);
  assert.equal(await db.collection('new_empty_validator_fixture').countDocuments(), 0);
  checks.push('missing collection is created with the canonical strict/error fence and verified through real listCollections readback');
  const name = 'empty_validator_fixture';
  const previous = { $jsonSchema: { bsonType: 'object' } };
  await db.createCollection(name, { validator: previous, validationLevel: 'moderate', validationAction: 'warn' });
  assert.equal(await isThingAclWriteFenceReady(db, name), false);
  await installThingAclWriteFence(db, name);
  assert.equal(await isThingAclWriteFenceReady(db, name), true);
  const options = async () => (await db.listCollections({ name }).toArray())[0]!.options;
  const installed = await options();
  assert.equal(installed.validationLevel, 'strict'); assert.equal(installed.validationAction, 'error');
  assert.deepEqual(installed.validator, { $and: [previous, THING_ACL_WRITE_FENCE] });
  await installThingAclWriteFence(db, name); assert.deepEqual(await options(), installed);
  checks.push('real collMod upgrades moderate/warn to strict/error, preserves existing validator conjunction and repeated install is idempotent');
  await db.command({ collMod: name, validationLevel: 'moderate', validationAction: 'warn' });
  assert.equal(await isThingAclWriteFenceReady(db, name), false);
  await installThingAclWriteFence(db, name); assert.equal(await isThingAclWriteFenceReady(db, name), true);
  assert.deepEqual(await options(), installed);
  checks.push('weakened strict/error options are detected and repaired without dropping existing constraints');
  const oldRule = { $expr: { $and: [
    ...structuredClone(THING_ACL_WRITE_FENCE.$expr.$and.slice(0, 2)),
    { $cond: [(THING_ACL_WRITE_FENCE.$expr.$and[2] as any).$cond[0], true, { $and: [
      { $eq: [{ $type: '$aclWriteFenceAfter' }, 'date'] }, { $eq: [{ $type: '$updatedAt' }, 'date'] },
      { $gte: ['$updatedAt', '$aclWriteFenceAfter'] }
    ] }] }
  ] } };
  const unrelated = { ownerId: { $type: 'string' } }, another = { 'crystal.retained': { $exists: true } };
  const oldName = 'empty_previous_guard_fixture';
  await db.createCollection(oldName, { validator: { $and: [unrelated, { $and: [oldRule, another] }] }, validationLevel: 'strict', validationAction: 'error' });
  assert.equal(await isThingAclWriteFenceReady(db, oldName), false);
  await installThingAclWriteFence(db, oldName);
  const upgradedOptions = (await db.listCollections({ name: oldName }).toArray())[0]!.options;
  assert.deepEqual(upgradedOptions.validator, { $and: [unrelated, { $and: [THING_ACL_WRITE_FENCE, another] }] });
  assert.equal(await isThingAclWriteFenceReady(db, oldName), true);
  assert.equal(await db.collection(oldName).countDocuments(), 0);
  checks.push('real nested conjunction containing the exact previous strict-floor rule upgrades to the compatibility guard while both unrelated constraints survive');
  const date = new Date('2026-01-01T00:00:00Z');
  const audience = { aclGeneration: 'synthetic-audience', aclBaselineVersion: 1, aclBaseline: ['tt:all'], acl: ['tt:user', '-tt:all'], updatedAt: date };
  const token = { tokenAclGeneration: 'synthetic-token', tokenAcl: [], acl: ['tt:user'], updatedAt: date };
  const documents = [audience, token].flatMap((doc, family) => [
    { ...doc, label: `${family}-missing`, expected: true },
    { ...doc, aclWriteFenceAfter: date, label: `${family}-date`, expected: true },
    { ...doc, aclWriteFenceAfter: null, label: `${family}-null`, expected: false },
    { ...doc, aclWriteFenceAfter: 'invalid', label: `${family}-invalid`, expected: false },
    { ...doc, aclWriteFenceAfter: new Date(date.getTime() + 1), label: `${family}-regressed`, expected: false }
  ]);
  const evaluated = await db.aggregate([{ $documents: documents }, { $project: { _id: 0, label: 1, expected: 1, accepted: THING_ACL_WRITE_FENCE.$expr } }]).toArray();
  assert.equal(evaluated.length, documents.length);
  for (const value of evaluated) assert.equal(value.accepted, value.expected, `Actual Mongo expression ${value.label}`);
  checks.push('actual Mongo nonpersisted $documents evaluation accepts missing legacy/date floors and rejects null, wrong-type and regressed floors for both audience and token families; no business rows are written');
  const readPassword = password(); const noListPassword = password();
  await admin.db('admin').command({ createUser: 'readFence', pwd: readPassword, roles: [{ role: 'read', db: db.databaseName }] });
  await admin.db('admin').command({ createUser: 'noFencePermissions', pwd: noListPassword, roles: [] });
  await db.command({ collMod: name, validationLevel: 'moderate', validationAction: 'warn' });
  const read = await connect('readFence', readPassword);
  assert.equal(await isThingAclWriteFenceReady(read.db(db.databaseName), name), false);
  await assert.rejects(() => installThingAclWriteFence(read.db(db.databaseName), name), (error: any) => error?.code === 13);
  assert.equal((await options()).validationLevel, 'moderate');
  const none = await connect('noFencePermissions', noListPassword);
  await assert.rejects(() => isThingAclWriteFenceReady(none.db(db.databaseName), name), (error: any) => error?.code === 13);
  await assert.rejects(() => installThingAclWriteFence(none.db(db.databaseName), name), (error: any) => error?.code === 13);
  assert.equal(await db.collection(name).countDocuments(), 0);
  checks.push('actual authenticated read-only user cannot collMod and no-permission user cannot listCollections; both readiness/install paths fail closed with Unauthorized (13); fixture remains empty');
  passed = true;
} catch (error: any) {
  console.error(JSON.stringify({ passed: false, failure: String(error.message).split('\n')[0].slice(0, 200) })); process.exitCode = 1;
} finally {
  for (const client of clients) await client.close().catch(() => {});
  if (child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit'); process.kill(-child.pid!, 'SIGTERM');
    const timer = setTimeout(() => { try { process.kill(-child.pid!, 'SIGKILL'); } catch {} }, 3000);
    await exited; clearTimeout(timer);
  }
  await rm(dir, { recursive: true, force: true }); await mkdir(evidence, { recursive: true });
  await writeFile(join(evidence, 'acl-validator-lifecycle-acceptance.json'), JSON.stringify({ passed, checks, mongoAuthentication: true, businessWrites: 'none; empty DDL fixture only', cleanup: { exited: child.exitCode !== null || child.signalCode !== null, temporaryDataRemoved: true }, completedAt: new Date().toISOString() }, null, 2));
  console.log(JSON.stringify({ passed, checks }));
}
