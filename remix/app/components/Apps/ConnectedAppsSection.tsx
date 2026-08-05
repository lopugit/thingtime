import React from 'react';
import { Badge, Button, Flex, Text } from '@chakra-ui/react';
import { useNavigate } from 'react-router';

import { SettingRow, SettingsSection } from '~/components/Settings/SettingsSection';
import { useLopu } from '~/components/Lopu/useLopu';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { useApi } from '~/hooks/useApi';

// The Settings "Connected apps" section: every app with a live "Login with
// Thingtime" grant AND every app namespace still holding data (orphaned data
// stays visible — the grants list alone would hide it). Optimistic house
// rule: last-known roster paints instantly from localStorage, refetch
// reconciles in the background.

export type AppGrantRow = {
  clientId: string;
  appName: string | null;
  scopes: string[];
  sessionCount: number;
  lastGrantedAt: string | null;
};

export type AppDataRow = {
  appId: string;
  appName: string | null;
  entryCount: number;
  usedBytes: number;
  budgetBytes: number | null;
  lastUpdatedAt: string | null;
};

export const formatBytes = (bytes: number): string => {
  if (!(bytes > 0)) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

type ConnectedAppsCache = { grants: AppGrantRow[]; data: AppDataRow[] };

export const ConnectedAppsSection = ({ userId }: { userId: string }) => {
  const api = useApi();
  const lopu = useLopu();
  const navigate = useNavigate();
  const cacheKey = `tt-app-grants-${userId}`;

  const [state, setState] = React.useState<ConnectedAppsCache>(
    () => readLocalCache<ConnectedAppsCache>(cacheKey) ?? { grants: [], data: [] }
  );
  const [revoking, setRevoking] = React.useState<string | null>(null);
  const [loaded, setLoaded] = React.useState(false);

  // depend on the LEAF callbacks (stable useCallbacks) — the api wrapper
  // object itself is rebuilt every render and would loop the effect
  const grantsApi = api.v1.oauth.grants;
  const summaryApi = api.v1.apps.dataSummary;
  const refresh = React.useCallback(async () => {
    try {
      const [grantsRes, dataRes] = await Promise.all([grantsApi(), summaryApi()]);
      const next: ConnectedAppsCache = {
        grants: grantsRes?.ok ? grantsRes.grants || [] : [],
        data: dataRes?.ok ? dataRes.apps || [] : []
      };
      setState(next);
      writeLocalCache(cacheKey, next);
    } catch {
      // keep the last-known paint — background refresh only
    } finally {
      setLoaded(true);
    }
  }, [grantsApi, summaryApi, cacheKey]);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const revoke = async (clientId: string) => {
    setRevoking(clientId);
    // optimistic: the grant disappears immediately, the data row stays
    const previous = state;
    setState((current) => ({ ...current, grants: current.grants.filter((g) => g.clientId !== clientId) }));
    try {
      const result = await api.v1.oauth.revokeGrant({ clientId });
      if (result?.ok === false) throw new Error(result?.error || 'Revoke failed');
      lopu({ title: 'Access revoked', description: 'The app’s tokens stopped working. Its data stays yours.', status: 'success' });
      refresh();
    } catch (err: any) {
      setState(previous);
      lopu({ title: 'Couldn’t revoke', description: String(err?.message || err), status: 'error' });
    } finally {
      setRevoking(null);
    }
  };

  // one row per app: live grant, stored data, or both
  const rows = React.useMemo(() => {
    const byId = new Map<string, { grant?: AppGrantRow; data?: AppDataRow }>();
    for (const grant of state.grants) byId.set(grant.clientId, { grant });
    for (const data of state.data) byId.set(data.appId, { ...(byId.get(data.appId) || {}), data });
    return [...byId.entries()].map(([clientId, entry]) => ({ clientId, ...entry }));
  }, [state]);

  return (
    <SettingsSection
      eyebrow="Connected apps"
      description="Apps you’ve signed into with Thingtime — and everything they store in your account."
    >
      <Flex flexDirection="column">
        {rows.length === 0 && (
          <Text fontSize="sm" opacity={0.7} py={2}>
            {loaded ? 'No connected apps yet — apps you sign into with Thingtime show up here.' : ' '}
          </Text>
        )}
        {rows.map(({ clientId, grant, data }) => {
          const name = grant?.appName ?? data?.appName ?? null;
          return (
            <SettingRow
              key={clientId}
              label={
                // SettingRow renders labels inside a <p> — inline elements only
                <>
                  {name || 'Deleted app'}
                  {!grant && (
                    <Badge as="span" fontSize="0.6em" ml={2}>
                      no live access
                    </Badge>
                  )}
                </>
              }
              hint={
                data
                  ? `${data.entryCount} ${data.entryCount === 1 ? 'entry' : 'entries'} · ${formatBytes(data.usedBytes)} of ${data.budgetBytes === null ? 'unlimited' : formatBytes(data.budgetBytes)}`
                  : grant
                    ? `Signed in · ${grant.scopes.join(', ')}`
                    : clientId
              }
            >
              <Flex gap={2}>
                <Button size="xs" variant="outline" onClick={() => navigate(`/apps?app=${encodeURIComponent(clientId)}`)}>
                  Browse 📦
                </Button>
                {grant && (
                  <Button
                    size="xs"
                    variant="outline"
                    isDisabled={revoking === clientId}
                    onClick={() => revoke(clientId)}
                  >
                    Revoke 🔌
                  </Button>
                )}
              </Flex>
            </SettingRow>
          );
        })}
      </Flex>
    </SettingsSection>
  );
};
