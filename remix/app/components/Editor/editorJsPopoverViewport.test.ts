import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes this TypeScript test directly and requires the .ts extension.
import { EDITOR_JS_POPOVER_VIEWPORT_CSS_VARS, getEditorJsPopoverViewportMetrics, watchEditorJsPopoverViewport } from './editorJsPopoverViewport.ts';

class FakeEventTarget {
	private readonly listeners = new Map<string, Set<EventListener>>();

	addEventListener(type: string, listener: EventListener): void {
		const listeners = this.listeners.get(type) ?? new Set<EventListener>();
		listeners.add(listener);
		this.listeners.set(type, listeners);
	}

	removeEventListener(type: string, listener: EventListener): void {
		this.listeners.get(type)?.delete(listener);
	}

	emit(type: string): void {
		for (const listener of this.listeners.get(type) ?? []) listener(new Event(type));
	}

	listenerCount(type: string): number {
		return this.listeners.get(type)?.size ?? 0;
	}
}

class FakeVisualViewport extends FakeEventTarget {
	width = 390;
	height = 844;
	offsetLeft = 0;
	offsetTop = 0;
}

class FakeWindow extends FakeEventTarget {
	innerWidth = 390;
	innerHeight = 844;
	visualViewport = new FakeVisualViewport();
	private nextFrame = 1;
	private readonly frames = new Map<number, FrameRequestCallback>();

	requestAnimationFrame(callback: FrameRequestCallback): number {
		const id = this.nextFrame++;
		this.frames.set(id, callback);
		return id;
	}

	cancelAnimationFrame(id: number): void {
		this.frames.delete(id);
	}

	flushAnimationFrames(): void {
		const frames = [...this.frames.values()];
		this.frames.clear();
		for (const callback of frames) callback(0);
	}

	queuedFrameCount(): number {
		return this.frames.size;
	}
}

class FakeStyle {
	readonly values = new Map<string, string>();

	setProperty(property: string, value: string): void {
		this.values.set(property, value);
	}

	removeProperty(property: string): string {
		const previous = this.values.get(property) ?? '';
		this.values.delete(property);
		return previous;
	}
}

const fakeHolder = () => ({ style: new FakeStyle() });

test('uses the whole layout viewport when VisualViewport is unavailable', () => {
	assert.deepEqual(getEditorJsPopoverViewportMetrics({ layoutWidth: 390, layoutHeight: 844 }), {
		left: 0,
		top: 0,
		width: 390,
		height: 844,
		bottomInset: 0
	});
});

test('converts a pinched or keyboard-shrunk visual viewport into fixed-position insets', () => {
	const metrics = getEditorJsPopoverViewportMetrics({
		layoutWidth: 390,
		layoutHeight: 844,
		visualViewport: { width: 320, height: 500, offsetLeft: 35, offsetTop: 100 }
	});

	assert.deepEqual(metrics, { left: 35, top: 100, width: 320, height: 500, bottomInset: 244 });
	const gap = 8;
	const resolvedBottom = 844 - metrics.bottomInset - gap;
	const resolvedHeight = Math.min(270, metrics.height - gap * 2);
	assert.ok(resolvedBottom <= metrics.top + metrics.height);
	assert.ok(resolvedBottom - resolvedHeight >= metrics.top);
});

test('clamps malformed and out-of-layout viewport values safely', () => {
	assert.deepEqual(
		getEditorJsPopoverViewportMetrics({
			layoutWidth: 390,
			layoutHeight: 844,
			visualViewport: { width: 999, height: Number.NaN, offsetLeft: -50, offsetTop: 999 }
		}),
		{ left: 0, top: 0, width: 390, height: 844, bottomInset: 0 }
	);
});

test('shares viewport listeners, batches updates, and cleans up every CSS variable', () => {
	const fakeWindow = new FakeWindow();
	const first = fakeHolder();
	const second = fakeHolder();
	const cleanupFirst = watchEditorJsPopoverViewport(first as unknown as HTMLElement, fakeWindow as unknown as Window);
	const cleanupFirstDuplicate = watchEditorJsPopoverViewport(first as unknown as HTMLElement, fakeWindow as unknown as Window);
	const cleanupSecond = watchEditorJsPopoverViewport(second as unknown as HTMLElement, fakeWindow as unknown as Window);
	const cssVars = EDITOR_JS_POPOVER_VIEWPORT_CSS_VARS;

	assert.equal(fakeWindow.listenerCount('resize'), 1);
	assert.equal(fakeWindow.visualViewport.listenerCount('resize'), 1);
	assert.equal(fakeWindow.visualViewport.listenerCount('scroll'), 1);
	assert.equal(first.style.values.get(cssVars.bottomInset), '0px');
	assert.equal(second.style.values.get(cssVars.height), '844px');

	fakeWindow.visualViewport.height = 360;
	fakeWindow.visualViewport.offsetTop = 20;
	fakeWindow.visualViewport.emit('resize');
	fakeWindow.visualViewport.emit('scroll');
	assert.equal(fakeWindow.queuedFrameCount(), 1);
	fakeWindow.flushAnimationFrames();
	assert.equal(first.style.values.get(cssVars.height), '360px');
	assert.equal(second.style.values.get(cssVars.bottomInset), '464px');

	cleanupFirst();
	cleanupFirst();
	assert.notEqual(first.style.values.size, 0);
	assert.equal(fakeWindow.listenerCount('resize'), 1);
	cleanupFirstDuplicate();
	assert.equal(first.style.values.size, 0);
	assert.equal(fakeWindow.listenerCount('resize'), 1);
	cleanupSecond();
	assert.equal(second.style.values.size, 0);
	assert.equal(fakeWindow.listenerCount('resize'), 0);
	assert.equal(fakeWindow.visualViewport.listenerCount('resize'), 0);
	assert.equal(fakeWindow.visualViewport.listenerCount('scroll'), 0);
});
