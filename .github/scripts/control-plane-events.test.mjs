import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { classifyConversation, classifyQueuedConversation, hasAutomationMarker } from './lopu-conversation-gate.mjs';

const workflow = readFileSync(new URL('../workflows/resolve-pr-conflicts.yml', import.meta.url), 'utf8');
const ci = readFileSync(new URL('../workflows/control-plane-ci.yml', import.meta.url), 'utf8');
const marker = '<!-- thingtime-develop-pr-preview -->';
const event = (body, patch = {}) => ({ action: 'created', issue: { pull_request: {} }, comment: { id: 5541425923, user: { type: 'User', login: 'lopugit' }, body }, changes: { body: { from: '' } }, ...patch });

// Evaluate the actual YAML expressions for this intentionally small expression
// subset. No fixture expression duplicates the production admission rules.
function gateExpression(job) {
  const block = workflow.split(`\n  ${job}:\n`)[1]?.split(/\n  [a-z_]+:\n/u)[0];
  const expression = block?.match(/\n    if: >-\n((?:      [^\n]*\n)+)/u)?.[1];
  assert.ok(expression, `${job} has an evaluable job gate`);
  return expression;
}
function evaluate(expression, eventName, payload, eligible = 'true', result = 'success') {
  return runInNewContext(expression, {
    github: { event_name: eventName, event: payload, actor: 'lopugit', ref_name: 'main' },
    inputs: { promotion_source_pr: '', promotion_plan_b64: '', maintenance_operation: '', control_dispatch_id: '', ref_race_handoff: false },
    needs: { conversation_gate: { result, outputs: { eligible } }, route: { outputs: { execute: 'true' } } },
    cancelled: () => false,
    startsWith: (value, prefix) => String(value ?? '').toLowerCase().startsWith(prefix.toLowerCase()),
  });
}

for (const eventName of ['issue_comment', 'pull_request_review_comment']) {
  for (const action of ['created', 'edited']) {
    test(`${eventName}/${action}: PAT preview update stops before any runner or provider routing`, () => {
      const payload = event(`${marker}\n### Preview ready`, { action });
      assert.equal(evaluate(gateExpression('conversation_gate'), eventName, payload), false);
      assert.equal(evaluate(gateExpression('route'), eventName, payload, '', 'skipped'), false);
      assert.equal(classifyConversation(eventName, payload).eligible, false);
    });
    test(`${eventName}/${action}: human question and quoted automation reach review`, () => {
      for (const body of ['Please investigate this', `> ${marker}\n> Preview failed\n\nCan you fix this?`, `What about this example?\n\`\`\`html\n${marker}\n\`\`\``]) {
        const payload = event(body, { action });
        assert.equal(evaluate(gateExpression('conversation_gate'), eventName, payload), true);
        assert.equal(classifyConversation(eventName, payload).eligible, true);
        assert.equal(evaluate(gateExpression('route'), eventName, payload), true);
        assert.equal(evaluate(gateExpression('review_detect'), eventName, payload), true);
      }
    });
  }
  test(`${eventName}: bot, empty, unchanged, removed and trailing markers fail closed`, () => {
    const cases = [
      event('hello', { comment: { user: { type: 'Bot' }, body: 'hello' } }),
      event('   '),
      event('same', { action: 'edited', changes: { body: { from: 'same' } } }),
      event('marker removed', { action: 'edited', changes: { body: { from: `${marker}\nold status` } } }),
      event(`Preview result\n\n${marker}`),
      event(` \t<!--THINGTIME-ai-rebase-result:v1 -->\nReady`),
    ];
    for (const payload of cases) {
      assert.equal(classifyConversation(eventName, payload).eligible, false);
      assert.equal(evaluate(gateExpression('route'), eventName, payload, 'false'), false);
    }
    assert.equal(evaluate(gateExpression('route'), eventName, event('hello'), '', 'failure'), false);
  });
}

