import React from 'react';
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  Badge,
  Box,
  Button,
  Checkbox,
  Divider,
  Flex,
  FormControl,
  FormLabel,
  Heading,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Select,
  SimpleGrid,
  Spinner,
  Text
} from '@chakra-ui/react';

import {
  EMPTY_TIER_INCLUSIONS,
  EMPTY_TIER_PRICES,
  DEFAULT_SUBSCRIPTION_TIER,
  QUOTA_OVERRIDE_FIELDS,
  SUBSCRIPTION_TIER_CATALOG,
  TIER_DISCOUNT_COMPARISONS,
  computeTierDiscounts,
  currencyMinorUnitFactor,
  type SubscriptionTierDescriptor,
  type TierDiscountKey,
  type TierDiscountOverrides,
  type TierInclusions,
  type TierPricePeriod,
  type TierPrices,
  type TierQuotas
} from '~/api/utils/subscriptions/tierCatalog';
import { formatBytes } from '~/components/Apps/ConnectedAppsSection';
import { LongTextEditor } from '~/components/Editor/LongTextEditor';
import { safeUrl } from '~/components/Kinds/safeUrl';
import { useLopu } from '~/components/Lopu/useLopu';
import { TierCard } from '~/components/Subscriptions/TierCard';
import { useApi } from '~/hooks/useApi';

import { AdminRowQueryControls, useAdminRowQuery } from './AdminRowQueryControls';
import type { AdminRowField } from './adminRowQuery';

const MB = 1024 * 1024;

const PRICE_LABELS: Record<TierPricePeriod, string> = {
  daily: 'Daily price',
  weekly: 'Weekly price',
  monthly: 'Monthly price',
  yearly: 'Yearly price'
};

const QUOTA_LABELS: Record<keyof TierQuotas, { label: string; unit: 'MiB' | 'items' }> = {
  appStorageBytes: { label: 'Whole-app storage', unit: 'MiB' },
	userStorageBytes: { label: 'Whole-account storage', unit: 'MiB' },
  maxApps: { label: 'Max registered apps', unit: 'items' },
  maxPats: { label: 'Max access tokens', unit: 'items' }
};

const tierInclusionText = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(tierInclusionText).filter(Boolean).join(' ');
  if (typeof value === 'object') {
		return Object.values(value as Record<string, unknown>)
			.map(tierInclusionText)
			.filter(Boolean)
			.join(' ');
  }
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
};

