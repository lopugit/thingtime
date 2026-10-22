import React from 'react';
import { Box, Button, Flex, Input, Spinner, Switch, Text } from '@chakra-ui/react';

import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useLopu } from '~/components/Lopu/useLopu';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';

// Admin-only control panel (rendered from SettingsPage when user.isAdmin).
// Lets admins tune the global rate limits, control secure-field storage, and
// grant/revoke admin on other users. Every action re-checks admin server-side;
// this UI is just the surface.

type Rule = { limit: number; windowMs: number; enabled: boolean };
type Config = Record<string, Rule>;
type SecureFieldsCfg = Record<string, { secure: boolean }>;
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
  'things.comment': 'Comments',
  'mongodb.query': 'MongoDB queries'
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

const SECURE_FIELDS_CACHE_KEY = 'tt-admin-secure-fields';

const SECURE_FIELD_LABELS: Record<string, { label: string; blurb: string }> = {
  email: {
    label: 'Email address',
    blurb: 'User emails on user things (the secure BinData blob is always the source of truth).'
  }
};

// Per-field secure-storage toggles. Secure = blob-only (BinData, invisible to
// the wildcard text index). Plaintext = a root mirror field is maintained so
// admins can query the DB directly while debugging; flipping runs the
// users-email-mirror-sync migration server-side. Going plaintext needs an
// explicit inline confirm — it puts real addresses into the search index's
// token stream, so it should never happen by mis-tap.
const SecureFieldsEditor = () => {
  const api = useApi();
  const lopu = useLopu();
  // paint the last-known config instantly (optimistic house rule); the server
  // refetch below reconciles — spinner only on a true cold start
  const [config, setConfig] = React.useState<SecureFieldsCfg | null>(() =>
    readLocalCache<SecureFieldsCfg>(SECURE_FIELDS_CACHE_KEY)
  );
  const [confirming, setConfirming] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const apiRef = React.useRef(api);
  apiRef.current = api;

  React.useEffect(() => {
    let cancelled = false;
    apiRef.current.v1.admin
      .secureFields()
      .then((resp: any) => {
        if (cancelled || !resp?.ok) return;
        setConfig(resp.config);
        writeLocalCache(SECURE_FIELDS_CACHE_KEY, resp.config);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const apply = async (name: string, secure: boolean) => {
    setConfirming(null);
    setBusy(name);
    const prev = config;
    setConfig((c) => (c ? { ...c, [name]: { secure } } : c));
    try {
      const resp = await apiRef.current.v1.admin.setSecureFields({ [name]: { secure } });
      if (resp?.ok) {
        setConfig(resp.config);
        writeLocalCache(SECURE_FIELDS_CACHE_KEY, resp.config);
        const synced = resp.report?.migrated ?? 0;
        lopu({
          title: secure ? 'Secure blobbing back on 🔐' : 'Plaintext mirrors on ⚠️',
          description: `${synced} user thing${synced === 1 ? '' : 's'} reconciled.`,
          status: secure ? 'success' : 'warning',
          duration: 5000
        });
      } else {
        setConfig(prev);
        lopu({ title: 'Could not update secure fields', description: resp?.error, status: 'error' });
      }
    } catch (err: any) {
      setConfig(prev);
      lopu({ title: 'Could not update secure fields', description: err?.error, status: 'error' });
    } finally {
      setBusy(null);
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
      <Text sx={eyebrow}>Secure fields</Text>
      {Object.entries(config).map(([name, rule]) => {
        const meta = SECURE_FIELD_LABELS[name] || { label: name, blurb: '' };
        return (
          <Flex
            key={name}
            flexDirection="column"
            rowGap={2}
            padding={2}
            borderRadius="var(--tt-radius-sm, 9px)"
            background="var(--tt-surface-alt, #f5f5f7)"
          >
            <Flex alignItems="center" columnGap={2}>
              <Box minWidth={0} flex="1 1 auto">
                <Text fontSize="sm" fontWeight={600}>
                  {meta.label}
                </Text>
                <Text fontSize="xs" opacity={0.6}>
                  {rule.secure
                    ? 'Secure blob only — hidden from the search index, not directly queryable.'
                    : 'Plaintext mirror on — queryable in the DB, tokenized by the search index.'}
                </Text>
              </Box>
              <Flex alignItems="center" columnGap={1} flexShrink={0}>
                <Text fontSize="xs" opacity={0.7}>
                  {rule.secure ? 'Secure' : 'Plaintext'}
                </Text>
                <Switch
                  size="sm"
                  isChecked={rule.secure}
                  isDisabled={busy === name}
                  onChange={(e) => {
                    if (e.target.checked) apply(name, true);
                    else setConfirming(name);
                  }}
                  aria-label={`${meta.label} secure blobbing`}
                />
              </Flex>
            </Flex>
            {confirming === name && (
              <Flex flexDirection="column" rowGap={2} padding={2} borderRadius="var(--tt-radius-sm, 9px)" border="1px solid var(--tt-border, #e2e2e6)">
                <Text fontSize="xs">
                  ⚠️ Plaintext mode writes a root <code>{name}</code> field on every user thing so the DB can be
                  queried directly. The wildcard text index will tokenize those values (search results still exclude
                  user things, but the index entries exist). Keep production secure.
                </Text>
                <Flex columnGap={2}>
                  <Button size="xs" variant="outline" isLoading={busy === name} onClick={() => apply(name, false)}>
                    Store plaintext mirrors
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => setConfirming(null)}>
                    Cancel
                  </Button>
                </Flex>
              </Flex>
            )}
          </Flex>
        );
      })}
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
    <SecureFieldsEditor />
    <AdminManager />
  </Flex>
);
