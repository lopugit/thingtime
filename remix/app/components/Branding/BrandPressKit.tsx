import { Box, Flex, Heading, SimpleGrid, Text } from '@chakra-ui/react';
import React from 'react';

import { Eyebrow, Segmented, formatBytes } from './BrandAssetSection';

// Press-kit gallery: the generated marketing suite (OG cards, banners,
// wallpapers, tiles, patterns). Every format exists with each logo lock-up on
// a light and a dark background; two selectors pick which set the grid shows,
// so the page stays one tile per format — imagery first, zero chrome.

export type PressKitLogo = 'wordmark' | 'square' | 'icon';
export type PressKitSurface = 'light' | 'dark';

export type PressKitItem = {
  slug: string;
  /** The format this file belongs to (og-card, banner, …). */
  kind: string;
  kindName: string;
  /** null = a logo-free format (the confetti pattern). */
  logo: PressKitLogo | null;
  surface: PressKitSurface;
  name: string;
  description: string;
  w: number;
  h: number;
  url: string;
  bytes: number;
};

const MONO = 'var(--tt-font-mono, "JetBrains Mono", monospace)';
const HEAD = 'var(--tt-font-heading, "Space Grotesk", sans-serif)';

const LOGO_OPTIONS: Array<{ value: PressKitLogo; label: string }> = [
  { value: 'wordmark', label: 'Wordmark' },
  { value: 'square', label: 'Square' },
  { value: 'icon', label: 'Icon' }
];

const SURFACE_OPTIONS: Array<{ value: PressKitSurface; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
];

const Label = ({ children }: { children: React.ReactNode }) => (
  <Text fontFamily={MONO} fontSize="10px" fontWeight={600} letterSpacing="0.12em" textTransform="uppercase" color="var(--tt-muted, #9a9aa6)">
    {children}
  </Text>
);

export const BrandPressKit = ({ items, eyebrow }: { items: PressKitItem[]; eyebrow: string }) => {
  const [logo, setLogo] = React.useState<PressKitLogo>('wordmark');
  const [surface, setSurface] = React.useState<PressKitSurface>('light');

  // One tile per format, in manifest order, showing the selected combination.
  const shown = React.useMemo(() => {
    const kinds = Array.from(new Set(items.map((item) => item.kind)));
    return kinds
      .map((kind) => items.find((item) => item.kind === kind && item.surface === surface && (item.logo === null || item.logo === logo)))
      .filter((item): item is PressKitItem => Boolean(item));
  }, [items, logo, surface]);

  return (
    <Box as="section" id="press-kit" pt={{ base: '72px', md: '112px' }}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <Heading as="h2" fontFamily={HEAD} fontWeight={700} letterSpacing="-0.025em" fontSize="clamp(28px, 3.4vw, 42px)" color="var(--tt-ink, #16161a)" mt="10px">
        Ready-to-post imagery
      </Heading>
      <Text mt="12px" mb={{ base: '20px', md: '24px' }} maxW="620px" fontSize={{ base: '15px', md: '16px' }} lineHeight={1.65} color="var(--tt-text, #5a5a66)">
        A generated suite for articles, launch posts and slides — link cards, social banners, wallpapers and tiles, all
        rendered straight from the voxel matrix. Pick a logo and a background; every format follows. Take anything.
      </Text>
      <Flex gap={{ base: '14px', md: '24px' }} flexWrap="wrap" mb={{ base: '24px', md: '36px' }}>
        <Flex flexDir="column" gap="6px">
          <Label>Logo</Label>
          <Segmented label="Press kit logo" options={LOGO_OPTIONS} value={logo} onChange={(next) => setLogo(next)} />
        </Flex>
        <Flex flexDir="column" gap="6px">
          <Label>Background</Label>
          <Segmented label="Press kit background" options={SURFACE_OPTIONS} value={surface} onChange={(next) => setSurface(next)} />
        </Flex>
      </Flex>
      <SimpleGrid columns={{ base: 1, md: 2 }} spacingX="28px" spacingY="40px">
        {shown.map((item) => (
          // keyed by format so switching logo/background swaps the src in place
          // (the previous image stays up until the next one has loaded)
          <Box key={item.kind} data-testid={`presskit-${item.kind}`}>
            <Box borderRadius="20px" overflow="hidden" lineHeight={0} boxShadow="0 1px 3px rgba(20,20,40,.08), 0 18px 44px -28px rgba(20,20,40,.25)">
              <img
                src={item.url}
                alt={`Thingtime ${item.name} — ${item.w}×${item.h} PNG`}
                width={item.w}
                height={item.h}
                loading="lazy"
                decoding="async"
                // portrait pieces (phone wallpaper) preview as a centre crop so
                // one tall tile can't stretch its whole grid row
                style={
                  item.h > item.w
                    ? { width: '100%', height: '480px', objectFit: 'cover', display: 'block' }
                    : { width: '100%', height: 'auto', display: 'block' }
                }
              />
            </Box>
            <Flex mt="12px" alignItems="baseline" gap="12px" flexWrap="wrap">
              <Text fontWeight={650} fontSize="15px" color="var(--tt-ink, #16161a)">
                {item.kindName}
              </Text>
              <Text fontFamily={MONO} fontSize="11px" color="var(--tt-muted, #9a9aa6)">
                {item.w}×{item.h} · PNG · {formatBytes(item.bytes)}
              </Text>
              <Box flex="1" />
              <Box
                as="a"
                href={item.url}
                download
                fontSize="13px"
                fontWeight={600}
                color="var(--tt-ink, #16161a)"
                _hover={{ opacity: 0.7 }}
                transition="opacity 140ms ease"
                aria-label={`Download ${item.name}`}
              >
                Download ↓
              </Box>
            </Flex>
            <Text mt="2px" fontSize="13px" color="var(--tt-text, #5a5a66)" maxW="440px">
              {item.description}
            </Text>
          </Box>
        ))}
      </SimpleGrid>
    </Box>
  );
};