const TIER_QUERY_FIELDS: readonly AdminRowField<SubscriptionTierDescriptor>[] = [
  { id: 'id', label: 'Tier ID', kind: 'string' },
  { id: 'versionId', label: 'Version ID', kind: 'string' },
  { id: 'version', label: 'Version', kind: 'number' },
  {
    id: 'status',
    label: 'Status',
    kind: 'enum',
    options: [
      { value: 'live', label: 'Live' },
      { value: 'draft', label: 'Draft' },
      { value: 'archived', label: 'Archived' }
    ]
  },
  { id: 'title', label: 'Name', kind: 'string' },
  { id: 'tagline', label: 'Tagline', kind: 'string' },
  { id: 'description', label: 'Description', kind: 'string' },
  { id: 'emoji', label: 'Emoji', kind: 'string' },
  { id: 'bannerImageUrl', label: 'Banner image URL', kind: 'string' },
  { id: 'sortOrder', label: 'Sort order', kind: 'number' },
  { id: 'metered', label: 'Metered', kind: 'boolean' },
  { id: 'currency', label: 'Currency', kind: 'string' },
  {
    id: 'prices.daily',
    label: 'Daily price',
    kind: 'number',
		getValue: (tier) => (tier.prices.daily === null ? null : tier.prices.daily / currencyMinorUnitFactor(tier.currency))
  },
  {
    id: 'prices.weekly',
    label: 'Weekly price',
    kind: 'number',
		getValue: (tier) => (tier.prices.weekly === null ? null : tier.prices.weekly / currencyMinorUnitFactor(tier.currency))
  },
  {
    id: 'prices.monthly',
    label: 'Monthly price',
    kind: 'number',
		getValue: (tier) => (tier.prices.monthly === null ? null : tier.prices.monthly / currencyMinorUnitFactor(tier.currency))
  },
  {
    id: 'prices.yearly',
    label: 'Yearly price',
    kind: 'number',
		getValue: (tier) => (tier.prices.yearly === null ? null : tier.prices.yearly / currencyMinorUnitFactor(tier.currency))
  },
  { id: 'discounts.weeklyFromDaily', label: 'Weekly saving vs daily', kind: 'number' },
  { id: 'discounts.monthlyFromDaily', label: 'Monthly saving vs daily', kind: 'number' },
  { id: 'discounts.monthlyFromWeekly', label: 'Monthly saving vs weekly', kind: 'number' },
  { id: 'discounts.yearlyFromDaily', label: 'Yearly saving vs daily', kind: 'number' },
  { id: 'discounts.yearlyFromWeekly', label: 'Yearly saving vs weekly', kind: 'number' },
  { id: 'discounts.yearlyFromMonthly', label: 'Yearly saving vs monthly', kind: 'number' },
  { id: 'discountOverrides.weeklyFromDaily', label: 'Custom weekly saving vs daily', kind: 'number' },
  { id: 'discountOverrides.monthlyFromDaily', label: 'Custom monthly saving vs daily', kind: 'number' },
  { id: 'discountOverrides.monthlyFromWeekly', label: 'Custom monthly saving vs weekly', kind: 'number' },
  { id: 'discountOverrides.yearlyFromDaily', label: 'Custom yearly saving vs daily', kind: 'number' },
  { id: 'discountOverrides.yearlyFromWeekly', label: 'Custom yearly saving vs weekly', kind: 'number' },
  { id: 'discountOverrides.yearlyFromMonthly', label: 'Custom yearly saving vs monthly', kind: 'number' },
  { id: 'inclusions', label: 'Inclusions text', kind: 'string', getValue: (tier) => tierInclusionText(tier.inclusions.blocks) },
  { id: 'quotas.appStorageBytes', label: 'Whole-app storage bytes', kind: 'number' },
  { id: 'quotas.userStorageBytes', label: 'User storage bytes', kind: 'number' },
  { id: 'quotas.maxApps', label: 'Max registered apps', kind: 'number' },
  { id: 'quotas.maxPats', label: 'Max access tokens', kind: 'number' },
  { id: 'createdAt', label: 'Created time', kind: 'date' },
  { id: 'updatedAt', label: 'Updated time', kind: 'date' },
  { id: 'publishedAt', label: 'Published time', kind: 'date' },
  { id: 'archivedAt', label: 'Archived time', kind: 'date' }
];

const tierQueryRowId = (tier: SubscriptionTierDescriptor) => tier.versionId;

type DiscountInput = Record<TierDiscountKey, { mode: 'computed' | 'custom'; value: string }>;
type QuotaInput = Record<keyof TierQuotas, { unlimited: boolean; value: string }>;

const blankDiscounts = (): DiscountInput =>
  Object.fromEntries(TIER_DISCOUNT_COMPARISONS.map((comparison) => [comparison.key, { mode: 'computed', value: '' }])) as DiscountInput;

const quotasToInput = (quotas: TierQuotas): QuotaInput =>
  Object.fromEntries(
    QUOTA_OVERRIDE_FIELDS.map((field) => {
      const value = quotas[field];
      return [
        field,
        {
          unlimited: value === null,
          value: value === null ? '' : String(field.endsWith('Bytes') ? Math.round((value / MB) * 100) / 100 : value)
        }
      ];
    })
  ) as QuotaInput;

const pricesToInput = (prices: TierPrices, currency = 'USD'): Record<TierPricePeriod, string> => ({
  daily: prices.daily === null ? '' : String(prices.daily / currencyMinorUnitFactor(currency)),
  weekly: prices.weekly === null ? '' : String(prices.weekly / currencyMinorUnitFactor(currency)),
  monthly: prices.monthly === null ? '' : String(prices.monthly / currencyMinorUnitFactor(currency)),
  yearly: prices.yearly === null ? '' : String(prices.yearly / currencyMinorUnitFactor(currency))
});

const parsePriceInputs = (input: Record<TierPricePeriod, string>, currency: string): TierPrices | null => {
  const prices: TierPrices = { ...EMPTY_TIER_PRICES };
  const factor = currencyMinorUnitFactor(currency);
  for (const period of Object.keys(PRICE_LABELS) as TierPricePeriod[]) {
    const source = input[period].trim();
    if (!source) {
      prices[period] = null;
      continue;
    }
    const amount = Number(source);
    const minor = Math.round(amount * factor);
    if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(minor)) return null;
    prices[period] = minor;
  }
  return prices;
};

const formatDiscount = (value: number | null) => {
  if (value === null) return 'Add both prices to compute';
  if (value < 0) return `${Math.abs(value)}% more`;
  return `${value}% saved`;
};

