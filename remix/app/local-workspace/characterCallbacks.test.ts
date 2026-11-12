import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { CharacterScope } from '../components/Characters/CharacterScope';
import { useAsyncFetcher } from '../hooks/useAsyncFetcher';
import { bindLocalWorkspace } from './runtime.client';
import { rootIdentity } from '../utils/rootIdentity';

test('the real submit hook retires retained explicit and composer Character callbacks before HTTP', async () => {
 const previousFetch = globalThis.fetch;
 let requests = 0;
 globalThis.fetch = async () => { requests++; throw Error('A retired callback must not send HTTP'); };
 const scope = { kind: 'account', origin: 'https://character-callback.example', ownerId: 'owner', dataPlane: 'home' } as const;
 const callbacks: ReturnType<typeof useAsyncFetcher>[] = [];
 const routers: ReturnType<typeof createMemoryRouter>[] = [];
 function Probe() { callbacks.push(useAsyncFetcher()); return null; }
 const render = (character = false) => {
  const element = character
   ? React.createElement(CharacterScope.Provider, { value: { id: 'character' } as any }, React.createElement(Probe))
   : React.createElement(Probe);
  const router = createMemoryRouter([{ id: 'root', path: '/', element }], { hydrationData: { loaderData: { root: { dataPlane: 'home' } } } });
  routers.push(router); renderToString(React.createElement(RouterProvider, { router }));
 };
 try {
  rootIdentity.confirm(rootIdentity.read().generation);
  bindLocalWorkspace(false, rootIdentity.read().generation, scope);
  render(); render(true);
  assert.equal(callbacks.length, 2);
  rootIdentity.changed(); rootIdentity.confirm(rootIdentity.read().generation);
  bindLocalWorkspace(false, rootIdentity.read().generation, { ...scope, ownerId: 'next-owner' });
  await assert.rejects(callbacks[0].submit({ text: 'Old explicit actor' }, { action: '/api/v1/things', characterId: 'character' }), /workspace changed/i);
  await assert.rejects(callbacks[1].submit({ text: 'Old composer actor' }, { action: '/api/v1/things' }), /workspace changed/i);
  assert.equal(requests, 0, 'not even capability discovery may borrow the new session');
 } finally {
  routers.forEach(router => router.dispose());
  bindLocalWorkspace(true, rootIdentity.read().generation);
  globalThis.fetch = previousFetch;
 }
});
