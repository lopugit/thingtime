import assert from 'node:assert/strict';
import test from 'node:test';
import { nativePhotoProgressLifecycle } from './nativePhotoProgressLifecycle';

test('focus without visibilitychange invalidates stale active lease before authoritative read and retains counts', () => {
 const window = new EventTarget(), document = new EventTarget();
 const counts = { photos: 47, bytes: 73_200_000 };
 let view = { active: true, stale: false, counts };
 let currentOwner = 'owner', reads = 0;
 const stop = nativePhotoProgressLifecycle({ window, document, visible: () => true,
  invalidate: () => { view = { ...view, stale: true }; }, hidden: () => {},
  refresh: () => {
   assert.equal(view.stale, true, 'Prior active certainty must be invalidated before an async read');
   assert.equal(view.counts, counts, 'Historical confirmed counts remain painted');
   if (currentOwner === 'owner') { reads++; view = { ...view, active: false, stale: false }; }
  } });
 window.dispatchEvent(new Event('focus'));
 assert.equal(reads, 1); assert.equal(view.active, false); assert.equal(view.counts.photos, 47);
 currentOwner = 'other'; window.dispatchEvent(new Event('pageshow'));
 assert.equal(view.stale, true, 'A different owner cannot restore previous active certainty');
 assert.equal(reads, 1);
 stop(); window.dispatchEvent(new Event('focus')); assert.equal(reads, 1);
});

test('hiding invalidates current status and stops pending reads without refreshing a hidden page', () => {
 const window = new EventTarget(), document = new EventTarget();
 let visible = false, stale = false, hidden = 0, reads = 0;
 const stop = nativePhotoProgressLifecycle({ window, document, visible: () => visible,
  invalidate: () => { stale = true; }, hidden: () => { hidden++; }, refresh: () => { reads++; } });
 document.dispatchEvent(new Event('visibilitychange'));
 assert.equal(stale, true); assert.equal(hidden, 1); assert.equal(reads, 0);
 visible = true; window.dispatchEvent(new Event('focus')); assert.equal(reads, 1);
 stop();
});