const TierEditorModal = ({
  open,
  tier,
  onClose,
  onSaved
}: {
  open: boolean;
  tier: SubscriptionTierDescriptor | null;
  onClose: () => void;
  onSaved: (response: any) => void;
}) => {
  const api = useApi();
  const lopu = useLopu();
  const fallback = SUBSCRIPTION_TIER_CATALOG[0];
  const [title, setTitle] = React.useState('');
  const [tagline, setTagline] = React.useState('');
  const [emoji, setEmoji] = React.useState('✨');
  const [bannerImageUrl, setBannerImageUrl] = React.useState('');
  const [sortOrder, setSortOrder] = React.useState('100');
  const [metered, setMetered] = React.useState(false);
  const [currency, setCurrency] = React.useState('USD');
  const [prices, setPrices] = React.useState<Record<TierPricePeriod, string>>(pricesToInput(EMPTY_TIER_PRICES));
  const [discountInputs, setDiscountInputs] = React.useState<DiscountInput>(blankDiscounts);
  const [inclusions, setInclusions] = React.useState<TierInclusions>({ ...EMPTY_TIER_INCLUSIONS });
  const [quotas, setQuotas] = React.useState<QuotaInput>(quotasToInput(fallback.quotas));
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    const source = tier ?? fallback;
    setTitle(tier?.title ?? '');
    setTagline(tier?.tagline ?? '');
    setEmoji(tier?.emoji ?? '✨');
    setBannerImageUrl(tier?.bannerImageUrl ?? '');
    setSortOrder(String(tier?.sortOrder ?? 100));
    setMetered(tier?.metered ?? false);
    setCurrency(tier?.currency ?? 'USD');
    setPrices(pricesToInput(tier?.prices ?? EMPTY_TIER_PRICES, tier?.currency ?? 'USD'));
    const nextDiscounts = blankDiscounts();
    for (const comparison of TIER_DISCOUNT_COMPARISONS) {
      const custom = tier?.discountOverrides?.[comparison.key];
      if (typeof custom === 'number') nextDiscounts[comparison.key] = { mode: 'custom', value: String(custom) };
    }
    setDiscountInputs(nextDiscounts);
    setInclusions(tier?.inclusions ?? { ...EMPTY_TIER_INCLUSIONS });
    setQuotas(quotasToInput(source.quotas));
    setSaving(false);
  }, [fallback, open, tier]);

  const parsedPrices = parsePriceInputs(prices, currency) ?? { ...EMPTY_TIER_PRICES };
  const previewOverrides: TierDiscountOverrides = {};
  for (const comparison of TIER_DISCOUNT_COMPARISONS) {
    const input = discountInputs[comparison.key];
    const value = Number(input.value);
    if (input.mode === 'custom' && input.value.trim() && Number.isFinite(value)) {
      previewOverrides[comparison.key] = value;
    }
  }
  const previewDiscounts = computeTierDiscounts(parsedPrices, previewOverrides);

  const save = async () => {
    if (!title.trim()) {
      lopu({ title: 'Give this tier a name', status: 'error' });
      return;
    }
    const nextPrices = parsePriceInputs(prices, currency);
    if (!nextPrices) {
      lopu({ title: 'Prices must be blank or non-negative amounts', status: 'error' });
      return;
    }
    const nextDiscounts: TierDiscountOverrides = {};
    for (const comparison of TIER_DISCOUNT_COMPARISONS) {
      const input = discountInputs[comparison.key];
      if (input.mode !== 'custom') continue;
      if (!input.value.trim()) {
        lopu({ title: `${comparison.label}: enter a custom saving or choose Computed`, status: 'error' });
        return;
      }
      const value = Number(input.value);
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        lopu({ title: `${comparison.label}: enter a custom saving from 0 to 100`, status: 'error' });
        return;
      }
      nextDiscounts[comparison.key] = value;
    }
    const nextQuotas = {} as TierQuotas;
    for (const field of QUOTA_OVERRIDE_FIELDS) {
      const input = quotas[field];
      if (input.unlimited) {
        nextQuotas[field] = null;
        continue;
      }
      if (!input.value.trim()) {
        lopu({ title: `${QUOTA_LABELS[field].label}: enter a value or choose unlimited`, status: 'error' });
        return;
      }
      const value = Number(input.value);
      const normalized = field.endsWith('Bytes') ? Math.round(value * MB) : Math.round(value);
      if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(normalized)) {
        lopu({ title: `${QUOTA_LABELS[field].label}: enter a non-negative value or choose unlimited`, status: 'error' });
        return;
      }
      nextQuotas[field] = normalized;
    }

    setSaving(true);
    try {
      const response: any = await api.v1.admin.setTier({
        action: tier ? 'update-draft' : 'create',
        versionId: tier?.versionId,
        tier: {
          title: title.trim(),
          tagline: tagline.trim(),
          emoji: emoji.trim(),
          bannerImageUrl: bannerImageUrl.trim() || null,
          sortOrder: Number(sortOrder),
          metered,
          currency: currency.trim().toUpperCase(),
          prices: nextPrices,
          discountOverrides: nextDiscounts,
          inclusions,
          quotas: nextQuotas
        }
      });
      if (!response?.ok) throw new Error(response?.error || 'Tier save failed');
      lopu({ title: tier ? `${title.trim()} draft updated` : `${title.trim()} draft created`, status: 'success' });
      onSaved(response);
      onClose();
    } catch (error: any) {
      lopu({ title: error?.error || error?.message || 'Tier save failed', status: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const previewQuotas = { ...fallback.quotas };
  for (const field of QUOTA_OVERRIDE_FIELDS) {
    const input = quotas[field];
    if (input.unlimited) {
      previewQuotas[field] = null;
      continue;
    }
    const value = Number(input.value);
    const normalized = field.endsWith('Bytes') ? Math.round(value * MB) : Math.round(value);
    if (input.value.trim() && Number.isFinite(value) && value >= 0 && Number.isSafeInteger(normalized)) {
      previewQuotas[field] = normalized;
    }
  }

  const preview: SubscriptionTierDescriptor = {
    ...(tier ?? fallback),
    id: tier?.id ?? 'new-tier',
    versionId: tier?.versionId ?? 'new-tier-draft',
    version: tier?.version ?? 1,
    status: 'draft',
    title: title.trim() || 'New tier',
    tagline: tagline.trim(),
    description: tagline.trim(),
    emoji: emoji.trim(),
    bannerImageUrl: bannerImageUrl.trim() || null,
    sortOrder: Number(sortOrder) || 0,
    metered,
    currency: currency.trim().toUpperCase() || 'USD',
    prices: parsedPrices,
    discountOverrides: previewOverrides,
    discounts: previewDiscounts,
    inclusions,
    quotas: previewQuotas
  };

  return (
    <Modal isOpen={open} onClose={onClose} size="6xl" scrollBehavior="inside">
      <ModalOverlay />
      <ModalContent mx={3} maxH="94vh">
        <ModalHeader pr={12}>{tier ? `Edit ${tier.title} · draft v${tier.version}` : 'Create a tier draft'}</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <SimpleGrid columns={{ base: 1, xl: 2 }} spacing={6} alignItems="start">
            <Flex direction="column" gap={5} minW={0}>
              <Box>
                <Heading size="sm" mb={3}>
                  Identity
                </Heading>
                <SimpleGrid columns={{ base: 1, sm: 2 }} spacing={3}>
                  <FormControl isRequired>
                    <FormLabel fontSize="xs">Name</FormLabel>
                    <Input size="sm" value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} />
                  </FormControl>
                  <FormControl>
                    <FormLabel fontSize="xs">Emoji</FormLabel>
                    <Input size="sm" value={emoji} maxLength={16} onChange={(event) => setEmoji(event.target.value)} />
                  </FormControl>
                  <FormControl gridColumn={{ sm: '1 / -1' }}>
                    <FormLabel fontSize="xs">Subtitle / tagline</FormLabel>
                    <Input size="sm" value={tagline} maxLength={240} onChange={(event) => setTagline(event.target.value)} />
                  </FormControl>
                  <FormControl gridColumn={{ sm: '1 / -1' }}>
                    <FormLabel fontSize="xs">Banner image URL</FormLabel>
                    <Input
                      size="sm"
                      type="url"
                      placeholder="https://…"
                      value={bannerImageUrl}
                      onChange={(event) => setBannerImageUrl(event.target.value)}
                    />
                    {safeUrl(bannerImageUrl) ? (
                      <Box
                        as="img"
                        src={safeUrl(bannerImageUrl)}
                        alt="Tier banner preview"
                        width="100%"
                        height="92px"
                        objectFit="cover"
                        borderRadius="md"
                        mt={2}
                      />
                    ) : null}
                  </FormControl>
                  <FormControl>
                    <FormLabel fontSize="xs">Sort order</FormLabel>
                    <Input size="sm" type="number" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} />
                  </FormControl>
                  <FormControl>
                    <FormLabel fontSize="xs">Currency</FormLabel>
                    <Input size="sm" value={currency} maxLength={3} onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
                  </FormControl>
                </SimpleGrid>
              </Box>

              <Divider />
              <Box>
                <Heading size="sm" mb={1}>
                  Pricing
                </Heading>
                <Text fontSize="xs" opacity={0.6} mb={3}>
                  Leave a renewal option blank when it is not offered.
                </Text>
                <SimpleGrid columns={{ base: 1, sm: 2 }} spacing={3}>
                  {(Object.keys(PRICE_LABELS) as TierPricePeriod[]).map((period) => (
                    <FormControl key={period}>
                      <FormLabel fontSize="xs">{PRICE_LABELS[period]}</FormLabel>
                      <Input
                        size="sm"
                        type="number"
                        min={0}
                        step="0.01"
                        placeholder="0.00"
                        value={prices[period]}
                        onChange={(event) => setPrices((current) => ({ ...current, [period]: event.target.value }))}
                      />
                    </FormControl>
                  ))}
                </SimpleGrid>
              </Box>

              <Box>
                <Heading size="sm" mb={1}>
                  Percentage saved
                </Heading>
                <Text fontSize="xs" opacity={0.6} mb={3}>
                  Computed values annualize each renewal option. Choose Custom to save your own percentage.
                </Text>
                <Flex direction="column" gap={2}>
                  {TIER_DISCOUNT_COMPARISONS.map((comparison) => {
                    const input = discountInputs[comparison.key];
                    return (
                      <Flex key={comparison.key} align="center" gap={2} wrap="wrap" borderWidth="1px" borderRadius="md" p={2}>
                        <Box flex="1 1 220px">
                          <Text fontSize="sm" fontWeight={650}>
                            {comparison.label}
                          </Text>
                          <Text fontSize="xs" opacity={0.55}>
                            {formatDiscount(previewDiscounts[comparison.key])}
                          </Text>
                        </Box>
                        <Select
                          size="xs"
                          width="105px"
                          value={input.mode}
                          aria-label={`${comparison.label} discount mode`}
                          onChange={(event) =>
                            setDiscountInputs((current) => ({
                              ...current,
                              [comparison.key]: { ...current[comparison.key], mode: event.target.value as 'computed' | 'custom' }
                            }))
                          }
                        >
                          <option value="computed">Computed</option>
                          <option value="custom">Custom</option>
                        </Select>
                        {input.mode === 'custom' ? (
                          <Flex align="center" gap={1}>
                            <Input
                              size="xs"
                              width="88px"
                              type="number"
                              min={0}
                              max={100}
                              step="0.01"
                              value={input.value}
                              aria-label={`${comparison.label} custom percentage saved`}
                              onChange={(event) =>
                                setDiscountInputs((current) => ({
                                  ...current,
                                  [comparison.key]: { ...current[comparison.key], value: event.target.value }
                                }))
                              }
                            />
                            <Text fontSize="xs">%</Text>
                          </Flex>
                        ) : null}
                      </Flex>
                    );
                  })}
                </Flex>
              </Box>

              <Divider />
              <Box>
                <Heading size="sm" mb={1}>
                  Inclusions
                </Heading>
                <Text fontSize="xs" opacity={0.6} mb={3}>
                  This Editor.js content appears directly on the tier card.
                </Text>
                <LongTextEditor
                  value={inclusions}
                  minHeight="180px"
                  placeholder="Add benefits, limits, support, and everything included…"
                  blockTypes={{ image: false, embed: false, code: false, table: false }}
                  onValueChange={(value) => {
                    if (value && typeof value === 'object' && 'blocks' in value) setInclusions(value as TierInclusions);
                  }}
                />
              </Box>

              <Divider />
              <Box>
                <Flex align="center" justify="space-between" gap={3} mb={3}>
                  <Box>
                    <Heading size="sm">Allowance defaults</Heading>
                    <Text fontSize="xs" opacity={0.6}>
                      Snapshotted into every assignment of this version.
                    </Text>
                  </Box>
                  <Checkbox
                    isChecked={metered}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setMetered(checked);
                      if (checked) {
                        setQuotas(
                          (current) =>
                            Object.fromEntries(QUOTA_OVERRIDE_FIELDS.map((field) => [field, { ...current[field], unlimited: true }])) as QuotaInput
                        );
                      }
                    }}
                  >
                    <Text fontSize="sm">Metered</Text>
                  </Checkbox>
                </Flex>
                <SimpleGrid columns={{ base: 1, sm: 2 }} spacing={3}>
                  {QUOTA_OVERRIDE_FIELDS.map((field) => {
                    const input = quotas[field];
                    return (
                      <FormControl key={field}>
                        <FormLabel fontSize="xs">{QUOTA_LABELS[field].label}</FormLabel>
                        <Flex gap={2}>
                          <Select
                            size="sm"
                            width="116px"
                            value={input.unlimited ? 'unlimited' : 'limited'}
                            aria-label={`${QUOTA_LABELS[field].label} limit mode`}
                            onChange={(event) =>
                              setQuotas((current) => ({
                                ...current,
                                [field]: { ...current[field], unlimited: event.target.value === 'unlimited' }
                              }))
                            }
                          >
                            <option value="limited">Limited</option>
                            <option value="unlimited">Unlimited</option>
                          </Select>
                          {!input.unlimited ? (
                            <Input
                              size="sm"
                              type="number"
                              min={0}
                              value={input.value}
                              aria-label={`${QUOTA_LABELS[field].label} in ${QUOTA_LABELS[field].unit}`}
                              onChange={(event) =>
                                setQuotas((current) => ({ ...current, [field]: { ...current[field], value: event.target.value } }))
                              }
                            />
                          ) : null}
                          {!input.unlimited ? (
                            <Text alignSelf="center" fontSize="xs">
                              {QUOTA_LABELS[field].unit}
                            </Text>
                          ) : null}
                        </Flex>
                      </FormControl>
                    );
                  })}
                </SimpleGrid>
              </Box>
            </Flex>

            <Box position={{ xl: 'sticky' }} top={0} minW={0}>
              <Flex align="center" justify="space-between" mb={2}>
                <Text fontSize="xs" fontWeight={700} textTransform="uppercase" opacity={0.5}>
                  Live card preview
                </Text>
                {tier ? (
                  <Badge>
                    {tier.id} · v{tier.version}
                  </Badge>
                ) : (
                  <Badge>new draft</Badge>
                )}
              </Flex>
              <TierCard
                tier={preview}
                showStatus
                allowanceLabel={`App ${preview.quotas.appStorageBytes === null ? '∞' : formatBytes(preview.quotas.appStorageBytes)} · User ${
                  preview.quotas.userStorageBytes === null ? '∞' : formatBytes(preview.quotas.userStorageBytes)
                }`}
              />
            </Box>
          </SimpleGrid>
        </ModalBody>
        <ModalFooter gap={2} flexWrap="wrap" pr={{ base: 24, md: 6 }}>
          <Button size="sm" variant="outline" onClick={onClose} isDisabled={saving}>
            Cancel
          </Button>
          <Button size="sm" colorScheme="purple" onClick={save} isLoading={saving}>
            Save draft
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

