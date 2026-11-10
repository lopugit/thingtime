import React from 'react';
import { AttachmentComposer, type AttachmentComposerHandle } from '../Attachments/AttachmentComposer';
import { PostAttachments } from '../Attachments/PostAttachments';
import { normalizePublicAttachment } from '../Attachments/attachmentUiCore';
import type { AttachmentComposerSnapshot } from '../Attachments/attachmentTypes';
import { ComponentUploadEnabled } from './ComponentUpload';
import { ComponentLocalControl } from './NativeComponentControls';
import { useCurrentUser } from '~/hooks/useCurrentUser';

const empty: AttachmentComposerSnapshot = { attachmentIds: [], attachments: [], blocking: false, hasSelection: false };
type Props = {
	name?: unknown;
	purpose?: unknown;
	targetId?: unknown;
	maxFiles?: unknown;
	imageOnly?: unknown;
	title?: unknown;
	helperText?: unknown;
	allowLinkedUrls?: unknown;
	readyStateKey?: unknown;
	committedTargetId?: unknown;
	committedIds?: unknown;
	disabled?: unknown;
};
// Uploads are account-owned drafts. The surrounding saved Action chooses the
// target and commits the IDs; failed writes leave the same drafts available.
export function ComponentAttachments(props: Props) {
	const enabled = React.useContext(ComponentUploadEnabled),
		user = useCurrentUser();
	if (!enabled || !user?.id) return <p>{enabled ? 'Sign in to add attachments.' : 'Attachments (available on an interactive component).'}</p>;
	return <AttachmentField key={JSON.stringify([user.id, props.targetId, props.purpose])} {...props} ownerId={user.id} />;
}
function AttachmentField({
	ownerId,
	name,
	purpose,
	targetId,
	maxFiles,
	imageOnly,
	title,
	helperText,
	allowLinkedUrls,
	readyStateKey,
	committedTargetId,
	committedIds,
	disabled
}: Props & { ownerId: string }) {
	const composer = React.useRef<AttachmentComposerHandle>(null);
	const [snapshot, setSnapshot] = React.useState(empty);
	const [committed, setCommitted] = React.useState(false);
	const local = React.useContext(ComponentLocalControl);
	const localRef = React.useRef(local);
	localRef.current = local;
	const ready = disabled !== true && !committed && !snapshot.blocking && snapshot.attachmentIds.length > 0;
	React.useEffect(() => {
		if (typeof readyStateKey === 'string') localRef.current?.({ op: 'set', key: readyStateKey, value: ready });
	}, [readyStateKey, ready]);
	const field = typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(name) ? name : 'attachmentIds';
	const ids = JSON.stringify(snapshot.attachmentIds);
	const saved = JSON.stringify(Array.isArray(committedIds) ? committedIds : []);
	React.useEffect(() => {
		const submitted = JSON.parse(ids) as string[];
		if (typeof targetId !== 'string' || committedTargetId !== targetId || !submitted.length) return;
		if (saved !== ids) return;
		composer.current?.markCommitted(submitted);
		setCommitted(true);
	}, [targetId, committedTargetId, ids, saved]);
	const limit = typeof maxFiles === 'number' && Number.isInteger(maxFiles) ? Math.max(1, Math.min(50, maxFiles)) : 12;
	return (
		<div
			data-tt-native-upload
			data-tt-upload-blocking={snapshot.blocking ? 'true' : 'false'}
			style={{ minWidth: 0 }}
			onClick={(event) => event.stopPropagation()}
		>
			<AttachmentComposer
				ref={composer}
				ownerId={ownerId}
				purpose={purpose === 'post' ? 'post' : 'comment'}
				maxFiles={limit}
				imageOnly={imageOnly === true}
				disabled={disabled === true || committed}
				onChange={setSnapshot}
				ariaLabel={typeof title === 'string' ? title.slice(0, 120) : 'Add attachments'}
				allowLinkedUrls={allowLinkedUrls !== false}
				helperText={typeof helperText === 'string' ? helperText.slice(0, 2000) : 'Choose files, then use the form’s save action.'}
			/>
			<input type="hidden" name={field} value={snapshot.attachmentIds.join(',')} disabled={disabled === true} />
			{committed ? <p role="status">Attachments saved. Start another entry to add more.</p> : null}
		</div>
	);
}

export function ComponentMedia({ attachments, postId }: { attachments?: unknown; postId?: unknown }) {
	if (!Array.isArray(attachments)) return null;
	if (attachments.length > 50) return <p role="alert">Page the media source to display at most 50 attachments at a time.</p>;
	const list = attachments.map(normalizePublicAttachment).filter((item): item is NonNullable<typeof item> => !!item);
	return <PostAttachments attachments={list} postId={typeof postId === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(postId) ? postId : undefined} />;
}
