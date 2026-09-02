import React from 'react';
import { Text } from '@chakra-ui/react';

import { PageShell } from '../Layout/PageShell';

// Placeholder while the dedicated demo page lands (see the routes entry).
export const DemoDetailPage = () => (
	<PageShell width={760}>
		<Text paddingTop={12}>Loading the demo…</Text>
	</PageShell>
);
