import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { thingPresentationData } from '../Thingtime/renderComponentDeclaration';
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
      interactive = node.attributes.properties.some(prop => ts.isJsxAttribute(prop) && prop.name.getText(source) === 'interactive' && (!prop.initializer || (ts.isJsxExpression(prop.initializer) && prop.initializer.expression?.kind === ts.SyntaxKind.TrueKeyword)));
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

test('generic Things delegate presentation and saved identity while canonical kinds retain their renderers', () => {
  const text = readFileSync(new URL('./PostInteractiveThing.tsx', import.meta.url), 'utf8');
  const source = ts.createSourceFile('PostInteractiveThing.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'PostInteractiveThing');
  assert.ok(component && ts.isFunctionDeclaration(component) && component.body);
  const negates = (node: ts.Node, name: string) => ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.ExclamationToken && ts.isIdentifier(node.operand) && node.operand.text === name;
  const fallback = component.body.statements.find(node => ts.isIfStatement(node) &&
    ts.isBinaryExpression(node.expression) && node.expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
    negates(node.expression.left, 'component') && negates(node.expression.right, 'webpage'));
  assert.ok(fallback && ts.isIfStatement(fallback), 'only generic kinds enter the ThingView fallback');
  const attribute = (node: ts.JsxSelfClosingElement, name: string) => {
    const value = node.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.getText(source) === name);
    return value && ts.isJsxAttribute(value) && value.initializer && ts.isJsxExpression(value.initializer) ? value.initializer.expression : undefined;
  };
  const property = (node: ts.Node | undefined, name: string) => !!node && ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) && node.expression.text === 'thing' && node.name.text === name;
  const views: ts.JsxSelfClosingElement[] = [];
  let canonicalBranch: ts.ConditionalExpression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'ThingView') views.push(node);
    ts.forEachChild(node, visit);
  };
  visit(fallback.thenStatement);
  assert.equal(views.length, 1, 'generic presentation delegates once through ThingView');
  const data = attribute(views[0], 'thing');
  assert.ok(data && ts.isCallExpression(data) && ts.isIdentifier(data.expression) && data.expression.text === 'thingPresentationData');
  assert.equal(data.arguments.length, 1);
  assert.ok(property(data.arguments[0], 'crystal'), 'presentation comes from the canonical crystal helper');
  assert.ok(property(attribute(views[0], 'subjectId'), 'id'), 'menu authority names the exact persisted root, independent of JSX attribute order');
  const compact = attribute(views[0], 'compact');
  assert.ok(compact && ts.isIdentifier(compact) && compact.text === 'compact');
  const findCanonical = (node: ts.Node) => {
    if (ts.isConditionalExpression(node) && ts.isIdentifier(node.condition) && node.condition.text === 'component' &&
        ts.isJsxSelfClosingElement(node.whenTrue) && node.whenTrue.tagName.getText(source) === 'LinkedComponent' &&
        ts.isJsxSelfClosingElement(node.whenFalse) && node.whenFalse.tagName.getText(source) === 'LinkedPage') canonicalBranch = node;
    ts.forEachChild(node, findCanonical);
  };
  findCanonical(component.body);
  assert.ok(canonicalBranch, 'Component and Webpage keep their dedicated canonical renderers');
  for (const branch of [canonicalBranch.whenTrue, canonicalBranch.whenFalse]) {
    assert.ok(ts.isJsxSelfClosingElement(branch));
    const value = attribute(branch, 'thing');
    assert.ok(value && ts.isIdentifier(value) && value.text === 'thing');
  }
  assert.doesNotMatch(text, /ExplicitThingRender/);
});

test('generic presentation keeps explicit render pointers authoritative over legacy nested payloads', () => {
  const plain = { name: 'Plain data' }, nested = { note: 'Legacy payload' };
  assert.equal(thingPresentationData(plain), plain);
  assert.equal(thingPresentationData({ thing: nested }), nested);
  for (const renderComponent of [{ id: 'saved-component' }, { render: { tag: 'p', children: 'Embedded component' } }, null, 'invalid']) {
    const crystal = { renderComponent, thing: nested };
    assert.equal(thingPresentationData(crystal), crystal, 'explicit, unavailable or invalid declarations never infer the nested legacy renderer');
  }
});
