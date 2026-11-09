import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChakraProvider } from '@chakra-ui/react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import ThingPage from '../app/routes/thing';
import { ThingtimeProvider } from '../app/Providers/ThingtimeProvider';

// Only non-secret synthetic identity data is supplied by the isolated API test.
const owner = (window as unknown as { metadataFixtureOwner: Record<string, unknown> }).metadataFixtureOwner;
const router = createBrowserRouter([{ id: 'root', path: '/thing/:id', element: <ThingtimeProvider storageKey="metadata-isolated-acceptance" accountId={owner.id} exposeGlobals={false}>
  <ThingPage /><footer style={{ padding: '24px', textAlign: 'center' }}>End of Thing</footer>
</ThingtimeProvider> }], { hydrationData: { loaderData: { root: { user: owner, dataPlane: 'home' } } } });
createRoot(document.getElementById('root')!).render(<ChakraProvider><RouterProvider router={router} /></ChakraProvider>);
