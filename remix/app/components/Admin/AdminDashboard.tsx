import React from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router';
import {
  Alert,
  AlertIcon,
  Badge,
  Box,
  Button,
  Flex,
  Heading,
  Menu,
  MenuButton,
  MenuDivider,
  MenuItem,
  MenuList,
  Spinner,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Table,
  Tabs,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr
} from '@chakra-ui/react';

import { AdminPanel } from '~/components/Admin/AdminPanel';
import { CIControlDashboard } from '~/components/Admin/CIControl/CIControlDashboard';
import { IntegrationManager } from '~/components/Admin/IntegrationManager';
import { AdminRowQueryControls, useAdminRowQuery } from '~/components/Admin/AdminRowQueryControls';
import { LinkManagerModal } from '~/components/Admin/LinkManagerModal';
import { ModerationTab } from '~/components/Admin/ModerationTab';
import { SubscriptionEditorModal } from '~/components/Admin/SubscriptionEditorModal';
import { TierManager } from '~/components/Admin/TierManager';
import { loadCompleteAdminSnapshot, type CompleteAdminSnapshot } from '~/components/Admin/adminDirectoryClient';
import type { AdminRowField } from '~/components/Admin/adminRowQuery';
import { ADMIN_TABS, adminTabIndex, adminTabPath } from '~/components/Admin/adminRoutesCore';
import {
	exactByteLabel,
	storageProjectionTitle,
	storageStatusPresentation,
	type AdminStorageProjection
} from '~/components/Admin/adminStorageProjection';
import { formatBytes } from '~/components/Apps/ConnectedAppsSection';
import { useLopu } from '~/components/Lopu/useLopu';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { CARD_STYLES } from '~/theme/card';

// /admin — the management dashboard: Users (tiers, quotas, storage, links),
// Apps (owners, users, storage, suspension), System (the existing rate-limit
// + admin-access panel). Client gate mirrors MongoDB/Raw.tsx; every endpoint
// re-checks admin server-side — this UI is just the surface.

type UserRow = {
  id: string;
  username: string;
  displayName: string | null;
  email: string;
  createdAt: string | null;
  isAdmin: boolean;
  envAdmin: boolean;
  emailVerified: boolean;
  publicUploadsEnabled: boolean;
  privateUploadsEnabled: boolean;
  publicUploadsPending: boolean;
  privateUploadsPending: boolean;
  accountKind: 'user' | 'service';
	storage: AdminStorageProjection;
  storageAllowanceBytes: number | null;
	storageUsedBytes: number | null;
	appNamespaceBytes: number | null;
  subscription: {
    tier: string;
    tierName: string;
    tierVersionId: string;
    tierVersion: number;
    metered: boolean;
    isDefault: boolean;
    overrides: Record<string, number | null> | null;
    effective: Record<string, number | null>;
    note: string | null;
    updatedBy: string | null;
    updatedAt: string | null;
		storage: AdminStorageProjection | null;
  };
  counts: { apps: number; linkedApps: number; ownedAccounts: number; pats: number; connectedApps: number };
};

type AppRow = {
  clientId: string;
  name: string;
  origins: string[];
  createdAt: string | null;
  revokedAt: string | null;
  owner: { id: string; username: string | null };
  managers: Array<{ id: string; username: string | null }>;
  userCount: number;
	storage: AdminStorageProjection | null;
	usedBytes: number | null;
  subscription: UserRow['subscription'];
};

const formatAdminDate = (value: string | null | undefined): string => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
};

const StorageUsage = ({ storage }: { storage: AdminStorageProjection | null | undefined }) => {
	const state = storageStatusPresentation(storage);
	const usageCanBeTrusted = !!storage && storage.status !== 'unavailable' && storage.usedBytes !== null;
	const allowance = !storage ? '—' : storage.allowanceBytes === null ? '∞' : formatBytes(storage.allowanceBytes);
	const usedCompact = usageCanBeTrusted && storage ? formatBytes(storage.usedBytes!) : '—';
	const usedExact = usageCanBeTrusted && storage ? exactByteLabel(storage.usedBytes) : 'Usage unavailable';
	return (
		<Box title={storageProjectionTitle(storage)}>
			<Flex align="center" justify="flex-end" gap={1} wrap="wrap">
				<Text as="span" whiteSpace="nowrap">
					{usedCompact} / {allowance}
				</Text>
				<Badge colorScheme={state.colorScheme} fontSize="0.55em">
					{state.label}
				</Badge>
				{!!storage?.overageBytes && (
					<Badge colorScheme="red" fontSize="0.55em">
						over {formatBytes(storage.overageBytes)}
					</Badge>
				)}
			</Flex>
			<Text fontSize="10px" opacity={0.62} whiteSpace="nowrap">
				{usedExact}
				{storage?.status === 'reconciling' ? ' · provisional' : ''}
			</Text>
		</Box>
	);
};

