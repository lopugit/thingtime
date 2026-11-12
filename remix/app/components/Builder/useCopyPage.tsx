import React from 'react';
import { Button, Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalFooter, Text } from '@chakra-ui/react';
import { useNavigate } from 'react-router';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { copyPage } from './copyPage';

// The shared page supplies only the button. The platform owns the disclosure,
// copy request and account boundary; no foreign Action executes at this stage.
export function useCopyPage({ id, linkKey, name }: { id?: string; linkKey?: string; name?: string }) {
	const user = useCurrentUser();
	const navigate = useNavigate();
	// eslint-disable-next-line react-hooks/exhaustive-deps -- opaque page/viewer boundary, including A to B to A transitions
	const identity = React.useMemo(() => ({}), [id, linkKey, user?.id]);
	const current = React.useRef(identity);
	current.current = identity;
	const pending = React.useRef<{ identity: object; resolve: (ok: boolean) => void; abort: AbortController; copying: boolean } | null>(null);
	const [dialog, setDialog] = React.useState<{ identity: object; copying: boolean; error: string } | null>(null);
	const cancel = React.useCallback(() => {
		const request = pending.current;
		pending.current = null;
		request?.abort.abort();
		request?.resolve(false);
		setDialog(null);
	}, []);
	React.useEffect(() => {
		return () => {
			const request = pending.current;
			if (request?.identity !== identity) return;
			pending.current = null;
			request.abort.abort();
			request.resolve(false);
		};
	}, [identity]);
	const requestCopy = React.useCallback((): Promise<boolean> => {
		if (!id || pending.current) return Promise.resolve(false);
		if (!user?.id) {
			navigate('/login');
			return Promise.resolve(false);
		}
		return new Promise((resolve) => {
			pending.current = { identity, resolve, abort: new AbortController(), copying: false };
			setDialog({ identity, copying: false, error: '' });
		});
	}, [id, identity, navigate, user?.id]);
	const confirm = async () => {
		const request = pending.current;
		if (!id || !user?.id || !request || request.copying || request.identity !== current.current) return;
		request.copying = true;
		setDialog({ identity, copying: true, error: '' });
		try {
			const href = await copyPage({ id, ...(linkKey ? { key: linkKey } : {}) }, {
				actorId: user.id,
				current: () => pending.current === request && current.current === request.identity,
				signal: request.abort.signal
			});
			if (!href) return;
			pending.current = null;
			setDialog(null);
			request.resolve(true);
			navigate(href);
		} catch (error) {
			if (pending.current !== request || current.current !== request.identity) return;
			request.copying = false;
			setDialog({ identity, copying: false, error: error instanceof Error ? error.message : 'Could not copy this page' });
		}
	};
	const visible = dialog?.identity === identity ? dialog : null;
	return {
		requestCopy,
		dialog: (
			<Modal isOpen={!!visible} onClose={cancel} isCentered closeOnOverlayClick={!visible?.copying} closeOnEsc={!visible?.copying}>
				<ModalOverlay />
				<ModalContent margin={4} width="calc(100% - 48px)" maxWidth="28rem" maxHeight="calc(100dvh - 32px)" overflowY="auto">
					<ModalHeader>Make an editable copy</ModalHeader>
					<ModalBody display="grid" gap={3}>
						<Text>Copy {name || 'this page'} and its referenced Components, Actions, and Data privately into your account.</Text>
						<Text>Saved Actions will run as you when you open your copy. Only copy apps you trust. Connected records keep their existing access rules.</Text>
						{visible?.error ? <Text role="alert">{visible.error}</Text> : null}
					</ModalBody>
					<ModalFooter gap={3} flexWrap="wrap">
						<Button variant="ghost" onClick={cancel} isDisabled={visible?.copying}>Cancel</Button>
						<Button onClick={() => void confirm()} isLoading={visible?.copying} loadingText="Copying">Copy and open</Button>
					</ModalFooter>
				</ModalContent>
			</Modal>
		)
	};
}
