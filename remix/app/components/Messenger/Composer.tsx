import { useDesktopUpdateBlocker } from '~/utils/useDesktopUpdateBlocker';
import React from 'react';
import { chatAttachmentInput } from '../Attachments/chatAttachmentInput';
import { Box, Button, Flex, Popover, PopoverBody, PopoverContent, PopoverTrigger, Portal, Text, Textarea } from '@chakra-ui/react';

import { AttachmentComposer, type AttachmentComposerHandle } from '~/components/Attachments/AttachmentComposer';
import type { AttachmentComposerSnapshot, PublicAttachment } from '~/components/Attachments/attachmentTypes';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { MessengerEmojiPicker } from './MessengerEmojiPicker';
import { useEmojiPickerDraft } from '../Emoji/useEmojiPickerDraft';
import { DRAWER_POPUP_Z } from '../Nav/Drawer/useDrawer';
import { AgentComposerControls, type AgentComposerControlState, type AgentSendMode } from './AgentComposerControls';
import { CUSTOM_TOKEN_PREFIX, customTokenId, isCustomToken, type ChatMessage, type CustomEmoji } from './messengerTypes';
import { getUserDisplayName } from '~/utils/userIdentity';

import { ComposerDraftAdmission, sharedMessageRequestId, type ComposerInitialDraft } from './composerInitialDraft';
export type { ComposerInitialDraft } from './composerInitialDraft';

