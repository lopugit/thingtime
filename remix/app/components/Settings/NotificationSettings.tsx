import React from 'react';
import { Flex, Switch } from '@chakra-ui/react';

import { SettingRow, SettingsSection } from './SettingsSection';
import { useLopu } from '~/components/Lopu/useLopu';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { useApi } from '~/hooks/useApi';
import type { CurrentUser } from '~/hooks/useCurrentUser';

// Settings → Notifications: per-type switches for what lands in your bell.
// Optimistic per the house rule — first paint from the per-user localCache,
// background reconcile from GET /api/v1/notifications/settings, each flip
// applies instantly and reverts on failure. Disabling a type hides even
// already-written notifications of that type (the server filters reads).

type PrefRow = { type: string; label: string; hint: string };

const PREF_ROWS: PrefRow[] = [
  { type: 'friend-request', label: 'Friend requests 🤝', hint: 'Someone asks to be your friend' },
  { type: 'friend-accepted', label: 'Request accepted 💚', hint: 'A friend request you sent is accepted' },
  { type: 'new-follower', label: 'New followers 👀', hint: 'Someone starts following you' },
  { type: 'post-from-followed', label: 'Posts from people you follow 📰', hint: 'New posts by accounts you follow' },
  { type: 'post-from-friend', label: 'Posts from friends 🫶', hint: 'New posts by your friends' },
  { type: 'comment', label: 'Comments 💬', hint: 'Comments on your posts' },
  { type: 'reply', label: 'Replies ↩️', hint: 'Replies to your comments' },
  { type: 'reaction', label: 'Reactions 🤣', hint: 'Reactions on your posts and comments' },
  { type: 'share', label: 'Shares 🔁', hint: 'Your posts get reposted' },
  { type: 'groups', label: 'Groups 👥', hint: 'Group activity — ready for when groups arrive ✨' }
];

// absent key = enabled (defaults ON, matching the server)
const withDefaults = (stored: Record<string, boolean> | null | undefined): Record<string, boolean> => {
  const prefs: Record<string, boolean> = {};
  for (const row of PREF_ROWS) prefs[row.type] = stored?.[row.type] !== false;
  return prefs;
};

export const NotificationSettingsSection = (props: { user: NonNullable<CurrentUser> }) => {
  const { user } = props;
  const api = useApi();
  const lopu = useLopu();

  const cacheKey = `tt-notif-prefs-${user.id}`;
  const [prefs, setPrefs] = React.useState<Record<string, boolean>>(() =>
    withDefaults(readLocalCache<Record<string, boolean>>(cacheKey))
  );
  const [savingType, setSavingType] = React.useState<string | null>(null);

  React.useEffect(() => {
    setPrefs(withDefaults(readLocalCache<Record<string, boolean>>(cacheKey)));
    let cancelled = false;
    api.v1.notifications.settings
      .get()
      .then((resp: any) => {
        if (cancelled || !resp?.prefs) return;
        const next = withDefaults(resp.prefs);
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

  const handleToggle = async (type: string, enabled: boolean) => {
    if (savingType) return;
    const previous = prefs;
    const optimistic = { ...prefs, [type]: enabled };
    setPrefs(optimistic);
    setSavingType(type);
    try {
      const resp: any = await api.v1.notifications.settings.set({ prefs: { [type]: enabled } });
      const next = withDefaults(resp?.prefs || optimistic);
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
      setSavingType(null);
    }
  };

  return (
    <SettingsSection
      eyebrow="Notifications"
      description="Pick what lands in your bell 🔔 — flips apply instantly and also hide older notifications of that type."
    >
      <Flex flexDirection="column">
        {PREF_ROWS.map((row) => (
          <SettingRow key={row.type} label={row.label} hint={row.hint}>
            <Switch
              isChecked={prefs[row.type] !== false}
              isDisabled={savingType === row.type}
              onChange={(event) => handleToggle(row.type, event.target.checked)}
            />
          </SettingRow>
        ))}
      </Flex>
    </SettingsSection>
  );
};
