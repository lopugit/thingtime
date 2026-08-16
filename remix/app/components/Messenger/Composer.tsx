import React from 'react';
import { Box, Button, Flex, Popover, PopoverBody, PopoverContent, PopoverTrigger, Portal, Textarea } from '@chakra-ui/react';

import { MessengerEmojiPicker } from './MessengerEmojiPicker';
import { CUSTOM_TOKEN_PREFIX, customTokenId, isCustomToken, type ChatMessage, type CustomEmoji } from './messengerTypes';
import { getUserDisplayName } from '~/utils/userIdentity';

export type ComposerProps = {
  placeholder: string;
  pickerEmojis: CustomEmoji[];
  replyTo: ChatMessage | null;
  onCancelReply: () => void;
  editing: ChatMessage | null;
  onCancelEdit: () => void;
  onSend: (text: string) => Promise<boolean>;
  onUploadEmoji?: () => void;
  disabled?: boolean;
  disabledLabel?: string;
};

// The message box: Enter sends, Shift+Enter breaks the line, the emoji button
// inserts unicode emojis or `:name:` custom tokens inline, and the same
// surface flips into edit / reply mode with a small context strip on top.
export const Composer = (props: ComposerProps) => {
  const [text, setText] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const areaRef = React.useRef<HTMLTextAreaElement | null>(null);
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
    const trimmed = text.trim();
    if (!trimmed || sending || props.disabled) return;
    setSending(true);
    const okSend = await props.onSend(trimmed);
    setSending(false);
    if (okSend) setText('');
    areaRef.current?.focus();
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

  const contextStrip = props.editing ? (
    <ContextStrip label={`Editing message`} onCancel={props.onCancelEdit} />
  ) : props.replyTo ? (
    <ContextStrip
      label={`Replying to ${props.replyTo.author ? getUserDisplayName(props.replyTo.author) : 'someone'}: ${
        props.replyTo.text.slice(0, 60) || '…'
      }`}
      onCancel={props.onCancelReply}
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
      <Flex
        align="flex-end"
        gap={2}
        background="var(--tt-surface, #fafafa)"
        border="1px solid var(--tt-border, #ececef)"
        borderRadius="var(--tt-radius-lg, 16px)"
        padding="6px 8px"
        _focusWithin={{ borderColor: 'var(--tt-accent, #a855f7)' }}
      >
        <Popover
          isOpen={pickerOpen}
          onClose={() => setPickerOpen(false)}
          placement="top-start"
          isLazy
        >
          <PopoverTrigger>
            <Button
              size="sm"
              variant="ghost"
              flexShrink={0}
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
        <Textarea
          ref={areaRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
            if (event.key === 'Escape') {
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
          isDisabled={!text.trim()}
          flexShrink={0}
          background="var(--tt-accent, #a855f7)"
          color="white"
          _hover={{ opacity: 0.9 }}
          borderRadius="var(--tt-radius-pill, 999px)"
          title={props.editing ? 'Save edit' : 'Send'}
        >
          {props.editing ? '✓' : '➤'}
        </Button>
      </Flex>
    </Box>
  );
};

const ContextStrip = ({ label, onCancel }: { label: string; onCancel: () => void }) => (
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
    <Button size="xs" variant="ghost" onClick={onCancel} flexShrink={0}>
      ✕
    </Button>
  </Flex>
);
