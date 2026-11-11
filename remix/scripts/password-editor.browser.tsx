import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChakraProvider } from '@chakra-ui/react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { CurrentPageBuilderFixture } from './lib/CurrentPageBuilderFixture';
import { PasswordManager } from '../app/components/Passwords/PasswordManager';
const router = createBrowserRouter([{ id: 'root', path: '/passwords', loader: () => ({ user: { id: 'password-editor-fixture', accountKind: 'user' }, dataPlane: 'home' }), element: <CurrentPageBuilderFixture><PasswordManager /></CurrentPageBuilderFixture> }]);
createRoot(document.getElementById('root')!).render(<ChakraProvider><RouterProvider router={router} /></ChakraProvider>);
