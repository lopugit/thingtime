import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes this TypeScript test directly and requires the .ts extension.
import {
  catalogEntryFrom,
  componentTrustFor,
  entryToCardSource,
  parseSourceBindingParams,
  parseSourceInputsJson,
  pickActiveSource,
  sourceBindingToParams,
  type BrowseComponentEntry,
  type ComponentCardSource
} from './componentBrowseTypes.ts';

const entry = (overrides: Partial<BrowseComponentEntry> & { id: string }): BrowseComponentEntry => ({
  thingtime: ['component'],
  author: null,
  visibility: 'public',
  acl: ['tt:all'],
  targetId: null,
  crystal: { name: overrides.id, render: { tag: 'div' } },
  tags: [],
  createdAt: '',
  updatedAt: '',
  reactionCounts: {},
  viewerReactions: [],
  saved: false,
  usageCount: 0,
  ...overrides
});

const suites = (componentKey: string): string | null => {
  for (const key of ['pokeworld', 'guestbook']) {
    if (componentKey.startsWith(`app-${key}-`) || componentKey.startsWith(`demo-${key}-`)) return key;
  }
  return null;
};

// ---- trust ladder -----------------------------------------------------------

test('componentTrustFor: the viewer owns their own thing, whatever its id', () => {
  const own = { id: 'abc123', componentKey: 'app-pokeworld-hud', entry: { author: { id: 'u1', username: 'me', displayName: null, avatarUrl: null } } };
  assert.deepEqual(componentTrustFor(own, 'u1', suites), { trust: 'owner', suiteKey: 'pokeworld' });
  assert.equal(componentTrustFor(own, 'u2', suites).trust, 'stranger');
  assert.equal(componentTrustFor(own, null, suites).trust, 'stranger');
});

test('componentTrustFor: a seeded suite part needs the reserved id AND a registered suite', () => {
  const seeded = { id: 'component-app-pokeworld-hud', componentKey: 'app-pokeworld-hud', entry: { author: null } };
  assert.deepEqual(componentTrustFor(seeded, 'u1', suites), { trust: 'seeded', suiteKey: 'pokeworld' });
  assert.deepEqual(componentTrustFor(seeded, null, suites), { trust: 'seeded', suiteKey: 'pokeworld' });
  // a demo-/app- slug whose suite is not registered is not platform-curated
  const unknownSuite = { id: 'component-app-mystery-hud', componentKey: 'app-mystery-hud', entry: { author: null } };
  assert.equal(componentTrustFor(unknownSuite, 'u1', suites).trust, 'stranger');
  // no author but no reserved prefix either — never trusted from markup
  const noPrefix = { id: 'xyz', componentKey: 'app-pokeworld-hud', entry: { author: null } };
  assert.equal(componentTrustFor(noPrefix, 'u1', suites).trust, 'stranger');
});

test('componentTrustFor: a plain platform library component is seeded with no suite', () => {
  const library = { id: 'component-antd-button', componentKey: 'antd-button', entry: { author: null } };
  assert.deepEqual(componentTrustFor(library, 'u1', suites), { trust: 'seeded', suiteKey: null });
  const stranger = { id: 'k9', componentKey: 'antd-button', entry: { author: { id: 'u9', username: 'them', displayName: null, avatarUrl: null } } };
  assert.equal(componentTrustFor(stranger, 'u1', suites).trust, 'stranger');
});

// ---- active design selection ----------------------------------------------

const sourcesFor = (entries: BrowseComponentEntry[]): ComponentCardSource[] =>
  entries.map(entryToCardSource).filter(Boolean) as ComponentCardSource[];

test('pickActiveSource prefers the viewer’s own twin of the URL key ahead of the seeded copy', () => {
  const sources = sourcesFor([
    entry({ id: 'component-app-pokeworld-hud', crystal: { name: 'HUD', render: { tag: 'div' }, componentKey: 'app-pokeworld-hud', library: 'thingtime' } }),
    entry({
      id: 'zz-own',
      author: { id: 'u1', username: 'me', displayName: null, avatarUrl: null },
      crystal: { name: 'HUD (mine)', render: { tag: 'div' }, componentKey: 'app-pokeworld-hud', library: 'thingtime' }
    })
  ]);
  assert.equal(pickActiveSource(sources, { design: '', key: 'app-pokeworld-hud', viewerId: 'u1' })?.id, 'zz-own');
  assert.equal(pickActiveSource(sources, { design: '', key: 'app-pokeworld-hud', viewerId: 'u2' })?.id, 'component-app-pokeworld-hud');
  assert.equal(pickActiveSource(sources, { design: '', key: 'component-app-pokeworld-hud', viewerId: null })?.id, 'component-app-pokeworld-hud');
  // an explicit design id wins over ownership; a library picks the own copy of that library
  assert.equal(pickActiveSource(sources, { design: 'component-app-pokeworld-hud', key: 'app-pokeworld-hud', viewerId: 'u1' })?.id, 'component-app-pokeworld-hud');
  assert.equal(pickActiveSource(sources, { design: 'thingtime', key: 'app-pokeworld-hud', viewerId: 'u1' })?.id, 'zz-own');
  assert.equal(pickActiveSource([], { design: '', key: 'x', viewerId: null }), null);
});

