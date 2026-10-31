import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/tt-boot.js', import.meta.url), 'utf8');
const guard = 'tt-chunk-reload';
const moduleFailure = { target: { tagName: 'SCRIPT', type: 'module', src: 'https://app.test/assets/index.js' } };

const createRuntime = ({ stored = new Map(), content = false, denied = false, bodyReady = true } = {}) => {
	const listeners = new Map();
	let reloads = 0;
	const element = () => ({ style: {}, children: [], setAttribute() {}, addEventListener(name, handler) { this[name] = handler; }, append(...children) { this.children.push(...children); } });
	const root = { ...element(), hasChildNodes() { return content || this.children.length > 0; } };
	const location = { href: 'https://app.test/p/fixture?key=not-logged', origin: 'https://app.test', hostname: 'app.test', reload() { reloads++; } };
	const window = {
		location,
		localStorage: { getItem() { return null; } },
		get sessionStorage() {
			if (denied) throw new Error('Storage denied');
			return { getItem: (key) => stored.get(key), setItem: (key, value) => stored.set(key, value) };
		},
		addEventListener: (name, handler) => listeners.set(name, handler)
	};
	const document = { createElement: element, getElementById: () => bodyReady ? root : null, addEventListener: (name, handler) => listeners.set(name, handler) };
	vm.runInNewContext(source, { window, document, URL, Date });
	return { root, stored, listeners, reloads: () => reloads, fail: (event = moduleFailure) => listeners.get('error')(event), bodyReady: () => { bodyReady = true; listeners.get('DOMContentLoaded')?.(); } };
};

test('entry and lazy chunk recovery share a durable one-reload guard', () => {
	const stale = readFileSync(new URL('../app/utils/staleChunkRecovery.ts', import.meta.url), 'utf8');
	assert.ok(stale.includes(`STALE_CHUNK_RELOAD_KEY = '${guard}'`));
	const first = createRuntime();
	first.fail();
	first.fail();
	assert.equal(first.reloads(), 1);
	assert.ok(first.stored.has(guard));
	const second = createRuntime({ stored: first.stored });
	second.fail();
	assert.equal(second.reloads(), 0);
	assert.equal(second.root.children[0].id, 'tt-boot-recovery');
	second.root.children[0].children[0].children[2].click();
	assert.equal(second.reloads(), 1, 'A user can explicitly retry');
});

test('unavailable session storage offers manual recovery without an automatic loop', () => {
	const runtime = createRuntime({ denied: true });
	runtime.fail();
	assert.equal(runtime.reloads(), 0);
	assert.equal(runtime.root.children[0].id, 'tt-boot-recovery');
});

test('existing optimistic content and unrelated resource failures remain untouched', () => {
	for (const event of [
		{ target: { tagName: 'IMG', src: '/missing.png' } },
		{ target: { tagName: 'SCRIPT', type: '', src: '/optional.js' } },
		{ target: { tagName: 'SCRIPT', type: 'module', src: 'https://other.test/optional.js' } },
		{ message: 'An unrelated application error' }
	]) {
		const runtime = createRuntime();
		runtime.fail(event);
		assert.equal(runtime.reloads(), 0);
		assert.equal(runtime.root.children.length, 0);
	}
	const runtime = createRuntime({ content: true });
	runtime.fail();
	assert.equal(runtime.reloads(), 0);
	assert.equal(runtime.stored.size, 0);
	assert.equal(runtime.root.children.length, 0);
});

test('an early error waits for the root without overwriting rendered content', () => {
	const runtime = createRuntime({ denied: true, bodyReady: false });
	runtime.fail();
	assert.equal(runtime.root.children.length, 0);
	runtime.bodyReady();
	assert.equal(runtime.root.children[0].id, 'tt-boot-recovery');
});

test('the early recovery script is loaded before the application module', () => {
	const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
	assert.ok(html.indexOf('src="/tt-boot.js"') < html.indexOf('src="/app/entry.client.tsx"'));
});
