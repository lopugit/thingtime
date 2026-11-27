import { OAUTH_ERROR_COPY } from './shared';

const markerKey = 'thingtime:connections-oauth-tab';
const channelPrefix = markerKey + ':';
const uuid = /^[0-9a-f-]{36}$/;

type Completion = { status: 'returned' } | { status: 'failed'; code: string };

export const openConnectionOAuthTab = (provider: string, onReturn: (result: Completion) => boolean) => {
  const popup = window.open('about:blank', '_blank');
  if (!popup) return null;

  let channel: BroadcastChannel | undefined;
  try {
    // The blank tab starts same-origin. Remove its opener before sending it to
    // the provider. The one-use channel name stays in this tab's session storage.
    popup.opener = null;
    popup.document.title = 'Opening sign-in';
    popup.document.body.textContent = 'Opening sign-in…';
    const id = crypto.randomUUID();
    popup.sessionStorage.setItem(markerKey, JSON.stringify({ id, provider }));
    channel = new BroadcastChannel(channelPrefix + id);
    channel.onmessage = ({ data, origin }) => {
      if (origin !== window.location.origin) return;
      const result = data?.status === 'returned' ? { status: 'returned' } as const
        : data?.status === 'failed' && typeof data.code === 'string' ? { status: 'failed', code: data.code } as const : null;
      if (!result) return;
      if (onReturn(result)) {
        channel?.postMessage({ status: 'received' });
        channel?.close();
      }
    };
    return {
      navigate(url: string) {
        if (popup.closed) return false;
        const authorize = new URL(url);
        if (authorize.protocol !== 'https:' || authorize.username || authorize.password) throw new Error('Invalid sign-in URL');
        popup.location.replace(authorize.href);
        return true;
      },
      cancel() {
        channel?.close();
        if (!popup.closed) popup.close();
      }
    };
  } catch (error) {
    channel?.close();
    popup.close();
    throw error;
  }
};

// The callback uses the existing allowlisted redirect. This message only
// wakes a fresh authorized list read. It cannot prove or create a grant.
export const notifyConnectionOAuthReturn = (connected: string | null, code: string | null) => {
  try {
    const raw = window.sessionStorage.getItem(markerKey);
    if (!raw) return;
    const { id, provider } = JSON.parse(raw);
    if (typeof id !== 'string' || !uuid.test(id) || typeof provider !== 'string' || (connected !== provider && !code)) return;
    window.sessionStorage.removeItem(markerKey);
    const channel = new BroadcastChannel(channelPrefix + id);
    const timeout = window.setTimeout(() => channel.close(), 3000);
    channel.onmessage = ({ data, origin }) => {
      if (origin !== window.location.origin || data?.status !== 'received') return;
      window.clearTimeout(timeout);
      channel.close();
      window.close();
    };
    const errorCode = code && OAUTH_ERROR_COPY.has(code) ? code : 'failed';
    channel.postMessage(connected === provider ? { status: 'returned' } : { status: 'failed', code: errorCode });
  } catch {
    // Leave the callback tab as a normal Connections page if the channel fails.
  }
};
