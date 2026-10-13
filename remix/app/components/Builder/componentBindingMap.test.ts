import assert from 'node:assert/strict';
import test from 'node:test';
import { buildComponentsByRef } from './WebpageBlocksRenderer';
import { bindingsForBlocks } from '../../timeline/componentBindings';
test('component ref maps preserve explicit unavailable prototype-shaped names for capture', () => {
 const components = buildComponentsByRef({ components: [], refs: JSON.parse('{"__proto__":null,"constructor":null}') });
 assert.equal(Object.getPrototypeOf(components), null);
 const binding = bindingsForBlocks([{ type: 'component', component: '__proto__' }, { type: 'component', component: 'constructor' }], components);
 assert.deepEqual(Object.keys(binding), ['__proto__', 'constructor']);
 assert.equal(binding.__proto__, null); assert.equal(binding.constructor, null);
});
