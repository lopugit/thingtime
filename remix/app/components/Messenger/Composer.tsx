import React from 'react';
import { Box, Button, Flex, Popover, PopoverBody, PopoverContent, PopoverTrigger, Portal, Text, Textarea } from '@chakra-ui/react';

import { AttachmentComposer, type AttachmentComposerHandle } from '~/components/Attachments/AttachmentComposer';
import type { AttachmentComposerSnapshot, PublicAttachment } from '~/components/Attachments/attachmentTypes';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { MessengerEmojiPicker } from './MessengerEmojiPicker';
import { AgentComposerControls, type AgentComposerControlState, type AgentSendMode } from './AgentComposerControls';
import { CUSTOM_TOKEN_PREFIX, customTokenId, isCustomToken, type ChatMessage, type CustomEmoji } from './messengerTypes';
import { getUserDisplayName } from '~/utils/userIdentity';

export type ComposerProps = {
  placeholder: string;
  pickerEmojis: CustomEmoji[];
  replyTo: ChatMessage | null;
  onCancelReply: () => void;
  editing: ChatMessage | null;
  onCancelEdit: () => void;
	onSend: (submission: {
		text: string;
		requestId: string;
		attachmentIds: string[];
		attachments: PublicAttachment[];
		agentMode?: AgentSendMode;
	}) => Promise<boolean>;
  onUploadEmoji?: () => void;
  disabled?: boolean;
  disabledLabel?: string;
	agentControls?: AgentComposerControlState;
	attachmentsSupported?: boolean;
};

const EMPTY_ATTACHMENTS: AttachmentComposerSnapshot = {
	attachmentIds: [],
	attachments: [],
	blocking: false,
	hasSelection: false
};

type MessageSubmission = Parameters<ComposerProps['onSend']>[0];

