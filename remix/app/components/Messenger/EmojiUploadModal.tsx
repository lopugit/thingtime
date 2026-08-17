import React from 'react';
import {
  Button,
  Flex,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
	ModalOverlay,
	Text
} from '@chakra-ui/react';

import { AttachmentComposer, type AttachmentComposerHandle } from '../Attachments/AttachmentComposer';
import type { AttachmentComposerSnapshot } from '../Attachments/attachmentTypes';
import { useLopu } from '../Lopu/useLopu';
import { hasUnknownMutationOutcome } from '~/hooks/apiFailure';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import type { MessengerApi } from './useMessengerApi';
import type { CustomEmoji } from './messengerTypes';

const EMPTY_ATTACHMENTS: AttachmentComposerSnapshot = {
	attachmentIds: [],
	attachments: [],
	blocking: false,
	hasSelection: false
};

// Custom emoji images use the same private multipart S3 flow and account
// storage quota as every other attachment. Legacy inline emoji remain readable
// server-side, but no new base64 blob is accepted here.
export const EmojiUploadModal = ({
  isOpen,
  onClose,
  api,
  communityId,
  communityName,
  onUploaded
}: {
  isOpen: boolean;
  onClose: () => void;
  api: MessengerApi;
  communityId: string | null;
  communityName?: string | null;
  onUploaded: (emoji: CustomEmoji) => void;
}) => {
  const lopu = useLopu();
	const user = useCurrentUser();
  const [name, setName] = React.useState('');
	const [attachments, setAttachments] = React.useState<AttachmentComposerSnapshot>(EMPTY_ATTACHMENTS);
	const [attachmentSession, setAttachmentSession] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
	const [submissionUncertain, setSubmissionUncertain] = React.useState(false);
	const attachmentRef = React.useRef<AttachmentComposerHandle | null>(null);
	const pendingSubmissionRef = React.useRef<{
		name: string;
		attachmentId: string;
		communityId?: string;
	} | null>(null);

	React.useEffect(() => {
		const filename = attachments.attachments[0]?.name;
		if (!filename || name) return;
		const base = filename
			.replace(/\.[a-z0-9]+$/i, '')
			.toLowerCase()
			.replace(/[^a-z0-9_-]+/g, '-');
		setName(base.slice(0, 32).replace(/^[-_]+|[-_]+$/g, ''));
	}, [attachments.attachments, name]);

  const reset = () => {
    setName('');
		setAttachments(EMPTY_ATTACHMENTS);
		setAttachmentSession((session) => session + 1);
    setBusy(false);
		setSubmissionUncertain(false);
		pendingSubmissionRef.current = null;
  };

  const upload = async () => {
		const currentAttachmentId = attachments.attachmentIds[0];
		const submission =
			pendingSubmissionRef.current ||
			(currentAttachmentId && name.trim()
				? {
        name: name.trim(),
						attachmentId: currentAttachmentId,
        ...(communityId ? { communityId } : {})
				  }
				: null);
		if (!submission || busy || (!pendingSubmissionRef.current && attachments.blocking)) return;
		pendingSubmissionRef.current = submission;
		setBusy(true);
		try {
			const result = await api.uploadEmoji(submission);
			attachmentRef.current?.markCommitted([submission.attachmentId]);
      lopu({ title: `:${result.emoji.name}: is ready to party 🎉`, status: 'success', duration: 6000 });
      onUploaded(result.emoji);
			window.dispatchEvent(new Event('thingtime:root-data-refresh'));
      reset();
      onClose();
    } catch (err: any) {
			if (hasUnknownMutationOutcome(err)) {
				setSubmissionUncertain(true);
				lopu({ title: 'That emoji may already be ready. Retry safely to confirm it.', status: 'info' });
			} else {
				pendingSubmissionRef.current = null;
				setSubmissionUncertain(false);
				lopu({ title: 'Thingtime could not add that emoji. Please try again.', status: 'error' });
			}
      setBusy(false);
    }
  };

	const close = () => {
		if (submissionUncertain) return;
		reset();
		onClose();
	};

  return (
		<Modal isOpen={isOpen} onClose={close} closeOnOverlayClick={!submissionUncertain} closeOnEsc={!submissionUncertain} isCentered>
      <ModalOverlay />
			<ModalContent background="var(--tt-card, #ffffff)" color="var(--tt-ink, #17171c)" borderRadius="var(--tt-radius-lg, 16px)" marginX={4}>
				<ModalHeader fontSize="16px">Upload custom emoji {communityId ? `to ${communityName || 'this community'}` : '(personal)'}</ModalHeader>
				<ModalCloseButton isDisabled={busy || submissionUncertain} />
        <ModalBody>
          <Flex direction="column" gap={3}>
						{user ? (
							<AttachmentComposer
								ref={attachmentRef}
								key={`emoji-attachment-${user.id}-${attachmentSession}`}
								ownerId={user.id}
								purpose="custom-emoji"
								maxFiles={1}
								imageOnly
								maxBytesPerFile={512 * 1024}
								allowedContentTypes={['image/gif', 'image/jpeg', 'image/png', 'image/webp']}
								ariaLabel="Custom emoji image"
								helperText="One GIF, PNG, JPEG, or WebP image · up to 512 KiB"
								disabled={busy || submissionUncertain}
								remainingBytes={user.storage.remainingBytes}
								storageStatus={user.storage.status}
								onChange={setAttachments}
            />
						) : null}
            <Flex align="center" gap={2}>
							<Flex as="span" color="var(--tt-muted, #9a9aa6)">
								:
							</Flex>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value.toLowerCase())}
								isDisabled={busy || submissionUncertain}
                placeholder="party-parrot"
                maxLength={32}
                size="sm"
                borderRadius="var(--tt-radius-md, 10px)"
              />
							<Flex as="span" color="var(--tt-muted, #9a9aa6)">
								:
							</Flex>
            </Flex>
						{submissionUncertain ? (
							<Text role="status" aria-live="polite" fontSize="12px" color="var(--tt-muted, #70707a)" whiteSpace="normal">
								Thingtime may already have added this exact emoji. Its name and image are frozen so retry cannot create a duplicate.
							</Text>
						) : null}
          </Flex>
        </ModalBody>
        <ModalFooter gap={2}>
					<Button size="sm" variant="ghost" onClick={close} isDisabled={busy || submissionUncertain}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={upload}
            isLoading={busy}
						isDisabled={
							(!submissionUncertain && !attachments.attachments.length) ||
							(!submissionUncertain && attachments.blocking) ||
							(!submissionUncertain && !name.trim())
						}
            background="var(--tt-accent, #a855f7)"
            color="white"
            _hover={{ opacity: 0.9 }}
            borderRadius="var(--tt-radius-pill, 999px)"
          >
						{submissionUncertain ? 'Retry safely ↻' : 'Upload ✨'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};
