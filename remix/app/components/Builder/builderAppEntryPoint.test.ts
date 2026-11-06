import assert from 'node:assert/strict';
import test from 'node:test';
import { builderAppAdditionalMetadata, builderAppMetadata, builderAppEntryPointHref, builderAppEntryPointId, builderAppLaunchHref, resolveBuilderAppEntryPoint } from './builderAppNavigation';
import type { ThingsThing } from '../Things/thingsCore';
const app = (metadata: unknown = { entryPointThingId: 'home-page' }): ThingsThing => ({ id: 'app-a', folderId: null, thingtime: ['folder', 'builder-thing'], crystal: { builderApp: true, metadata }, author: { id: 'owner', username: 'owner', displayName: null, avatarUrl: null }, visibility: 'private', acl: ['tt:user'], targetId: null, extended: null, tags: [], createdAt: '', updatedAt: '' } as ThingsThing);
const page = { id: 'home-page', thingtime: ['webpage'], crystal: {} } as ThingsThing;

test('app primary links resolve the saved entry point while ordinary folders and Things retain their navigation', () => {
  assert.equal(builderAppEntryPointId(app({ entryPageId: 'legacy-page', entryUrl: 'https://ignored.invalid' })), 'legacy-page');
  assert.equal(builderAppEntryPointId(app({ entryPointThingId: 'canonical-page', entryPageId: 'legacy-page' })), 'canonical-page');
  assert.equal(builderAppLaunchHref(app()), '/builder?app=app-a');
  assert.equal(builderAppLaunchHref({ ...app(), folderId: 'parent' }), null);
  assert.equal(builderAppLaunchHref({ ...app(), crystal: {} }), null);
  assert.equal(builderAppLaunchHref(page), null);
  assert.equal(builderAppEntryPointHref(app(), page), '/p/home-page');
});

test('the app and target are independently authorized before navigation, without writes or Action execution', async () => {
  const reads: string[] = [];
  const href = await resolveBuilderAppEntryPoint('app-a', async id => { reads.push(id); return { ok: true, thing: id === 'app-a' ? app() : page }; });
  assert.equal(href, '/p/home-page');
  assert.deepEqual(reads, ['app-a', 'home-page']);
  reads.length = 0;
  await assert.rejects(resolveBuilderAppEntryPoint('app-a', async id => { reads.push(id); return { ok: false }; }), /app is unavailable/);
  assert.deepEqual(reads, ['app-a']);
  await assert.rejects(resolveBuilderAppEntryPoint('app-a', async id => id === 'app-a' ? { ok: true, thing: app() } : { ok: false, status: 403 }), /missing or unavailable/);
});

test('unset metadata browses contents; malformed, executable and folder-cycle declarations fail explicitly', async () => {
  for (const metadata of [{}, null, { entryPointThingId: '' }]) {
    assert.equal(await resolveBuilderAppEntryPoint('app-a', async () => ({ ok: true, thing: app(metadata) })), '/builder?folder=app-a&kind=all');
  }
  for (const value of [false, 7, {}, ['home-page'], 'https://evil.test', '//evil', '/p/home-page', 'javascript:run()', ' home-page']) {
    assert.throws(() => builderAppEntryPointId(app({ entryPointThingId: value })), /saved Thing ID/);
  }
  assert.throws(() => builderAppEntryPointHref(app(), app()), /rather than an app or folder/);
  assert.throws(() => builderAppEntryPointHref(app(), { ...app(), id: 'another-app' }), /rather than an app or folder/);
  assert.throws(() => builderAppEntryPointHref(app(), { ...page, thingtime: ['data'] }), /no live presentation/);
  assert.equal(builderAppEntryPointHref(app(), { ...page, id: 'action-a', thingtime: ['action'] }), '/actions/action-a');
});


test('the entry setting and additional metadata have one unambiguous owner', () => {
  const additional = builderAppAdditionalMetadata(app({ entryPointThingId: 'home', entryPageId: 'legacy', namespace: 'sample', entryUrl: '/ignored' }));
  assert.deepEqual(additional, { namespace: 'sample', entryUrl: '/ignored' });
  assert.deepEqual(builderAppMetadata(additional, 'new-page'), { namespace: 'sample', entryUrl: '/ignored', entryPointThingId: 'new-page' });
  assert.deepEqual(builderAppMetadata(additional, ''), additional);
  for (const key of ['entryPointThingId', 'entryPageId']) assert.throws(() => builderAppMetadata({ [key]: '' }, 'old-page'), /Entry point setting/);
});
