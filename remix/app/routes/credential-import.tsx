import { Box } from '@chakra-ui/react';
import { useSearchParams } from 'react-router';
import { CredentialHandoff } from '~/components/CredentialImport/CredentialImport';

export default function CredentialImportRoute() {
	const [params] = useSearchParams();
	const ids = params.getAll('requestId');
	return <Box as="main" width="100%" maxW="640px" marginX="auto" padding={{ base: 3, md: 6 }}>
		<CredentialHandoff requestId={ids.length === 1 ? ids[0] : ''} />
	</Box>;
}
