import React from 'react';
import { Badge, Box, Button, Flex, Heading, SimpleGrid, Text } from '@chakra-ui/react';

import {
  TIER_DISCOUNT_COMPARISONS,
  currencyMinorUnitFactor,
  speedTestsPerHour,
  speedTestAllowanceLabel,
  type SubscriptionTierDescriptor,
  type TierPricePeriod
} from '~/api/utils/subscriptions/tierCatalog';
import { RichTextBlocks } from '~/components/Kinds/kindRenderersMedia';
import { safeUrl } from '~/components/Kinds/safeUrl';

export type TierCardTier = SubscriptionTierDescriptor & {
  selectable?: boolean;
  storageAllowanceBytes?: number | null;
};

const PERIOD_LABELS: Record<TierPricePeriod, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly'
};

export const formatTierPrice = (minor: number | null, currency: string): string | null => {
  if (minor === null || !Number.isSafeInteger(minor)) return null;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(minor / currencyMinorUnitFactor(currency));
  } catch {
    const factor = currencyMinorUnitFactor(currency);
    return `${currency} ${(minor / factor).toFixed(Math.round(Math.log10(factor)))}`;
  }
};

const discountLabel = (value: number) =>
  value >= 0 ? `${Math.abs(value).toFixed(value % 1 ? 2 : 0)}% saved` : `${Math.abs(value).toFixed(value % 1 ? 2 : 0)}% more`;

export const TierCard = ({
  tier,
  current = false,
  showStatus = false,
  allowanceLabel,
  actionLabel,
  actionDisabled = false,
  actionLoading = false,
  onAction,
  footer
}: {
  tier: TierCardTier;
  current?: boolean;
  showStatus?: boolean;
  allowanceLabel?: string | null;
  actionLabel?: string;
  actionDisabled?: boolean;
  actionLoading?: boolean;
  onAction?: () => void;
  footer?: React.ReactNode;
}) => {
  const banner = safeUrl(tier.bannerImageUrl);
  const [bannerFailed, setBannerFailed] = React.useState(false);
  React.useEffect(() => setBannerFailed(false), [banner]);
  const pricedPeriods = (Object.keys(PERIOD_LABELS) as TierPricePeriod[]).filter(
    (period) => tier.prices?.[period] !== null && tier.prices?.[period] !== undefined
  );
  const discountRows = TIER_DISCOUNT_COMPARISONS.filter((comparison) => typeof tier.discounts?.[comparison.key] === 'number');

  return (
    <Flex
      direction="column"
      minW={0}
      height="100%"
      borderWidth="1px"
      borderRadius="var(--tt-radius-lg, 16px)"
      borderColor={current ? 'purple.400' : 'var(--tt-border, #ececef)'}
      overflow="hidden"
      background="var(--tt-card, white)"
      boxShadow={current ? '0 0 0 2px rgba(128, 90, 213, 0.12)' : 'var(--tt-shadow-card, 0 8px 30px rgba(0,0,0,0.05))'}
    >
      <Box height="104px" background="linear-gradient(125deg, var(--tt-rainbow-2, #ff9dca), var(--tt-rainbow-5, #8c6cff))" overflow="hidden">
        {banner && !bannerFailed ? (
          <Box as="img" src={banner} alt="" width="100%" height="100%" objectFit="cover" display="block" onError={() => setBannerFailed(true)} />
        ) : null}
      </Box>

      <Flex direction="column" flex={1} p={4} gap={3} minW={0}>
        <Box>
          <Flex align="center" gap={2} wrap="wrap">
            <Heading as="h3" size="sm" lineHeight="1.2" overflowWrap="anywhere">
              {tier.emoji ? `${tier.emoji} ` : ''}
              {tier.title}
            </Heading>
            {current ? <Badge colorScheme="purple">current</Badge> : null}
            {showStatus ? (
              <Badge colorScheme={tier.status === 'live' ? 'green' : tier.status === 'draft' ? 'orange' : 'gray'}>{tier.status}</Badge>
            ) : null}
            <Badge variant="outline">v{tier.version}</Badge>
          </Flex>
          {tier.tagline ? (
            <Text fontSize="sm" opacity={0.66} mt={1} overflowWrap="anywhere">
              {tier.tagline}
            </Text>
          ) : null}
        </Box>

        {allowanceLabel ? (
          <Text fontSize="sm" fontWeight={700}>
            {allowanceLabel}
          </Text>
        ) : null}

        {pricedPeriods.length ? (
          <SimpleGrid columns={{ base: 2, sm: Math.min(4, pricedPeriods.length) }} spacing={2}>
            {pricedPeriods.map((period) => (
              <Box key={period} borderWidth="1px" borderRadius="md" p={2} minW={0}>
                <Text fontSize="10px" textTransform="uppercase" letterSpacing="0.06em" opacity={0.5}>
                  {PERIOD_LABELS[period]}
                </Text>
                <Text fontSize="sm" fontWeight={750} noOfLines={1}>
                  {formatTierPrice(tier.prices[period], tier.currency)}
                </Text>
              </Box>
            ))}
          </SimpleGrid>
        ) : (
          <Text fontSize="xs" opacity={0.5}>
            Pricing not set
          </Text>
        )}

        {discountRows.length ? (
          <Flex gap={1.5} wrap="wrap">
            {discountRows.map((comparison) => {
              const value = tier.discounts[comparison.key] as number;
              return (
                <Badge
                  key={comparison.key}
                  variant="subtle"
                  colorScheme={value >= 0 ? 'green' : 'orange'}
                  title={comparison.label}
                  whiteSpace="normal"
                >
                  {PERIOD_LABELS[comparison.target]} vs {PERIOD_LABELS[comparison.source]} · {discountLabel(value)}
                </Badge>
              );
            })}
          </Flex>
        ) : null}

        {tier.inclusions?.blocks?.length ? (
          <Box borderTopWidth="1px" borderColor="var(--tt-border, #ececef)" pt={3}>
            <RichTextBlocks blocks={tier.inclusions.blocks} />
          </Box>
        ) : null}

        {showStatus ? <Text fontSize="sm">Account speed tests: {speedTestAllowanceLabel(speedTestsPerHour(tier.id, tier.quotas))}</Text> : null}

        <Box mt="auto" pt={1}>
          {onAction && actionLabel ? (
            <Button
              size="sm"
              width="100%"
              colorScheme="purple"
              variant={current ? 'outline' : 'solid'}
              isDisabled={actionDisabled}
              isLoading={actionLoading}
              onClick={onAction}
              aria-label={`${actionLabel}: ${tier.title} version ${tier.version}`}
            >
              {actionLabel}
            </Button>
          ) : null}
          {footer}
        </Box>
      </Flex>
    </Flex>
  );
};