export type ComposerProps = {
  initialDraft?: ComposerInitialDraft;
  active?: boolean;
  onSent?: () => void;
  initialSubmission?: MessageSubmission;
  beforeSubmit?: (targetId: string, operationId: string, payload: Record<string, unknown>) => Promise<void>;
  targetId: string;
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

export type MessageSubmission = Parameters<ComposerProps['onSend']>[0];

// The message box: Enter sends, Shift+Enter breaks the line, the emoji button
// inserts unicode emojis or `:name:` custom tokens inline, and the same
// surface flips into edit / reply mode with a small context strip on top.
export const Composer = (props: ComposerProps) => {
	const user = useCurrentUser();
  const [text, setText] = React.useState(props.initialSubmission?.text ?? props.initialDraft?.text ?? '');
  const [sending, setSending] = React.useState(false);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const pickerDraft = useEmojiPickerDraft(props.targetId);
	const [attachmentOpen, setAttachmentOpen] = React.useState(Boolean(props.initialDraft?.files?.length || props.initialSubmission?.attachments.length));
  const [sharedFilesPending, setSharedFilesPending] = React.useState(Boolean(props.initialDraft?.files?.length) && !props.initialSubmission);
	const [attachmentSession, setAttachmentSession] = React.useState(0);
	const [attachmentSnapshot, setAttachmentSnapshot] = React.useState<AttachmentComposerSnapshot>(EMPTY_ATTACHMENTS);
	const [submissionUncertain, setSubmissionUncertain] = React.useState(Boolean(props.initialSubmission));
  const areaRef = React.useRef<HTMLTextAreaElement | null>(null);
	const attachmentRef = React.useRef<AttachmentComposerHandle | null>(null);
	const pendingSubmissionRef = React.useRef<MessageSubmission | null>(props.initialSubmission || null);
  const initialSubmissionSent = React.useRef(false);
  const preparingSubmission = React.useRef(false);
  useDesktopUpdateBlocker(Boolean(text || sending || sharedFilesPending || attachmentSnapshot.blocking ||
    attachmentSnapshot.attachments.length || submissionUncertain || pendingSubmissionRef.current || preparingSubmission.current));
  const admission = React.useRef(new ComposerDraftAdmission(props.initialDraft));
  const draftRef = React.useRef(props.initialDraft);
  draftRef.current = props.initialDraft;
  // Ref attachment runs before passive mount. Never enqueue here: React's
  // StrictMode probe would abort that queue and consume the incoming seed.
  const receiveAttachmentHandle = React.useCallback((handle: AttachmentComposerHandle | null) => {
    attachmentRef.current = handle;
  }, []);

  React.useEffect(() => {
    const draft = props.initialDraft;
    if (!draft) return;
    setText(admission.current.text(text, draft));
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled || pendingSubmissionRef.current) return;
      const handle = attachmentRef.current;
      if (!handle) return;
      const accepted = admission.current.files(draft, files => handle.addFiles(files));
      setSharedFilesPending(!accepted);
    });
    return () => { cancelled = true; };
  }, [props.initialDraft, user?.privateUploadsEnabled, text]);

  React.useEffect(() => {
    if (!props.initialDraft?.id || props.active === false) return;
    const area = areaRef.current;
    area?.focus();
    area?.setSelectionRange(area.value.length, area.value.length);
  }, [props.initialDraft?.id, props.active]);
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
    if (preparingSubmission.current || sending || props.disabled || sharedFilesPending || (!pendingSubmissionRef.current && attachmentSnapshot.blocking) || (!pendingSubmissionRef.current && !text.trim() && !attachmentSnapshot.attachments.length)) return;
    setSending(true);
    preparingSubmission.current = true;
    let requestId: string;
    try {
      requestId = props.initialDraft && !initialSubmissionSent.current
        ? await sharedMessageRequestId(props.initialDraft.id, props.targetId) : crypto.randomUUID();
    } catch {
      setSending(false);
      return;
    } finally { preparingSubmission.current = false; }
		const submission =
			pendingSubmissionRef.current ||
			({
				text: text.trim(),
				requestId,
				attachmentIds: [...attachmentSnapshot.attachmentIds],
				attachments: [...attachmentSnapshot.attachments],
				...(props.agentControls?.running ? { agentMode: props.agentControls.mode } : {})
			} satisfies MessageSubmission);
		if (
			(!submission.text && !submission.attachments.length) ||
			(!pendingSubmissionRef.current && attachmentSnapshot.blocking) ||
			sending ||
      sharedFilesPending ||
			props.disabled
		)
			return;
		pendingSubmissionRef.current = submission;
    setSending(true);
		try {
			await props.beforeSubmit?.(props.targetId, submission.requestId, { ...submission });
			const okSend = await props.onSend(submission);
			if (okSend) {
				attachmentRef.current?.markCommitted(submission.attachmentIds);
        initialSubmissionSent.current = true;
				pendingSubmissionRef.current = null;
				setSubmissionUncertain(false);
				setText('');
				setAttachmentSnapshot(EMPTY_ATTACHMENTS);
				setAttachmentSession((session) => session + 1);
				setAttachmentOpen(false);
        props.onSent?.();
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
        {...chatAttachmentInput(files => {
					if (attachmentRef.current?.addFiles(files)) setAttachmentOpen(true);
				}, composerLocked || !!props.editing || props.attachmentsSupported === false || !user)}
        align="flex-end"
        gap={2}
        background="var(--tt-surface, #fafafa)"
        border="1px solid var(--tt-border, #ececef)"
        borderRadius="var(--tt-radius-lg, 16px)"
        padding="6px 8px"
        _focusWithin={{ borderColor: 'var(--tt-accent, #a855f7)' }}
      >
				<Popover isOpen={pickerOpen} onClose={() => setPickerOpen(false)} placement="top-start" strategy="fixed" modifiers={[{ name: 'preventOverflow', options: { padding: 12 } }, { name: 'flip', options: { padding: 12 } }]} isLazy>
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
              aria-label="Insert emoji"
            >
              😊
            </Button>
          </PopoverTrigger>
          <Portal appendToParentPortal={false}>
            <PopoverContent rootProps={{ zIndex: DRAWER_POPUP_Z }} zIndex={DRAWER_POPUP_Z} width="auto" boxShadow="var(--tt-shadow-popover, 0 8px 30px rgba(0,0,0,0.12))">
              <PopoverBody padding={2}>
                <MessengerEmojiPicker
                  emojis={props.pickerEmojis}
                  query={pickerDraft.query}
                  onQueryChange={pickerDraft.setQuery}
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
						(!submissionUncertain && !text.trim() && !attachmentSnapshot.attachments.length) || (!submissionUncertain && (attachmentSnapshot.blocking || sharedFilesPending))
					}
          flexShrink={0}
          background="var(--tt-accent, #a855f7)"
          color="white"
          _hover={{ opacity: 0.9 }}
          borderRadius="var(--tt-radius-pill, 999px)"
					title={submissionUncertain ? 'Retry safely' : props.editing ? 'Save edit' : 'Send'}
          aria-label={submissionUncertain ? 'Retry safely' : props.editing ? 'Save edit' : 'Send'}
        >
					{submissionUncertain ? '↻' : props.editing ? '✓' : '➤'}
        </Button>
      </Flex>
			{props.initialSubmission && submissionUncertain ? <Text fontSize="12px" paddingTop={2}>Retry will confirm the original {props.initialSubmission.attachmentIds.length} shared attachments.</Text> : null}
      {sharedFilesPending ? <Text role="status" fontSize="12px" paddingTop={2} whiteSpace="normal">Shared files are retained. Allow uploads below to attach them before sending.</Text> : null}
      {submissionUncertain ? (
				<Text role="status" aria-live="polite" fontSize="12px" color="var(--tt-muted, #70707a)" paddingX={2} paddingTop={2} whiteSpace="normal">
					Thingtime may already have sent this. Retry safely to confirm it without creating a duplicate.
				</Text>
			) : null}
			{user && !props.editing && props.attachmentsSupported !== false && !(props.initialSubmission && submissionUncertain) ? (
				<Box paddingTop={2} display={attachmentOpen || attachmentSnapshot.hasSelection ? undefined : 'none'}>
					<AttachmentComposer
						ref={receiveAttachmentHandle}
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
