import assert from 'node:assert/strict';
import test from 'node:test';
import { cacheEditorRuntimes, loadEditorRuntimeScript } from './editorJsRuntime';
import { EDITOR_RUNTIME_SLOT, type EditorJsRuntime } from './editorJsRuntimeImports';
const runtime = { EditorJS: function SyntheticEditor() {} } as unknown as EditorJsRuntime;
function fixture() {
	const scripts: any[] = [];
	const view: any = { Function };
	const doc: any = {
		defaultView: view,
		documentElement: { isConnected: true },
		head: { append: (script: any) => scripts.push(script) },
		createElement: () => ({
			remove() {
				this.removed = true;
			},
			removed: false
		})
	};
	return { doc, view, scripts };
}
test('concurrent consumers share one runtime; rejected loads can reopen', async () => {
	const { doc } = fixture();
	let count = 0,
		resolve!: (runtime: EditorJsRuntime) => void;
	const load = cacheEditorRuntimes(async () => {
		count++;
		return await new Promise<EditorJsRuntime>((done) => {
			resolve = done;
		});
	});
	const first = load(doc),
		second = load(doc);
	assert.equal(first, second);
	assert.equal(count, 1);
	resolve(runtime);
	assert.equal(await second, runtime);
	let attempts = 0;
	const retry = cacheEditorRuntimes(async () => {
		if (++attempts === 1) throw Error('Temporary failure');
		return runtime;
	});
	await assert.rejects(retry(doc), /Temporary/);
	assert.equal(await retry(doc), runtime);
	assert.equal(attempts, 2);
});
test('timeout then late module initialization reopens without another one-shot event', async () => {
	const { doc, view, scripts } = fixture();
	await assert.rejects(loadEditorRuntimeScript(doc, '/fixed-editor-entry.js', 5), /did not open/);
	assert.equal(scripts.length, 1);
	assert.equal(scripts[0].removed, true);
	assert.equal(scripts[0].onload, null);
	view[EDITOR_RUNTIME_SLOT] = async () => runtime;
	assert.equal(await loadEditorRuntimeScript(doc, '/fixed-editor-entry.js'), runtime);
	assert.equal(scripts.length, 1);
});
test('loaded modules and detached documents settle once and remove script callbacks', async () => {
	const { doc, view, scripts } = fixture();
	const loading = loadEditorRuntimeScript(doc, '/fixed-editor-entry.js');
	view[EDITOR_RUNTIME_SLOT] = async () => runtime;
	scripts[0].onload();
	assert.equal(await loading, runtime);
	assert.equal(scripts[0].removed, true);
	assert.equal(scripts[0].onerror, null);
	doc.documentElement.isConnected = false;
	await assert.rejects(loadEditorRuntimeScript(doc, '/fixed-editor-entry.js'), /document closed/);
});
