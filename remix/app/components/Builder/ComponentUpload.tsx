import React from 'react';
import { Box, Button, Text } from '@chakra-ui/react';
import { AttachmentComposer, type AttachmentComposerHandle } from '../Attachments/AttachmentComposer';
import type { AttachmentComposerSnapshot } from '../Attachments/attachmentTypes';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';

export const ComponentUploadEnabled = React.createContext(false);
const empty: AttachmentComposerSnapshot = { attachmentIds: [], attachments: [], blocking: false, hasSelection: false };

// Authored markup only selects a named native control. It never gets scripts,
// credentials or signed storage URLs. The saved file retains private ownership.
export function ComponentUpload(props: { name?: unknown; imageOnly?: unknown; disabled?: unknown; title?: unknown }) {
	const enabled = React.useContext(ComponentUploadEnabled);
	const user = useCurrentUser();
	if (!enabled || !user?.id)
		return <Text fontSize="sm">{enabled ? 'Sign in to upload a file.' : 'File upload (available on an interactive owned component).'}</Text>;
	return <OwnedUpload key={user.id} ownerId={user.id} {...props} />;
}

function OwnedUpload({
	ownerId,
	name,
	imageOnly,
	disabled,
	title
}: {
	ownerId: string;
	name?: unknown;
	imageOnly?: unknown;
	disabled?: unknown;
	title?: unknown;
}) {
	const api = useApi();
	const composer = React.useRef<AttachmentComposerHandle>(null);
	const [snapshot, setSnapshot] = React.useState(empty);
	const [value, setValue] = React.useState('');
	const [attachmentId, setAttachmentId] = React.useState('');
	const [busy, setBusy] = React.useState(false);
	const [showUrl, setShowUrl] = React.useState(false);
	const [error, setError] = React.useState('');
	const operation = React.useRef<{ ids: string; shareId: string } | null>(null);
	const live = React.useRef(true);
	React.useEffect(() => {
		live.current = true;
		return () => {
			live.current = false;
		};
	}, []);
	const field = typeof name === 'string' && /^[A-Za-z][\w.-]{0,79}$/.test(name) ? name : 'file';
	const save = async () => {
		if (busy || snapshot.blocking || !snapshot.attachmentIds.length) return;
		const ids = JSON.stringify(snapshot.attachmentIds);
		if (operation.current?.ids !== ids) operation.current = { ids, shareId: `component-upload-${crypto.randomUUID()}` };
		setBusy(true);
		setError('');
		try {
			let result;
			try {
				result = await api.v1.things.create({
					thingtime: ['post'],
					crystal: { text: 'Component file', type: 'post' },
					acl: ['tt:user'],
					attachmentIds: snapshot.attachmentIds,
					shareId: operation.current.shareId
				});
			} catch (failure) {
				const existing = await api.v1.things.get({ id: operation.current.shareId }).catch(() => null);
				const saved = existing?.thing;
				if (
					!saved ||
					saved.id !== operation.current.shareId ||
					JSON.stringify((saved.attachments ?? []).map((file: { id: string }) => file.id).sort()) !==
						JSON.stringify([...snapshot.attachmentIds].sort())
				)
					throw failure;
				result = existing;
			}
			if (result?.ok === false) throw new Error(result.error || 'Could not save the file.');
			composer.current?.markCommitted(snapshot.attachmentIds);
			if (!live.current) return;
			const file = snapshot.attachments[0];
			setAttachmentId(file.id);
			setValue(file.url || `/api/v1/attachments/content?id=${encodeURIComponent(file.id)}`);
		} catch (failure) {
			if (live.current) setError(failure instanceof Error ? failure.message : 'Could not save the file. Retry uses the same upload.');
		} finally {
			if (live.current) setBusy(false);
		}
	};
	return (
		<Box data-tt-native-upload onClick={(event) => event.stopPropagation()} minW={0}>
			<Text fontSize="sm">{typeof title === 'string' ? title.slice(0, 120) : imageOnly === true ? 'Upload image' : 'Upload file'}</Text>
			<AttachmentComposer
				ref={composer}
				ownerId={ownerId}
				purpose="post"
				maxFiles={1}
				imageOnly={imageOnly === true}
				disabled={disabled === true || busy}
				allowLinkedUrls={showUrl}
				onChange={setSnapshot}
				helperText="Save a private file to your account and use it in this form. Access and storage limits apply."
			/>
			<Button type="button" size="sm" variant="ghost" onClick={() => setShowUrl(!showUrl)}>
				{showUrl ? 'Hide URL option' : 'Use URL instead'}
			</Button>
			<input type="hidden" name={field} value={value} />
			<input type="hidden" name={`${field}AttachmentId`} value={attachmentId} />
			<Button
				size="sm"
				onClick={save}
				isLoading={busy}
				isDisabled={
					disabled === true ||
					snapshot.blocking ||
					!snapshot.attachmentIds.length ||
					(attachmentId !== '' && snapshot.attachmentIds[0] === attachmentId)
				}
			>
				Use file
			</Button>
			{value && (
				<Button
					size="sm"
					variant="ghost"
					onClick={() => {
						setValue('');
						setAttachmentId('');
					}}
				>
					Clear field
				</Button>
			)}
			{value && (
				<Text fontSize="sm" role="status">
					File saved privately. Clearing this field keeps the saved file in your account.
				</Text>
			)}
			{error && (
				<Text role="alert" fontSize="sm">
					{error}
				</Text>
			)}
		</Box>
	);
}
