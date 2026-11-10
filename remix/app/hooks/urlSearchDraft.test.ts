import assert from 'node:assert/strict';
import test from 'node:test';
import { UrlSearchDraft, withSearchQuery } from './urlSearchDraft';

const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();

test('a delayed local URL echo preserves newer typing and commits it next', () => {
  const draft = new UrlSearchDraft('', normalize);
  draft.edit('q28');
  assert.equal(draft.commit('first'), 'q28');
  draft.edit('q27');
  assert.equal(draft.observe('q28', 'first', 'REPLACE'), 'q27');
  assert.equal(draft.commit('second'), 'q27');
  assert.equal(draft.observe('q27', 'second', 'REPLACE'), 'q27');
  assert.equal(draft.commit('redundant'), null);
});

test('back/forward and external replacement cancel a stale pending search', () => {
  for (const navigation of ['POP', 'REPLACE', 'PUSH']) {
    const draft = new UrlSearchDraft('initial', normalize);
    draft.edit('pending');
    assert.equal(draft.observe('external', undefined, navigation), 'external');
    assert.equal(draft.commit('stale-timer'), null);
  }
});

test('POP to a previously written location is external even if its token is pending', () => {
  const draft = new UrlSearchDraft('', normalize);
  draft.edit('q28');
  draft.commit('old-location');
  draft.edit('q27');
  assert.equal(draft.observe('q28', 'old-location', 'POP'), 'q28');
  assert.equal(draft.commit('stale-timer'), null);
});

test('filter replacements preserve typing; reset clears it even when committed q is empty', () => {
  const draft = new UrlSearchDraft('', normalize);
  draft.edit('pending');
  assert.equal(draft.observe('', undefined, 'REPLACE'), 'pending');
  draft.edit('');
  assert.equal(draft.observe('', undefined, 'REPLACE'), '');
  assert.equal(draft.commit('stale-timer'), null);
});

test('debounced commits preserve current nonquery URL fields and remove blank searches', () => {
  const draft = new UrlSearchDraft('', normalize);
  draft.edit('  latest   text  ');
  const latestSearch = '?source=device&category=system&unread=1&since=2026-10-01&until=2026-10-27';
  const next = withSearchQuery(latestSearch, 'q', draft.commit('search')!);
  assert.equal(next.get('q'), 'latest text');
  next.delete('q');
  assert.equal(next.toString(), new URLSearchParams(latestSearch).toString());
  assert.equal(withSearchQuery('?source=device&q=old&unread=1', 'q', '').toString(), 'source=device&unread=1');
});

test('acknowledgements without newer edits normalize displayed draft text', () => {
  const draft = new UrlSearchDraft('', normalize);
  draft.edit('  words   here ');
  assert.equal(draft.commit('normalize'), 'words here');
  assert.equal(draft.observe('words here', 'normalize', 'REPLACE'), 'words here');
});
