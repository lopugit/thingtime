import React from 'react';
import { Box, Button, Flex, Input, Spinner } from '@chakra-ui/react';

import { useLopu } from '../Lopu/useLopu';
import { hasUnknownMutationOutcome } from '~/hooks/apiFailure';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { Composer } from './Composer';
import { AgentLiveActivity } from './AgentLiveActivity';
import { EmojiUploadModal } from './EmojiUploadModal';
import { MessageList } from './MessageList';
import { emitMessengerRefresh, mergeEmojiMap, pushCustomRecent, readEmojiMap, readMessages, writeMessages } from './messengerCache';
import { getUserDisplayName } from '~/utils/userIdentity';
import {
  chatDisplayName,
	externalSourceAvatar,
	isLiveAiSource,
	isLopuAiSource,
  memberDisplayName,
  type ChatMember,
  type ChatMessage,
  type ChatSummary,
  type CustomEmoji,
  type CustomEmojiMap,
  type MessengerMode
} from './messengerTypes';
import type { MessengerApi } from './useMessengerApi';
import type { PublicAttachment } from '~/components/Attachments/attachmentTypes';
import { useAgentSession } from './useAgentSession';
import type { AgentSendMode } from './AgentComposerControls';

const ACTIVE_POLL_MS = 4000;

const dedupeNewestFirst = (lists: ChatMessage[][]): ChatMessage[] => {
  const seen = new Set<string>();
  const merged: ChatMessage[] = [];
  for (const list of lists) {
    for (const message of list) {
      if (seen.has(message.id)) continue;
      seen.add(message.id);
      merged.push(message);
    }
  }
  return merged.sort((a, b) => (a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : b.createdAt.localeCompare(a.createdAt)));
};

export type ChatViewProps = {
  api: MessengerApi;
  chatSummary: ChatSummary;
  mode: MessengerMode;
  onBack?: () => void;
  onOpenDetails: () => void;
  onChatsChanged: () => void;
};

