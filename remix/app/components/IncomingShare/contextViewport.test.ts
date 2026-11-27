import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contextDockTop } from './contextViewport';

test('real WK keyboard geometry retains its occlusion independently of editor focus', () => {
 assert.equal(contextDockTop({ height: 365, offsetTop: 0 }, 152), 213);
 assert.equal(contextDockTop({ height: 734, offsetTop: 0 }, 152), 582);
});
test('CSS layout offsets preserve the WK visual pan exactly once for toolbar and Post', () => {
 const viewport = { height: 365, offsetTop: 269 };
 assert.equal(contextDockTop(viewport, 152), 482);
 assert.equal(contextDockTop(viewport, 97, 152), 385);
 const wkToolbarTop = contextDockTop(viewport, 152) - viewport.offsetTop;
 const wkActionsTop = contextDockTop(viewport, 97, 152) - viewport.offsetTop;
 assert.equal(wkToolbarTop, 213); assert.equal(wkToolbarTop + 152, viewport.height);
 assert.equal(wkActionsTop, 116); assert.equal(wkActionsTop + 97, wkToolbarTop);
});
