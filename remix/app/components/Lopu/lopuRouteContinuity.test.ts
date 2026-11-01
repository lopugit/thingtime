import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

test('voice and text routes export the identical component, not remounting wrappers', () => {
	const chatComponent = () => null;
	const source = readFileSync(new URL('../../routes/lopu-voice.tsx', import.meta.url), 'utf8');
	const compiled = ts.transpileModule(source, {
		compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
	}).outputText;
	const exports: Record<string, unknown> = {};
	vm.runInNewContext(compiled, {
		exports,
		require: (specifier: string) => {
			assert.equal(specifier, './lopu', 'voice must reuse the canonical text route');
			return { default: chatComponent };
		}
	});
	assert.equal(exports.default, chatComponent);
});
