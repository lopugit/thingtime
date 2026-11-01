import React from 'react';
import { Badge, Box, Button, Divider, Flex, Input, InputGroup, InputRightElement, Select, Text } from '@chakra-ui/react';
import { useRevalidator } from 'react-router';

import { useLopu } from '~/components/Lopu/useLopu';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';

type ActiveEndpoint = {
  custom: boolean;
  host: string | null;
  dbName: string | null;
  savedId: string | null;
};

type SavedEndpoint = {
  id: string;
  name: string;
  host: string | null;
  dbName: string | null;
  createdAt: string;
  active: boolean;
};

type EndpointCache = {
  endpoint: ActiveEndpoint;
  defaultHost: string | null;
  endpoints: SavedEndpoint[];
};

const CACHE_KEY = 'tt-mongo-endpoint';

const DEFAULT_ACTIVE: ActiveEndpoint = { custom: false, host: null, dbName: 'thingtime', savedId: null };

const MonoLabel = ({ children }: { children: React.ReactNode }) => (
  <Text
    color="var(--tt-muted, #718096)"
    fontFamily="mono"
    fontSize="11px"
    letterSpacing="0.12em"
    textTransform="uppercase"
  >
    {children}
  </Text>
);

// A password-masked input with its own show/hide toggle — connection details
// (hosts included) stay unreadable on a shared screen until deliberately
// revealed. autoComplete="new-password" keeps password managers from offering
// to save or autofill these; values live only in component state and the POST
// body, never in localCache.
const SecretInput = (props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  isDisabled?: boolean;
  flex?: string | number;
  minW?: string;
}) => {
  const [shown, setShown] = React.useState(false);
  return (
    <InputGroup size="sm" flex={props.flex} minW={props.minW} width={props.flex ? undefined : 'auto'}>
      <Input
        type={shown ? 'text' : 'password'}
        fontFamily="mono"
        aria-label={props.label}
        placeholder={props.placeholder}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        autoComplete="new-password"
        spellCheck={false}
        maxLength={props.maxLength}
        isDisabled={props.isDisabled}
        pr="2.4rem"
      />
      <InputRightElement width="2.4rem">
        <Button
          size="xs"
          variant="ghost"
          aria-label={`${shown ? 'Hide' : 'Show'} ${props.label}`}
          onClick={() => setShown((value) => !value)}
          isDisabled={props.isDisabled}
          tabIndex={-1}
        >
          {shown ? '🙈' : '👁'}
        </Button>
      </InputRightElement>
    </InputGroup>
  );
};

const EMPTY_FIELDS = { user: '', pass: '', host: '', port: '', database: '' };
type UriFields = typeof EMPTY_FIELDS;
type MongoScheme = 'mongodb' | 'mongodb+srv';

// Compose a connection URI from the individual fields. Credentials only attach
// when a user is present (Mongo forbids password-only), srv URIs never carry a
// port, and user/password/database are URI-encoded so special characters can't
// corrupt the URL. An empty host composes '' so the shared `url` state keeps
// the action buttons disabled.
const composeMongoUrl = (scheme: MongoScheme, fields: UriFields): string => {
  const host = fields.host.trim();
  if (!host) return '';
  const user = fields.user.trim();
  const credentials = user
    ? `${encodeURIComponent(user)}${fields.pass ? `:${encodeURIComponent(fields.pass)}` : ''}@`
    : '';
  const port = scheme === 'mongodb' && fields.port.trim() ? `:${fields.port.trim()}` : '';
  const database = fields.database.trim() ? `/${encodeURIComponent(fields.database.trim())}` : '';
  return `${scheme}://${credentials}${host}${port}${database}`;
};

// Best-effort split of a pasted URI into fields (prefills the fields mode).
const parseMongoUrl = (raw: string): { scheme: MongoScheme; fields: UriFields } | null => {
  const match = raw
    .trim()
    .match(/^(mongodb(?:\+srv)?):\/\/(?:([^:@/]*)(?::([^@/]*))?@)?([^/:?]+)(?::(\d+))?(?:\/([^?]*))?/i);
  if (!match) return null;
  const decode = (value?: string) => {
    if (!value) return '';
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };
  return {
    scheme: match[1].toLowerCase() as MongoScheme,
    fields: {
      user: decode(match[2]),
      pass: decode(match[3]),
      host: match[4] || '',
      port: match[5] || '',
      database: decode(match[6])
    }
  };
};

