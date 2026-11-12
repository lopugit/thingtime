import assert from 'node:assert/strict';
import test from 'node:test';
import { beginGatewayWork, gatewayAuthority, GatewayWorkUnavailable, isGatewayWorkIdle, registerGatewayDrain, reserveGatewayWorkShutdown, runAdmittedGatewayWork, withGatewayWork } from './environmentGateway';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};

test('detached completion keeps shutdown unavailable after its parent request ends', async () => {
  const endRequest = beginGatewayWork(), saved = deferred();
  const task = withGatewayWork(() => saved.promise);
  endRequest(); endRequest();
  assert.equal(isGatewayWorkIdle(), false);
  assert.equal(reserveGatewayWorkShutdown(), null);
  saved.resolve(); await task;
  const reservation = reserveGatewayWorkShutdown();
  assert.ok(reservation?.isCurrent());
  try {
    let dispatched = false;
    await assert.rejects(withGatewayWork(async () => { dispatched = true; }), GatewayWorkUnavailable);
    assert.equal(dispatched, false);
    assert.equal(reserveGatewayWorkShutdown(), null);
    assert.equal(reservation.isCurrent(), true);
  } finally { reservation.release(); }
  assert.equal(reservation.isCurrent(), false);
  await withGatewayWork(async () => {});
});

test('nested jobs, throws and failed persistence retain then release their own admissions', async () => {
  const saved = deferred(); let child: Promise<void>;
  await withGatewayWork(async () => { child = withGatewayWork(() => saved.promise); });
  assert.equal(reserveGatewayWorkShutdown(), null);
  saved.resolve(); await child!;
  await assert.rejects(withGatewayWork(() => { throw Error('write failed'); }), /write failed/);
  const first = reserveGatewayWorkShutdown(); assert.ok(first);
  first.release();
  const second = reserveGatewayWorkShutdown(); assert.ok(second);
  first.release();
  assert.equal(second.isCurrent(), true, 'an old handle cannot release a newer reservation');
  second.release();
});

test('shutdown waits for demotion pool cleanup and a failed drain cannot skip other pools', async t => {
  const environment = {
    THINGTIME_GATEWAY_ENVIRONMENT: 'test', THINGTIME_GATEWAY_ORIGIN: 'https://runtime.test',
    THINGTIME_GATEWAY_DEPLOYMENT_ID: 'runtime-old', THINGTIME_GATEWAY_SECRET: 'synthetic'.repeat(8),
    THINGTIME_MONGODB_CONNECTION_MODE: 'proxy', THINGTIME_DESKTOP: undefined, THINGTIME_AGENT_TEST_MODE: undefined
  };
  const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  const closed = deferred(); let owner = 'runtime-old', closeStarted = false;
  const removeFailed = registerGatewayDrain(() => { throw Error('synthetic close failure'); });
  const removePending = registerGatewayDrain(async () => { closeStarted = true; await closed.promise; });
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    schemaVersion: 1, origin: 'https://runtime.test',
    gateway: { origin: 'https://runtime.test', environment: 'test', deploymentId: owner },
    features: { 'api.environment-gateway': { version: '1.0.0' } }, operations: []
  }));
  const end = beginGatewayWork();
  try {
    await gatewayAuthority.current(true);
    owner = 'runtime-new'; await gatewayAuthority.current(true);
    assert.equal(closeStarted, false, 'admitted work must settle before pool close starts');
    assert.equal(reserveGatewayWorkShutdown(), null);
    end();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(closeStarted, true);
    assert.equal(reserveGatewayWorkShutdown(), null, 'zero active requests is insufficient during pool close');
    let admitted = false;
    const waiting = runAdmittedGatewayWork(async () => { admitted = true; });
    await Promise.resolve(); assert.equal(admitted, false);
    closed.resolve(); await waiting;
    const reservation = reserveGatewayWorkShutdown(); assert.ok(reservation);
    reservation.release();
  } finally {
    end(); closed.resolve(); await runAdmittedGatewayWork(async () => {});
    removeFailed(); removePending();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
