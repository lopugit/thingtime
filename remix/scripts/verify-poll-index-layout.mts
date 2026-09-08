// Synthetic, disposable local MongoDB acceptance. Never accepts a remote URI.
// Usage: node --import tsx scripts/verify-poll-index-layout.mts /absolute/path/to/mongod
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { MongoClient } from 'mongodb';
import { ensureHomeThingsIndexPlan, physicalCollectionName } from '../app/api/utils/mongodb/collections.ts';
import { migratePollVoteIndex, pollVoteIdentity } from '../app/api/utils/mongodb/pollVoteIndex.ts';

const binary = process.argv[2];
assert.ok(binary && isAbsolute(binary), 'Supply an absolute local mongod path.');
const reservation = createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const address = reservation.address();
assert.ok(address && typeof address === 'object');
const port = address.port;
await new Promise<void>(resolve => reservation.close(() => resolve()));
const directory = await mkdtemp(join(tmpdir(), 'thingtime-poll-index-'));
const server = spawn(binary, ['--dbpath', directory, '--bind_ip', '127.0.0.1', '--port', String(port), '--logpath', join(directory, 'mongo.log')], { stdio: 'ignore' });
const closed = new Promise<void>(resolve => { server.once('close', () => resolve()); server.once('error', () => resolve()); });
const client = new MongoClient(`mongodb://127.0.0.1:${port}/thingtime_poll_index_acceptance`, { serverSelectionTimeoutMS: 500 });
try {
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    if (server.exitCode !== null) throw new Error('Disposable MongoDB exited before readiness.');
    try { await client.connect(); ready = true; break; } catch { await delay(250); }
  }
  assert.ok(ready, 'Disposable MongoDB did not become ready.');
  const db = client.db();
  const votes = db.collection(physicalCollectionName('things'));
  await votes.createIndex({ 'crystal.voteKey': 1 }, { name: 'things_vote_key_lookup', partialFilterExpression: { 'crystal.voteKey': { $type: 'string' } } });
  await votes.insertMany(Array.from({ length: 1001 }, (_, i) => ({
    shareId: `synthetic-vote-${i}`, thingtime: ['vote'], ownerId: `u${i}`, targetId: 'poll',
    crystal: { voteKey: `poll~u${i}`, optionIndex: 0 }, createdAt: new Date()
  })));
  // The same user-defined crystal on an ordinary Thing cannot squat a slot.
  await votes.insertOne({ shareId: 'synthetic-data', thingtime: ['data'], crystal: { voteKey: 'poll~u0' } });
  const drop = async (name: string) => { try { await votes.dropIndex(name); } catch (e: any) { if (e.code !== 27) throw e; } };
  await migratePollVoteIndex(votes, drop);
  await migratePollVoteIndex(votes, drop); // idempotent rerun
  await ensureHomeThingsIndexPlan(db);
  const indexes = await votes.indexes();
  assert.equal(indexes.length, 60);
  assert.ok(!indexes.some(index => index.name === 'things_vote_key_lookup'));
  assert.equal(await votes.countDocuments({ thingtime: 'vote', uniqueKeys: { $exists: true } }), 1001);
  assert.equal(await votes.countDocuments({ thingtime: 'data', uniqueKeys: { $exists: true } }), 0);
  const identity = pollVoteIdentity('poll', 'u0');
  const plan = await votes.find(identity.filter).explain('executionStats');
  assert.equal(plan.executionStats.nReturned, 1);
  assert.equal(plan.executionStats.totalDocsExamined, 1);
  assert.match(JSON.stringify(plan.queryPlanner.winningPlan), /uniqueKeys_1/);
  await assert.rejects(votes.insertOne({ shareId: 'synthetic-duplicate', thingtime: ['vote'], uniqueKeys: [identity.uniqueKey] }), (e: any) => e.code === 11000);
  // A pre-existing duplicate must abort migration before dropping its index.
  await votes.createIndex({ 'crystal.voteKey': 1 }, { name: 'things_vote_key_lookup' });
  await votes.insertOne({ shareId: 'legacy-duplicate', thingtime: ['vote'], ownerId: 'u0', targetId: 'poll', crystal: { voteKey: 'poll~u0' } });
  await assert.rejects(migratePollVoteIndex(votes, drop), (e: any) => e.code === 11000);
  assert.ok((await votes.indexes()).some(index => index.name === 'things_vote_key_lookup'));
  console.log(JSON.stringify({ passed: true, indexCount: 60, spareSlots: 4, legacyVotes: 1001, docsExamined: 1, duplicateProtection: true }));
} finally {
  await client.close();
  server.kill('SIGTERM');
  const kill = setTimeout(() => server.kill('SIGKILL'), 10_000);
  await closed;
  clearTimeout(kill);
  await rm(directory, { recursive: true, force: true });
}
