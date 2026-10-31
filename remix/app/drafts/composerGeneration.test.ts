import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { isEditorJsDoc } from '../components/Editor/editorJsValue';
const text = readFileSync(new URL('../components/Feed/PostComposer.tsx', import.meta.url), 'utf8');
const source = ts.createSourceFile('PostComposer.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
for (const attribute of ['onValueChange', 'onDraftValueChange'])
	test(`template load rejects a late ${attribute} from the previous editor`, () => {
		let expression: ts.Expression | undefined;
		function visit(node: ts.Node) {
			if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'LongTextEditor') {
				const prop = node.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText(source) === attribute) as ts.JsxAttribute;
				expression = (prop.initializer as ts.JsxExpression).expression;
			}
			ts.forEachChild(node, visit);
		}
		visit(source);
		assert.ok(expression);
		let value: unknown = 'loaded template';
		const generation = { current: 1 };
		const callback = runInNewContext(
			ts.transpileModule(`(${expression.getText(source)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
			{
				composerGeneration: generation,
				editorGeneration: 0,
				latestEditorDraft: { current: null },
				isEditorJsDoc,
				setPostEditorValue: (next) => {
					value = next;
				},
				setPostEditorDraft: (next) => {
					value = next;
				}
			}
		);
		callback({ blocks: [] });
		assert.equal(value, 'loaded template');
		generation.current = 0;
		const current = { blocks: [{ type: 'paragraph', data: { text: 'new input' } }] };
		callback(current);
		assert.equal(value, current);
	});
