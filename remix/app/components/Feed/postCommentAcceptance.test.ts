import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

// Execute the actual submission closures with a deferred server and small UI
// stand-ins. This checks acceptance ordering and rejection handling without
// mounting the full feed, Editor.js and account providers.
const text = readFileSync(new URL('./PostCard.tsx', import.meta.url), 'utf8');
const source = ts.createSourceFile('PostCard.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function closure(name: string, bindings: Record<string, unknown>) {
  let initializer: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) initializer = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(initializer, `${name} must remain available for the acceptance regression`);
  const code = ts.transpileModule(`(${initializer.getText(source)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return runInNewContext(code, bindings);
}
const notifyCommentAdded = closure('notifyCommentAdded', {});
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
function harness(callback: () => void | Promise<unknown>) {
  let accept!: (response: unknown) => void, reject!: (error: Error) => void;
  const response = new Promise((resolve, fail) => { accept = resolve; reject = fail; });
  const effects = { writes: 0, errors: 0, restored: 0, dropped: 0 };
  let post = { id: 'target', comments: [] as any[], commentCount: 0 };
  let replies: any[] = [];
  const fresh = { note() {}, swap() {}, drop() { effects.dropped++; } };
  const bindings = {
    api: { v1: { things: { comment: () => { effects.writes++; return response; } } } },
    post, comment: post, user: { id: 'viewer' }, commentText: 'New note', replyText: 'New note',
    buildPendingComment: () => ({ id: 'pending', pending: true }),
    clearCommentDraft() {}, clearReplyDraft() {}, freshComments: fresh, freshReplies: fresh,
    onChanged: (_id: string, change: (current: typeof post) => typeof post) => { post = change(post); },
    setReplies: (change: (current: any[]) => any[]) => { replies = change(replies); },
    setCachedThread() {}, commentSort: null, isPendingComment: (entry: any) => !!entry.pending,
    onEngagement() {}, setRepliesOpen() {}, setRichReplyOpen() {}, setRichCommentOpen() {},
    setCommentText() { effects.restored++; }, setReplyText() { effects.restored++; },
    lopu() { effects.errors++; }, onCommentAdded: callback, notifyCommentAdded
  };
  return { accept, reject, effects, bindings };
}

for (const name of ['submitComment', 'submitReply']) {
  test(`${name} refreshes media only after acceptance and isolates refresh failures`, async () => {
    for (const failure of ['throw', 'reject']) {
      let refreshes = 0;
      const h = harness(() => {
        refreshes++;
        if (failure === 'throw') throw new Error('Refresh failed');
        return Promise.reject(new Error('Refresh failed'));
      });
      const sending = closure(name, h.bindings)();
      await settle();
      assert.equal(refreshes, 0, 'optimistic engagement must not refresh before attachments are committed');
      h.accept({ comment: { id: 'accepted', text: 'New note' }, commentCount: 1 });
      await sending;
      await settle();
      assert.equal(refreshes, 1);
      assert.deepEqual(h.effects, { writes: 1, errors: 0, restored: 0, dropped: 0 });
    }
  });
  test(`${name} does not report rejected comments as added`, async () => {
    let refreshes = 0;
    const h = harness(() => { refreshes++; });
    const sending = closure(name, h.bindings)();
    h.reject(new Error('Write failed'));
    await sending;
    await settle();
    assert.equal(refreshes, 0);
    assert.deepEqual(h.effects, { writes: 1, errors: 1, restored: 1, dropped: 1 });
  });
}

for (const name of ['handleRichCommented', 'handleRichReplied']) {
  test(`${name} reports the accepted rich comment without resending on refresh failure`, async () => {
    let refreshes = 0;
    const h = harness(() => { refreshes++; return Promise.reject(new Error('Refresh failed')); });
    closure(name, h.bindings)({ id: 'accepted-rich', attachments: [{ id: 'media' }] });
    await settle();
    assert.equal(refreshes, 1);
    assert.deepEqual(h.effects, { writes: 0, errors: 0, restored: 0, dropped: 0 });
  });
}

test('shared discussions and every nested/focused reply row forward the acceptance callback', () => {
  let rows = 0;
  const visit = (node: ts.Node) => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'CommentRow') {
      rows++;
      const callback = node.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.getText(source) === 'onCommentAdded');
      assert.ok(callback && ts.isJsxAttribute(callback) && callback.initializer && ts.isJsxExpression(callback.initializer));
      assert.equal(callback.initializer.expression?.getText(source), 'onCommentAdded');
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(rows, 3);
  const discussion = readFileSync(new URL('../Things/ThingComments.tsx', import.meta.url), 'utf8');
  assert.match(discussion, /<Discussion[^>]*onCommentAdded=\{onCommentAdded\}/);
  assert.match(discussion, /<PostCard[^>]*onCommentAdded=\{onCommentAdded\}/);
});