const QUOTA_FIELDS = ['appStorageBytes', 'userStorageBytes', 'maxApps', 'maxPats'] as const;
const QUOTA_QUERY_LABELS: Record<(typeof QUOTA_FIELDS)[number], string> = {
  appStorageBytes: 'app storage',
  userStorageBytes: 'user storage',
  maxApps: 'max apps',
  maxPats: 'max access tokens'
};

const subscriptionQueryFields = <T,>(prefix = 'subscription'): AdminRowField<T>[] => [
  { id: `${prefix}.tier`, label: 'Tier ID', kind: 'string', sortable: true },
  { id: `${prefix}.tierName`, label: 'Tier name', kind: 'string', sortable: true },
  { id: `${prefix}.tierVersionId`, label: 'Tier version ID', kind: 'string', sortable: true },
  { id: `${prefix}.tierVersion`, label: 'Tier version', kind: 'number', sortable: true },
  { id: `${prefix}.metered`, label: 'Metered tier', kind: 'boolean', sortable: true },
  { id: `${prefix}.isDefault`, label: 'Default assignment', kind: 'boolean', sortable: true },
  { id: `${prefix}.note`, label: 'Subscription note', kind: 'string', sortable: true },
  { id: `${prefix}.updatedBy`, label: 'Subscription updated by', kind: 'string', sortable: true },
  { id: `${prefix}.updatedAt`, label: 'Subscription updated time', kind: 'date', sortable: true },
  {
    id: `${prefix}.hasOverrides`,
    label: 'Has custom quota overrides',
    kind: 'boolean',
    getValue: (row: any) => !!row?.subscription?.overrides,
    sortable: true
  },
  ...QUOTA_FIELDS.flatMap<AdminRowField<T>>((field) => [
    {
      id: `${prefix}.overrides.${field}`,
      label: `Override ${QUOTA_QUERY_LABELS[field]}`,
      kind: 'number',
      sortable: true
    },
    {
      id: `${prefix}.overrides.${field}.unlimited`,
      label: `Override ${QUOTA_QUERY_LABELS[field]} is unlimited`,
      kind: 'boolean',
      getValue: (row: any) => {
        const overrides = row?.subscription?.overrides;
        return overrides && Object.prototype.hasOwnProperty.call(overrides, field) ? overrides[field] === null : undefined;
      },
      sortable: true
    },
    {
      id: `${prefix}.effective.${field}`,
      label: `Effective ${QUOTA_QUERY_LABELS[field]}`,
      kind: 'number',
      sortable: true
    },
    {
      id: `${prefix}.effective.${field}.unlimited`,
      label: `Effective ${QUOTA_QUERY_LABELS[field]} is unlimited`,
      kind: 'boolean',
      getValue: (row: any) => row?.subscription?.effective?.[field] === null,
      sortable: true
    }
  ])
];

