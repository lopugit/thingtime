import assert from 'node:assert/strict';
import test from 'node:test';
import { composerDraftReducer as reduce, EMPTY_COMPOSER_DRAFT, LOPU_MAX_MESSAGE_CHARS, type ComposerDraft } from './composerDictation';

const dictate = (state: ComposerDraft, captureId: string, text: string) => reduce(state, { type: 'dictate', transcript: { captureId, text } });

test('partial revisions and cumulative final segments replace the same capture without duplicates', () => {
	let draft = reduce(EMPTY_COMPOSER_DRAFT, { type: 'edit', value: 'My note:' });
	draft = dictate(draft, 'one', 'buy');
	assert.equal(draft.text, 'My note: buy');
	draft = dictate(draft, 'one', 'buy milk');
	draft = dictate(draft, 'one', 'buy milk and bread');
	assert.equal(draft.text, 'My note: buy milk and bread');
	assert.equal(dictate(draft, 'one', '').text, draft.text);
});

test('a resumed capture appends after the stopped partial and any manual correction', () => {
	let draft = dictate(EMPTY_COMPOSER_DRAFT, 'one', 'Keep these words');
	draft = reduce(draft, { type: 'edit', value: text => text + '\nEdited:' });
	draft = dictate(draft, 'two', 'and these');
	draft = dictate(draft, 'two', 'and these words too');
	assert.equal(draft.text, 'Keep these words\nEdited: and these words too');
});

test('a new recognition capture retains the previous utterance and whitespace', () => {
	let draft = dictate(EMPTY_COMPOSER_DRAFT, 'one', 'First sentence.');
	draft = dictate(draft, 'two', 'Second sentence.');
	assert.equal(draft.text, 'First sentence. Second sentence.');
	draft = reduce(draft, { type: 'edit', value: 'Typed\n' });
	assert.equal(dictate(draft, 'three', 'on a new line').text, 'Typed\non a new line');
});

test('send/reset removes prior capture ownership; rejected sends can restore their draft', () => {
	let draft = dictate(EMPTY_COMPOSER_DRAFT, 'one', 'Ready to send');
	draft = reduce(draft, { type: 'edit', value: '' });
	assert.deepEqual(draft, EMPTY_COMPOSER_DRAFT);
	draft = reduce(draft, { type: 'edit', value: current => current || 'Ready to send' });
	assert.equal(dictate(draft, 'two', 'with more detail').text, 'Ready to send with more detail');
});

test('dictation respects the same length limit as typing without erasing the typed prefix', () => {
	const draft = reduce(EMPTY_COMPOSER_DRAFT, { type: 'edit', value: 'Typed prefix' });
	const full = dictate(draft, 'one', 'x'.repeat(LOPU_MAX_MESSAGE_CHARS));
	assert.equal(full.text.length, LOPU_MAX_MESSAGE_CHARS);
	assert.ok(full.text.startsWith('Typed prefix '));
	assert.equal(dictate(full, 'two', 'extra').text, full.text);
});
