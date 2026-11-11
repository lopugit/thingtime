import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChakraProvider } from '@chakra-ui/react';
import { createBrowserRouter, RouterProvider, useRouteLoaderData } from 'react-router';
import { CurrentPageBuilderFixture } from './lib/CurrentPageBuilderFixture';
import { rootIdentity } from '../app/utils/rootIdentity';
import { PasswordManagerScope } from '../app/components/Passwords/PasswordManager';
import { bindLocalWorkspace } from '../app/local-workspace/runtime.client';
let owner: string | null = 'password-editor-fixture';
function FixtureAccountEditor() {
  const data = useRouteLoaderData('root') as { user: { id: string } | null };
  return <CurrentPageBuilderFixture>{data.user && <PasswordManagerScope key={data.user.id} ownerId={data.user.id} />}</CurrentPageBuilderFixture>;
}
const router = createBrowserRouter([{ id: 'root', path: '/passwords', loader: () => {
  const { generation } = rootIdentity.read();
  bindLocalWorkspace(!owner, generation, owner ? { kind: 'account', origin: location.origin, ownerId: owner, dataPlane: 'home' } : undefined, false);
  rootIdentity.confirm(generation);
  return { user: owner ? { id: owner, accountKind: 'user' } : null, dataPlane: 'home' };
}, element: <FixtureAccountEditor /> }]);
Object.assign(window, { async changeFixturePasswordOwner(next: string | null) { rootIdentity.changed(); const { generation } = rootIdentity.read(); owner = next; await router.revalidate(); rootIdentity.confirm(generation); } });
createRoot(document.getElementById('root')!).render(<ChakraProvider><RouterProvider router={router} /></ChakraProvider>);