const CatalogSection = ({
  title,
  description,
  tiers,
  busyVersionId,
  onEdit,
  onCreateVersion,
  onPublish,
  onArchive,
  draftTierIds
}: {
  title: string;
  description: string;
  tiers: SubscriptionTierDescriptor[];
  busyVersionId: string | null;
  onEdit: (tier: SubscriptionTierDescriptor) => void;
  onCreateVersion: (tier: SubscriptionTierDescriptor) => void;
  onPublish: (tier: SubscriptionTierDescriptor) => void;
  onArchive: (tier: SubscriptionTierDescriptor) => void;
  draftTierIds: Set<string>;
}) => (
  <Box>
    <Flex align="baseline" gap={2} mb={1} wrap="wrap">
      <Heading size="md">{title}</Heading>
      <Badge>{tiers.length}</Badge>
    </Flex>
    <Text fontSize="sm" opacity={0.62} mb={3}>
      {description}
    </Text>
    {tiers.length ? (
      <SimpleGrid columns={{ base: 1, lg: 2 }} spacing={4}>
        {tiers.map((tier) => (
          <TierCard
            key={tier.versionId}
            tier={tier}
            showStatus
            allowanceLabel={`App ${tier.quotas.appStorageBytes === null ? '∞' : formatBytes(tier.quotas.appStorageBytes)} · User ${
              tier.quotas.userStorageBytes === null ? '∞' : formatBytes(tier.quotas.userStorageBytes)
            }`}
            footer={
              <Flex gap={2} wrap="wrap">
                {tier.status === 'draft' ? (
                  <Button size="xs" flex="1 1 90px" variant="outline" onClick={() => onEdit(tier)}>
                    Edit draft
                  </Button>
                ) : (
                  <Button
                    size="xs"
                    flex="1 1 120px"
                    variant="outline"
                    isDisabled={draftTierIds.has(tier.id)}
                    title={draftTierIds.has(tier.id) ? 'This tier already has a draft version' : undefined}
                    aria-label={`Create a new draft version of ${tier.title}`}
                    onClick={() => onCreateVersion(tier)}
                  >
                    New draft version
                  </Button>
                )}
                {tier.status === 'draft' ? (
                  <Button
                    size="xs"
                    flex="1 1 80px"
                    colorScheme="green"
                    isLoading={busyVersionId === tier.versionId}
                    aria-label={`Publish ${tier.title} version ${tier.version}`}
                    onClick={() => onPublish(tier)}
                  >
                    Publish
                  </Button>
                ) : null}
                {tier.status !== 'archived' && !(tier.status === 'live' && tier.id === DEFAULT_SUBSCRIPTION_TIER) ? (
                  <Button
                    size="xs"
                    variant="ghost"
                    colorScheme="orange"
                    isLoading={busyVersionId === tier.versionId}
                    aria-label={`Archive ${tier.title} version ${tier.version}`}
                    onClick={() => onArchive(tier)}
                  >
                    Archive
                  </Button>
                ) : null}
              </Flex>
            }
          />
        ))}
      </SimpleGrid>
    ) : (
      <Box borderWidth="1px" borderStyle="dashed" borderRadius="lg" p={5}>
        <Text fontSize="sm" opacity={0.55}>
          No tiers in this section.
        </Text>
      </Box>
    )}
  </Box>
);

