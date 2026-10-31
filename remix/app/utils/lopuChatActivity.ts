import { getNativeBridge, postNativeBridgeMessage } from './nativeBridge';

export type NativeLopuChatActivitySnapshot = {
  ownerId: string | null;
  contextKey?: string;
  chats: { chatId: string; status: 'running' | 'retrying'; management: 'server' | 'client' }[];
};

/** A complete account-scoped snapshot. Empty chats ends the aggregate activity. */
export function syncNativeLopuChatActivity(snapshot: NativeLopuChatActivitySnapshot): boolean {
  const bridge = getNativeBridge();
  if (bridge?.platform !== 'ios' || !/^1\.\d+\.\d+$/.test(bridge.lopuChatActivityVersion ?? '')) return false;
  return postNativeBridgeMessage({ type: 'lopu-chat-activity-sync', payload: snapshot });
}
