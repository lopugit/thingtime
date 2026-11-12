import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeUploadMayContinue, trackNativeUploadBackground } from './nativeUploadBackground';
test('only acknowledged background authority survives visibility; cancellation and terminal callbacks cannot resurrect it', () => {
	const controller = new AbortController(),
		a = trackNativeUploadBackground(controller.signal),
		b = trackNativeUploadBackground(controller.signal);
	assert.equal(nativeUploadMayContinue(controller.signal), false);
	a.set(true);
	b.set(true);
	a.dispose();
	a.set(true);
	assert.equal(nativeUploadMayContinue(controller.signal), true);
	b.set(false);
	assert.equal(nativeUploadMayContinue(controller.signal), false);
	b.set(true);
	controller.abort();
	assert.equal(nativeUploadMayContinue(controller.signal), false);
	b.dispose();
	b.set(true);
	assert.equal(nativeUploadMayContinue(controller.signal), false);
});