const USER_QUERY_FIELDS: readonly AdminRowField<UserRow>[] = [
  { id: 'id', label: 'User ID', kind: 'string', sortable: true },
  { id: 'username', label: 'Username', kind: 'string', sortable: true },
  { id: 'displayName', label: 'Display name', kind: 'string', sortable: true },
  { id: 'email', label: 'Email', kind: 'string', sortable: true },
  { id: 'createdAt', label: 'Created time', kind: 'date', sortable: true },
	{
		id: 'accountKind',
		label: 'Account kind',
		kind: 'enum',
		options: [
			{ value: 'user', label: 'User' },
			{ value: 'service', label: 'Service' }
		],
		sortable: true
	},
  { id: 'isAdmin', label: 'Administrator', kind: 'boolean', sortable: true },
  { id: 'emailVerified', label: 'Email verified', kind: 'boolean', sortable: true },
  { id: 'publicUploadsEnabled', label: 'Public uploads enabled', kind: 'boolean', sortable: true },
  { id: 'privateUploadsEnabled', label: 'Private uploads enabled', kind: 'boolean', sortable: true },
  { id: 'publicUploadsPending', label: 'Public uploads awaiting approval', kind: 'boolean', sortable: true },
  { id: 'privateUploadsPending', label: 'Private uploads awaiting approval', kind: 'boolean', sortable: true },
  { id: 'envAdmin', label: 'Environment administrator', kind: 'boolean', sortable: true },
	{ id: 'storage.usedBytes', label: 'Account storage used (bytes)', kind: 'number', sortable: true },
	{ id: 'storage.allowanceBytes', label: 'Account storage allowance (bytes)', kind: 'number', sortable: true },
	{
		id: 'storage.allowanceBytes.unlimited',
		label: 'Account storage allowance is unlimited',
		kind: 'boolean',
		getValue: (row) => !!row.storage && row.storage.allowanceBytes === null,
		sortable: true
	},
	{ id: 'storage.remainingBytes', label: 'Account storage remaining (bytes)', kind: 'number', sortable: true },
	{ id: 'storage.overageBytes', label: 'Account storage overage (bytes)', kind: 'number', sortable: true },
	{
		id: 'storage.status',
		label: 'Account storage accounting status',
		kind: 'enum',
		options: [
			{ value: 'ready', label: 'Ready / exact' },
			{ value: 'reconciling', label: 'Reconciling' },
			{ value: 'unavailable', label: 'Unavailable' }
		],
		sortable: true
	},
	{ id: 'storage.accountingVersion', label: 'Account storage accounting version', kind: 'number', sortable: true },
	{ id: 'storage.reconciledAt', label: 'Account storage reconciled time', kind: 'date', sortable: true },
	{ id: 'storageAllowanceBytes', label: 'Storage allowance compatibility alias (bytes)', kind: 'number', sortable: true },
	{ id: 'storageUsedBytes', label: 'Storage used compatibility alias (bytes)', kind: 'number', sortable: true },
	{ id: 'appNamespaceBytes', label: 'App data subset of account storage (bytes)', kind: 'number', sortable: true },
  ...subscriptionQueryFields<UserRow>(),
  { id: 'counts.apps', label: 'Registered apps', kind: 'number', sortable: true },
  { id: 'counts.linkedApps', label: 'Linked apps', kind: 'number', sortable: true },
  { id: 'counts.ownedAccounts', label: 'Owned accounts', kind: 'number', sortable: true },
  { id: 'counts.pats', label: 'Access tokens', kind: 'number', sortable: true },
  { id: 'counts.connectedApps', label: 'Connected apps', kind: 'number', sortable: true }
];

const APP_QUERY_FIELDS: readonly AdminRowField<AppRow>[] = [
  { id: 'clientId', label: 'Client ID', kind: 'string', sortable: true },
  { id: 'name', label: 'App name', kind: 'string', sortable: true },
  { id: 'origins', label: 'Allowed origins', kind: 'string', sortable: true },
  { id: 'createdAt', label: 'Created time', kind: 'date', sortable: true },
  { id: 'revokedAt', label: 'Suspended time', kind: 'date', sortable: true },
  {
    id: 'status',
    label: 'Status',
    kind: 'enum',
    getValue: (row) => (row.revokedAt ? 'suspended' : 'active'),
		options: [
			{ value: 'active', label: 'Active' },
			{ value: 'suspended', label: 'Suspended' }
		],
    sortable: true
  },
  { id: 'owner.id', label: 'Owner ID', kind: 'string', sortable: true },
  { id: 'owner.username', label: 'Owner username', kind: 'string', sortable: true },
  { id: 'managers.id', label: 'Manager ID', kind: 'string', sortable: true },
  { id: 'managers.username', label: 'Manager username', kind: 'string', sortable: true },
  { id: 'userCount', label: 'Connected users', kind: 'number', sortable: true },
	{ id: 'storage.usedBytes', label: 'App storage used (bytes)', kind: 'number', sortable: true },
	{ id: 'storage.allowanceBytes', label: 'App storage allowance (bytes)', kind: 'number', sortable: true },
	{
		id: 'storage.allowanceBytes.unlimited',
		label: 'App storage allowance is unlimited',
		kind: 'boolean',
		getValue: (row) => !!row.storage && row.storage.allowanceBytes === null,
		sortable: true
	},
	{ id: 'storage.remainingBytes', label: 'App storage remaining (bytes)', kind: 'number', sortable: true },
	{ id: 'storage.overageBytes', label: 'App storage overage (bytes)', kind: 'number', sortable: true },
	{
		id: 'storage.status',
		label: 'App storage accounting status',
		kind: 'enum',
		options: [
			{ value: 'ready', label: 'Ready / exact' },
			{ value: 'reconciling', label: 'Reconciling' },
			{ value: 'unavailable', label: 'Unavailable' }
		],
		sortable: true
	},
	{ id: 'storage.accountingVersion', label: 'App storage accounting version', kind: 'number', sortable: true },
	{ id: 'storage.reconciledAt', label: 'App storage reconciled time', kind: 'date', sortable: true },
	{ id: 'usedBytes', label: 'Storage used compatibility alias (bytes)', kind: 'number', sortable: true },
  ...subscriptionQueryFields<AppRow>()
];

