import assert from 'node:assert/strict';
import test from 'node:test';
import { MongoClient, Db } from 'mongodb';
import { createMongoStatusReader } from './status';
import { getMongoStatusConnection } from './collections';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};

const fixture = (dbName = 'thingtime') => {
  const commands: any[] = [];
  let closes = 0;
  let gets = 0;
  const db = {
    databaseName: dbName,
    command: async (command: any, options: any) => {
      commands.push([command, options]);
      assert.ok(options.timeoutMS > 0 && options.timeoutMS <= 2000);
      return command.hello ? { setName: 'test-replica' } : { ok: 1 };
    },
    listCollections: (_filter: any, options: any) => {
      assert.equal(options.nameOnly, true);
      assert.ok(options.timeoutMS > 0 && options.timeoutMS <= 2000);
      return { toArray: async () => [{ name: 'one' }, { name: 'two' }] };
    },
    close: async () => { closes++; }
  };
  const selected = {
    uri: 'mongodb://synthetic-user:synthetic-password@db.test/thingtime',
    dbName, custom: false,
    getDb: async () => { gets++; return db; }
  };
  return { selected, db, commands, gets: () => gets, closes: () => closes };
};

test('real status wiring reuses one bounded application client without adopting or closing it', async t => {
  const previousUri = process.env.MONGODB_CONNECTION_STRING;
  process.env.MONGODB_CONNECTION_STRING = 'mongodb://pooled-status.test/thingtime';
  t.after(() => {
    if (previousUri === undefined) delete process.env.MONGODB_CONNECTION_STRING;
    else process.env.MONGODB_CONNECTION_STRING = previousUri;
  });
  let connections = 0, closes = 0, collectionLists = 0;
  t.mock.method(MongoClient.prototype, 'connect', async function (this: MongoClient) {
    connections++;
    assert.equal(this.options.maxPoolSize, 10);
    assert.equal(this.options.minPoolSize, 0);
    assert.equal(this.options.maxIdleTimeMS, 60_000);
    return this;
  });
  t.mock.method(MongoClient.prototype, 'close', async () => { closes++; });
  t.mock.method(Db.prototype, 'command', async (command: any) => {
    assert.ok(command.ping || command.hello, 'diagnostics issue no mutation commands');
    return command.hello ? { setName: 'test' } : { ok: 1 };
  });
  t.mock.method(Db.prototype, 'listCollections', () => {
    collectionLists++;
    return { toArray: async () => [] } as any;
  });
  t.mock.method(Db.prototype, 'renameCollection', async () => { assert.fail('health cannot adopt collections'); });
  const read = createMongoStatusReader(getMongoStatusConnection);
  for (let i = 0; i < 3; i++) assert.equal((await read()).connected, true);
  assert.equal(connections, 1, 'three sequential health reads use one cached MongoClient');
  assert.equal(closes, 0, 'diagnostics leave the application client open');
  assert.equal(collectionLists, 3, 'only the requested diagnostic lists run; no adoption pass');
});

test('simultaneous health reads share one diagnostic and keep the application connection open', async () => {
  const f = fixture();
  const gate = deferred<void>();
  const selected = { ...f.selected, getDb: async () => { await gate.promise; return f.selected.getDb(); } };
  const read = createMongoStatusReader(() => selected);
  const first = read(), second = read();
  gate.resolve();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, b);
  assert.equal(a.connected, true);
  assert.equal(a.host, 'db.test');
  assert.equal(a.dbName, 'thingtime');
  assert.equal(a.collections, 2);
  assert.equal(a.replicaSet, 'test-replica');
  assert.equal(a.custom, false);
  assert.equal(a.error, null);
  assert.ok(Number.isFinite(Date.parse(a.checkedAt)));
  assert.equal(f.gets(), 1);
  assert.equal(f.commands.length, 2);
  assert.equal(f.closes(), 0);
  await read();
  assert.equal(f.gets(), 2, 'completed status is not cached as stale success');
});