// One open conversation: instant paint from the per-chat message cache, a 4s
// visibility-aware poll for fresh pages, optimistic sends and reactions with
// per-item reconcile, Slack thread panel, and read-receipt advancement.
export const ChatView = (props: ChatViewProps) => {
  const { chatSummary, mode } = props;
  const chatId = chatSummary.id;
  const user = useCurrentUser();
  const userId = user?.id || null;
  const lopu = useLopu();
  const api = props.api;
	const liveSource = isLiveAiSource(chatSummary.externalSource) ? chatSummary.externalSource : null;
	const agent = useAgentSession(userId, liveSource, props.onChatsChanged);

  const [messages, setMessages] = React.useState<ChatMessage[]>(() => readMessages(userId, chatId));
  const [members, setMembers] = React.useState<ChatMember[]>(chatSummary.members || []);
  const [customEmojis, setCustomEmojis] = React.useState<CustomEmojiMap>(() => readEmojiMap(userId));
  const [pickerEmojis, setPickerEmojis] = React.useState<CustomEmoji[]>([]);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(messages.length === 0);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [replyTo, setReplyTo] = React.useState<ChatMessage | null>(null);
  const [editing, setEditing] = React.useState<ChatMessage | null>(null);
  const [threadRoot, setThreadRoot] = React.useState<ChatMessage | null>(null);
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [editingTopic, setEditingTopic] = React.useState(false);
  const [topicDraft, setTopicDraft] = React.useState('');
	const [agentMode, setAgentMode] = React.useState<AgentSendMode>('queue');
	const [interruptingAgent, setInterruptingAgent] = React.useState(false);

  const seqRef = React.useRef(0);
  const readMarkRef = React.useRef<string | null>(null);
  // once the user pages into history, polls must not rewind the cursor to
  // page one — that would splice old pages out of reach
  const hasPagedRef = React.useRef(false);
  const emojiFetchRef = React.useRef<Set<string>>(new Set());
  const messagesRef = React.useRef(messages);
	const lastAgentRefreshRef = React.useRef(0);
  messagesRef.current = messages;

	React.useEffect(() => {
		if (agentMode === 'steer' && !agent.controls.canSteer) setAgentMode('queue');
	}, [agent.controls.canSteer, agentMode]);

	React.useEffect(() => {
		if (!liveSource || agent.state.sequence <= lastAgentRefreshRef.current) return;
		if (agent.state.status !== 'completed' && agent.state.status !== 'interrupted' && agent.state.status !== 'failed') return;
		lastAgentRefreshRef.current = agent.state.sequence;
		props.onChatsChanged();
	}, [agent.state.sequence, agent.state.status, liveSource, props]);

  const myMember = members.find((m) => m.userId === userId) || null;
  const pendingRequest = (chatSummary.myMember?.state || myMember?.state) === 'pending';

  const applyPage = React.useCallback(
    (payload: any, { replace }: { replace: boolean }) => {
      setMembers(payload.members || []);
      setCustomEmojis(mergeEmojiMap(userId, payload.customEmojis || {}));
      setMessages((prev) => {
        const pending = prev.filter((m) => m.id.startsWith('pending-'));
				const merged = replace ? dedupeNewestFirst([pending, payload.messages, prev]) : dedupeNewestFirst([pending, prev, payload.messages]);
				writeMessages(
					userId,
					chatId,
					merged.filter((m) => !m.id.startsWith('pending-'))
				);
        return merged;
      });
    },
    [chatId, userId]
  );

  // initial load + 4s poll while visible
  React.useEffect(() => {
    let cancelled = false;
    const seq = ++seqRef.current;
    const load = async () => {
      try {
        const payload = await api.messages({ chatId, limit: 40 });
        if (cancelled || seq !== seqRef.current) return;
        applyPage(payload, { replace: true });
        if (!hasPagedRef.current) setNextCursor(payload.nextCursor ?? null);
        setLoading(false);
      } catch (err: any) {
        if (cancelled) return;
        setLoading(false);
        lopu({ title: err?.error || 'Could not load this chat 😞', status: 'error' });
      }
    };
    void load();
    const interval = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void load();
    }, ACTIVE_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [api, applyPage, chatId, lopu]);

  // custom emoji palette for this chat (community set + personal set)
  React.useEffect(() => {
    let cancelled = false;
    api
      .emojis({ chatId })
      .then((payload: any) => {
        if (cancelled) return;
        setPickerEmojis(payload.emojis || []);
        const map: CustomEmojiMap = {};
        for (const emoji of payload.emojis || []) map[emoji.id] = { name: emoji.name, image: emoji.image, animated: emoji.animated };
        setCustomEmojis(mergeEmojiMap(userId, map));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [api, chatId, userId]);

  // advance the read receipt to the newest visible message (forward-only on
  // the server, deduped here) — this is what clears the unread badge. Pending
  // requests never leave receipts: "seen" must not leak before accept.
  React.useEffect(() => {
    if (pendingRequest) return;
    const newest = messages.find((m) => !m.id.startsWith('pending-'));
    if (!newest || readMarkRef.current === newest.id) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    readMarkRef.current = newest.id;
		api
			.markRead({ chatId, messageId: newest.id })
			.then(() => props.onChatsChanged())
			.catch(() => {});
  }, [api, chatId, messages, pendingRequest, props]);

  // reaction chips reference emojis by id with { name, animated } only —
  // fetch the image bytes once per unknown id and cache them
  React.useEffect(() => {
    const missing = Object.entries(customEmojis)
      .filter(([id, entry]) => !entry.image && !emojiFetchRef.current.has(id))
      .map(([id]) => id);
    if (!missing.length) return;
    for (const id of missing) emojiFetchRef.current.add(id);
    api
      .emojis({ ids: missing })
      .then((payload: any) => {
        const map: CustomEmojiMap = {};
        for (const emoji of payload.emojis || []) map[emoji.id] = { name: emoji.name, image: emoji.image, animated: emoji.animated };
        if (Object.keys(map).length) setCustomEmojis(mergeEmojiMap(userId, map));
      })
      .catch(() => {
        for (const id of missing) emojiFetchRef.current.delete(id);
      });
  }, [api, customEmojis, userId]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    hasPagedRef.current = true;
    try {
      const payload = await api.messages({ chatId, cursor: nextCursor, limit: 40 });
      applyPage(payload, { replace: false });
      setNextCursor(payload.nextCursor ?? null);
    } catch {
      // leave the button; another tap retries
    }
    setLoadingMore(false);
  };

	const send = async (submission: {
		text: string;
		requestId: string;
		attachmentIds: string[];
		attachments: PublicAttachment[];
		agentMode?: AgentSendMode;
	}): Promise<boolean> => {
		const { text, requestId, attachmentIds, attachments } = submission;
    if (editing) {
      const target = editing;
      const prevText = target.text;
      setMessages((prev) => prev.map((m) => (m.id === target.id ? { ...m, text } : m)));
      try {
        const payload = await api.editMessage({ id: target.id, text });
        setMessages((prev) => prev.map((m) => (m.id === target.id ? payload.message : m)));
				setEditing((current) => (current?.id === target.id ? null : current));
        return true;
      } catch (err: any) {
        setMessages((prev) => prev.map((m) => (m.id === target.id ? { ...m, text: prevText } : m)));
				if (hasUnknownMutationOutcome(err)) {
					lopu({ title: 'That edit may already have saved. Retry safely to confirm it.', status: 'info' });
					throw err;
				}
				lopu({ title: 'Thingtime could not save that edit. Please try again.', status: 'error' });
        return false;
      }
    }
		if (liveSource) {
			if (attachments.length) {
				lopu({ title: 'This desktop connector does not support attachments yet.', status: 'info' });
				return false;
			}
			try {
				await agent.send({ text, requestId, mode: submission.agentMode || agentMode });
				return true;
			} catch (err: any) {
				if (hasUnknownMutationOutcome(err)) {
					lopu({ title: 'That agent message may already be queued. Retry safely to confirm it.', status: 'info' });
					throw err;
				}
				lopu({ title: err?.error || err?.message || 'Thingtime could not reach that desktop chat.', status: 'error' });
				return false;
			}
		}
    const reply = replyTo;
    const localId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const optimistic: ChatMessage = {
      id: localId,
      chatId,
      authorId: userId || '',
      author: user
        ? {
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            temporary: user.temporary,
            avatarUrl: user.avatarUrl
          }
        : null,
      text,
			attachments,
      deleted: false,
      editedAt: null,
      threadRootId: null,
      replyToId: reply?.id || null,
      replyTo: reply
        ? {
            id: reply.id,
            authorId: reply.authorId,
            authorName: reply.author ? getUserDisplayName(reply.author) : null,
            text: reply.text.slice(0, 140),
						deleted: reply.deleted,
						attachmentCount: reply.attachments.length
          }
        : null,
      systemType: null,
      systemMeta: null,
      reactionCounts: {},
      viewerReactions: [],
      threadCount: 0,
      threadLastAt: null,
      createdAt: new Date().toISOString()
    };
    setMessages((prev) => [optimistic, ...prev]);
    try {
			const payload = await api.sendMessage({
				chatId,
				text,
				requestId,
				attachmentIds,
				...(reply ? { replyToId: reply.id } : {})
			});
      setMessages((prev) => {
        const next = prev.map((m) => (m.id === localId ? payload.message : m));
				writeMessages(
					userId,
					chatId,
					next.filter((m) => !m.id.startsWith('pending-'))
				);
        return next;
      });
			if (reply) setReplyTo((current) => (current?.id === reply.id ? null : current));
      props.onChatsChanged();
      emitMessengerRefresh();
      return true;
    } catch (err: any) {
      setMessages((prev) => prev.filter((m) => m.id !== localId));
			if (hasUnknownMutationOutcome(err)) {
				lopu({ title: 'That message may already have sent. Retry safely to confirm it.', status: 'info' });
				throw err;
			}
			lopu({ title: 'Thingtime could not send that message. Please try again.', status: 'error' });
      return false;
    }
  };

  const react = async (message: ChatMessage, token: string) => {
    if (message.id.startsWith('pending-')) return;
    const had = message.viewerReactions.includes(token);
    const applyDelta = (m: ChatMessage): ChatMessage => {
      if (m.id !== message.id) return m;
      const counts = { ...m.reactionCounts };
      const nextCount = (counts[token] || 0) + (had ? -1 : 1);
      if (nextCount <= 0) delete counts[token];
      else counts[token] = nextCount;
      return {
        ...m,
        reactionCounts: counts,
        viewerReactions: had ? m.viewerReactions.filter((t) => t !== token) : [...m.viewerReactions, token]
      };
    };
    setMessages((prev) => prev.map(applyDelta));
    try {
      const payload = await api.react({ messageId: message.id, emoji: token });
      setMessages((prev) =>
				prev.map((m) => (m.id === message.id ? { ...m, reactionCounts: payload.reactionCounts, viewerReactions: payload.viewerReactions } : m))
      );
      setCustomEmojis(mergeEmojiMap(userId, payload.customEmojis || {}));
      if (token.startsWith('custom:') && !had) {
        pushCustomRecent(userId, token);
      }
    } catch (err: any) {
      setMessages((prev) => prev.map((m) => (m.id === message.id ? message : m)));
      lopu({ title: err?.error || 'Reaction did not stick 😞', status: 'error' });
    }
  };

  const remove = async (message: ChatMessage) => {
    const prev = messagesRef.current;
		setMessages((current) =>
			current.map((m) => (m.id === message.id ? { ...m, deleted: true, text: '', attachments: [], reactionCounts: {}, viewerReactions: [] } : m))
		);
    try {
      await api.deleteMessage({ id: message.id });
			window.dispatchEvent(new Event('thingtime:root-data-refresh'));
    } catch (err: any) {
      setMessages(prev);
      lopu({ title: err?.error || 'Delete failed 😞', status: 'error' });
    }
  };

  const saveTopic = async () => {
    setEditingTopic(false);
    try {
      await api.updateChat({ id: chatId, topic: topicDraft });
      props.onChatsChanged();
    } catch (err: any) {
      lopu({ title: err?.error || 'Topic did not save 😞', status: 'error' });
    }
  };

  const title = chatDisplayName({ ...chatSummary, members }, userId);
  const canEditTopic =
    !chatSummary.externalSource &&
    mode === 'slack' &&
    chatSummary.chatType === 'channel' &&
    (myMember?.role === 'owner' || myMember?.role === 'admin');
  const communityEmojiScope = chatSummary.communityId;

  return (
    <Flex direction="column" height="100%" minWidth={0} flex={1}>
      {/* header */}
			<Flex align="center" gap={2} paddingX={3} paddingY={2} borderBottom="1px solid var(--tt-border-light, #f3f3f5)" flexShrink={0}>
        {props.onBack ? (
          <Button size="sm" variant="ghost" onClick={props.onBack} aria-label="Back">
            ←
          </Button>
        ) : null}
        <Box minWidth={0} flex={1}>
          <Box fontWeight={700} fontSize="15px" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
            {title}
            {chatSummary.externalSource ? (
              <Box as="span" fontSize="10px" fontWeight={600} color="var(--tt-muted, #777782)" marginLeft={2}>
                {externalSourceAvatar(chatSummary.externalSource).glyph} {chatSummary.externalSource.label}
              </Box>
            ) : null}
          </Box>
          {mode === 'slack' && chatSummary.chatType === 'channel' ? (
            editingTopic ? (
              <Input
                size="xs"
                value={topicDraft}
                autoFocus
                onChange={(event) => setTopicDraft(event.target.value)}
                onBlur={saveTopic}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') saveTopic();
                  if (event.key === 'Escape') setEditingTopic(false);
                }}
                maxWidth="420px"
                placeholder="Set a topic…"
              />
            ) : (
              <Box
                fontSize="12px"
                color="var(--tt-muted, #9a9aa6)"
                overflow="hidden"
                textOverflow="ellipsis"
                whiteSpace="nowrap"
                cursor={canEditTopic ? 'pointer' : 'default'}
                onClick={() => {
                  if (!canEditTopic) return;
                  setTopicDraft(chatSummary.topic || '');
                  setEditingTopic(true);
                }}
                title={canEditTopic ? 'Click to edit the topic' : chatSummary.topic || undefined}
              >
                {chatSummary.topic || (canEditTopic ? 'Add a topic ✏️' : 'No topic')}
              </Box>
            )
          ) : null}
        </Box>
        <Button size="sm" variant="ghost" onClick={props.onOpenDetails} title="Details & members">
          👥 {members.filter((m) => m.state === 'active').length || chatSummary.memberCount || ''}
        </Button>
      </Flex>

      {pendingRequest ? (
        <Box
          padding={2}
          fontSize="12px"
          textAlign="center"
          background="var(--tt-accent-tint, #f3e8ff)"
          color="var(--tt-ink, #17171c)"
          whiteSpace="normal"
        >
          This is a message request — replying accepts it 💌
        </Box>
      ) : null}

      {chatSummary.externalSource ? (
        <Box
          paddingX={3}
          paddingY="6px"
          fontSize="11px"
          textAlign="center"
          background="var(--tt-surface-alt, #f7f7f9)"
          color="var(--tt-muted, #777782)"
          borderBottom="1px solid var(--tt-border-light, #f3f3f5)"
          whiteSpace="normal"
        >
					{isLopuAiSource(chatSummary.externalSource)
						? 'A conversation with Lopu, the Thingtime assistant 🦄'
						: liveSource
							? `Live with ${liveSource.label} on your computer. Messages here are sent to that desktop session; completed responses sync back to Thingtime.`
							: `Imported read-only from ${chatSummary.externalSource.label}. Reactions, threads and replies stay in Thingtime.`}
        </Box>
      ) : null}

      {/* messages + optional thread panel */}
      <Flex flex={1} minHeight={0}>
        <Flex direction="column" flex={1} minWidth={0}>
          {loading && !messages.length ? (
            <Flex flex={1} align="center" justify="center">
              <Spinner color="var(--tt-muted, #9a9aa6)" />
            </Flex>
          ) : (
            <MessageList
              messages={messages}
              mode={mode}
              viewerId={userId}
              members={members}
              customEmojis={customEmojis}
              pickerEmojis={pickerEmojis}
              hasMore={!!nextCursor}
              loadingMore={loadingMore}
              onLoadMore={loadMore}
              showSeenBy={mode === 'messenger'}
              onReact={react}
              onReply={mode === 'messenger' ? (m) => setReplyTo(m) : undefined}
              onOpenThread={mode === 'slack' ? (m) => setThreadRoot(m) : undefined}
              onEdit={(m) => setEditing(m)}
              onDelete={remove}
              onUploadEmoji={() => setUploadOpen(true)}
            />
          )}
					{liveSource ? (
						<AgentLiveActivity
							state={agent.state}
							connected={agent.connected}
							onApproval={async (approvalId, decision) => {
								try {
									await agent.respondToApproval(approvalId, decision);
								} catch (err: any) {
									lopu({ title: err?.error || err?.message || 'Approval response failed.', status: 'error' });
									throw err;
								}
							}}
						/>
					) : null}
          <Composer
						placeholder={
							isLopuAiSource(chatSummary.externalSource)
								? 'Ask Lopu anything 🦄'
								: liveSource
									? `Message ${liveSource.label} on your computer`
									: chatSummary.externalSource
										? `Reply in Thingtime about ${title}`
										: `Message ${title}`
						}
            pickerEmojis={pickerEmojis}
            replyTo={replyTo}
            onCancelReply={() => setReplyTo(null)}
            editing={editing}
            onCancelEdit={() => setEditing(null)}
            onSend={send}
            onUploadEmoji={() => setUploadOpen(true)}
						attachmentsSupported={!liveSource || liveSource.capabilities.includes('attachments')}
						disabled={Boolean(liveSource && !liveSource.capabilities.includes('send-message'))}
						disabledLabel="This desktop connector cannot send messages."
						agentControls={
							liveSource
								? {
										running: agent.controls.running,
										mode: agentMode,
										canQueue: agent.controls.canQueue,
										canSteer: agent.controls.canSteer,
										canInterrupt: agent.controls.canInterrupt,
										queueDepth: agent.controls.queueDepth,
										interrupting: interruptingAgent,
										onModeChange: setAgentMode,
										onInterrupt: () => {
											if (interruptingAgent) return;
											setInterruptingAgent(true);
											void agent
												.interrupt()
												.catch((err: any) => {
													lopu({ title: err?.error || err?.message || 'Could not stop that turn.', status: 'error' });
												})
												.finally(() => setInterruptingAgent(false));
										}
								  }
								: undefined
						}
          />
        </Flex>
        {threadRoot ? (
          <ThreadPanel
            api={api}
            chatId={chatId}
            root={messages.find((m) => m.id === threadRoot.id) || threadRoot}
            members={members}
            customEmojis={customEmojis}
            pickerEmojis={pickerEmojis}
            viewerId={userId}
            onClose={() => setThreadRoot(null)}
            onReact={react}
            onUploadEmoji={() => setUploadOpen(true)}
            onSent={() => {
              props.onChatsChanged();
            }}
          />
        ) : null}
      </Flex>

      <EmojiUploadModal
        isOpen={uploadOpen}
        onClose={() => setUploadOpen(false)}
        api={api}
        communityId={communityEmojiScope}
        onUploaded={(emoji) => {
          setPickerEmojis((prev) => [...prev, emoji]);
          setCustomEmojis(mergeEmojiMap(userId, { [emoji.id]: { name: emoji.name, image: emoji.image, animated: emoji.animated } }));
        }}
      />
    </Flex>
  );
};

// Slack-style thread side panel: its own page + composer, one level deep.
const ThreadPanel = ({
  api,
  chatId,
  root,
  members,
  customEmojis,
  pickerEmojis,
  viewerId,
  onClose,
  onReact,
  onUploadEmoji,
  onSent
}: {
  api: MessengerApi;
  chatId: string;
  root: ChatMessage;
  members: ChatMember[];
  customEmojis: CustomEmojiMap;
  pickerEmojis: CustomEmoji[];
  viewerId: string | null;
  onClose: () => void;
  onReact: (message: ChatMessage, token: string) => void;
  onUploadEmoji: () => void;
  onSent: () => void;
}) => {
  const lopu = useLopu();
  const [replies, setReplies] = React.useState<ChatMessage[]>([]);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    try {
      const payload = await api.messages({ chatId, threadRootId: root.id, limit: 100 });
      setReplies(payload.messages || []);
      setLoading(false);
    } catch {
      setLoading(false);
    }
  }, [api, chatId, root.id]);

  React.useEffect(() => {
    void load();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, ACTIVE_POLL_MS);
    return () => window.clearInterval(interval);
  }, [load]);

  const reactInThread = async (message: ChatMessage, token: string) => {
    if (message.id === root.id) return onReact(message, token);
    const had = message.viewerReactions.includes(token);
    setReplies((prev) =>
      prev.map((m) => {
        if (m.id !== message.id) return m;
        const counts = { ...m.reactionCounts };
        const next = (counts[token] || 0) + (had ? -1 : 1);
        if (next <= 0) delete counts[token];
        else counts[token] = next;
        return { ...m, reactionCounts: counts, viewerReactions: had ? m.viewerReactions.filter((t) => t !== token) : [...m.viewerReactions, token] };
      })
    );
    try {
      const payload = await api.react({ messageId: message.id, emoji: token });
			setReplies((prev) =>
				prev.map((m) => (m.id === message.id ? { ...m, reactionCounts: payload.reactionCounts, viewerReactions: payload.viewerReactions } : m))
			);
    } catch (err: any) {
      setReplies((prev) => prev.map((m) => (m.id === message.id ? message : m)));
      lopu({ title: err?.error || 'Reaction did not stick 😞', status: 'error' });
    }
  };

	const sendReply = async (submission: {
		text: string;
		requestId: string;
		attachmentIds: string[];
		attachments: PublicAttachment[];
	}): Promise<boolean> => {
    try {
			const payload = await api.sendMessage({
				chatId,
				text: submission.text,
				requestId: submission.requestId,
				attachmentIds: submission.attachmentIds,
				threadRootId: root.id
			});
      setReplies((prev) => [payload.message, ...prev]);
      onSent();
      return true;
    } catch (err: any) {
			if (hasUnknownMutationOutcome(err)) {
				lopu({ title: 'That reply may already have sent. Retry safely to confirm it.', status: 'info' });
				throw err;
			}
			lopu({ title: 'Thingtime could not send that reply. Please try again.', status: 'error' });
      return false;
    }
  };

  return (
    <Flex
      direction="column"
      width={{ base: '100%', md: '340px' }}
      position={{ base: 'absolute', md: 'relative' }}
      inset={{ base: 0, md: 'auto' }}
      background="var(--tt-card, #ffffff)"
      borderLeft={{ md: '1px solid var(--tt-border-light, #f3f3f5)' }}
      zIndex={5}
      minHeight={0}
    >
      <Flex align="center" justify="space-between" paddingX={3} paddingY={2} borderBottom="1px solid var(--tt-border-light, #f3f3f5)">
        <Box fontWeight={700} fontSize="14px">
          🧵 Thread
        </Box>
        <Button size="xs" variant="ghost" onClick={onClose}>
          ✕
        </Button>
      </Flex>
      <Box borderBottom="1px solid var(--tt-border-light, #f3f3f5)" paddingY={1}>
        <MessageList
          messages={[root]}
          mode="slack"
          viewerId={viewerId}
          members={members}
          customEmojis={customEmojis}
          pickerEmojis={pickerEmojis}
          hasMore={false}
          loadingMore={false}
          onLoadMore={() => {}}
          isThreadReply
          onReact={onReact}
          onUploadEmoji={onUploadEmoji}
        />
      </Box>
      {loading ? (
        <Flex flex={1} align="center" justify="center">
          <Spinner size="sm" color="var(--tt-muted, #9a9aa6)" />
        </Flex>
      ) : (
        <MessageList
          messages={replies}
          mode="slack"
          viewerId={viewerId}
          members={members}
          customEmojis={customEmojis}
          pickerEmojis={pickerEmojis}
          hasMore={false}
          loadingMore={false}
          onLoadMore={() => {}}
          isThreadReply
          onReact={reactInThread}
          onUploadEmoji={onUploadEmoji}
          emptyLabel="No replies yet — start the thread 🧵"
        />
      )}
      <Composer
        placeholder="Reply in thread"
        pickerEmojis={pickerEmojis}
        replyTo={null}
        onCancelReply={() => {}}
        editing={null}
        onCancelEdit={() => {}}
        onSend={sendReply}
        onUploadEmoji={onUploadEmoji}
      />
    </Flex>
  );
};