export const TierManager = () => {
  const api = useApi();
  const lopu = useLopu();
  const [tiers, setTiers] = React.useState<SubscriptionTierDescriptor[] | null>(null);
  const [editing, setEditing] = React.useState<{ open: boolean; tier: SubscriptionTierDescriptor | null }>({
    open: false,
    tier: null
  });
  const [busyVersionId, setBusyVersionId] = React.useState<string | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [confirmation, setConfirmation] = React.useState<{
    tier: SubscriptionTierDescriptor;
    action: 'publish' | 'archive';
  } | null>(null);
  const cancelConfirmationRef = React.useRef<HTMLButtonElement>(null);
  const apiRef = React.useRef(api);
  apiRef.current = api;

  const tierQuery = useAdminRowQuery({
    rows: tiers ?? [],
    fields: TIER_QUERY_FIELDS,
    getRowId: tierQueryRowId,
    initialSort: { field: 'sortOrder', direction: 'asc' }
  });

  const accept = React.useCallback((response: any) => {
    if (Array.isArray(response?.tiers)) setTiers(response.tiers);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    apiRef.current.v1.admin
      .tiers()
      .then((response: any) => {
        if (!cancelled && response?.ok) accept(response);
      })
      .catch((error: any) => {
        if (!cancelled) {
          const message = error?.error || 'Could not load tiers';
          setLoadError(message);
          lopu({ title: message, status: 'error' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [accept, lopu, reloadKey]);

  const lifecycle = async (tier: SubscriptionTierDescriptor, action: 'create-version' | 'publish' | 'archive') => {
    setBusyVersionId(tier.versionId);
    try {
      const response: any = await api.v1.admin.setTier({ action, versionId: tier.versionId });
      if (!response?.ok) throw new Error(response?.error || 'Tier update failed');
      accept(response);
      if (action === 'create-version') {
        setEditing({ open: true, tier: response.tier });
        lopu({ title: `${tier.title} v${response.tier.version} draft created`, status: 'success' });
      } else {
        lopu({
          title: action === 'publish' ? `${tier.title} v${tier.version} is live` : `${tier.title} v${tier.version} archived`,
          status: 'success'
        });
      }
    } catch (error: any) {
      lopu({ title: error?.error || error?.message || 'Tier update failed', status: 'error' });
    } finally {
      setBusyVersionId(null);
    }
  };

  if (!tiers) {
    return loadError ? (
      <Box borderWidth="1px" borderRadius="lg" p={5} textAlign="center">
        <Text fontSize="sm" mb={3}>
          {loadError}
        </Text>
        <Button size="sm" variant="outline" onClick={() => setReloadKey((value) => value + 1)}>
          Retry
        </Button>
      </Box>
    ) : (
      <Flex justify="center" py={12}>
        <Spinner />
      </Flex>
    );
  }

  const live = tierQuery.rows.filter((tier) => tier.status === 'live');
  const drafts = tierQuery.rows.filter((tier) => tier.status === 'draft');
  const archived = tierQuery.rows.filter((tier) => tier.status === 'archived');
  const draftTierIds = new Set(tiers.filter((tier) => tier.status === 'draft').map((tier) => tier.id));

  return (
    <Flex direction="column" gap={7}>
      <Flex align="center" justify="space-between" gap={3} wrap="wrap">
        <Box>
          <Heading size="md">Tier catalog</Heading>
          <Text fontSize="sm" opacity={0.62} mt={1}>
            Draft changes safely, publish immutable versions, and keep every historical assignment traceable.
          </Text>
        </Box>
        <Button size="sm" colorScheme="purple" onClick={() => setEditing({ open: true, tier: null })}>
          Add new tier
        </Button>
      </Flex>

      <AdminRowQueryControls
        ariaLabel="Query tier catalog"
        fields={TIER_QUERY_FIELDS}
        onChange={tierQuery.setQuery}
        resultCount={tierQuery.rows.length}
        searchPlaceholder="Search every tier field…"
        totalCount={tiers.length}
        value={tierQuery.query}
      />

      <CatalogSection
        title="Live tiers"
        description="These versions are available as new tier choices. Editing creates a new draft version."
        tiers={live}
        busyVersionId={busyVersionId}
        onEdit={(tier) => setEditing({ open: true, tier })}
        onCreateVersion={(tier) => lifecycle(tier, 'create-version')}
        onPublish={(tier) => setConfirmation({ tier, action: 'publish' })}
        onArchive={(tier) => setConfirmation({ tier, action: 'archive' })}
        draftTierIds={draftTierIds}
      />
      <CatalogSection
        title="Draft / not live"
        description="Drafts are editable and never appear in customer tier options until published."
        tiers={drafts}
        busyVersionId={busyVersionId}
        onEdit={(tier) => setEditing({ open: true, tier })}
        onCreateVersion={(tier) => lifecycle(tier, 'create-version')}
        onPublish={(tier) => setConfirmation({ tier, action: 'publish' })}
        onArchive={(tier) => setConfirmation({ tier, action: 'archive' })}
        draftTierIds={draftTierIds}
      />
      <CatalogSection
        title="Archived tiers"
        description="Archived versions remain linked to existing subscriptions but cannot be newly selected."
        tiers={archived}
        busyVersionId={busyVersionId}
        onEdit={(tier) => setEditing({ open: true, tier })}
        onCreateVersion={(tier) => lifecycle(tier, 'create-version')}
        onPublish={(tier) => setConfirmation({ tier, action: 'publish' })}
        onArchive={(tier) => setConfirmation({ tier, action: 'archive' })}
        draftTierIds={draftTierIds}
      />

      <TierEditorModal open={editing.open} tier={editing.tier} onClose={() => setEditing({ open: false, tier: null })} onSaved={accept} />
      <AlertDialog isOpen={!!confirmation} leastDestructiveRef={cancelConfirmationRef} onClose={() => setConfirmation(null)} isCentered>
        <AlertDialogOverlay />
        <AlertDialogContent mx={3}>
          <AlertDialogHeader>{confirmation?.action === 'publish' ? 'Publish tier revision?' : 'Archive tier revision?'}</AlertDialogHeader>
          <AlertDialogBody>
            {confirmation?.action === 'publish' ? (
              <Text fontSize="sm">
                {confirmation.tier.title} v{confirmation.tier.version} will become selectable. Its previous live revision will move to Archived, while
                existing assignments stay pinned to their original version.
              </Text>
            ) : confirmation ? (
              <Text fontSize="sm">
                {confirmation.tier.title} v{confirmation.tier.version} will no longer be selectable. Existing assignments remain linked to this
                historical version.
              </Text>
            ) : null}
          </AlertDialogBody>
          <AlertDialogFooter gap={2}>
            <Button ref={cancelConfirmationRef} size="sm" variant="outline" onClick={() => setConfirmation(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              colorScheme={confirmation?.action === 'publish' ? 'green' : 'orange'}
              onClick={() => {
                const pending = confirmation;
                setConfirmation(null);
                if (pending) void lifecycle(pending.tier, pending.action);
              }}
            >
              {confirmation?.action === 'publish' ? 'Publish' : 'Archive'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Flex>
  );
};
