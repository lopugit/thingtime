import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { isGatewayWorkIdle, reserveGatewayWorkShutdown, withGatewayWork } from '../deployment/environmentGateway';

// Execute the actual detached scheduling statement in isolation from unrelated
// DB/ACL setup. Removing its work lease makes these ordering tests fail.
function schedulingStatement(file: URL, call: string) {
  const source = ts.createSourceFile(file.pathname, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const candidates: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isExpressionStatement(node) && node.getText(source).includes(call)) candidates.push(node.getText(source));
    ts.forEachChild(node, visit);
  };
  visit(source);
  const statement = candidates.sort((a, b) => a.length - b.length)[0];
  assert(statement, `Missing scheduling boundary: ${call}`);
  return statement;
}

for (const fixture of [
  { name: 'Messenger recent reaction', file: new URL('./messenger.ts', import.meta.url), call: 'pushUserRecentReaction(viewerId, token)', dependency: 'pushUserRecentReaction', args: ['viewerId', 'token'], values: ['synthetic-owner', '🙂'] },
  { name: 'deployment login-session revocation', file: new URL('../../../routes/api/v1/deployment-links/_deployment-links.tsx', import.meta.url), call: 'remoteLogout(baseUrl, token)', dependency: 'remoteLogout', args: ['baseUrl', 'token'], values: ['https://synthetic.example', 'synthetic-session'] }
]) {
  for (const rejected of [false, true]) test(`${fixture.name} holds shutdown until ${rejected ? 'failed' : 'successful'} completion`, async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve, reject) => { finish = () => rejected ? reject(new Error('synthetic failure')) : resolve(); });
    let calls = 0;
    const effect = (...args: unknown[]) => { calls++; assert.deepEqual(args, fixture.values); return pending; };
    const schedule = new Function('withGatewayWork', fixture.dependency, ...fixture.args, schedulingStatement(fixture.file, fixture.call));
    assert.equal(isGatewayWorkIdle(), true);
    schedule(withGatewayWork, effect, ...fixture.values);
    assert.equal(calls, 1);
    assert.equal(isGatewayWorkIdle(), false);
    assert.equal(reserveGatewayWorkShutdown(), null);
    finish();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(isGatewayWorkIdle(), true);
    const reservation = reserveGatewayWorkShutdown();
    assert(reservation); reservation.release();
  });
}