const userRowId = (row: UserRow) => row.id;
const appRowId = (row: AppRow) => row.clientId;

const TierBadge = ({ subscription }: { subscription: UserRow['subscription'] }) => (
  <Flex gap={1} align="center" wrap="wrap">
    <Badge colorScheme={subscription.tier === 'payg' ? 'orange' : subscription.isDefault ? 'gray' : 'purple'} fontSize="0.65em">
      {subscription.tierName || subscription.tier}
      {subscription.tierVersion ? ` · v${subscription.tierVersion}` : ''}
    </Badge>
    {subscription.overrides && (
      <Badge colorScheme="pink" fontSize="0.6em" title="Admin quota overrides are active">
        custom
      </Badge>
    )}
  </Flex>
);

// Fetch the complete admin directory through bounded keyset pages. The typed
// query controls run over the whole snapshot locally, so searching nested and
// computed rollup fields stays fast. A refreshed snapshot swaps in atomically,
// avoiding loading flashes and blind spots past the first 200 rows.
const useAdminRows = <T,>(fetcher: (signal: AbortSignal) => Promise<CompleteAdminSnapshot<T> | null>, deps: React.DependencyList) => {
  const [rows, setRows] = React.useState<T[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);
  const fetcherRef = React.useRef(fetcher);
  fetcherRef.current = fetcher;
  const [tick, setTick] = React.useState(0);
  const refresh = React.useCallback(() => setTick((value) => value + 1), []);

  React.useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    // Optimistic-rendering house rule: keep the last rows on screen while the
    // refetch runs; only the cold start shows the spinner.
    setLoading(rows === null);
    setError(false);
    fetcherRef
      .current(controller.signal)
      .then((next) => {
        if (cancelled || !next) return;
        setRows(next.rows);
      })
      .catch(() => !cancelled && setError(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);

  return { rows, loading, error, refresh };
};

const SnapshotErrorNotice = ({ hasPreviousRows, onRetry }: { hasPreviousRows: boolean; onRetry: () => void }) => (
  <Alert borderRadius="md" fontSize="xs" mb={3} status="error" variant="left-accent">
    <AlertIcon boxSize={4} />
    <Box flex="1">
      {hasPreviousRows
        ? 'Could not refresh the complete directory. The last complete snapshot remains visible.'
        : 'Could not load the complete directory.'}
    </Box>
    <Button ml={3} onClick={onRetry} size="xs" variant="outline">
      Retry
    </Button>
  </Alert>
);

// File/media uploads are withheld from every account created since the
// signup-permissions hotfix — verifying an email address no longer grants
// them. This is the manual approval control, per scope: PUBLIC covers
// post/comment/custom-emoji attachments, PRIVATE covers message attachments +
// the user's own profile media, and "all" is both at once. Each action hits
// POST /api/v1/admin/users/public-uploads { userId, enabled, scope } and
// refreshes the snapshot.
//
// Optimistic per the UI house rule: the badge flips the moment the admin
// clicks and reverts if the request fails, so approving never shows a spinner
// where a known state already exists.
const UploadApprovalsControl = ({ row, onChanged }: { row: UserRow; onChanged: () => void }) => {
  const api = useApi();
  const lopu = useLopu();
  const [optimistic, setOptimistic] = React.useState<{ pub: boolean; priv: boolean } | null>(null);
  const [saving, setSaving] = React.useState(false);
  const pub = optimistic?.pub ?? row.publicUploadsEnabled;
  const priv = optimistic?.priv ?? row.privateUploadsEnabled;

  // A fresh snapshot is authoritative again — drop the local override.
  React.useEffect(() => {
    setOptimistic(null);
  }, [row.publicUploadsEnabled, row.privateUploadsEnabled]);

  const save = async (scope: 'public' | 'private' | 'all', enabled: boolean) => {
    setOptimistic({ pub: scope === 'private' ? pub : enabled, priv: scope === 'public' ? priv : enabled });
    setSaving(true);
    try {
      const result = await api.v1.admin.setUserPublicUploads({ userId: row.id, enabled, scope });
      if (result?.ok === false) throw new Error(result.error || 'Request failed');
      lopu({
        title: enabled
          ? `${scope === 'all' ? 'All' : scope === 'public' ? 'Public' : 'Private'} uploads enabled for @${row.username} 🎉`
          : `${scope === 'all' ? 'All' : scope === 'public' ? 'Public' : 'Private'} uploads withheld for @${row.username}`
      });
      onChanged();
    } catch (error: any) {
      setOptimistic(null);
      lopu({ title: error?.error || error?.message || 'Could not update upload permission', status: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const pending = row.publicUploadsPending || row.privateUploadsPending;
  const summary = pub && priv ? 'all' : pub ? 'public' : priv ? 'private' : pending ? 'pending' : 'off';
  const summaryColor = pub && priv ? 'green' : pub || priv ? 'teal' : pending ? 'orange' : 'gray';

  return (
    <Flex align="center" gap={2}>
      <Badge
        colorScheme={summaryColor}
        fontSize="0.6em"
        title={`Public uploads: ${pub ? 'enabled' : 'withheld'} · Private uploads: ${priv ? 'enabled' : 'withheld'}`}
      >
        {summary}
      </Badge>
      {row.isAdmin ? (
        <Text fontSize="10px" opacity={0.55}>
          admin
        </Text>
      ) : (
        <Menu isLazy>
          <MenuButton as={Button} size="xs" variant="outline" isLoading={saving}>
            Approve ▾
          </MenuButton>
          <MenuList fontSize="sm" minW="220px">
            <MenuItem onClick={() => save('public', !pub)}>{pub ? 'Withhold public uploads' : 'Enable public uploads'}</MenuItem>
            <MenuItem onClick={() => save('private', !priv)}>{priv ? 'Withhold private uploads' : 'Enable private uploads'}</MenuItem>
            <MenuDivider />
            <MenuItem isDisabled={pub && priv} onClick={() => save('all', true)}>
              Enable all
            </MenuItem>
            <MenuItem isDisabled={!pub && !priv} onClick={() => save('all', false)}>
              Withhold all
            </MenuItem>
          </MenuList>
        </Menu>
      )}
    </Flex>
  );
};

const UsersTab = () => {
  const api = useApi();
  const apiRef = React.useRef(api);
  apiRef.current = api;
  const { rows, loading, error, refresh } = useAdminRows<UserRow>(
    (signal) =>
      loadCompleteAdminSnapshot<UserRow>(
				(cursor, pageSignal) => apiRef.current.v1.admin.usersOverview({ limit: 200, ...(cursor ? { cursor } : {}) }, { signal: pageSignal }),
        'users',
        userRowId,
        signal
      ),
    []
  );
  const userQuery = useAdminRowQuery({
    rows: rows ?? [],
    fields: USER_QUERY_FIELDS,
    getRowId: userRowId,
    initialSort: { field: 'createdAt', direction: 'desc' }
  });
  const [subscriptionFor, setSubscriptionFor] = React.useState<UserRow | null>(null);
  const [linksFor, setLinksFor] = React.useState<UserRow | null>(null);
  const pendingUploadCount = React.useMemo(
    () => (rows ?? []).filter((row) => row.publicUploadsPending || row.privateUploadsPending).length,
    [rows]
  );

  return (
    <Box>
      <Box mb={3}>
        <AdminRowQueryControls
          ariaLabel="Query users"
          fields={USER_QUERY_FIELDS}
          onChange={userQuery.setQuery}
          resultCount={userQuery.rows.length}
          searchPlaceholder="Search every user field…"
          totalCount={rows?.length ?? 0}
          value={userQuery.query}
        />
      </Box>
      {pendingUploadCount > 0 && (
        <Alert status="warning" mb={3} borderRadius="md" fontSize="sm">
          <AlertIcon />
          {pendingUploadCount} new {pendingUploadCount === 1 ? 'account is' : 'accounts are'} awaiting file &amp; media upload
          approval — use Approve on a row to enable public, private, or all uploads.
        </Alert>
      )}
      {error ? <SnapshotErrorNotice hasPreviousRows={rows !== null} onRetry={refresh} /> : null}
      {loading && !rows ? (
        <Flex justify="center" py={10}>
          <Spinner />
        </Flex>
      ) : rows ? (
        <Box overflowX="auto">
          <Table size="sm" minW="880px">
            <Thead>
              <Tr>
                <Th>User</Th>
                <Th>Tier</Th>
                <Th>Uploads</Th>
                <Th>Created</Th>
								<Th isNumeric>Account storage</Th>
								<Th isNumeric>App data subset</Th>
                <Th isNumeric>Apps</Th>
                <Th isNumeric>Tokens</Th>
                <Th isNumeric>Connected</Th>
                <Th>Actions</Th>
              </Tr>
            </Thead>
            <Tbody>
              {userQuery.rows.map((row) => (
                <Tr key={row.id}>
                  <Td>
                    <Text fontWeight={600} fontSize="sm">
                      @{row.username}
                      {row.isAdmin && (
                        <Badge ml={1} colorScheme="green" fontSize="0.6em">
                          admin
                        </Badge>
                      )}
                      {row.accountKind === 'service' && (
                        <Badge ml={1} colorScheme="blue" fontSize="0.6em">
                          service
                        </Badge>
                      )}
                    </Text>
                    <Text fontSize="xs" opacity={0.6} overflow="hidden" textOverflow="ellipsis" maxW="220px">
                      {row.displayName || row.email}
                    </Text>
                  </Td>
                  <Td>
                    <TierBadge subscription={row.subscription} />
                  </Td>
                  <Td whiteSpace="nowrap">
                    <UploadApprovalsControl row={row} onChanged={refresh} />
                  </Td>
                  <Td fontSize="xs" whiteSpace="nowrap" title={row.createdAt || undefined}>
                    {formatAdminDate(row.createdAt)}
                  </Td>
                  <Td isNumeric fontSize="xs" whiteSpace="nowrap">
										<StorageUsage storage={row.storage} />
                  </Td>
									<Td
										isNumeric
										fontSize="xs"
										whiteSpace="nowrap"
										title={
											row.appNamespaceBytes === null
												? 'App-data subset is unavailable until the account ledger is reconciled'
												: `${exactByteLabel(row.appNamespaceBytes)} included in account storage`
										}
									>
										<Text>{row.appNamespaceBytes === null ? 'Recalculating…' : formatBytes(row.appNamespaceBytes)}</Text>
										<Text fontSize="10px" opacity={0.62}>
											{row.appNamespaceBytes === null ? 'not authoritative yet' : exactByteLabel(row.appNamespaceBytes)}
										</Text>
                  </Td>
                  <Td isNumeric fontSize="xs">
                    {row.counts.apps}
                    {row.counts.linkedApps > 0 && (
                      <Text as="span" opacity={0.55}>
                        {' '}
                        +{row.counts.linkedApps}
                      </Text>
                    )}
                  </Td>
                  <Td isNumeric fontSize="xs">
                    {row.counts.pats}
                  </Td>
                  <Td isNumeric fontSize="xs">
                    {row.counts.connectedApps}
                  </Td>
                  <Td whiteSpace="nowrap">
                    <Button size="xs" variant="outline" mr={1} onClick={() => setSubscriptionFor(row)}>
                      Tier
                    </Button>
                    <Button size="xs" variant="outline" onClick={() => setLinksFor(row)}>
                      Links{row.counts.ownedAccounts + row.counts.linkedApps > 0 ? ` (${row.counts.ownedAccounts + row.counts.linkedApps})` : ''}
                    </Button>
                  </Td>
                </Tr>
              ))}
              {rows && userQuery.rows.length === 0 && (
                <Tr>
                  <Td colSpan={10}>
                    <Text fontSize="sm" opacity={0.6} py={2}>
                      No users match this query.
                    </Text>
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
        </Box>
      ) : null}
      {subscriptionFor && (
        <SubscriptionEditorModal
          subjectType="user"
          subjectId={subscriptionFor.id}
          subjectLabel={`@${subscriptionFor.username}`}
          isOpen
          onClose={() => setSubscriptionFor(null)}
          onSaved={refresh}
        />
      )}
      {linksFor && (
        <LinkManagerModal
          mode="user"
          subjectId={linksFor.id}
          subjectLabel={`@${linksFor.username}`}
          isOpen
          onClose={() => setLinksFor(null)}
          onChanged={refresh}
        />
      )}
    </Box>
  );
};

const AppsTab = () => {
  const api = useApi();
  const lopu = useLopu();
  const apiRef = React.useRef(api);
  apiRef.current = api;
  const { rows, loading, error, refresh } = useAdminRows<AppRow>(
    (signal) =>
      loadCompleteAdminSnapshot<AppRow>(
				(cursor, pageSignal) => apiRef.current.v1.admin.apps({ limit: 200, ...(cursor ? { cursor } : {}) }, { signal: pageSignal }),
        'apps',
        appRowId,
        signal
      ),
    []
  );
  const appQuery = useAdminRowQuery({
    rows: rows ?? [],
    fields: APP_QUERY_FIELDS,
    getRowId: appRowId,
    initialSort: { field: 'createdAt', direction: 'desc' }
  });
  const [subscriptionFor, setSubscriptionFor] = React.useState<AppRow | null>(null);
  const [managersFor, setManagersFor] = React.useState<AppRow | null>(null);
  const [confirmRevoke, setConfirmRevoke] = React.useState<string | null>(null);
  const [busyClientId, setBusyClientId] = React.useState<string | null>(null);

  const toggleRevoked = async (row: AppRow) => {
    setBusyClientId(row.clientId);
    try {
      const resp: any = await api.v1.admin.revokeApp({ clientId: row.clientId, revoked: !row.revokedAt });
      if (resp?.ok) {
        lopu({
          title: row.revokedAt ? `${row.name} restored` : `${row.name} suspended — all tokens revoked`,
          status: 'success',
          duration: 6000
        });
        refresh();
      } else {
        lopu({ title: resp?.error || 'Update failed', status: 'error' });
      }
    } catch (err: any) {
      lopu({ title: err?.error || 'Update failed', status: 'error' });
    } finally {
      setBusyClientId(null);
      setConfirmRevoke(null);
    }
  };

  return (
    <Box>
      <Box mb={3}>
        <AdminRowQueryControls
          ariaLabel="Query apps"
          fields={APP_QUERY_FIELDS}
          onChange={appQuery.setQuery}
          resultCount={appQuery.rows.length}
          searchPlaceholder="Search every app field…"
          totalCount={rows?.length ?? 0}
          value={appQuery.query}
        />
      </Box>
      {error ? <SnapshotErrorNotice hasPreviousRows={rows !== null} onRetry={refresh} /> : null}
      {loading && !rows ? (
        <Flex justify="center" py={10}>
          <Spinner />
        </Flex>
      ) : rows ? (
        <Box overflowX="auto">
          <Table size="sm" minW="880px">
            <Thead>
              <Tr>
                <Th>App</Th>
                <Th>Owner</Th>
                <Th>Created</Th>
                <Th isNumeric>Users</Th>
                <Th isNumeric>Storage</Th>
                <Th>Tier</Th>
                <Th>Status</Th>
                <Th>Actions</Th>
              </Tr>
            </Thead>
            <Tbody>
              {appQuery.rows.map((row) => (
                <Tr key={row.clientId} opacity={row.revokedAt ? 0.6 : 1}>
                  <Td>
                    <Text fontWeight={600} fontSize="sm">
                      {row.name}
                    </Text>
                    <Text fontSize="xs" opacity={0.6} fontFamily="mono" overflow="hidden" textOverflow="ellipsis" maxW="200px">
                      {row.clientId}
                    </Text>
                  </Td>
                  <Td fontSize="xs">
                    @{row.owner.username ?? row.owner.id}
                    {row.managers.length > 0 && (
                      <Text as="span" opacity={0.55}>
                        {' '}
                        +{row.managers.length}
                      </Text>
                    )}
                  </Td>
                  <Td fontSize="xs" whiteSpace="nowrap" title={row.createdAt || undefined}>
                    {formatAdminDate(row.createdAt)}
                  </Td>
                  <Td isNumeric fontSize="xs">
                    {row.userCount}
                  </Td>
                  <Td isNumeric fontSize="xs" whiteSpace="nowrap">
										<StorageUsage storage={row.storage} />
                  </Td>
                  <Td>
                    <TierBadge subscription={row.subscription} />
                  </Td>
                  <Td>
                    {row.revokedAt ? (
                      <Badge colorScheme="red" fontSize="0.65em">
                        suspended
                      </Badge>
                    ) : (
                      <Badge colorScheme="green" fontSize="0.65em">
                        active
                      </Badge>
                    )}
                  </Td>
                  <Td whiteSpace="nowrap">
                    <Button size="xs" variant="outline" mr={1} onClick={() => setSubscriptionFor(row)}>
                      Tier
                    </Button>
                    <Button size="xs" variant="outline" mr={1} onClick={() => setManagersFor(row)}>
                      Owners{row.managers.length > 0 ? ` (${row.managers.length + 1})` : ''}
                    </Button>
                    {confirmRevoke === row.clientId ? (
                      <>
                        <Button size="xs" colorScheme="red" mr={1} isLoading={busyClientId === row.clientId} onClick={() => toggleRevoked(row)}>
                          Confirm
                        </Button>
                        <Button size="xs" variant="ghost" onClick={() => setConfirmRevoke(null)}>
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="xs"
                        variant="ghost"
                        colorScheme={row.revokedAt ? 'green' : 'red'}
                        isLoading={busyClientId === row.clientId}
                        onClick={() => (row.revokedAt ? toggleRevoked(row) : setConfirmRevoke(row.clientId))}
                      >
                        {row.revokedAt ? 'Restore' : 'Suspend'}
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
              {rows && appQuery.rows.length === 0 && (
                <Tr>
                  <Td colSpan={8}>
                    <Text fontSize="sm" opacity={0.6} py={2}>
                      No apps match this query.
                    </Text>
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
        </Box>
      ) : null}
      {subscriptionFor && (
        <SubscriptionEditorModal
          subjectType="app"
          subjectId={subscriptionFor.clientId}
          subjectLabel={subscriptionFor.name}
          isOpen
          onClose={() => setSubscriptionFor(null)}
          onSaved={refresh}
        />
      )}
      {managersFor && (
        <LinkManagerModal
          mode="app"
          subjectId={managersFor.clientId}
          subjectLabel={managersFor.name}
          isOpen
          onClose={() => setManagersFor(null)}
          onChanged={refresh}
        />
      )}
    </Box>
  );
};

export const AdminDashboard = () => {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const { section } = useParams();
  const selectedTabIndex = adminTabIndex(section);

  React.useEffect(() => {
    if (selectedTabIndex === null) navigate('/admin', { replace: true });
  }, [navigate, selectedTabIndex]);

  // Same whole-page gate idiom as the MongoDB workbench (Raw.tsx): a card,
  // never a redirect, so the URL is shareable between admins.
  if (!user?.isAdmin) {
    return (
      <Flex justify="center" px={4} py={16} paddingTop="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px) + 32px)">
        <Box {...CARD_STYLES} maxW="420px" width="100%" p={6} textAlign="center">
          <Heading size="md" mb={2}>
            🔐 Admin access required
          </Heading>
          <Text fontSize="sm" opacity={0.7}>
            {user ? 'This dashboard is for administrators only.' : 'Sign in with an admin account to manage users and apps.'}
          </Text>
        </Box>
      </Flex>
    );
  }

  return (
    <Box
      maxW="1280px"
      mx="auto"
      px={{ base: 3, md: 6 }}
      py={6}
      paddingTop="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px) + 16px)"
      width="100%"
    >
      <Heading size="lg" mb={1}>
        Admin
      </Heading>
      <Text fontSize="sm" opacity={0.65} mb={4}>
        Manage users, apps, subscription tiers, CI automation, external integrations, quotas, and ownership.
      </Text>
      <Tabs
        variant="enclosed"
        size="sm"
        isLazy
        lazyBehavior="keepMounted"
        index={selectedTabIndex ?? 0}
        onChange={(index) => navigate(adminTabPath(index))}
      >
        <TabList flexWrap="wrap">
          {ADMIN_TABS.map((tab) => (
            <Tab key={tab.slug} as={RouterLink} to={`/admin/${tab.slug}`}>
              {tab.label}
            </Tab>
          ))}
        </TabList>
        <TabPanels>
          <TabPanel px={0}>
            <UsersTab />
          </TabPanel>
          <TabPanel px={0}>
            <AppsTab />
          </TabPanel>
          <TabPanel px={0}>
            <ModerationTab />
          </TabPanel>
          <TabPanel px={0}>
            <TierManager />
          </TabPanel>
          <TabPanel px={0}>
            <CIControlDashboard cacheIdentity={user.id} />
          </TabPanel>
          <TabPanel px={0}>
            <IntegrationManager />
          </TabPanel>
          <TabPanel px={0}>
            <AdminPanel />
          </TabPanel>
        </TabPanels>
      </Tabs>
    </Box>
  );
};
