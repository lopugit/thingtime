import React from 'react';
import { Button, Flex, Text } from '@chakra-ui/react';
import { MessagesSquare, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { LopuConversationList } from './LopuConversationList';
import { LOPU_UI } from './lopuTheme';
import { useLopuChat } from './useLopuChat';

/** Keep the composer mounted while the narrow popup shows its conversation list. */
export const LopuWindowConversations = ({ wide, children }: { wide: boolean; children: React.ReactNode }) => {
  const chat = useLopuChat();
  const [sidebarOpen, setSidebarOpen] = React.useState(true);
  const [listOpen, setListOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const listId = React.useId();
  const signedIn = !!chat.viewer.id && !chat.viewer.temporary;
  const open = signedIn && (wide ? sidebarOpen : listOpen);

  const closeList = () => {
    setListOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  };

  return (
    <Flex className="lopuWindowConversations" direction="column" flex={1} minH={0} minW={0}
      onKeyDown={event => {
        if (!wide && open && event.key === 'Escape' && !event.defaultPrevented) {
          event.preventDefault();
          event.stopPropagation();
          closeList();
        }
      }}
    >
      {signedIn && (
        <Flex align="center" gap={2} px={2} py={1.5} borderBottom={LOPU_UI.border} flexShrink={0} minW={0}>
          <Button
            ref={triggerRef}
            size="sm"
            variant="ghost"
            flexShrink={0}
            fontSize={LOPU_UI.fontSmall}
            color={LOPU_UI.ink}
            data-lopu-conversations-toggle
            aria-expanded={open}
            aria-controls={listId}
            leftIcon={wide ? (open ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />) : <MessagesSquare size={16} />}
            onClick={() => wide ? setSidebarOpen(value => !value) : setListOpen(value => !value)}
          >
            {!wide && open ? 'Back to chat' : 'Conversations'}
          </Button>
          <Text fontSize={LOPU_UI.fontSmall} color={LOPU_UI.muted} isTruncated minW={0}>
            {chat.chats.find(entry => entry.id === chat.chatId)?.name || 'New chat'}
          </Text>
        </Flex>
      )}
      <Flex flex={1} minH={0} minW={0}>
        {open && (
          <Flex
            as="nav"
            id={listId}
            aria-label="Lopu conversations"
            direction="column"
            width={wide ? '248px' : '100%'}
            flexShrink={0}
            minH={0}
            minW={0}
            p={2}
            borderRight={wide ? LOPU_UI.border : undefined}

          >
            <LopuConversationList chat={chat} onPicked={wide ? undefined : closeList} bottomInset={wide ? undefined : '48px'} />
          </Flex>
        )}
        <Flex flex={1} minH={0} minW={0} display={!wide && open ? 'none' : 'flex'}>
          {children}
        </Flex>
      </Flex>
    </Flex>
  );
};
