import React from 'react';
import { Box, Divider, Flex, Switch, Text } from '@chakra-ui/react';

import { SettingsSection } from './SettingsSection';
import { useLopu } from '~/components/Lopu/useLopu';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { useApi } from '~/hooks/useApi';
import type { CurrentUser } from '~/hooks/useCurrentUser';
import { normalizeNotificationPrefs } from '~/schemas/registry';
import type { NormalizedNotificationPrefs } from '~/schemas/registry';

// Settings → Notifications: a per-type switch matrix with two channels —
// Push (the bell/in-app channel) and Email (SES notification emails) — plus a
// master switch per channel that mutes the whole column. Optimistic per the
// house rule — first paint from the per-user localCache, background reconcile
// from GET /api/v1/notifications/settings, each flip applies instantly and
// reverts on failure. Disabling a push type hides even already-written
// notifications of that type (the server filters reads); disabling an email
// type stops future emails.

type PrefRow = { type: string; label: string; hint: string; emailOnly?: boolean };

const PREF_ROWS: PrefRow[] = [
  { type: 'friend-request', label: 'Friend requests 🤝', hint: 'Someone asks to be your friend' },
  { type: 'friend-accepted', label: 'Request accepted 💚', hint: 'A friend request you sent is accepted' },
  { type: 'new-follower', label: 'New followers 👀', hint: 'Someone starts following you' },
  {
    type: 'post-from-followed',
    label: 'Posts from people you follow 📰',
    hint: 'New posts by accounts you follow — email is opt-in'
  },
  {
    type: 'post-from-friend',
    label: 'Posts from friends 🫶',
    hint: 'New posts by your friends — email is opt-in'
  },
  { type: 'comment', label: 'Comments 💬', hint: 'Comments on your posts' },
  { type: 'reply', label: 'Replies ↩️', hint: 'Replies to your comments' },
  { type: 'reaction', label: 'Reactions 🤣', hint: 'Reactions on your posts and comments' },
  { type: 'share', label: 'Shares 🔁', hint: 'Your posts get reposted' },
  { type: 'mention', label: 'Mentions 📣', hint: 'Someone @mentions you in a post or comment' },
  { type: 'groups', label: 'Groups 👥', hint: 'Group activity — ready for when groups arrive ✨' },
  {
    type: 'weekly-summary',
    label: 'Weekly summary ✨',
    hint: 'One email a week recapping activity around your things',
    emailOnly: true
  }
];

const MONO = 'var(--tt-font-mono, ui-monospace, Menlo, monospace)';
const COL_WIDTH = '44px';

type Channel = 'push' | 'email' | 'masters';

const SwitchCell = (props: {
  checked: boolean;
  disabled: boolean;
  dimmed?: boolean;
  onChange: (enabled: boolean) => void;
  ariaLabel: string;
}) => (
  <Flex width={COL_WIDTH} justifyContent="center" flexShrink={0} opacity={props.dimmed ? 0.4 : 1}>
    <Switch
      aria-label={props.ariaLabel}
      isChecked={props.checked}
      isDisabled={props.disabled}
      onChange={(event) => props.onChange(event.target.checked)}
    />
  </Flex>
);

const RowShell = (props: { label: React.ReactNode; hint?: string; children: React.ReactNode }) => (
  <Flex alignItems="center" columnGap={3} paddingY={2} whiteSpace="normal">
    <Box minWidth={0} flex="1">
      <Text fontSize="sm" color="var(--tt-ink, #16161a)">
        {props.label}
      </Text>
      {props.hint && (
        <Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">
          {props.hint}
        </Text>
      )}
    </Box>
    <Flex columnGap={2} flexShrink={0}>
      {props.children}
    </Flex>
  </Flex>
);

