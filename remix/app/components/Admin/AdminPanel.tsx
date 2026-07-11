import React from 'react';
import { Box, Button, Flex, Input, Spinner, Switch, Text } from '@chakra-ui/react';

import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useLopu } from '~/components/Lopu/useLopu';

// Admin-only control panel (rendered from SettingsPage when user.isAdmin).
// Lets admins tune the global rate limits and grant/revoke admin on other
// users. Every action re-checks admin server-side; this UI is just the surface.

type Rule = { limit: number; windowMs: number; enabled: boolean };
type Config = Record<string, Rule>;
type AdminRow = { id: string; username: string; displayName: string | null; email?: string; isAdmin: boolean; envAdmin: boolean };

const eyebrow = {
  fontSize: '10px',
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase' as const,
  opacity: 0.45
};

const ENDPOINT_LABELS: Record<string, string> = {
  'things.react': 'Reactions',
  'things.comment': 'Comments'
};

const RateLimitEditor = () => {
  const api = useApi();
  const lopu = useLopu();
  const [config, setConfig] = React.useState<Config | null>(null);
  const [endpoints, setEndpoints] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState(false);

  const apiRef = React.useRef(api);
  apiRef.current = api;

  React.useEffect(() => {
    let cancelled = false;
    apiRef.current.v1.admin
      .rateLimits()
      .then((resp: any) => {
        if (cancelled || !resp?.ok) return;
        setConfig(resp.config);
        setEndpoints(resp.endpoints || Object.keys(resp.config || {}));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const patch = (name: string, next: Partial<Rule>) =>
    setConfig((prev) => (prev ? { ...prev, [name]: { ...prev[name], ...next } } : prev));

  const save = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const resp = await apiRef.current.v1.admin.setRateLimits(config);
      if (resp?.ok) {
        setConfig(resp.config);
        lopu({ title: 'Rate limits saved ✨', status: 'success', duration: 5000 });
      } else {
        lopu({ title: 'Could not save rate limits', description: resp?.error, status: 'error' });
      }
    } catch (err: any) {
      lopu({ title: 'Could not save rate limits', description: err?.error, status: 'error' });
    } finally {
      setSaving(false);
    }
  };

  if (!config) {
    return (
      <Flex justifyContent="center" padding={3}>
        <Spinner size="sm" />
      </Flex>
    );
  }

  return (
    <Flex flexDirection="column" rowGap={3}>
      <Text sx={eyebrow}>Rate limits</Text>
      {endpoints.map((name) => {
        const rule = config[name];
        if (!rule) return null;
        return (
          <Flex
            key={name}
            alignItems="center"
            columnGap={2}
            rowGap={1}
            flexWrap="wrap"
            padding={2}
            borderRadius="var(--tt-radius-sm, 9px)"
            background="var(--tt-surface-alt, #f5f5f7)"
          >
            <Text fontSize="sm" fontWeight={600} minWidth="90px">
              {ENDPOINT_LABELS[name] || name}
            </Text>
            <Flex alignItems="center" columnGap={1}>
              <Input
                size="xs"
                width="64px"
                type="number"
                value={rule.limit}
                onChange={(e) => patch(name, { limit: Math.max(1, Math.floor(Number(e.target.value) || 0)) })}
                aria-label={`${name} limit`}
              />
              <Text fontSize="xs" opacity={0.7}>
                per
              </Text>
              <Input
                size="xs"
                width="64px"
                type="number"
                value={Math.round(rule.windowMs / 1000)}
                onChange={(e) => patch(name, { windowMs: Math.max(1, Math.floor(Number(e.target.value) || 0)) * 1000 })}
                aria-label={`${name} window seconds`}
              />
              <Text fontSize="xs" opacity={0.7}>
                sec
              </Text>
            </Flex>
            <Flex alignItems="center" columnGap={1} marginLeft="auto">
              <Text fontSize="xs" opacity={0.7}>
                {rule.enabled ? 'On' : 'Off'}
              </Text>
              <Switch
                size="sm"
                isChecked={rule.enabled}
                onChange={(e) => patch(name, { enabled: e.target.checked })}
                aria-label={`${name} enabled`}
              />
            </Flex>
          </Flex>
        );
      })}
      <Flex>
        <Button size="xs" variant="outline" isLoading={saving} onClick={save}>
          Save rate limits 💾
        </Button>
      </Flex>
    </Flex>
  );
};

const AdminManager = () => {
  const api = useApi();
  const lopu = useLopu();
  const me = useCurrentUser();
  const [admins, setAdmins] = React.useState<AdminRow[]>([]);
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<AdminRow[]>([]);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const apiRef = React.useRef(api);
  apiRef.current = api;

  const refresh = React.useCallback(async (q?: string) => {
    try {
      const resp = await apiRef.current.v1.admin.users(q ? { q } : undefined);
      if (resp?.ok) {
        setAdmins(resp.admins || []);
        if (q !== undefined) setResults(resp.results || []);
      }
    } catch {
      // leave last-known
    }
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const search = async () => {
    await refresh(query.trim());
  };

  const setAdmin = async (row: AdminRow, admin: boolean) => {
    setBusyId(row.id);
    try {
      const resp = await apiRef.current.v1.admin.setAdmin({ userId: row.id, admin });
      if (resp?.ok) {
        lopu({
          title: admin ? `@${row.username} is now an admin ✨` : `@${row.username} is no longer an admin`,
          status: 'success',
          duration: 5000
        });
        await refresh(query.trim() || undefined);
      } else {
        lopu({ title: 'Could not update admin', description: resp?.error, status: 'error' });
      }
    } catch (err: any) {
      lopu({ title: 'Could not update admin', description: err?.error, status: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  const row = (r: AdminRow) => (
    <Flex key={r.id} alignItems="center" columnGap={2} padding={2} borderRadius="var(--tt-radius-sm, 9px)" _hover={{ background: 'var(--tt-surface-hover, #ececee)' }}>
      <Box minWidth={0} flex="1 1 auto">
        <Text fontSize="sm" fontWeight={600} noOfLines={1}>
          {r.displayName || r.username}
          {r.envAdmin && (
            <Text as="span" fontSize="xs" opacity={0.6} fontWeight={400}>
              {' '}· env admin
            </Text>
          )}
        </Text>
        <Text fontSize="xs" opacity={0.6} noOfLines={1}>
          @{r.username}
        </Text>
      </Box>
      {r.isAdmin ? (
        <Button
          size="xs"
          variant="outline"
          isLoading={busyId === r.id}
          isDisabled={r.envAdmin || r.id === me?.id}
          title={r.envAdmin ? 'Env-allowlist admins can’t be demoted here' : r.id === me?.id ? 'You can’t demote yourself' : undefined}
          onClick={() => setAdmin(r, false)}
        >
          Demote
        </Button>
      ) : (
        <Button size="xs" variant="outline" isLoading={busyId === r.id} onClick={() => setAdmin(r, true)}>
          Promote
        </Button>
      )}
    </Flex>
  );

  return (
    <Flex flexDirection="column" rowGap={3}>
      <Text sx={eyebrow}>Admins</Text>
      <Flex flexDirection="column" rowGap={0}>{admins.length ? admins.map(row) : <Text fontSize="xs" opacity={0.6}>No DB-flagged admins yet.</Text>}</Flex>

      <Text sx={eyebrow}>Promote a user</Text>
      <Flex columnGap={2}>
        <Input
          size="sm"
          placeholder="🔍 username or email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              search();
            }
          }}
          sx={{ background: 'var(--tt-surface-alt, #f5f5f7)', border: '1px solid transparent', borderRadius: 'var(--tt-radius-sm, 9px)' }}
        />
        <Button size="sm" variant="outline" onClick={search} flexShrink={0}>
          Search
        </Button>
      </Flex>
      {results.length > 0 && <Flex flexDirection="column" rowGap={0}>{results.map(row)}</Flex>}
    </Flex>
  );
};

export const AdminPanel = () => (
  <Flex flexDirection="column" rowGap={5}>
    <RateLimitEditor />
    <AdminManager />
  </Flex>
);
