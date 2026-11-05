import assert from 'node:assert/strict';
import test from 'node:test';
import { captureComponentFormFields, flushComponentFormFields, registerComponentFormField } from './componentFormFields';

function fixture() {
	const element = {} as HTMLElement;
	const root = { matches: () => false, querySelectorAll: () => [element], contains: (value: unknown) => value === element } as unknown as HTMLElement;
	return { element, root };
}
test('form submission awaits trusted latest-save adapters; authored markers alone are inert', async () => {
	const { element, root } = fixture();
	let finish!: () => void, saved = false;
	const unregister = registerComponentFormField(element, () => new Promise<void>(resolve => { finish = () => { saved = true; resolve(); }; }));
	const pending = flushComponentFormFields(root);
	assert.equal(saved, false); finish(); await pending; assert.equal(saved, true);
	unregister(); await flushComponentFormFields(root);
});
test('identity changes and an unmounted/replaced adapter reject the pending submission', async () => {
	for (const change of ['identity', 'registration']) {
		const { element, root } = fixture();
		let finish!: () => void, current = true;
		const unregister = registerComponentFormField(element, () => new Promise<void>(resolve => { finish = resolve; }));
		const pending = flushComponentFormFields(root, () => current);
		if (change === 'identity') current = false; else unregister();
		finish(); await assert.rejects(pending, /form changed/); unregister();
	}
});
test('an editor save failure refuses the form rather than collecting an older value', async () => {
	const { element, root } = fixture();
	const unregister = registerComponentFormField(element, async () => { throw new Error('Could not save editor'); });
	await assert.rejects(flushComponentFormFields(root), /Could not save editor/); unregister();
});
test('menu form activation snapshots native fields before awaiting editors and reads both saved rich outputs together', async () => {
	const { element, root } = fixture();
	let finish!: () => void, text = 'clicked', doc = 'old', plain = 'old';
	const unregister = registerComponentFormField(element, () => new Promise<Record<string, unknown>>(resolve => { finish = () => { doc = 'new-json'; plain = 'new-text'; resolve({ doc, plain }); }; }));
	const pending = captureComponentFormFields(root, node => node === root ? { text, doc, plain } : { doc, plain }, () => true);
	text = 'later'; finish();
	assert.deepEqual(await pending, { text: 'clicked', doc: 'new-json', plain: 'new-text' });
	unregister();
});
