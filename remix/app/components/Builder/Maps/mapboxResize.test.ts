import assert from 'node:assert/strict';
import test from 'node:test';
import { observeMapboxContainer } from './mapboxResize';

test('map canvas follows container width changes and coalesces resize frames', () => {
	const container = {} as HTMLElement;
	let callback: ResizeObserverCallback | undefined;
	let observed: Element | undefined;
	let disconnected = false;
	const frames = new Map<number, FrameRequestCallback>();
	let nextFrame = 0;
	let resized = 0;
	class Observer {
		constructor(receive: ResizeObserverCallback) { callback = receive; }
		observe(target: Element) { observed = target; }
		disconnect() { disconnected = true; }
	}
	const stop = observeMapboxContainer(container, { resize: () => { resized++; } }, {
		Observer: Observer as unknown as typeof ResizeObserver,
		requestFrame: (run) => { const id = ++nextFrame; frames.set(id, run); return id; },
		cancelFrame: (id) => { frames.delete(id); }
	});
	const emit = (width: number, height = 520) => {
		assert(callback);
		callback([{ target: container, contentRect: { width, height } } as unknown as ResizeObserverEntry], {} as ResizeObserver);
	};
	const flush = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach((run) => run(0)); };
	assert.equal(observed, container);
	emit(260);
	emit(560);
	assert.equal(frames.size, 1);
	flush();
	assert.equal(resized, 1);
	emit(560);
	assert.equal(frames.size, 0);
	emit(400);
	flush();
	assert.equal(resized, 2);
	emit(600);
	stop();
	assert(disconnected);
	assert.equal(frames.size, 0);
	assert.equal(resized, 2);
});
