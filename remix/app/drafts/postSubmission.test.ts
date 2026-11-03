import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';

// Execute the production submit handler, including both reconciliation paths.
const source = ts.createSourceFile('PostComposer.tsx', readFileSync(new URL('../components/Feed/PostComposer.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler = '';
function visit(node: ts.Node) {
	if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'handlePost') handler = node.initializer!.getText(source);
	ts.forEachChild(node, visit);
}
visit(source);
assert.ok(handler);
const js = ts.transpileModule(`(${handler})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const never = () => new Promise<void>(() => {});
function fixture(flush: () => Promise<void>, retire: () => Promise<void>) {
	const requests: any[] = [], notifications: any[] = [], posted: any[] = [], captures: any[] = [];
	const pending = { current: null as any };
	const doc = { kind: 'rich-text', blocks: [{ type: 'paragraph', data: { text: 'Exact latest text' } }] };
	let failPost = false;
	const context = {
		valid: true, posting: false, attachmentSnapshot: { blocking: false, attachmentIds: [], attachments: [] },
		setPosting: () => {}, setThingModalOpen: () => {}, postEditorValue: doc, pendingPostSubmissionRef: pending,
		capturePostEditorValue: async () => doc, postTextEditorRef: { current: null }, setPostEditorValue: () => {},
		accountDraft: { capture: (value: any) => captures.push(value), flush, retire }, draftContent: {}, draftSnapshot: '{}',
		draftAttachments: [], crypto: { randomUUID }, type: 'text', blocksToText: () => 'Exact latest text', showListing: false,
		composerAttachments: [], layoutSpans: {}, layoutMode: 'auto', parsedTags: [], isComment: false, isEdit: false,
		user: { id: 'fixture-owner' }, visibility: 'private', postTitle: '', subspaceId: null, showPhotos: false,
		clonePostJson: (value: unknown) => structuredClone(value), lopu: (value: any) => notifications.push(value),
		reset: () => { pending.current = null; }, onPosted: (value: any) => posted.push(value),
		api: { v1: { things: {
			create: async (payload: any) => { requests.push(payload); if (failPost) throw { unknown: true }; return { post: { id: payload.shareId } }; },
			get: async () => { throw new Error('unavailable'); }
		} } },
		withPostRequestDeadline: (fn: any) => fn(), matchesCommittedPostCreate: () => false,
		hasUnknownMutationOutcome: (error: any) => !!error.unknown,
		shouldFreezeAmbiguousPostSubmission: (unknown: boolean, _status: number, prior: boolean) => unknown || prior,
		setSubmissionUncertain: () => {}, apiErrorMessage: () => 'uncertain', setTimeout: (fn: () => void) => { fn(); }
	};
	return { context, run: runInNewContext(js, context), requests, posted, captures, notifications, pending, fail: (value: boolean) => { failPost = value; } };
}
for (const failure of ['rejected', 'stalled'] as const) test(`posting completes with ${failure} draft saving and cleanup`, async () => {
	const fail = failure === 'stalled' ? never : async () => { throw new Error('Draft unavailable'); };
	const f = fixture(fail, fail);
	await f.run();
	assert.equal(f.requests.length, 1);
	assert.equal(f.posted.length, 1);
	assert.equal(f.requests[0].text, 'Exact latest text');
	assert.equal(JSON.parse(f.captures[0].snapshot).pendingSubmission.shareId, f.requests[0].shareId);
	assert.ok(f.notifications.some(value => value.status === 'success'));
});
test('draft failure cannot replace the frozen identity or payload after uncertain posting', async () => {
	const f = fixture(async () => { throw new Error('Draft unavailable'); }, async () => {});
	f.fail(true);
	await f.run();
	const frozen = structuredClone(f.pending.current);
	assert.equal(frozen.unknownOutcome, true);
	f.fail(false);
	await f.run();
	assert.deepEqual(f.requests[0], f.requests[1]);
	assert.equal(f.posted.length, 1);
	assert.equal(f.posted[0].id, frozen.shareId);
});

for (const mode of ['edit', 'rich-comment']) test(`${mode} completion is independent of draft sync`, async () => {
	const f = fixture(never, never);
	const context = f.context as any;
	if (mode === 'edit') {
		context.isEdit = true;
		context.editPost = { id: 'existing-fixture-post' };
		context.editAttachmentOrderChanged = false;
		context.api.v1.things.update = async (payload: any) => { f.requests.push(payload); return { post: { id: payload.id } }; };
	} else {
		context.isComment = true;
		context.parentId = 'fixture-parent';
		context.api.v1.things.comment = async (payload: any) => { f.requests.push(payload); return { comment: { id: payload.shareId } }; };
	}
	await f.run();
	assert.equal(f.posted.length, 1);
	assert.equal(f.requests.length, 1);
});