test('missing author, unrelated issue, deleted event and malformed body never admit', () => {
  for (const payload of [event('x', { issue: {} }), event('x', { action: 'deleted' }), event('x', { comment: {} }), event(null)]) {
    assert.equal(classifyConversation('issue_comment', payload).eligible, false);
  }
});
test('skipped conversation gate preserves non-comment routing, including real failures', () => {
  for (const eventName of ['push', 'schedule', 'workflow_dispatch', 'repository_dispatch', 'pull_request_target']) {
    assert.equal(evaluate(gateExpression('route'), eventName, event(''), '', 'skipped'), true);
  }
  for (const eventName of ['check_run', 'workflow_run']) {
    assert.equal(evaluate(gateExpression('route'), eventName, { [eventName]: { pull_requests: [{ number: 624 }], conclusion: 'failure' } }, '', 'skipped'), true);
  }
});
test('only unquoted standalone markers suppress, with fence and whitespace variations', () => {
  for (const body of [`> ${marker}`, `\t${marker}`, `    ${marker}`, `\`\`\`html\n${marker}\n\`\`\``, `~~~\n${marker}\n~~~`, `Does \`${marker}\` matter?`]) assert.equal(hasAutomationMarker(body), false);
  assert.equal(hasAutomationMarker(`\`\`\`\nexample\n\`\`\`\n${marker}`), true);
  assert.equal(hasAutomationMarker(`> quoted\n\n${marker}`), true);
});
test('CI concurrency isolates unrelated PRs and refs while superseding the same PR', () => {
  const template = ci.match(/^  group: (.+)$/mu)?.[1];
  assert.ok(template);
  const key = (number, ref) => template.replace(/\$\{\{(.+?)\}\}/gu, (_, expr) => runInNewContext(expr, { github: { event: { pull_request: { number } }, ref } }));
  const keys = [key(624, 'refs/pull/624/merge'), key(625, 'refs/pull/625/merge'), key(null, 'refs/heads/github-actions'), key(null, 'refs/heads/main')];
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(key(624, 'refs/pull/624/merge'), key(624, 'refs/pull/624/merge'));
  assert.match(ci, /cancel-in-progress: true/u);
  assert.match(template, /^workflow-control-plane-ci-/u);
});
test('every rebase comment-producing step carries an unconditional automation marker', () => {
  const rebase = readFileSync(new URL('../workflows/rebase-pr-stacks.yml', import.meta.url), 'utf8');
  const writers = rebase.split(/\n      - /u).filter(step => step.includes('gh pr comment'));
  assert.equal(writers.length, 4);
  for (const step of writers) assert.match(step, /<!-- thingtime-ai-rebase-(?:ref-race|result|failure|post-push):v1 -->/u);
});
test('event safety tests block CI and classifier always uses the protected checkout', () => {
  const verify = ci.split('\n  verify:\n')[1].split('\n  contract-advisories:')[0];
  assert.match(verify, /node --test \.github\/scripts\/control-plane-events.test.mjs \.github\/scripts\/preview-comments.test.mjs/u);
  const admission = workflow.split('\n  conversation_gate:\n')[1].split('\n  route:')[0];
  assert.match(admission, /ref: github-actions\n\s+persist-credentials: false/u);
  assert.doesNotMatch(admission, /secrets\.|comment\.body.*\}\}/u);
  assert.match(workflow, /id: prepare\n\s+if: steps\.conversation\.outputs\.eligible == 'true'/u);
  assert.match(workflow, /run: node trusted\/\.github\/scripts\/lopu-conversation-gate.mjs --queued/u);
});

test('queued legacy signals recheck the live comment before spending on a model', async () => {
  for (const [kind, endpoint] of [['issue-comment', 'issues'], ['inline-comment', 'pulls']]) {
    const args = { dispatchId: `lopu-review:${kind}:42:100`, repository: 'example/project', prNumber: '624' };
    const comment = { id: 42, user: { type: 'User' }, body: `${marker}\nReady`, [`${endpoint === 'issues' ? 'issue' : 'pull_request'}_url`]: `https://api.github.com/repos/example/project/${endpoint}/624` };
    const readComment = async path => { assert.equal(path, `repos/example/project/${endpoint}/comments/42`); return comment; };
    assert.equal((await classifyQueuedConversation({ ...args, readComment })).eligible, false);
    comment.body = `> ${marker}\nCan you help?`;
    assert.equal((await classifyQueuedConversation({ ...args, readComment })).eligible, true);
    assert.equal((await classifyQueuedConversation({ ...args, readComment: async () => null })).eligible, false);
    await assert.rejects(classifyQueuedConversation({ ...args, readComment: async () => { throw new Error('transport'); } }));
    await assert.rejects(classifyQueuedConversation({ ...args, prNumber: '625', readComment }));
  }
});
