import React from 'react';
import { ChakraProvider, Box } from '@chakra-ui/react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { CredentialHandoff, CredentialImport } from '../app/components/CredentialImport/CredentialImport';
import { rootIdentity } from '../app/utils/rootIdentity';

function Fixture() {
	return <Box maxW="600px" padding={3} marginX="auto">
		<CredentialImport vaultConfigured onImported={() => {}} />
		<CredentialHandoff requestId="synthetic-handoff" />
		<button onClick={rootIdentity.changed}>Switch account</button>
	</Box>;
}

const router = createMemoryRouter([{ id: 'root', path: '/', Component: Fixture }], {
	hydrationData: { loaderData: { root: {
		user: { id: 'synthetic-admin', isAdmin: true },
		dataEnvironment: { id: 'development' }, dataPlane: 'home'
	} } }
});

createRoot(document.getElementById('root')!).render(<React.StrictMode><ChakraProvider><RouterProvider router={router} /></ChakraProvider></React.StrictMode>);