// Manage which MongoDB the data plane uses for this browser session
// (thin-frontend mode). Anonymous sessions can set a session-only override;
// signed-in users additionally keep a persisted list of saved endpoints with
// Thingtime as the ever-present default. Optimistic-rendering house rule:
// last-known state paints instantly from localCache, then reconciles with the
// API in the background.
export const MongoEndpointConfig = () => {
  const api = useApi();
  const lopu = useLopu();
  const user = useCurrentUser();
  const revalidator = useRevalidator();

  const cached = React.useMemo(() => readLocalCache<EndpointCache>(CACHE_KEY), []);
  const [active, setActive] = React.useState<ActiveEndpoint>(cached?.endpoint ?? DEFAULT_ACTIVE);
  const [defaultHost, setDefaultHost] = React.useState<string | null>(cached?.defaultHost ?? null);
  const [saved, setSaved] = React.useState<SavedEndpoint[]>(cached?.endpoints ?? []);
  const [url, setUrl] = React.useState('');
  const [name, setName] = React.useState('');
  // 'url' = one masked connection-string input; 'fields' = per-part masked
  // inputs (user/password/host/port/database) that live-compose into `url`,
  // so the action buttons below work identically in both modes.
  const [inputMode, setInputMode] = React.useState<'url' | 'fields'>('url');
  const [scheme, setScheme] = React.useState<MongoScheme>('mongodb');
  const [fields, setFields] = React.useState<UriFields>(EMPTY_FIELDS);
  // one in-flight action at a time; the value names the button showing feedback
  const [busy, setBusy] = React.useState<string | null>(null);

  const persist = React.useCallback((next: Partial<EndpointCache>) => {
    const current = readLocalCache<EndpointCache>(CACHE_KEY);
    writeLocalCache(CACHE_KEY, {
      endpoint: next.endpoint ?? current?.endpoint ?? DEFAULT_ACTIVE,
      defaultHost: next.defaultHost !== undefined ? next.defaultHost : (current?.defaultHost ?? null),
      endpoints: next.endpoints ?? current?.endpoints ?? []
    });
  }, []);

  // Background refetch + reconcile (the cached seed already painted).
  React.useEffect(() => {
    let cancelled = false;

    api.v1.mongodb.endpoint
      .get()
      .then((data: any) => {
        if (cancelled || !data?.ok) return;
        setActive(data.endpoint);
        setDefaultHost(data.defaultHost ?? null);
        persist({ endpoint: data.endpoint, defaultHost: data.defaultHost ?? null });
      })
      .catch(() => {});

    if (user) {
      api.v1.mongodb.endpoints
        .list()
        .then((data: any) => {
          if (cancelled || !data?.ok) return;
          setSaved(data.endpoints || []);
          persist({ endpoints: data.endpoints || [] });
        })
        .catch(() => {});
    } else {
      setSaved([]);
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const markSavedActive = React.useCallback(
    (savedId: string | null) =>
      setSaved((list) => {
        const next = list.map((entry) => ({ ...entry, active: entry.id === savedId }));
        persist({ endpoints: next });
        return next;
      }),
    [persist]
  );

  const applyEndpointResponse = React.useCallback(
    (data: any) => {
      if (!data?.ok) return;
      setActive(data.endpoint);
      if (data.defaultHost !== undefined) setDefaultHost(data.defaultHost ?? null);
      persist({ endpoint: data.endpoint, defaultHost: data.defaultHost ?? null });
      markSavedActive(data.endpoint?.savedId ?? null);
      // the data plane moved — refresh this page's status loader too
      revalidator.revalidate();
    },
    [markSavedActive, persist, revalidator]
  );

  const run = React.useCallback(
    async (key: string, work: () => Promise<void>) => {
      setBusy(key);
      try {
        await work();
      } catch (err: any) {
        lopu({ title: 'MongoDB endpoint', description: err?.error || 'Something went wrong', status: 'error' });
      } finally {
        setBusy(null);
      }
    },
    [lopu]
  );

  const updateField = (key: keyof UriFields, value: string) => {
    const next = { ...fields, [key]: key === 'port' ? value.replace(/\D/g, '').slice(0, 5) : value };
    setFields(next);
    setUrl(composeMongoUrl(scheme, next));
  };

  const updateScheme = (next: MongoScheme) => {
    // srv URIs never carry a port — drop it so the composed URL stays valid
    const nextFields = next === 'mongodb+srv' ? { ...fields, port: '' } : fields;
    setScheme(next);
    setFields(nextFields);
    setUrl(composeMongoUrl(next, nextFields));
  };

  const switchMode = (mode: 'url' | 'fields') => {
    if (mode === 'fields' && inputMode !== 'fields') {
      // prefill the fields from a pasted URL when it parses
      const parsed = parseMongoUrl(url);
      if (parsed) {
        setScheme(parsed.scheme);
        setFields(parsed.fields);
        setUrl(composeMongoUrl(parsed.scheme, parsed.fields));
      }
    }
    setInputMode(mode);
  };

  const activateUrl = () =>
    run('use-url', async () => {
      const data = await api.v1.mongodb.endpoint.set({ url: url.trim() });
      applyEndpointResponse(data);
      setUrl('');
      setFields(EMPTY_FIELDS);
      lopu({
        title: 'Custom MongoDB endpoint active',
        description: `The data plane now uses ${data?.endpoint?.host || 'your endpoint'} for this browser session.`,
        status: 'success'
      });
    });

  const saveUrl = () =>
    run('save-url', async () => {
      const data = await api.v1.mongodb.endpoints.add({ name: name.trim(), url: url.trim() });
      if (data?.endpoint) {
        setSaved((list) => {
          const next = [...list, data.endpoint];
          persist({ endpoints: next });
          return next;
        });
      }
      setUrl('');
      setFields(EMPTY_FIELDS);
      setName('');
      lopu({ title: 'MongoDB endpoint saved', description: 'Select it any time from your saved endpoints.', status: 'success' });
    });

  const activateSaved = (entry: SavedEndpoint) =>
    run(`use:${entry.id}`, async () => {
      const data = await api.v1.mongodb.endpoint.set({ savedId: entry.id });
      applyEndpointResponse(data);
      lopu({
        title: 'MongoDB endpoint active',
        description: `The data plane now uses ${entry.name || entry.host} for this browser session.`,
        status: 'success'
      });
    });

  const removeSaved = (entry: SavedEndpoint) =>
    run(`remove:${entry.id}`, async () => {
      const data = await api.v1.mongodb.endpoints.remove({ id: entry.id });
      setSaved((list) => {
        const next = list.filter((item) => item.id !== entry.id);
        persist({ endpoints: next });
        return next;
      });
      if (data?.clearedActive) {
        applyEndpointResponse({ ok: true, endpoint: DEFAULT_ACTIVE, defaultHost });
      }
      lopu({ title: 'MongoDB endpoint removed', status: 'info' });
    });

  const resetToDefault = () =>
    run('reset', async () => {
      const data = await api.v1.mongodb.endpoint.set({ reset: true });
      applyEndpointResponse(data);
      lopu({ title: 'Back to the Thingtime database', description: 'The default data endpoint is active again.', status: 'success' });
    });

  const activeLabel = active.custom
    ? `${active.host || 'custom endpoint'} / ${active.dbName || 'thingtime'}`
    : `Thingtime (default)${defaultHost ? ` — ${defaultHost}` : ''}`;

  return (
    <Flex flexDirection="column" rowGap={4}>
      <Flex alignItems="center" columnGap={3} flexWrap="wrap" rowGap={2}>
        <MonoLabel>Data endpoint</MonoLabel>
        {active.custom && (
          <Badge colorScheme="purple" borderRadius="md">
            Custom
          </Badge>
        )}
      </Flex>

      <Text fontSize="sm" fontFamily="mono" wordBreak="break-word">
        {activeLabel}
      </Text>

      <Text color="var(--tt-muted, #718096)" fontSize="sm">
        Point the Thingtime data plane (posts, comments, reactions, schemas, free-form data) at any MongoDB you can
        reach — your login, themes and account always stay on Thingtime. The override lasts for this browser session
        {user ? ', and saved endpoints stay on your account.' : '. Sign in to save endpoints for later.'}
      </Text>

      {/* Thingtime default + the user's saved endpoints */}
      <Flex flexDirection="column" rowGap={2}>
        <Flex alignItems="center" columnGap={3} justifyContent="space-between" flexWrap="wrap" rowGap={2}>
          <Box>
            <Text fontSize="sm" fontWeight="600">
              Thingtime
            </Text>
            <Text color="var(--tt-muted, #718096)" fontSize="xs" fontFamily="mono">
              {defaultHost || 'default database'}
            </Text>
          </Box>
          {active.custom ? (
            <Button size="xs" onClick={resetToDefault} isLoading={busy === 'reset'} loadingText="Switching…">
              Use
            </Button>
          ) : (
            <Badge colorScheme="green" borderRadius="md">
              Active
            </Badge>
          )}
        </Flex>

        {user &&
          saved.map((entry) => {
            const isActive = active.custom && (active.savedId === entry.id || entry.active);
            return (
              <Flex
                key={entry.id}
                alignItems="center"
                columnGap={3}
                justifyContent="space-between"
                flexWrap="wrap"
                rowGap={2}
              >
                <Box>
                  <Text fontSize="sm" fontWeight="600">
                    {entry.name || entry.host}
                  </Text>
                  <Text color="var(--tt-muted, #718096)" fontSize="xs" fontFamily="mono">
                    {entry.host}
                    {entry.dbName ? ` / ${entry.dbName}` : ''}
                  </Text>
                </Box>
                <Flex alignItems="center" columnGap={2}>
                  {isActive ? (
                    <Badge colorScheme="green" borderRadius="md">
                      Active
                    </Badge>
                  ) : (
                    <Button
                      size="xs"
                      onClick={() => activateSaved(entry)}
                      isLoading={busy === `use:${entry.id}`}
                      loadingText="Switching…"
                    >
                      Use
                    </Button>
                  )}
                  <Button
                    size="xs"
                    variant="ghost"
                    aria-label={`Remove ${entry.name || entry.host}`}
                    onClick={() => removeSaved(entry)}
                    isLoading={busy === `remove:${entry.id}`}
                  >
                    ✕
                  </Button>
                </Flex>
              </Flex>
            );
          })}
      </Flex>

      <Divider />

      {/* Add / activate a custom endpoint */}
      <Flex flexDirection="column" rowGap={2}>
        <MonoLabel>Custom endpoint</MonoLabel>
        {user && (
          <Input
            size="sm"
            placeholder="Name (optional, e.g. Homelab)"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={64}
          />
        )}
        <Flex columnGap={1}>
          <Button size="xs" variant={inputMode === 'url' ? 'solid' : 'ghost'} onClick={() => switchMode('url')}>
            Connection URL
          </Button>
          <Button size="xs" variant={inputMode === 'fields' ? 'solid' : 'ghost'} onClick={() => switchMode('fields')}>
            Individual fields
          </Button>
        </Flex>
        {inputMode === 'url' ? (
          <SecretInput
            label="MongoDB connection URL"
            placeholder="mongodb://user:password@host:27017/database"
            value={url}
            onChange={setUrl}
            flex="1"
          />
        ) : (
          <Flex flexDirection="column" rowGap={2}>
            <Flex columnGap={2} flexWrap="wrap" rowGap={2}>
              <Select
                size="sm"
                width="150px"
                aria-label="Connection scheme"
                value={scheme}
                onChange={(event) => updateScheme(event.target.value as MongoScheme)}
              >
                <option value="mongodb">mongodb://</option>
                <option value="mongodb+srv">mongodb+srv://</option>
              </Select>
              <SecretInput
                label="Host"
                placeholder="host (e.g. cluster0.abc.mongodb.net)"
                value={fields.host}
                onChange={(value) => updateField('host', value)}
                flex="1"
                minW="220px"
              />
            </Flex>
            <Flex columnGap={2} flexWrap="wrap" rowGap={2}>
              <SecretInput
                label="Username"
                placeholder="user (optional)"
                value={fields.user}
                onChange={(value) => updateField('user', value)}
                flex="1"
                minW="140px"
              />
              <SecretInput
                label="Password"
                placeholder="password (optional)"
                value={fields.pass}
                onChange={(value) => updateField('pass', value)}
                flex="1"
                minW="140px"
              />
            </Flex>
            <Flex columnGap={2} flexWrap="wrap" rowGap={2}>
              <SecretInput
                label="Port"
                placeholder={scheme === 'mongodb+srv' ? 'no port with srv' : '27017'}
                value={fields.port}
                onChange={(value) => updateField('port', value)}
                isDisabled={scheme === 'mongodb+srv'}
                minW="140px"
              />
              <SecretInput
                label="Database"
                placeholder="thingtime"
                value={fields.database}
                onChange={(value) => updateField('database', value)}
                flex="1"
                minW="140px"
              />
            </Flex>
            <Text color="var(--tt-muted, #718096)" fontSize="xs">
              Composes the connection URL for you — every value stays hidden until you toggle 👁, so nothing leaks
              on a shared screen.
            </Text>
          </Flex>
        )}
        <Flex columnGap={2} flexWrap="wrap" rowGap={2}>
          <Button
            size="sm"
            onClick={activateUrl}
            isDisabled={!url.trim()}
            isLoading={busy === 'use-url'}
            loadingText="Connecting…"
          >
            Use for this session
          </Button>
          {user && (
            <Button
              size="sm"
              variant="outline"
              onClick={saveUrl}
              isDisabled={!url.trim()}
              isLoading={busy === 'save-url'}
              loadingText="Saving…"
            >
              Save to my endpoints
            </Button>
          )}
        </Flex>
      </Flex>
    </Flex>
  );
};
