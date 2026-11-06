import React from 'react';
import {
  Badge,
  Box,
  Button,
  Flex,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Select,
  Spinner,
  Text
} from '@chakra-ui/react';

import {
  QUOTA_OVERRIDE_FIELDS,
  SUBSCRIPTION_TIER_CATALOG,
  type SubscriptionTierDescriptor,
  type TierQuotas
} from '~/api/utils/subscriptions/tierCatalog';
import { formatBytes } from '~/components/Apps/ConnectedAppsSection';
import { useLopu } from '~/components/Lopu/useLopu';
import { useApi } from '~/hooks/useApi';

// Admin subscription editor — one modal for both subject kinds (user / app).
// Tier picker from the shared pure catalog (patScopes-style single source of
// truth), plus per-field overrides: inherit the tier, a custom number, or
// unlimited. Saving POSTs /api/v1/admin/subscriptions; "Reset to default"
// clears the assignment entirely.

const FIELD_LABELS: Record<keyof TierQuotas, { label: string; unit: 'bytes' | 'count' }> = {
  appStorageBytes: { label: 'Whole-app storage', unit: 'bytes' },
	userStorageBytes: { label: 'Whole-account storage allowance', unit: 'bytes' },
  maxApps: { label: 'Max registered apps', unit: 'count' },
  maxPats: { label: 'Max personal access tokens', unit: 'count' },
  speedTestsPerHour: { label: 'Speed tests per hour', unit: 'count' }
};

const MB = 1024 * 1024;

type OverrideMode = 'inherit' | 'custom' | 'unlimited';
type OverrideState = Record<keyof TierQuotas, { mode: OverrideMode; value: string }>;

const emptyOverrides = (): OverrideState => ({
  appStorageBytes: { mode: 'inherit', value: '' },
  userStorageBytes: { mode: 'inherit', value: '' },
  maxApps: { mode: 'inherit', value: '' },
  maxPats: { mode: 'inherit', value: '' },
  speedTestsPerHour: { mode: 'inherit', value: '' }
});

export const tierLabel = (id: string, catalog = SUBSCRIPTION_TIER_CATALOG): string => {
  const tier = catalog.find((entry) => entry.id === id);
  return tier ? `${tier.emoji} ${tier.title}` : id;
};

