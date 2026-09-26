import assert from 'node:assert/strict';
import test from 'node:test';
import { WEB_FEATURES } from './catalogue';
import { featureRecipe } from './recipes';
import { DOM_RECEIVER_POLICY } from './domBridge';

const members = (names: string) => names.split(' ').filter(Boolean);
const union = (pick: (policy: (typeof DOM_RECEIVER_POLICY)[string]) => string[]) =>
	new Set(Object.values(DOM_RECEIVER_POLICY).flatMap(pick));
const reads = union((p) => members(p.reads));
const writes = union((p) => members(p.writes || ''));
const calls = union((p) => Object.keys(p.calls || {}));

/** The bridge resolves a request against this table on the frame thread, so a
 * catalogue member it does not register ends the run instead of demonstrating
 * the feature. Recipes and the policy are authored separately; pin the join. */
test('every catalogue DOM request names a member the receiver policy registers', () => {
	const requested = new Map<string, string>();
	const collect = (value: unknown, id: string) => {
		if (!value || typeof value !== 'object') return;
		const node = value as { op?: unknown; action?: unknown; key?: unknown };
		if (node.op === 'dom') requested.set(`${node.action}:${node.key || ''}`, id);
		for (const item of Object.values(value)) collect(item, id);
	};
	for (const f of WEB_FEATURES) collect(featureRecipe(f).program.steps, f.id);
	assert.ok(requested.size > 40, `expected broad DOM coverage, saw ${requested.size} distinct operations`);
	for (const [request, id] of requested) {
		const [action, key] = request.split(':');
		if (action === 'document') {
			assert.equal(key, '', `${id}: a document request carries no member name`);
			continue;
		}
		const registry = action === 'get' ? reads : action === 'set' ? writes : calls;
		assert.ok(registry.has(key), `${id}: DOM ${action} of ${key} is not registered in DOM_RECEIVER_POLICY`);
	}
	// Writable members must also be readable, or an example cannot show its effect.
	for (const key of writes) assert.ok(reads.has(key), `${key} is writable but never readable`);
});

test('registered DOM members fit the compiler and bridge request envelope', () => {
	for (const [name, policy] of Object.entries(DOM_RECEIVER_POLICY)) {
		const read = members(policy.reads);
		const write = members(policy.writes || '');
		const method = Object.keys(policy.calls || {});
		for (const key of [...read, ...write, ...method]) {
			// compiler.ts gates node.key with this pattern; domBridge caps key length at 60.
			assert.match(key, /^[A-Za-z_][A-Za-z0-9_]{0,60}$/, `${name}.${key}`);
		}
		assert.equal(new Set(read).size, read.length, `${name} repeats a readable member`);
		for (const key of write) assert.ok(read.includes(key), `${name}.${key} is writable but not readable`);
		// A name resolved as both a property and a method is ambiguous to the bridge.
		for (const key of method) assert.ok(!read.includes(key), `${name}.${key} is both a property and a method`);
	}
});
