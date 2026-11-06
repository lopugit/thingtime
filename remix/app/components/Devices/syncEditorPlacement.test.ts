import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { SyncEditorPlacement } from './SyncEditorPlacement';

test('retained editor placement renders a safe placeholder without a browser document', () => {
 assert.equal(typeof document, 'undefined');
 assert.equal(renderToString(React.createElement(SyncEditorPlacement, { targetId: 'selected-folder', children: React.createElement('input', { defaultValue: 'Unsaved draft' }) })), '<div></div>');
});
