import React from 'react';
import { Box, Flex } from '@chakra-ui/react';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useLopu } from '../Lopu/useLopu';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { TransientBlockHost } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import type { WebpageBlock } from '../Builder/webpageBlocks';
import type { MessageSubmission } from './Composer';
import { ChatView } from './ChatView';
import { ChatDetailsDrawer } from './ChatDetailsDrawer';
import { InboxSidebar } from './InboxSidebar';
import { NewChatModal } from './MessengerModals';
import { useMessengerApi } from './useMessengerApi';
import type { ChatSummary } from './messengerTypes';

export type ShareMessageDestinationProps = {
  shareId: string;
  text: string;
  files: readonly File[];
  active?: boolean;
  onSent?: (result: { messageId: string; chatId: string; requestId: string }) => void | Promise<void>;
  beforeSubmit?: (targetId: string, operationId: string, payload: Record<string, unknown>) => Promise<void>;
  initialSubmission?: { targetId: string; operationId: string; recoveryPayload: string };
};

export const SHARE_MESSAGE_CONTROLS: WebpageBlock[] = [{
  id: 'share-message-controls', type: 'element', tag: 'div',
  css: { display: 'flex', padding: '12px', gap: '12px', 'align-items': 'center', 'flex-wrap': 'wrap' },
  children: [
    { id: 'share-message-heading', type: 'element', tag: 'h2', text: 'Choose a conversation', css: { flex: '1', margin: '0', 'font-size': '16px', 'font-weight': '600' } },
    { id: 'share-message-new', type: 'element', tag: 'button', text: 'New message', props: { type: 'button', 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation: 'new' } }, css: { 'min-height': '44px', padding: '8px 14px', 'border-radius': '999px', border: '1px solid var(--tt-border, #ececef)' } },
    { id: 'share-message-status', type: 'element', tag: 'p', text: '{result.status}', props: { role: 'status' }, css: { margin: '0', width: '100%', 'white-space': 'normal' } },
    { id: 'share-message-retry', type: 'element', tag: 'button', text: 'Refresh conversations', props: { type: 'button', 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation: 'refresh' } }, css: { 'min-height': '44px', padding: '8px' } }
  ]
} as WebpageBlock];

/** The caller binds this entry to a verified account/origin and retains it
 * across Post/Message switches. No share is sent until the normal Send action. */
export function ShareMessageDestination(props: ShareMessageDestinationProps) {
  const user = useCurrentUser();
  return user ? <ShareMessageSession key={`${user.id}:${props.shareId}`} {...props} viewerId={user.id} /> : null;
}

function ShareMessageSession({ shareId, text, files, active = true, onSent, beforeSubmit, initialSubmission, viewerId }: ShareMessageDestinationProps & { viewerId: string }) {
  const api = useMessengerApi();
  const lopu = useLopu();
  const [chats, setChats] = React.useState<ChatSummary[]>([]);
  const [opened, setOpened] = React.useState<ChatSummary[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState('');
  const [newOpen, setNewOpen] = React.useState(false);
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const mounted = React.useRef(true);
  const loadSequence = React.useRef(0);
  const recovered = React.useMemo((): MessageSubmission | undefined => {
    if (!initialSubmission) return undefined;
    const payload = JSON.parse(initialSubmission.recoveryPayload);
    if (!payload || payload.requestId !== initialSubmission.operationId || typeof payload.text !== 'string' || !Array.isArray(payload.attachmentIds) || payload.attachmentIds.some((id: unknown) => typeof id !== 'string') || !Array.isArray(payload.attachments)) throw Error('The interrupted message cannot be recovered safely.');
    return payload;
  }, [initialSubmission]);
  const draft = React.useMemo(() => ({ id: shareId, text, files }), [shareId, text, files]);
  const refresh = React.useCallback(async () => {
    const sequence = ++loadSequence.current;
    try {
      const payload = await api.listChats();
      if (!mounted.current || sequence !== loadSequence.current) return;
      // Imported/agent sessions have a separate destination contract. Sharing
      // here offers ordinary account conversations, never a silent provider send.
      setChats((payload.chats || []).filter((chat: ChatSummary) => !chat.externalSource));
      setStatus('');
    } catch {
      if (mounted.current && sequence === loadSequence.current) setStatus('Conversations could not load. Refresh to try again.');
    }
  }, [api]);
  React.useEffect(() => { mounted.current = true; void refresh(); return () => { mounted.current = false; }; }, [refresh]);
  const select = (chat: ChatSummary) => {
    if (initialSubmission && initialSubmission.targetId !== chat.id) return;
    setOpened(current => current.some(item => item.id === chat.id) ? current : [...current, chat]);
    setSelectedId(chat.id);
  };
  const selectId = async (id: string) => {
    try {
      const result = await api.getChat(id);
      if (mounted.current && result.chat && !result.chat.externalSource) select(result.chat);
    } catch { lopu({ title: 'That conversation could not open. Your shared content is still here.', status: 'error' }); }
  };
  React.useEffect(() => {
    if (initialSubmission) void selectId(initialSubmission.targetId);
    // Recovery's immutable destination is pinned by the native host.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSubmission?.targetId]);
  return <Flex direction="column" height="100%" minHeight={0} minWidth={0}>
    <Box display={selectedId ? 'none' : undefined} minHeight={0} overflowY="auto" flex={1}>
      <SettingsDocumentHost documentKey="incoming-share-message-controls" defaultDocument={SHARE_MESSAGE_CONTROLS} scopeKey={viewerId} persistence="device" title="Share message controls">
        {({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={`${viewerId}:${shareId}`} scope={{ result: { status } }} enabled={!editing} actions={{ new: () => setNewOpen(true), refresh }}>
          <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} bare />
        </TransientBlockHost>}
      </SettingsDocumentHost>
      <InboxSidebar api={api} chats={chats} viewerId={viewerId} selectedChatId={selectedId} requestsCount={0}
        onSelectChat={select} onOpenRequests={() => setNewOpen(true)} onNewGroup={() => setNewOpen(true)}
        onStartDm={async person => {
          try {
            const result = await api.createChat({ chatType: 'dm', memberIds: [person.id] });
            if (mounted.current) select(result.chat);
          } catch { lopu({ title: 'That conversation could not start. Your shared content is still here.', status: 'error' }); }
        }} />
    </Box>
    {opened.map(chat => <Box key={chat.id} display={selectedId === chat.id ? 'flex' : 'none'} flex={1} minHeight={0} minWidth={0}>
      <ChatView api={api} chatSummary={chat} mode="messenger" active={active && selectedId === chat.id}
        initialDraft={draft} initialSubmission={recovered} beforeSubmit={beforeSubmit} onSent={onSent} onBack={() => setSelectedId(null)} onOpenDetails={() => setDetailsOpen(true)} onChatsChanged={() => { void refresh(); }} />
    </Box>)}
    <NewChatModal isOpen={newOpen} onClose={() => setNewOpen(false)} api={api} onCreated={id => { void selectId(id); }} />
    {selectedId ? <ChatDetailsDrawer isOpen={detailsOpen} onClose={() => setDetailsOpen(false)} api={api} chat={opened.find(chat => chat.id === selectedId)!} onChanged={() => { void refresh(); }} onLeft={() => { setDetailsOpen(false); setSelectedId(null); }} /> : null}
  </Flex>;
}
