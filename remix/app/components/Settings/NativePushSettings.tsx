import React from 'react';
import { getNativeBridge } from '~/utils/nativeBridge';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';

type DeviceStatus = { configured: boolean; devices: { ios: number; watchos: number } };
export function NativePushSettings({ ownerId }: { ownerId: string }) {
  const [server, setServer] = React.useState<DeviceStatus | null>(null);
  const [native, setNative] = React.useState<{ message?: string; authorization?: string; registration?: string } | null>(null);
  const [available, setAvailable] = React.useState(false);
  const [error, setError] = React.useState('');
  const bridge = getNativeBridge;
  const send = (action: string) => bridge()?.postMessage({ type: 'notification-settings', payload: { ownerId, action } });
  React.useEffect(() => {
    let cancelled = false, running = false;
    setServer(null); setNative(null); setError('');
    const refresh = async (syncNative = true) => {
      if (running) return;
      running = true;
      const supported = bridge()?.notificationsVersion === '1.0.0';
      setAvailable(supported);
      if (supported && syncNative) send('status');
      try {
        await requireThingtimeCapability('api.notifications-devices', '1.2.0');
        const response = await fetch('/api/v1/notifications/devices', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15_000) });
        const data = await response.json();
        if (!response.ok || data.ownerId !== ownerId) throw new Error('Could not check connected devices.');
        if (!cancelled) { setServer(data); setError(''); }
      } catch { if (!cancelled) setError('Device status is unavailable. Refresh after reconnecting.'); }
      finally { running = false; }
    };
    const receive = (event: Event) => {
      const message = (event as CustomEvent).detail;
      if (message?.type === 'notification-status' && message.payload?.ownerId === ownerId) { setNative(message.payload); void refresh(false); }
      if (message?.type === 'native-ready' || message?.type === 'native-push-registration-changed') void refresh();
    };
    const visible = () => { if (!document.hidden) void refresh(); };
    window.addEventListener('thingtime:native-message', receive);
    window.addEventListener('thingtime:native-bridge-ready', visible);
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    void refresh();
    return () => { cancelled = true; window.removeEventListener('thingtime:native-message', receive); window.removeEventListener('thingtime:native-bridge-ready', visible); window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', visible); };
    // The bridge is resolved at each event; all state belongs to this account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId]);
  return <Box mt={5}>
    <Text as="h3" fontWeight="semibold">iPhone and Watch push</Text>
    <Text fontSize="sm" mt={1}>{server ? !server.configured ? 'Native push needs server setup.' : `${server.devices.ios} iPhone and ${server.devices.watchos} Watch registration(s) connected to this account.` : error ? 'Connected devices could not be checked.' : 'Checking connected devices…'}</Text>
    {native && <Text fontSize="sm" mt={1} role="status">{native.message || `This iPhone: notifications ${native.authorization || 'unknown'}; ${native.registration === 'registered' ? 'connected to Thingtime' : native.registration === 'failed' ? 'connection failed — retry below' : 'waiting for Apple registration'}.`}</Text>}
    <Flex wrap="wrap" gap={2} mt={3}>
      {available ? <><Button size="sm" variant="outline" onClick={() => send('enable')}>Enable / reconnect iPhone push</Button><Button size="sm" variant="outline" onClick={() => send('open-settings')}>iPhone notification settings</Button></> : <Text fontSize="sm">Open the latest Thingtime iPhone app to enable or reconnect push notifications.</Text>}
    </Flex>
    {error && <Text fontSize="sm" mt={2}>{error}</Text>}
  </Box>;
}
