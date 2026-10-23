import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { applyLopuPatchEvent, getActiveWebpageDraft, registerWebpageDraft, resetLopuBuildBridge, type LopuDraftHandle } from '../Lopu/lopuBuildBridge';

// A display surface must opt out at the hook call: its default depends on the
// browser route, and feed/post/Thing pages are otherwise editable. Pin that
// wiring as well as the actual registry behavior without a fake hook runtime.
test('interactive webpage attachments cannot become or replace an editable builder target', () => {
  const source = ts.createSourceFile('PostInteractiveThing.tsx', readFileSync(new URL('./PostInteractiveThing.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const linkedPage = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'LinkedPage');
  assert.ok(linkedPage);
  let options: ts.ObjectLiteralExpression | undefined;
  let interactive = false;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'useWebpageDraft') {
      const argument = node.arguments[1];
      if (argument && ts.isObjectLiteralExpression(argument)) options = argument;
    }
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'WebpageBlocksRenderer') {
      interactive = node.attributes.properties.some(prop => ts.isJsxAttribute(prop) && prop.name.getText(source) === 'interactive' && (!prop.initializer || ts.isJsxExpression(prop.initializer) && prop.initializer.expression?.kind === ts.SyntaxKind.TrueKeyword));
    }
    ts.forEachChild(node, visit);
  };
  visit(linkedPage);
  const editable = options?.properties.find(prop => ts.isPropertyAssignment(prop) && prop.name.getText(source) === 'editable');
  assert.ok(editable && ts.isPropertyAssignment(editable), 'attachments must explicitly set hook editability independently of the feed route');
  assert.equal(editable.initializer.kind, ts.SyntaxKind.FalseKeyword);
  assert.equal(interactive, true, 'builder read-only does not disable attached page controls');

  resetLopuBuildBridge();
  try {
    let writes = 0;
    const draft = (id: string, editable: boolean): LopuDraftHandle => ({
      id, editable, source: 'user', pageKey: null, siteRoute: null, updatedAt: null, blocks: [], dirty: false,
      target: { kind: 'id', id }, setBlocks: () => { writes++; }, addComponent: () => {}, markSaved: () => {}
    });
    const attachment = draft('attached-page', editable.initializer.kind !== ts.SyntaxKind.FalseKeyword);
    registerWebpageDraft(attachment);
    assert.equal(getActiveWebpageDraft(), null, 'an attachment alone offers no editable target');
    const editor = draft('actual-editor', true);
    registerWebpageDraft(editor);
    registerWebpageDraft(attachment);
    assert.equal(getActiveWebpageDraft(), editor, 'a later embed cannot steal the active builder');
    const result = applyLopuPatchEvent({ target: { id: attachment.id! }, ops: [{ op: 'insert', containerId: null, index: 'end', block: { id: 'unexpected', type: 'text', text: 'Do not apply' } }] });
    assert.equal(result.ok, false, 'explicit patches cannot edit a display-only attachment either');
    assert.equal(writes, 0);
  } finally {
    resetLopuBuildBridge();
  }
});
