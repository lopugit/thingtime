import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChakraProvider } from '@chakra-ui/react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { ConnectionsPage } from '../app/components/Connections/ConnectionsPage';

const router = createBrowserRouter([{
  id: 'root',
  path: '/connections',
  loader: () => ({ user: { id: 'oauth-tab-fixture-owner', accountKind: 'user' } }),
  element: <ConnectionsPage />
}]);

createRoot(document.getElementById('root')!).render(
  <ChakraProvider><RouterProvider router={router} /></ChakraProvider>
);
