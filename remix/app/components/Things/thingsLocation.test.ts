import assert from 'node:assert/strict';
import test from 'node:test';
import { readThingsLocation, writeThingsLocation, thingBrowseHref, readLibraryDestination, homeLibraryHref, thingInspectHref } from './thingsLocation';
import { isPlainLinkClick, safeMenuHref } from '~/utils/linkNavigation';
import { characterContentPath } from '../Characters/characterContentPath';

test('Things location round-trips searches and every view preference', () => {
  const original = new URLSearchParams('q=audio+%26+notes&view=list&display=preview&sort=name-desc&group=kind&kind=post&folder=parent&device=mac&preview=item&extra=keep');
  const state = readThingsLocation(original);
  assert.deepEqual(state, { q: 'audio & notes', view: 'list', display: 'preview', sort: 'name-desc', group: 'kind', kind: 'post' });
  assert.equal(writeThingsLocation(original, state).toString(), original.toString());
  const next = writeThingsLocation(original, { ...state, q: '' });
  assert.equal(next.has('q'), false);
  for (const key of ['folder', 'device', 'preview', 'extra']) assert.equal(next.get(key), original.get(key));
  assert.equal(original.get('q'), 'audio & notes');
});

test('Back restores explicit preferences even after the local cache changes', () => {
  const first = writeThingsLocation(new URLSearchParams('q=before'), readThingsLocation(new URLSearchParams('q=before'), { view: 'list', sort: 'name' }));
  const later = writeThingsLocation(first, { ...readThingsLocation(first), q: 'after', view: 'columns', kind: 'folder' });
  assert.equal(readThingsLocation(later).q, 'after');
  const restored = readThingsLocation(first, { view: 'columns', sort: 'oldest' });
  assert.equal(restored.q, 'before'); assert.equal(restored.view, 'list'); assert.equal(restored.sort, 'name');
});

test('invalid URL options are bounded and normalized without trusting stale preferences', () => {
  const state = readThingsLocation(new URLSearchParams('view=invalid&sort=invalid&group=invalid&kind=invalid&display=invalid'), { view: 'list' });
  assert.deepEqual(state, { q: '', view: 'grid', display: 'name', sort: 'newest', group: 'none', kind: 'all' });
});

test('folder links carry view rules into a new tab without overwriting the search history entry', () => {
  const search = 'q=recording&folder=old&view=list&sort=name&kind=all&device=mac&preview=post';
  const href = new URL(thingBrowseHref({ id: 'new', thingtime: ['folder'] }, search), 'https://thingtime.test');
  assert.equal(href.searchParams.get('folder'), 'new');
  assert.equal(href.searchParams.get('view'), 'list');
  assert.equal(href.searchParams.get('sort'), 'name');
  for (const key of ['q', 'device', 'preview']) assert.equal(href.searchParams.has(key), false);
  assert.equal(new URLSearchParams(search).get('q'), 'recording');
});

test('archive links retain their dedicated read-only mode and the Things referrer', () => {
  assert.equal(thingBrowseHref({ id: 'archive', thingtime: ['chat-archive'] }), '/thing/archive?archive=true&from=things');
});

test('Character navigation retains scope and URL state without qualifying account or external links', () => {
  assert.equal(characterContentPath('/post/id?key=read#comment','actor/a'),'/post/id?key=read&character=actor%2Fa#comment');
  assert.equal(characterContentPath('/history?character=old&character=older','actor'),'/history?character=actor');
  for(const href of ['/settings','/login','/api/v1/things','https://example.test/post/id','//example.test/post/id','/\\example.test/post/id','#reply','/posters'])
    assert.equal(characterContentPath(href,'actor'),href);
  assert.equal(characterContentPath('/things',null),'/things');
  for(const kind of ['post','data','folder','attachment']) {
    const href=new URL(thingBrowseHref({id:'item',thingtime:[kind]},'?character=actor&view=list'),'https://thingtime.test');
    assert.equal(href.searchParams.get('character'),'actor');
  }
  const home=homeLibraryHref('actor')+'&character=actor';
  const inspected=new URL(thingInspectHref('item',home.split('?')[1]),'https://thingtime.test');
  assert.equal(inspected.searchParams.get('historyOwner'),'actor');
  assert.equal(inspected.searchParams.get('dataPlane'),'home');
  assert.equal(inspected.searchParams.get('character'),'actor');
});

test('native link modifiers, middle clicks and prevented events are never hijacked', () => {
  const plain = { button: 0, defaultPrevented: false, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };
  assert.equal(isPlainLinkClick(plain), true);
  for (const key of ['defaultPrevented', 'metaKey', 'ctrlKey', 'altKey', 'shiftKey']) assert.equal(isPlainLinkClick({ ...plain, [key]: true }), false);
  for (const button of [1, 2]) assert.equal(isPlainLinkClick({ ...plain, button }), false);
});

test('menu links allow real destinations but reject executable or malformed protocols', () => {
  for (const href of ['/things?q=hello%20world', '#details', 'https://thingtime.test/thing/123', 'mailto:hello@example.test']) assert.equal(safeMenuHref(href), href);
  for (const href of ['javascript:alert(1)', 'data:text/html,test', '//evil.test', '/\\evil.test', 'java\nscript:alert(1)', ' /things']) assert.equal(safeMenuHref(href), undefined);
});


test('home library links preserve destination through folders and qualify detail identity', () => {
  const home = new URL(homeLibraryHref('owner'), 'https://thingtime.test');
  assert.equal(readLibraryDestination(home.searchParams, {id:'owner'}), 'home');
  const folder = new URL(thingBrowseHref({id:'same',thingtime:['folder']}, home.search), home);
  assert.equal(folder.searchParams.get('workspaceOwner'), 'owner');
  assert.equal(folder.searchParams.get('localPlane'), 'home');
  const detail = new URL(thingBrowseHref({id:'same',thingtime:['data']}, folder.search), home);
  assert.equal(detail.searchParams.get('dataPlane'), 'home');
  assert.equal(detail.searchParams.get('historyOwner'), 'owner');
  assert.equal(thingInspectHref('same', folder.search), detail.pathname + detail.search);
  assert.equal(thingInspectHref('same'), '/thing/same?from=things');
  assert.equal(readLibraryDestination(new URLSearchParams(), {id:'owner'}), 'selected');
  for (const owner of [null, {id:'other'}, {id:'owner',localOnly:true as const}])
    assert.equal(readLibraryDestination(home.searchParams, owner), 'invalid');
  for (const query of ['localPlane=unknown&workspaceOwner=owner','localPlane=home','workspaceOwner=owner',
    'localPlane=home&localPlane=home&workspaceOwner=owner','localPlane=home&workspaceOwner=owner&workspaceOwner=owner'])
    assert.equal(readLibraryDestination(new URLSearchParams(query), {id:'owner'}), 'invalid');
});
