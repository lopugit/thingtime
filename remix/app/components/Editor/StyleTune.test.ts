import assert from 'node:assert/strict';
import test from 'node:test';
import { StyleTune } from './StyleTune';

const delegationDocument = () => {
	const listeners = new Set<(event: MouseEvent) => void>();
	let added = 0;
	let removed = 0;
	const document = {
		addEventListener(type: string, listener: (event: MouseEvent) => void, capture: boolean) {
			assert.equal(type, 'click');
			assert.equal(capture, true);
			added++;
			listeners.add(listener);
		},
		removeEventListener(type: string, listener: (event: MouseEvent) => void, capture: boolean) {
			assert.equal(type, 'click');
			assert.equal(capture, true);
			assert.ok(listeners.delete(listener), 'remove the exact registered listener');
			removed++;
		}
	} as unknown as Document;
	return { document, listeners, counts: () => ({ added, removed }) };
};

test('style delegation survives a sibling teardown and releases the last document listener exactly once', () => {
	const scope = delegationDocument();
	const tunes: StyleTune[] = [];
	const create = () => {
		const tune = new StyleTune({ api: {}, config: { ownerDocument: scope.document } });
		tunes.push(tune);
		return tune;
	};
	try {
		const first = create(), sibling = create();
		assert.deepEqual(scope.counts(), { added: 1, removed: 0 });
		first.destroy();
		first.destroy();
		assert.equal(scope.listeners.size, 1, 'a live sibling retains delegation');
		assert.deepEqual(scope.counts(), { added: 1, removed: 0 });
		sibling.destroy();
		assert.equal(scope.listeners.size, 0);
		assert.deepEqual(scope.counts(), { added: 1, removed: 1 });
		const reopened = create();
		assert.equal(scope.listeners.size, 1, 'a reopened editor gets fresh delegation');
		reopened.destroy();
		assert.deepEqual(scope.counts(), { added: 2, removed: 2 });
	} finally {
		tunes.forEach((tune) => tune.destroy());
	}
});

test('style clicks update only a tune belonging to the event document', () => {
	const firstDoc = delegationDocument(), secondDoc = delegationDocument();
	const first = new StyleTune({ api: {}, block: { id: 'shared-block' }, config: { ownerDocument: firstDoc.document } });
	const second = new StyleTune({ api: {}, block: { id: 'shared-block' }, config: { ownerDocument: secondDoc.document } });
	try {
		const panel = { getAttribute: () => first.tuneId, querySelectorAll: () => [] };
		const button = {
			closest: () => panel,
			hasAttribute: (name: string) => name === 'data-tt-style-color',
			getAttribute: () => '#ff0000'
		};
		let prevented = 0;
		const event = {
			target: { closest: () => button },
			preventDefault: () => prevented++,
			stopPropagation() {}
		} as unknown as MouseEvent;
		secondDoc.listeners.forEach((listener) => listener(event));
		assert.equal(first.save(), undefined, 'a copied tune ID in another document grants no access');
		assert.equal(prevented, 0);
		firstDoc.listeners.forEach((listener) => listener(event));
		assert.equal(first.save()?.color, '#ff0000');
		assert.equal(second.save(), undefined, 'matching saved block IDs remain independent');
		assert.equal(prevented, 1);
	} finally {
		first.destroy();
		second.destroy();
	}
	assert.equal(firstDoc.listeners.size, 0);
	assert.equal(secondDoc.listeners.size, 0);
});

test('style tunes initialize independently when the browser omits randomUUID', () => {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
	const tunes: StyleTune[] = [];
	try {
		for (const crypto of [{}, undefined]) {
			Object.defineProperty(globalThis, 'crypto', { configurable: true, value: crypto });
			for (let index = 0; index < 20; index++) {
				tunes.push(new StyleTune({ api: {}, block: { id: 'same-saved-block' } }));
			}
		}
		assert.equal(new Set(tunes.map((tune) => tune.tuneId)).size, tunes.length);
		assert.ok(tunes.every((tune) => tune.save() === undefined));
	} finally {
		tunes.forEach((tune) => tune.destroy());
		if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
		else Reflect.deleteProperty(globalThis, 'crypto');
	}
});