test('coalescing distinguishes credentials, database and home versus custom selection', async () => {
  const f = fixture();
  const gate = deferred<void>();
  let selected = { ...f.selected, getDb: async () => { await gate.promise; return f.selected.getDb(); } };
  const read = createMongoStatusReader(() => selected);
  const requests = [read()];
  selected = { ...selected, uri: 'mongodb://other-user:other-password@db.test/thingtime' };
  requests.push(read());
  selected = { ...selected, dbName: 'other-database' };
  requests.push(read());
  selected = { ...selected, custom: true };
  requests.push(read());
  gate.resolve();
  const results = await Promise.all(requests);
  assert.equal(f.gets(), 4);
  assert.deepEqual(results.map(row => row.custom), [false, false, false, true]);
  assert.equal(f.closes(), 0);
});

test('failed probe is redacted, coalesced, and retried without closing the shared connection', async () => {
  const f = fixture();
  const driverError = Object.assign(new Error('synthetic-password in a driver URI'), { name: 'MongoServerSelectionError' });
  let failed = true;
  const command = f.db.command;
  f.db.command = async (...args) => {
    if (failed) throw driverError;
    return command(...args);
  };
  const read = createMongoStatusReader(() => f.selected);
  const [a, b] = await Promise.all([read(), read()]);
  assert.equal(a, b);
  assert.equal(a.connected, false);
  assert.equal(a.error, 'MongoServerSelectionError');
  assert.equal(a.dbName, null);
  assert.equal(a.pingMs, null);
  assert.equal(a.collections, null);
  assert.equal(a.replicaSet, null);
  assert.doesNotMatch(JSON.stringify(a), /synthetic-password|synthetic-user/);
  failed = false;
  assert.equal((await read()).connected, true);
  assert.equal(f.closes(), 0);
});

test('slow shared connection returns at the health deadline and does not run late commands', async () => {
  const f = fixture();
  const gate = deferred<any>();
  const selected = { ...f.selected, getDb: () => gate.promise };
  const read = createMongoStatusReader(() => selected, 20);
  const result = await read();
  assert.equal(result.connected, false);
  assert.equal(result.error, 'MongoOperationTimeoutError');
  gate.resolve(f.db);
  await new Promise(done => setImmediate(done));
  assert.equal(f.commands.length, 0);
  assert.equal(f.closes(), 0);
  assert.equal((await read()).connected, true, 'deadline clears the in-flight entry for recovery');
});

test('denied optional hello preserves connected status with an unavailable replica set', async () => {
  const f = fixture();
  const command = f.db.command;
  f.db.command = async (cmd, options) => {
    if (cmd.hello) throw new Error('hello denied');
    return command(cmd, options);
  };
  const status = await createMongoStatusReader(() => f.selected)();
  assert.equal(status.connected, true);
  assert.equal(status.replicaSet, null);
});

test('optional hello cannot swallow a driver operation timeout', async () => {
  const f = fixture();
  const command = f.db.command;
  f.db.command = async (cmd, options) => {
    if (cmd.hello) throw Object.assign(new Error('diagnostic timeout'), { name: 'MongoOperationTimeoutError' });
    return command(cmd, options);
  };
  const status = await createMongoStatusReader(() => f.selected)();
  assert.equal(status.connected, false);
  assert.equal(status.error, 'MongoOperationTimeoutError');
  assert.equal(status.replicaSet, null);
});

test('expired hello result is disconnected before the outer timer callback runs', async t => {
  const f = fixture();
  let clock = Date.now();
  t.mock.method(Date, 'now', () => clock);
  const command = f.db.command;
  f.db.command = async (cmd, options) => {
    const result = await command(cmd, options);
    if (cmd.hello) clock += 2000;
    return result;
  };
  const status = await createMongoStatusReader(() => f.selected)();
  assert.equal(status.connected, false);
  assert.equal(status.error, 'MongoOperationTimeoutError');
  assert.equal(status.replicaSet, null);
});

test('unconfigured connection produces the complete disconnected response', async () => {
  const status = await createMongoStatusReader(() => { throw new Error('unconfigured'); })();
  assert.equal(status.connected, false);
  assert.equal(status.host, null);
  assert.equal(status.custom, false);
  assert.equal(status.error, 'Error');
  assert.equal(status.dbName, null);
});

test('a broken custom configuration is not reported as a home connection', async () => {
  const status = await createMongoStatusReader(() => ({ custom: true, error: new Error('synthetic custom configuration failure') }))();
  assert.equal(status.connected, false);
  assert.equal(status.custom, true);
  assert.equal(status.host, null);
  assert.equal(status.dbName, null);
  assert.equal(status.error, 'Error');
});
