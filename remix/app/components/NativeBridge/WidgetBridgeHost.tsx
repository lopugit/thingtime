import React from 'react';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { nativeBridgeMessageEvent, postNativeBridgeMessage, type ThingtimeBridgeMessage } from '~/utils/nativeBridge';

// Only a small display projection crosses the native boundary, never auth,
// arbitrary crystal fields, hidden-link keys, attachment URLs, or HTML.
export function WidgetBridgeHost() {
  const user = useCurrentUser();
  const api = useApi();
  const apiRef = React.useRef(api);
  apiRef.current = api;
  React.useEffect(() => {
    if (!/^1\.\d+\.\d+$/.test(window.thingtimeNativeBridge?.widgetVersion ?? '')) return;
    let cancelled = false;
    let running = false;
    let enabled = false;
    postNativeBridgeMessage({ type: 'widget-clear' });
    const sync = async () => {
      if (cancelled || running || !enabled || !user?.id || user.temporary) return;
      running = true;
      try {
        await requireThingtimeCapability('api.things', '1.7.0');
        const result = await apiRef.current.v1.things.list({ limit: 50 });
        if (cancelled || !enabled) return;
        const text = (value: unknown, length: number) => typeof value === 'string' ? value.slice(0, length) : '';
        const things = (Array.isArray(result?.things) ? result.things : []).map((thing: any) => ({
          id: text(thing.id, 200),
          title: text(thing.crystal?.name || thing.crystal?.title || 'Untitled Thing', 160),
          text: text(thing.crystal?.text || thing.crystal?.description, 1200),
          kind: text(thing.thingtime?.[0], 40),
          value: typeof thing.crystal?.value === 'number' ? String(thing.crystal.value) : text(thing.crystal?.value, 100)
        }));
        postNativeBridgeMessage({ type: 'widget-snapshot', payload: { owner: user.id, things } });
      } catch {
        // Keep the bounded last-known snapshot on transient failure. Logout or
        // account changes clear it immediately; the native timeline expires it.
      } finally { running = false; }
    };
    const receive = (event: Event) => {
      const message = (event as CustomEvent<ThingtimeBridgeMessage>).detail;
      if (message?.type !== 'widget-state') return;
      enabled = (message.payload as { enabled?: boolean })?.enabled === true;
      void sync();
    };
    const refresh = () => postNativeBridgeMessage({ type: 'widget-state-request' });
    window.addEventListener(nativeBridgeMessageEvent, receive);
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(refresh, 60000);
    refresh();
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener(nativeBridgeMessageEvent, receive);
      window.removeEventListener('focus', refresh);
      postNativeBridgeMessage({ type: 'widget-clear' });
    };
  }, [user?.id, user?.temporary]);
  return null;
}