export const SubscriptionEditorModal = ({
  subjectType,
  subjectId,
  subjectLabel,
  isOpen,
  onClose,
  onSaved
}: {
  subjectType: 'user' | 'app';
  subjectId: string;
  subjectLabel: string;
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}) => {
  const api = useApi();
  const lopu = useLopu();
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [saving, setSaving] = React.useState(false);
  const [tier, setTier] = React.useState('free');
  const [tierVersionId, setTierVersionId] = React.useState(SUBSCRIPTION_TIER_CATALOG[0].versionId);
  const [catalog, setCatalog] = React.useState<SubscriptionTierDescriptor[]>(SUBSCRIPTION_TIER_CATALOG);
  const [isDefault, setIsDefault] = React.useState(true);
  const [note, setNote] = React.useState('');
  const [overrides, setOverrides] = React.useState<OverrideState>(emptyOverrides);

  const apiRef = React.useRef(api);
  apiRef.current = api;

  React.useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    apiRef.current.v1.admin
      .subscription({ subjectType, subjectId })
      .then((resp: any) => {
        if (cancelled) return;
        if (!resp?.ok) throw new Error(resp?.error || 'Could not load this subscription');
        const sub = resp.subscription;
        const nextCatalog = Array.isArray(resp.catalog) && resp.catalog.length ? resp.catalog : SUBSCRIPTION_TIER_CATALOG;
        setCatalog(nextCatalog);
        setTier(sub?.tier ?? 'free');
        setTierVersionId(
          sub?.tierVersionId ??
            nextCatalog.find((entry: SubscriptionTierDescriptor) => entry.id === (sub?.tier ?? 'free'))?.versionId ??
            nextCatalog[0].versionId
        );
        setIsDefault(sub?.isDefault !== false);
        setNote(sub?.note ?? '');
        const next = emptyOverrides();
        for (const field of QUOTA_OVERRIDE_FIELDS) {
          if (sub?.overrides && field in sub.overrides) {
            const value = sub.overrides[field];
            next[field] =
              value === null
                ? { mode: 'unlimited', value: '' }
                : {
                    mode: 'custom',
                    value: String(FIELD_LABELS[field].unit === 'bytes' ? Math.round(value / MB) : value)
                  };
          }
        }
        setOverrides(next);
      })
      .catch((error: any) => {
        if (!cancelled) setLoadError(error?.error || error?.message || 'Could not load this subscription');
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [isOpen, subjectType, subjectId, reloadKey]);

  const selectedTier =
    catalog.find((entry) => entry.versionId === tierVersionId) ??
    catalog.find((entry) => entry.id === tier) ??
    catalog[0] ??
    SUBSCRIPTION_TIER_CATALOG[0];
  const visibleFields: Array<keyof TierQuotas> = subjectType === 'app' ? ['appStorageBytes'] : ['userStorageBytes', 'maxApps', 'maxPats', 'speedTestsPerHour'];

  const save = async () => {
    if (loadError) return;
    const payload: Record<string, number | null> = {};
    for (const field of visibleFields) {
      const state = overrides[field];
      if (state.mode === 'unlimited') payload[field] = null;
      else if (state.mode === 'custom') {
        const raw = Number(state.value);
        if (!Number.isFinite(raw) || raw < 0) {
          lopu({ title: `${FIELD_LABELS[field].label}: enter a number ≥ 0`, status: 'error', duration: 6000 });
          return;
        }
        payload[field] = FIELD_LABELS[field].unit === 'bytes' ? Math.round(raw * MB) : Math.round(raw);
      }
    }
    setSaving(true);
    try {
      const resp: any = await api.v1.admin.setSubscription({
        subjectType,
        subjectId,
        tier,
        tierVersionId,
        overrides: Object.keys(payload).length ? payload : null,
        note: note.trim() || undefined
      });
      if (resp?.ok) {
        lopu({ title: `Subscription saved for ${subjectLabel}`, status: 'success', duration: 5000 });
        onSaved();
        onClose();
      } else {
        lopu({ title: resp?.error || 'Save failed', status: 'error' });
      }
    } catch (err: any) {
      lopu({ title: err?.error || 'Save failed', status: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setSaving(true);
    try {
      const resp: any = await api.v1.admin.setSubscription({ subjectType, subjectId, clear: true });
      if (resp?.ok) {
        lopu({ title: `${subjectLabel} reset to the default tier`, status: 'success', duration: 5000 });
        onSaved();
        onClose();
      } else {
        lopu({ title: resp?.error || 'Reset failed', status: 'error' });
      }
    } catch (err: any) {
      lopu({ title: err?.error || 'Reset failed', status: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg" scrollBehavior="inside">
      <ModalOverlay />
      <ModalContent mx={3}>
        <ModalHeader pr={10}>
          Subscription — {subjectLabel}{' '}
          {isDefault && (
            <Badge ml={1} fontSize="0.55em" verticalAlign="middle">
              default
            </Badge>
          )}
        </ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          {loading ? (
            <Flex justify="center" py={8}>
              <Spinner />
            </Flex>
          ) : loadError ? (
            <Box borderWidth="1px" borderRadius="md" p={4} textAlign="center">
              <Text fontSize="sm" mb={3}>
                {loadError}
              </Text>
              <Button size="sm" variant="outline" onClick={() => setReloadKey((value) => value + 1)}>
                Retry
              </Button>
            </Box>
          ) : (
            <>
              <Text fontSize="xs" fontWeight={600} textTransform="uppercase" letterSpacing="0.08em" opacity={0.45} mb={2}>
                Tier
              </Text>
              <Select
                value={tierVersionId}
                onChange={(e) => {
                  const next = catalog.find((entry) => entry.versionId === e.target.value);
                  if (!next) return;
                  setTier(next.id);
                  setTierVersionId(next.versionId);
                }}
                size="sm"
                mb={1}
              >
                {catalog.map((entry) => (
                  <option key={entry.versionId} value={entry.versionId} disabled={entry.status !== 'live' && entry.versionId !== tierVersionId}>
                    {entry.emoji} {entry.title} · v{entry.version}
                    {entry.status !== 'live' ? ` (${entry.status})` : ''}
                  </option>
                ))}
              </Select>
              <Text fontSize="xs" opacity={0.65} mb={4}>
                {selectedTier.description}
                {selectedTier.metered && ' Usage is metered — no quota field blocks writes.'}
              </Text>
              {selectedTier.status === 'archived' ? (
                <Text fontSize="xs" color="orange.500" mb={4}>
                  This subject remains pinned to a historical revision. Saving keeps that revision and only updates the note or overrides; choose a
                  live tier to migrate them.
                </Text>
              ) : null}

              <Text fontSize="xs" fontWeight={600} textTransform="uppercase" letterSpacing="0.08em" opacity={0.45} mb={2}>
                Custom overrides
              </Text>
              {visibleFields.map((field) => {
                const meta = FIELD_LABELS[field];
                const state = overrides[field];
                const tierValue = selectedTier.quotas[field];
                const tierText = tierValue === null ? 'unlimited' : meta.unit === 'bytes' ? formatBytes(tierValue) : String(tierValue);
                return (
                  <Flex key={field} align="center" gap={2} mb={2} wrap="wrap">
                    <Box flex="1 1 180px" minW="150px">
                      <Text fontSize="sm">{meta.label}</Text>
                      <Text fontSize="xs" opacity={0.55}>
                        tier: {tierText}
                      </Text>
                    </Box>
                    <Select
                      size="xs"
                      width="110px"
                      value={state.mode}
                      onChange={(e) => setOverrides((prev) => ({ ...prev, [field]: { ...prev[field], mode: e.target.value as OverrideMode } }))}
                    >
                      <option value="inherit">Tier default</option>
                      <option value="custom">Custom</option>
                      <option value="unlimited">Unlimited</option>
                    </Select>
                    {state.mode === 'custom' && (
                      <Input
                        size="xs"
                        width="110px"
                        type="number"
                        min={0}
                        placeholder={meta.unit === 'bytes' ? 'MB' : 'count'}
                        value={state.value}
                        onChange={(e) => setOverrides((prev) => ({ ...prev, [field]: { ...prev[field], value: e.target.value } }))}
                      />
                    )}
                    {state.mode === 'custom' && meta.unit === 'bytes' && (
                      <Text fontSize="xs" opacity={0.55}>
                        MB
                      </Text>
                    )}
                  </Flex>
                );
              })}

              <Text fontSize="xs" fontWeight={600} textTransform="uppercase" letterSpacing="0.08em" opacity={0.45} mt={4} mb={2}>
                Note
              </Text>
              <Input size="sm" placeholder="Why this assignment exists (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
            </>
          )}
        </ModalBody>
        <ModalFooter gap={2} flexWrap="wrap">
          {!isDefault && !loadError && (
            <Button size="sm" variant="ghost" onClick={reset} isDisabled={saving} mr="auto">
              Reset to default
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={onClose} isDisabled={saving}>
            Cancel
          </Button>
          <Button size="sm" colorScheme="purple" onClick={save} isLoading={saving} isDisabled={loading || !!loadError}>
            Save
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};