test('catalogEntryFrom is a system-owned public entry the trust ladder reads as seeded', () => {
  const seeded = catalogEntryFrom('component-demo-guestbook-signer', { name: 'Signer', render: { tag: 'div' }, componentKey: 'demo-guestbook-signer' });
  const source = entryToCardSource(seeded);
  assert.ok(source);
  assert.equal(source!.origin, 'platform');
  assert.deepEqual(componentTrustFor(source!, 'u1', suites), { trust: 'seeded', suiteKey: 'guestbook' });
});

// ---- URL source binding ---------------------------------------------------

test('parseSourceBindingParams reads a bounded binding from the query and ignores junk', () => {
  assert.equal(parseSourceBindingParams(new URLSearchParams('')), null);
  assert.equal(parseSourceBindingParams(new URLSearchParams('source=Not%20A%20Key')), null);
  assert.deepEqual(parseSourceBindingParams(new URLSearchParams('source=app-pokeworld-state')), { action: 'app-pokeworld-state', refresh: 'load' });
  assert.deepEqual(parseSourceBindingParams(new URLSearchParams('source=app-starsalign-today&refresh=manual')), {
    action: 'app-starsalign-today',
    refresh: 'manual'
  });
  // interval is clamped to the runtime gate; unknown refresh modes fall back to load
  const interval = parseSourceBindingParams(new URLSearchParams('source=demo-guestbook-list&refresh=interval&interval=10'));
  assert.equal(interval?.refresh, 'interval');
  assert.equal(interval?.intervalMs, 5000);
  assert.equal(parseSourceBindingParams(new URLSearchParams('source=x&refresh=bogus'))?.refresh, 'load');
  // inputs must be a scalar object; a bad blob is dropped rather than poisoning the binding
  assert.deepEqual(parseSourceBindingParams(new URLSearchParams(`source=x&inputs=${encodeURIComponent('{"id":"{query.id}","n":2}')}`))?.inputs, {
    id: '{query.id}',
    n: 2
  });
  assert.equal(parseSourceBindingParams(new URLSearchParams('source=x&inputs=[1]'))?.inputs, undefined);
});

test('sourceBindingToParams round-trips and keeps the design param', () => {
  const params = new URLSearchParams('design=antd');
  const written = sourceBindingToParams(params, { action: 'app-pokeworld-state', refresh: 'interval', intervalMs: 20_000, inputs: { id: 'p1' } });
  assert.equal(written.get('design'), 'antd');
  assert.deepEqual(parseSourceBindingParams(written), { action: 'app-pokeworld-state', refresh: 'interval', intervalMs: 20_000, inputs: { id: 'p1' } });
  // load is the default and is not written; clearing removes every source key
  assert.equal(sourceBindingToParams(params, { action: 'x' }).toString(), 'design=antd&source=x');
  assert.equal(sourceBindingToParams(written, null).toString(), 'design=antd');
  assert.equal(sourceBindingToParams(written, { action: 'NOPE' }).toString(), 'design=antd');
});

test('parseSourceInputsJson accepts scalar objects only', () => {
  assert.deepEqual(parseSourceInputsJson('  '), { ok: true, inputs: undefined });
  assert.deepEqual(parseSourceInputsJson('{}'), { ok: true, inputs: undefined });
  assert.deepEqual(parseSourceInputsJson('{"a":"b","c":1,"d":true}'), { ok: true, inputs: { a: 'b', c: 1, d: true } });
  assert.equal(parseSourceInputsJson('{"a":{"nested":1}}').ok, false);
  assert.equal(parseSourceInputsJson('{"bad key":1}').ok, false);
  assert.equal(parseSourceInputsJson('not json').ok, false);
  assert.equal(parseSourceInputsJson('[1,2]').ok, false);
});
