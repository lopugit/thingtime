import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChakraProvider } from '@chakra-ui/react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import ThingPage from '../app/routes/thing';
import { ThingReplicaSyncHost } from '../app/storage/ThingReplicaSyncHost';
import { ThingtimeProvider } from '../app/Providers/ThingtimeProvider';

// Only non-secret synthetic identity data is supplied by the isolated API test.
const owner = (window as unknown as { metadataFixtureOwner: Record<string, unknown> }).metadataFixtureOwner;
const ownerId = String(owner.id);
const rootData = { user: owner, dataPlane: 'home' };
const router = createBrowserRouter([{ id: 'root', path: '/thing/:id', loader: () => rootData, element: <ThingtimeProvider storageKey="metadata-isolated-acceptance" accountId={owner.id} exposeGlobals={false}>
  <ThingReplicaSyncHost ownerId={ownerId} generation={0} dataPlane="home" />
  <ThingPage /><footer style={{ padding: '24px', textAlign: 'center' }}>End of Thing</footer>
</ThingtimeProvider> }], { hydrationData: { loaderData: { root: rootData } } });
createRoot(document.getElementById('root')!).render(<ChakraProvider><RouterProvider router={router} /></ChakraProvider>);
