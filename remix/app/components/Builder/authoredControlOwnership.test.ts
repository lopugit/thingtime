import assert from 'node:assert/strict';
import test from 'node:test';
import { ownsAuthoredControl } from './authoredControlOwnership';
function fixture() {
	const main: any = {};
	const boundary: any = { ownerDocument: main, contains: (node: any) => node === boundary || node === owned };
	const owned: any = { ownerDocument: main };
	return { main, boundary, owned };
}
test('authored events accept owned same-document controls and actual nested viewport portals', () => {
	const { main, boundary, owned } = fixture();
	assert.equal(ownsAuthoredControl(boundary, owned), true);
	const frameDoc: any = { defaultView: { frameElement: owned } };
	const nestedDoc: any = { defaultView: { frameElement: { ownerDocument: frameDoc } } };
	assert.equal(ownsAuthoredControl(boundary, { ownerDocument: frameDoc } as Element), true);
	assert.equal(ownsAuthoredControl(boundary, { ownerDocument: nestedDoc } as Element), true);
	assert.equal(ownsAuthoredControl(boundary, { ownerDocument: main } as Element), false);
});
test('unrelated, inaccessible and cyclic document chains do not acquire surface ownership', () => {
	const { boundary, main } = fixture();
	assert.equal(ownsAuthoredControl(boundary, { ownerDocument: { defaultView: { frameElement: { ownerDocument: main } } } } as any), false);
	assert.equal(ownsAuthoredControl(boundary, { ownerDocument: { defaultView: null } } as any), false);
	const blocked: any = {};
	Object.defineProperty(blocked, 'frameElement', {
		get() {
			throw Error('Cross-origin frame');
		}
	});
	assert.equal(ownsAuthoredControl(boundary, { ownerDocument: { defaultView: blocked } } as any), false);
	const doc: any = {};
	doc.defaultView = { frameElement: { ownerDocument: doc } };
	assert.equal(ownsAuthoredControl(boundary, { ownerDocument: doc } as any), false);
});

test('nested live surfaces own their controls while ordinary expanded fields retain their surrounding surface', () => {
	const { boundary, owned } = fixture();
	const nested: any = { contains: (node: any) => node === nested || node === owned };
	owned.closest = () => nested;
	assert.equal(ownsAuthoredControl(boundary, owned), false);
	assert.equal(ownsAuthoredControl(nested, owned), true);
	nested.contains = (node: any) => node === nested || node === boundary;
	assert.equal(ownsAuthoredControl(boundary, owned), true);
});
