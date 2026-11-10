// Only contracts consumed by the embedded Messenger view and its details UI.
export const SUBSPACE_MESSAGES_REQUIREMENTS: Record<string, string> = {
  'api.subspaces-get': '1.6.0',
  'api.chats-get': '1.0.1',
  'api.chats-messages': '1.2.1',
  'api.chats-messages-edit': '1.0.2',
  'api.chats-messages-delete': '1.0.1',
  'api.chats-react': '1.0.2',
  'api.chats-read': '1.0.1',
  'api.chats-update': '1.0.1',
  'api.chats-members': '1.0.1',
  'api.chats-leave': '1.0.1',
  'api.emojis': '1.0.2',
  'api.attachment-content': '1.13.1'
};
