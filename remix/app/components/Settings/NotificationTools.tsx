import { NativePushSettings } from './NativePushSettings';
import React from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { NOTIFICATION_TYPES } from '~/schemas/registry';
import { NOTIFICATION_TYPE_META } from '../Notifications/notificationCore';
import { NOTIFICATION_TESTS } from '~/api/utils/notifications/testNotificationsCore';

export const NOTIFICATION_TOOLS_REQUIREMENTS = { 'api.notifications-test': '1.1.1', 'api.lopu-reminders': '1.0.0' } as const;
export function supportsNotificationTools(manifest: any, origin: string) {
  return manifest?.origin === origin && Object.entries(NOTIFICATION_TOOLS_REQUIREMENTS).every(([id, minimum]) => {
    const version = manifest.features?.[id]?.version ?? manifest.features?.[id];
    if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) return false;
    const [major, minor, patch] = version.split('.').map(Number), [a, b, c] = minimum.split('.').map(Number);
    return major === a && (minor > b || (minor === b && patch >= c));
  });
}
type Reminder = { id: string; title: string; enabled: boolean; everyMinutes: number | null; nextRunAt: string | null };
const request = async (path: string, body?: unknown) => {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    if (!response.ok || data.ok === false) throw new Error(data.error || 'Please retry.');
    return data;
  } finally { clearTimeout(timer); }
};

export function NotificationTools({ ownerId }: { ownerId: string }) {
  const [reminders, setReminders] = React.useState<Reminder[]>([]);
  const [ready, setReady] = React.useState(false), [busy, setBusy] = React.useState(false), [status, setStatus] = React.useState('');
  const epoch = React.useRef(0), active = React.useRef(false), mutating = React.useRef(false), revision = React.useRef(0);
  const refresh = React.useCallback(async () => {
    if (active.current || mutating.current) return;
    active.current = true;
    const sequence = epoch.current, currentRevision = revision.current;
    try {
      const manifest = await request('/.well-known/thingtime-capabilities.json');
      if (!supportsNotificationTools(manifest, window.location.origin)) throw new Error('Reminder and notification testing support is not deployed on this domain yet.');
      const data = await request('/api/v1/lopu/reminders');
      if (sequence !== epoch.current || currentRevision !== revision.current || data.ownerId !== ownerId) return;
      setReminders(data.reminders); setReady(true);
    } catch (error) { if (sequence === epoch.current && currentRevision === revision.current) setStatus(error instanceof Error ? error.message : 'Could not refresh.'); }
    finally { if (sequence === epoch.current) active.current = false; }
  }, [ownerId]);
  React.useEffect(() => {
    epoch.current++; active.current = false; mutating.current = false; setReady(false); setReminders([]); setStatus(''); setBusy(false);
    void refresh();
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 30_000);
    return () => { epoch.current++; clearInterval(timer); };
  }, [refresh]);
  const mutate = async (path: string, body: unknown) => {
    if (!ready || mutating.current) return;
    mutating.current = true; revision.current++; setBusy(true);
    const sequence = epoch.current;
    try {
      const data = await request(path, body);
      if (sequence !== epoch.current) return;
      if (data.reminder) setReminders((rows) => rows.map((row) => row.id === data.reminder.id ? data.reminder : row));
      if (path === '/api/v1/notifications/test' && data.saved) {
        window.dispatchEvent(new CustomEvent('thingtime:notification-recorded', { detail: { userId: ownerId } }));
      }
      setStatus(data.message || 'Reminder updated.');
    } catch (error) { if (sequence === epoch.current) setStatus(error instanceof Error ? error.message : 'Please retry.'); }
    finally { if (sequence === epoch.current) { mutating.current = false; setBusy(false); } }
  };
  return <Box mt={6} pt={5} borderTop="1px solid var(--tt-border, #ececef)">
    <NativePushSettings ownerId={ownerId} />
    <Text as="h3" fontWeight="semibold" mt={5}>Test your notifications</Text>
    <Text fontSize="sm" color="var(--tt-muted)" mt={1}>Send only to your account. Your notification preferences and device permissions still apply. Urgent uses time-sensitive delivery, not Apple Critical alerts. Rich text and images appear in Thingtime; system banners use a plain-text fallback.</Text>
    <Flex wrap="wrap" gap={2} mt={3}>
      {NOTIFICATION_TESTS.map((test) => <Button key={test.id} size="sm" variant="outline" isDisabled={!ready || busy} onClick={() => void mutate('/api/v1/notifications/test', { preset: test.id })}>Send test {test.label}</Button>)}
    </Flex>
    <Box as="details" mt={4}>
      <Box as="summary" cursor="pointer">Test each notification type</Box>
      <Flex wrap="wrap" gap={2} mt={3}>
        {NOTIFICATION_TYPES.map((type) => <Button key={type} size="sm" variant="outline" height="auto" minHeight="32px" py={2} whiteSpace="normal" isDisabled={!ready || busy} onClick={() => void mutate('/api/v1/notifications/test', { preset: 'normal', type })}>Send test {NOTIFICATION_TYPE_META[type].emoji} {NOTIFICATION_TYPE_META[type].label}</Button>)}
      </Flex>
    </Box>
    <Flex mt={6} gap={3} align="center" justify="space-between"><Text as="h3" fontWeight="semibold">Lopu reminders</Text><Button size="sm" variant="outline" isDisabled={busy} onClick={() => void refresh()}>Refresh</Button></Flex>
    <Text fontSize="sm" color="var(--tt-muted)" mt={1}>Ask Lopu to remind you once or at a repeating interval. The server checks every five minutes, even while this page is closed. Late runs do not send a backlog.</Text>
    {ready && !reminders.length && <Text fontSize="sm" mt={3}>No saved reminders yet.</Text>}
    {reminders.map((row) => <Flex key={row.id} gap={3} align="center" mt={4}>
      <Box flex="1" minWidth={0}><Text overflowWrap="anywhere">{row.title}</Text><Text fontSize="xs" color="var(--tt-muted)">{!row.nextRunAt ? 'Completed' : !row.enabled ? 'Paused' : `Next: ${new Date(row.nextRunAt).toLocaleString()}`}{row.everyMinutes ? ` · Every ${row.everyMinutes} min` : ' · Once'}</Text></Box>
      <Button size="sm" variant="outline" isDisabled={busy || !row.nextRunAt} onClick={() => void mutate('/api/v1/lopu/reminders', { op: 'set-enabled', id: row.id, enabled: !row.enabled })}>{row.enabled ? 'Pause' : 'Resume'}</Button>
    </Flex>)}
    <Text role="status" aria-live="polite" fontSize="sm" mt={3}>{status}</Text>
  </Box>;
}
