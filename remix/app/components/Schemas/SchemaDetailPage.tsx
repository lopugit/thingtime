import React from 'react';
import { Text } from '@chakra-ui/react';

import { PageShell } from '../Layout/PageShell';

// Placeholder while the dedicated schema page lands (see the routes entry).
export const SchemaDetailPage = () => (
	<PageShell width={760}>
		<Text paddingTop={12}>Loading the schema…</Text>
	</PageShell>
);
