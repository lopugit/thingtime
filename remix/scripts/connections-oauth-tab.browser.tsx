import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChakraProvider } from '@chakra-ui/react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { rootIdentity } from '../app/utils/rootIdentity';
import { ConnectionsPage } from '../app/components/Connections/ConnectionsPage';

let owner: string | null = 'oauth-tab-fixture-owner';
const router = createBrowserRouter([{
  id: 'root',
  path: '/connections',
  loader: () => ({ user: owner ? { id: owner, accountKind: 'user' } : null, dataPlane: 'home' }),
  element: <ConnectionsPage />
}]);

Object.assign(window, {
  async changeFixtureConnectionOwner(next: string | null) {
    rootIdentity.changed();
    const { generation } = rootIdentity.read();
    owner = next;
    await router.revalidate();
    rootIdentity.confirm(generation);
  }
});

createRoot(document.getElementById('root')!).render(
  <ChakraProvider><RouterProvider router={router} /></ChakraProvider>
);