export const NotificationSettingsSection = (props: { user: NonNullable<CurrentUser> }) => {
  const { user } = props;
  const api = useApi();
  const lopu = useLopu();

  const cacheKey = `tt-notif-prefs-v2-${user.id}`;
  const [prefs, setPrefs] = React.useState<NormalizedNotificationPrefs>(() =>
    normalizeNotificationPrefs(readLocalCache<Record<string, any>>(cacheKey))
  );
  const [saving, setSaving] = React.useState<string | null>(null);

  React.useEffect(() => {
    setPrefs(normalizeNotificationPrefs(readLocalCache<Record<string, any>>(cacheKey)));
    let cancelled = false;
    api.v1.notifications.settings
      .get()
      .then((resp: any) => {
        if (cancelled || !resp?.prefs) return;
        const next = normalizeNotificationPrefs(resp.prefs);
        setPrefs(next);
        writeLocalCache(cacheKey, next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // api method + cacheKey are both stable per user id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  const handleToggle = async (channel: Channel, key: string, enabled: boolean) => {
    if (saving) return;
    const previous = prefs;
    const optimistic: NormalizedNotificationPrefs =
      channel === 'masters'
        ? { ...prefs, masters: { ...prefs.masters, [key]: enabled } }
        : { ...prefs, [channel]: { ...prefs[channel], [key]: enabled } };
    setPrefs(optimistic);
    setSaving(`${channel}:${key}`);
    try {
      const body =
        channel === 'masters' ? { masters: { [key]: enabled } } : { [channel]: { [key]: enabled } };
      const resp: any = await api.v1.notifications.settings.set({ prefs: body });
      const next = normalizeNotificationPrefs(resp?.prefs || optimistic);
      setPrefs(next);
      writeLocalCache(cacheKey, next);
    } catch (err: any) {
      setPrefs(previous);
      lopu({
        title: 'Could not update notifications 😔',
        description: err?.error || 'Please try again in a moment.',
        status: 'error',
        duration: 6000
      });
    } finally {
      setSaving(null);
    }
  };

  const columnHeader = (label: string) => (
    <Text
      width={COL_WIDTH}
      textAlign="center"
      fontFamily={MONO}
      fontSize="10px"
      fontWeight={600}
      letterSpacing="0.08em"
      textTransform="uppercase"
      color="var(--tt-muted, #9a9aa6)"
      flexShrink={0}
    >
      {label}
    </Text>
  );

  return (
    <SettingsSection
      eyebrow="Notifications"
      description="Pick what lands in your bell 🔔 and your inbox 📬 — each type has its own push and email switch, and the top row mutes a whole channel."
    >
      <Flex flexDirection="column">
        <Flex alignItems="center" columnGap={3} paddingBottom={1}>
          <Box minWidth={0} flex="1" />
          <Flex columnGap={2} flexShrink={0}>
            {columnHeader('Push')}
            {columnHeader('Email')}
          </Flex>
        </Flex>

        <RowShell label="All notifications" hint="Master switches — mute a whole channel at once">
          <SwitchCell
            ariaLabel="All push notifications"
            checked={prefs.masters.push}
            disabled={saving === 'masters:push'}
            onChange={(enabled) => handleToggle('masters', 'push', enabled)}
          />
          <SwitchCell
            ariaLabel="All email notifications"
            checked={prefs.masters.email}
            disabled={saving === 'masters:email'}
            onChange={(enabled) => handleToggle('masters', 'email', enabled)}
          />
        </RowShell>

        <Divider marginY={1} borderColor="var(--tt-border, #ececef)" />

        {PREF_ROWS.map((row) => (
          <RowShell key={row.type} label={row.label} hint={row.hint}>
            {row.emailOnly ? (
              <Flex width={COL_WIDTH} justifyContent="center" flexShrink={0}>
                <Text fontSize="sm" color="var(--tt-muted, #9a9aa6)" aria-hidden="true">
                  —
                </Text>
              </Flex>
            ) : (
              <SwitchCell
                ariaLabel={`Push: ${row.label}`}
                checked={prefs.push[row.type] !== false}
                disabled={!prefs.masters.push || saving === `push:${row.type}`}
                dimmed={!prefs.masters.push}
                onChange={(enabled) => handleToggle('push', row.type, enabled)}
              />
            )}
            <SwitchCell
              ariaLabel={`Email: ${row.label}`}
              checked={prefs.email[row.type] === true}
              disabled={!prefs.masters.email || saving === `email:${row.type}`}
              dimmed={!prefs.masters.email}
              onChange={(enabled) => handleToggle('email', row.type, enabled)}
            />
          </RowShell>
        ))}
      </Flex>
    </SettingsSection>
  );
};