// The message box: Enter sends, Shift+Enter breaks the line, the emoji button
// inserts unicode emojis or `:name:` custom tokens inline, and the same
// surface flips into edit / reply mode with a small context strip on top.
export const Composer = (props: ComposerProps) => {
	const user = useCurrentUser();
  const [text, setText] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [pickerOpen, setPickerOpen] = React.useState(false);
	const [attachmentOpen, setAttachmentOpen] = React.useState(false);
	const [attachmentSession, setAttachmentSession] = React.useState(0);
	const [attachmentSnapshot, setAttachmentSnapshot] = React.useState<AttachmentComposerSnapshot>(EMPTY_ATTACHMENTS);
	const [submissionUncertain, setSubmissionUncertain] = React.useState(false);
  const areaRef = React.useRef<HTMLTextAreaElement | null>(null);
	const attachmentRef = React.useRef<AttachmentComposerHandle | null>(null);
	const pendingSubmissionRef = React.useRef<MessageSubmission | null>(null);
  const emojiNameById = React.useMemo(() => new Map(props.pickerEmojis.map((e) => [e.id, e.name])), [props.pickerEmojis]);

  React.useEffect(() => {
    if (props.editing) {
      setText(props.editing.text);
      areaRef.current?.focus();
    }
  }, [props.editing]);

  React.useEffect(() => {
    if (props.replyTo) areaRef.current?.focus();
  }, [props.replyTo]);

  const send = async () => {
		const submission =
			pendingSubmissionRef.current ||
			({
				text: text.trim(),
				requestId: crypto.randomUUID(),
				attachmentIds: [...attachmentSnapshot.attachmentIds],
				attachments: [...attachmentSnapshot.attachments],
				...(props.agentControls?.running ? { agentMode: props.agentControls.mode } : {})
			} satisfies MessageSubmission);
		if (
			(!submission.text && !submission.attachments.length) ||
			(!pendingSubmissionRef.current && attachmentSnapshot.blocking) ||
			sending ||
			props.disabled
		)
			return;
		pendingSubmissionRef.current = submission;
    setSending(true);
		try {
			const okSend = await props.onSend(submission);
			if (okSend) {
				attachmentRef.current?.markCommitted(submission.attachmentIds);
				pendingSubmissionRef.current = null;
				setSubmissionUncertain(false);
				setText('');
				setAttachmentSnapshot(EMPTY_ATTACHMENTS);
				setAttachmentSession((session) => session + 1);
				setAttachmentOpen(false);
			} else {
				pendingSubmissionRef.current = null;
				setSubmissionUncertain(false);
			}
		} catch {
			// The server may have committed before the response was lost. Freeze the
			// exact caption, request id, and attachment set so retry is idempotent.
			setSubmissionUncertain(true);
		} finally {
    setSending(false);
    areaRef.current?.focus();
		}
  };

  const insertToken = (token: string) => {
    // custom picks land inline as :name: (rendered as the image for anyone
    // who can see that emoji); unicode lands as-is
    const insert = isCustomToken(token) ? `:${emojiNameById.get(customTokenId(token)) || 'emoji'}:` : token;
    const el = areaRef.current;
    if (!el) {
      setText((prev) => prev + insert);
      return;
    }
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    setText((prev) => prev.slice(0, start) + insert + prev.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + insert.length;
      el.setSelectionRange(caret, caret);
    });
  };

	const composerLocked = sending || submissionUncertain;
  const contextStrip = props.editing ? (
		<ContextStrip label="Editing message" onCancel={props.onCancelEdit} disabled={composerLocked} />
  ) : props.replyTo ? (
    <ContextStrip
			label={`Replying to ${props.replyTo.author ? getUserDisplayName(props.replyTo.author) : 'someone'}: ${props.replyTo.text.slice(0, 60) || '…'}`}
      onCancel={props.onCancelReply}
			disabled={composerLocked}
    />
  ) : null;

  if (props.disabled) {
    return (
      <Box padding={3} textAlign="center" fontSize="13px" color="var(--tt-muted, #9a9aa6)" whiteSpace="normal">
        {props.disabledLabel || 'You cannot send messages here'}
      </Box>
    );
  }

  return (
    <Box padding={3} paddingTop={contextStrip ? 1 : 3}>
      {contextStrip}
			{props.agentControls ? <AgentComposerControls state={props.agentControls} /> : null}
      <Flex
        align="flex-end"
        gap={2}
        background="var(--tt-surface, #fafafa)"
        border="1px solid var(--tt-border, #ececef)"
        borderRadius="var(--tt-radius-lg, 16px)"
        padding="6px 8px"
        _focusWithin={{ borderColor: 'var(--tt-accent, #a855f7)' }}
      >
				<Popover isOpen={pickerOpen} onClose={() => setPickerOpen(false)} placement="top-start" isLazy>
          <PopoverTrigger>
            <Button
              size="sm"
              variant="ghost"
              flexShrink={0}
							isDisabled={composerLocked}
              onClick={(event) => {
                // controlled Popover: block PopoverTrigger's own onToggle or an
                // open picker closes and instantly reopens
                event.preventDefault();
                setPickerOpen((open) => !open);
              }}
              title="Emoji"
            >
              😊
            </Button>
          </PopoverTrigger>
          <Portal>
            <PopoverContent zIndex={10220} width="auto" boxShadow="var(--tt-shadow-popover, 0 8px 30px rgba(0,0,0,0.12))">
              <PopoverBody padding={2}>
                <MessengerEmojiPicker
                  emojis={props.pickerEmojis}
                  onPick={(token) => insertToken(token)}
                  onUploadRequest={
                    props.onUploadEmoji
                      ? () => {
                          setPickerOpen(false);
                          props.onUploadEmoji!();
                        }
                      : undefined
                  }
                  autoFocus
                />
              </PopoverBody>
            </PopoverContent>
          </Portal>
        </Popover>
				{!props.editing && props.attachmentsSupported !== false ? (
					<Button
						size="sm"
						variant={attachmentOpen || attachmentSnapshot.hasSelection ? 'solid' : 'ghost'}
						flexShrink={0}
						isDisabled={composerLocked}
						onClick={() => setAttachmentOpen((open) => !open)}
						title="Add media or files"
						aria-label="Add media or files"
						aria-expanded={attachmentOpen}
					>
						📎
					</Button>
				) : null}
        <Textarea
          ref={areaRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
					isDisabled={composerLocked}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
						if (event.key === 'Escape' && !composerLocked) {
              if (props.editing) props.onCancelEdit();
              if (props.replyTo) props.onCancelReply();
            }
          }}
          placeholder={props.placeholder}
          rows={1}
          resize="none"
          border="none"
          _focusVisible={{ boxShadow: 'none' }}
          fontSize="14px"
          maxHeight="140px"
          paddingX={1}
          paddingY="6px"
          sx={{ fieldSizing: 'content' } as any}
        />
        <Button
          size="sm"
          onClick={send}
          isLoading={sending}
					isDisabled={
						(!submissionUncertain && !text.trim() && !attachmentSnapshot.attachments.length) || (!submissionUncertain && attachmentSnapshot.blocking)
					}
          flexShrink={0}
          background="var(--tt-accent, #a855f7)"
          color="white"
          _hover={{ opacity: 0.9 }}
          borderRadius="var(--tt-radius-pill, 999px)"
					title={submissionUncertain ? 'Retry safely' : props.editing ? 'Save edit' : 'Send'}
        >
					{submissionUncertain ? '↻' : props.editing ? '✓' : '➤'}
        </Button>
      </Flex>
			{submissionUncertain ? (
				<Text role="status" aria-live="polite" fontSize="12px" color="var(--tt-muted, #70707a)" paddingX={2} paddingTop={2} whiteSpace="normal">
					Thingtime may already have sent this. Retry safely to confirm it without creating a duplicate.
				</Text>
			) : null}
			{user && !props.editing && (attachmentOpen || attachmentSnapshot.hasSelection) ? (
				<Box paddingTop={2}>
					<AttachmentComposer
						ref={attachmentRef}
						key={`message-attachments-${user.id}-${attachmentSession}`}
						ownerId={user.id}
						purpose="message"
						ariaLabel="Message attachments"
						disabled={composerLocked}
						remainingBytes={user.storage.remainingBytes}
						storageStatus={user.storage.status}
						onChange={setAttachmentSnapshot}
					/>
				</Box>
			) : null}
    </Box>
  );
};

const ContextStrip = ({ label, onCancel, disabled }: { label: string; onCancel: () => void; disabled?: boolean }) => (
  <Flex
    align="center"
    justify="space-between"
    fontSize="12px"
    color="var(--tt-muted, #9a9aa6)"
    background="var(--tt-surface-alt, #f2f2f5)"
    borderRadius="var(--tt-radius-md, 10px)"
    paddingX={3}
    paddingY={1}
    marginBottom={2}
    gap={2}
  >
    <Box overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
      {label}
    </Box>
		<Button size="xs" variant="ghost" onClick={onCancel} flexShrink={0} isDisabled={disabled}>
      ✕
    </Button>
  </Flex>
);
