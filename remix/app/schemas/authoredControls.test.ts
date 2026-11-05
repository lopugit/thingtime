import assert from 'node:assert/strict';
import test from 'node:test';
import { AUTHORED_CONTROL_REQUIREMENTS, usesAuthoredControls } from './authoredControls';
import { sanitizeActionCrystal, sanitizeWebpageBlocks } from './registry';
import { validateRunInputs } from '../api/utils/actions/actionInputs';
import { capabilitySatisfies } from '../api/utils/capabilities/capabilityContract';

test('typed Actions accept more than sixteen distinct inputs through save and execution validation', () => {
	const inputs = Array.from({ length: 40 }, (_, index) => ({ name: `field${index}`, type: 'json' }));
	const result = sanitizeActionCrystal({ name: 'Many fields', inputs, steps: [{ op: 'return', value: '$input.field39' }] });
	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.equal((result.crystal.inputs as unknown[]).length, 40);
	const validated = validateRunInputs(result.crystal.inputs as Record<string, unknown>[], { field39: { kind: 'rich-text', blocks: [] } });
	assert.equal(validated.ok, true);
	assert.equal(sanitizeActionCrystal({ name: 'Duplicate', inputs: [...inputs, inputs[0]], steps: [{ op: 'return', value: null }] }).ok, false);
});
test('both new intrinsic boundaries and editable child slots survive the stored page gate', () => {
	const result = sanitizeWebpageBlocks([{ id: 'menu', type: 'element', tag: 'tt-menu', props: { contextMenu: true }, children: [
		{ id: 'target', type: 'element', tag: 'div', props: { 'data-tt-menu-slot': 'target' }, children: [{ id: 'primary', type: 'element', tag: 'button', text: 'Primary' }] },
		{ id: 'content', type: 'element', tag: 'div', props: { 'data-tt-menu-slot': 'content' }, children: [{ id: 'editor', type: 'element', tag: 'tt-rich-text', props: { name: 'document', plainTextName: 'text', value: { kind: 'rich-text', blocks: [] } } }] }
	] }]);
	assert.equal(result.ok, true);
	if (result.ok) assert.equal(result.blocks[0].children?.[1].children?.[0].tag, 'tt-rich-text');
});
test('new authored contract discovery is cycle-safe and requirements reject old or breaking servers', () => {
	const cycle: any = { children: [] }; cycle.children.push(cycle);
	assert.equal(usesAuthoredControls(cycle), false);
	assert.equal(usesAuthoredControls({ render: { tag: 'tt-rich-text' } }), true);
	assert.equal(usesAuthoredControls({ inputs: Array.from({ length: 17 }, () => ({})) }), true);
	for (const minimum of Object.values(AUTHORED_CONTROL_REQUIREMENTS)) {
		assert.equal(capabilitySatisfies(minimum, minimum), true);
		assert.equal(capabilitySatisfies('1.0.0', minimum), false);
		assert.equal(capabilitySatisfies('2.0.0', minimum), false);
	}
});
test('valid large shared arrays do not become function argument limits during discovery', () => {
	const rows: unknown[] = Array(200_000).fill(0);
	assert.equal(usesAuthoredControls({ rows }), false);
	rows[0] = { tag: 'tt-rich-text' };
	assert.equal(usesAuthoredControls({ rows }), true);
});
