import assert from 'node:assert/strict';
import { test } from 'node:test';
import { patScopeCovers } from '../auth/patScopes';
import { privateReportingAcl, reportingDigest, reportingUuid, validReportingWorkspace } from './reportingCore';
test('reporting identities and immutable payload hashes are stable under object key order', () => {
  assert.equal(reportingDigest({ b: 2, a: 1 }), reportingDigest({ a: 1, b: 2 }));
  assert.notEqual(reportingDigest({ a: 1 }), reportingDigest({ a: 2 }));
  assert.match(reportingUuid('task'), /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(reportingUuid('task'), reportingUuid('task'));
});
test('only explicit owner and named-user private audiences qualify', () => {
  for (const acl of [['tt:user'], ['tt:user', 'tt:custom', 'tt:user/agent'], ['tt:user', 'tt:user/owner/write']]) assert.ok(privateReportingAcl(acl));
  for (const acl of [['tt:all'], ['tt:user', 'tt:all'], ['tt:user', 'tt:hidden'], ['tt:user', 'tt:inherit'], ['tt:userFriends'], ['tt:user', 'tt:group/others']]) assert.equal(privateReportingAcl(acl), false);
});
test('workspace uses exact independent saved role references and a closed Action vocabulary', () => {
  const workspace = { pages: { overview: 'overview', taskDetail: 'detail' }, schemas: Object.fromEntries(['project', 'task', 'agent', 'todo', 'progress', 'question'].map(role => [role, role])), actions: { createTask: 'action' } };
  assert.equal(validReportingWorkspace(workspace), true);
  assert.equal(validReportingWorkspace({ ...workspace, actions: { arbitrary: 'action' } }), false);
  assert.equal(validReportingWorkspace({ ...workspace, schemas: { ...workspace.schemas, agent: 'task' } }), false);
});

test('general Things scope never implies delegation authority', () => { assert.equal(patScopeCovers(['things'], 'agents.report'), false); assert.equal(patScopeCovers(['agents.report'], 'things.create'), false); assert.equal(patScopeCovers(['agents.report'], 'agents.report'), true); });
