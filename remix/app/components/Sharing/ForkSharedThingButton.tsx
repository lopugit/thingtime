import React from 'react';
import { Button } from '@chakra-ui/react';
import { useNavigate } from 'react-router';
import { useWorkspaceUser } from '~/hooks/useWorkspaceUser';
import { useApi } from '~/hooks/useApi';
import { useLopu } from '~/components/Lopu/useLopu';

export const ForkSharedThingButton = ({ id, linkKey, webpage = false }: { id: string; linkKey?: string; webpage?: boolean }) => {
	const user = useWorkspaceUser();
	const api = useApi();
	const navigate = useNavigate();
	const lopu = useLopu();
	const [busy, setBusy] = React.useState(false);
	const inFlight = React.useRef(false);
	const copy = async () => {
		if (inFlight.current) return;
		if (!user?.id) {
			lopu({ title: 'Workspace is not ready', description: 'Please retry when your workspace is available.', status: 'info' });
			return;
		}
		inFlight.current = true;
		setBusy(true);
		try {
			await requireThingtimeCapability('api.things-fork', '1.7.1');
			const response = await fetch('/api/v1/things/fork', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...(linkKey ? { key: linkKey } : {}) }) });
			const data = await response.json();
			if (!response.ok || !data?.ok) throw new Error(data?.error || 'Could not copy this app');
			lopu({ title: 'Your private copy is ready ✨', description: 'You can edit it without changing the original.', status: 'success' });
			navigate(webpage ? `/builder?page=${encodeURIComponent(data.id)}` : `/thing/${encodeURIComponent(data.id)}`);
		} catch (error) {
			lopu({ title: 'Could not finish the copy', description: error instanceof Error ? error.message : 'Please try again.', status: 'error' });
		} finally { inFlight.current = false; setBusy(false); }
	};
	return <Button size="xs" variant="outline" maxWidth="100%" whiteSpace="normal" height="auto" minHeight={6} background="white" color="gray.700" borderColor="gray.300" _hover={{ background: 'gray.50' }} onClick={copy} isLoading={busy} loadingText="Copying…" aria-busy={busy} data-testid="fork-shared-thing">Copy to my {webpage ? 'Builder' : 'Things'}</Button>;
};
