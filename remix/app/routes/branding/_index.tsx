import { Box, Flex, Heading, SimpleGrid, Text } from '@chakra-ui/react';
import React from 'react';

import { BrandAssetSection } from '~/components/Branding/BrandAssetSection';
import type { ManifestVariant } from '~/components/Branding/BrandAssetSection';
import { Eyebrow } from '~/components/Branding/BrandAssetSection';
import { BrandPressKit } from '~/components/Branding/BrandPressKit';
import type { PressKitItem } from '~/components/Branding/BrandPressKit';
import { LOGO_DEFAULT_COLOURS, LOGO_FULL_MATRIX, LOGO_ICON_MATRIX, LOGO_THEMES } from '~/components/Branding/logoMatrix';
import { useLopu } from '~/components/Lopu/useLopu';
import { RAINBOW_PALETTE } from '~/theme/tokens';
import brandingAssets from '~/components/Branding/brandingAssets.generated.json';

// /branding — Thingtime's brand-resources page, styled after the big-league
// brand centres (full-width sections, one asset per section, imagery first)
// with the Prism design language + rainbow soul. Ready-made files come from
// remix/public/branding (npm run branding-assets); the custom exporter renders
// anything else client-side from the same voxel matrix.

const MONO = 'var(--tt-font-mono, "JetBrains Mono", monospace)';
const HEAD = 'var(--tt-font-heading, "Space Grotesk", sans-serif)';

const RAINBOW_GRADIENT = `linear-gradient(90deg, var(--tt-rainbow-1, #f34a4a), var(--tt-rainbow-2, #ffbc48), var(--tt-rainbow-3, #58ca70), var(--tt-rainbow-4, #47b5e6), var(--tt-rainbow-5, #a555e8), var(--tt-rainbow-1, #f34a4a))`;

const SECTIONS = [
  {
    slug: 'logo',
    eyebrow: '01 · Wordmark',
    title: 'The wordmark',
    description:
      'Nine voxel glyphs spelling Thingtime — the full lock-up for headers, docs, decks and anywhere the brand introduces itself. It ships trimmed to the pixel: no baked-in whitespace, ever.',
    matrix: LOGO_FULL_MATRIX,
    colourMap: LOGO_THEMES.default
  },
  {
    slug: 'icon',
    eyebrow: '02 · Icon',
    title: 'The tree',
    description:
      'Thingtime distilled to five voxels — a leafy little tree. Reach for it when space is tight: avatars, favicons, app grids, pixel jewellery.',
    matrix: LOGO_ICON_MATRIX,
    colourMap: LOGO_THEMES.default
  },
  {
    slug: 'logo-pink',
    eyebrow: '03 · Wordmark · pink',
    title: 'Wordmark in hotpink',
    description:
      'The single-colour cut for stickers, stamps, embroidery and moments that call for maximum 🩷. Same voxels, one colour.',
    matrix: LOGO_FULL_MATRIX,
    colourMap: LOGO_THEMES.pink
  },
  {
    slug: 'icon-pink',
    eyebrow: '04 · Icon · pink',
    title: 'The tree in hotpink',
    description: 'The five-voxel tree in one colour — engraving, laser cutting, single-ink print, tiny UI moments.',
    matrix: LOGO_ICON_MATRIX,
    colourMap: LOGO_THEMES.pink
  }
];

const ANCHORS = [
  { href: '#logo', label: 'Wordmark' },
  { href: '#icon', label: 'Icon' },
  { href: '#logo-pink', label: 'Pink' },
  { href: '#press-kit', label: 'Press kit' },
  { href: '#colours', label: 'Colours' },
  { href: '#usage', label: 'Usage' }
];

// The wordmark palette in reading order, plus the pink cut.
const WORDMARK_SWATCHES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'x']
  .map((key) => LOGO_DEFAULT_COLOURS[key])
  .concat(['hotpink']);

const USAGE_RULES = [
  { emoji: '🟩', text: 'Keep the voxels square — scale the logo, never stretch or squash it.' },
  { emoji: '🌬️', text: 'Give it room to breathe. The exporter’s padding options bake in clear space for you.' },
  { emoji: '🌗', text: 'Any calm background works — pick the surface that keeps contrast comfy.' },
  { emoji: '🚫', text: 'Please don’t recolour, rearrange or add effects to the voxels. The pink cut is the only remix.' }
];

const Inner = (props: React.ComponentProps<typeof Box>) => <Box maxW="1240px" mx="auto" px={{ base: '20px', md: '40px' }} {...props} />;

export default function Branding() {
  const lopu = useLopu();
  const manifestBySlug = new Map<string, ManifestVariant>(brandingAssets.variants.map((variant) => [variant.slug, variant as ManifestVariant]));

  const copyColour = async (hex: string) => {
    try {
      await navigator.clipboard.writeText(hex);
      lopu({ title: `${hex} copied 🎨`, status: 'success' });
    } catch {
      lopu({ title: 'Copy failed', description: 'Your browser blocked clipboard access 🥺', status: 'error' });
    }
  };

  return (
    <Box
      width="100%"
      pb="0"
      sx={{
        'section[id]': { scrollMarginTop: 'calc(var(--thingtime-safe-area-top, 0px) + 72px)' },
        '@media (prefers-reduced-motion: reduce)': { '.tt-brand-gradient': { animation: 'none' } }
      }}
    >
      {/* Hero */}
      <Inner as="header" pt="calc(var(--thingtime-safe-area-top, 0px) + 128px)">
        <Eyebrow>Brand resources</Eyebrow>
        <Heading
          as="h1"
          fontFamily={HEAD}
          fontWeight={700}
          letterSpacing="-0.03em"
          lineHeight={1.02}
          fontSize="clamp(42px, 7vw, 84px)"
          color="var(--tt-ink, #16161a)"
          mt="14px"
        >
          Make it{' '}
          <Box
            as="span"
            className="tt-brand-gradient"
            backgroundImage={RAINBOW_GRADIENT}
            backgroundSize="200% auto"
            backgroundClip="text"
            sx={{ WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', animation: 'tt-pan 7s linear infinite' }}
          >
            Thingtime
          </Box>
          .
        </Heading>
        <Text mt="20px" maxW="640px" fontSize={{ base: '16px', md: '18px' }} lineHeight={1.7} color="var(--tt-text, #5a5a66)">
          Logos, colours and ready-to-post imagery — everything on this page is free to use when you talk about
          Thingtime. Grab a ready-made size, or export any variant at any resolution with your own padding. Every asset
          is trimmed to the pixel.
        </Text>
        <Flex mt="28px" gap="8px" flexWrap="wrap">
          {ANCHORS.map((anchor) => (
            <Box
              key={anchor.href}
              as="a"
              href={anchor.href}
              px="16px"
              height="36px"
              display="inline-flex"
              alignItems="center"
              borderRadius="full"
              bg="var(--tt-surface-alt, #f5f5f7)"
              color="var(--tt-ink, #16161a)"
              fontSize="13.5px"
              fontWeight={600}
              _hover={{ bg: 'var(--tt-ink, #16161a)', color: 'var(--tt-card, #fff)' }}
              transition="all 140ms ease"
            >
              {anchor.label}
            </Box>
          ))}
        </Flex>
      </Inner>

      {/* One section per variant */}
      <Inner>
        {SECTIONS.map((section) => (
          <BrandAssetSection key={section.slug} {...section} manifest={manifestBySlug.get(section.slug)} />
        ))}

        <BrandPressKit items={brandingAssets.presskit as PressKitItem[]} />

        {/* Colours */}
        <Box as="section" id="colours" pt={{ base: '72px', md: '112px' }}>
          <Eyebrow>06 · Colours</Eyebrow>
          <Heading as="h2" fontFamily={HEAD} fontWeight={700} letterSpacing="-0.025em" fontSize="clamp(28px, 3.4vw, 42px)" color="var(--tt-ink, #16161a)" mt="10px">
            The palette
          </Heading>
          <Text mt="12px" mb="28px" maxW="620px" fontSize={{ base: '15px', md: '16px' }} lineHeight={1.65} color="var(--tt-text, #5a5a66)">
            The wordmark’s voxel colours and the five-stop rainbow that runs through the product. Tap a swatch to copy
            its hex.
          </Text>
          {[
            { label: 'Voxels', colours: WORDMARK_SWATCHES },
            { label: 'Rainbow', colours: RAINBOW_PALETTE }
          ].map((group) => (
            <Box key={group.label} mb="22px">
              <Text fontFamily={MONO} fontSize="11px" fontWeight={600} letterSpacing="0.14em" textTransform="uppercase" color="var(--tt-muted, #9a9aa6)" mb="10px">
                {group.label}
              </Text>
              <Flex flexWrap="wrap" columnGap="8px" rowGap="8px">
                {group.colours.map((hex) => (
                  <Flex
                    key={hex}
                    as="button"
                    type="button"
                    onClick={() => copyColour(hex)}
                    alignItems="center"
                    gap="10px"
                    pl="6px"
                    pr="14px"
                    height="44px"
                    borderRadius="full"
                    bg="var(--tt-surface-alt, #f5f5f7)"
                    _hover={{ transform: 'translateY(-1px)', boxShadow: '0 6px 16px -8px rgba(20,20,40,.35)' }}
                    transition="all 140ms ease"
                    aria-label={`Copy ${hex}`}
                  >
                    <Box width="32px" height="32px" borderRadius="full" bg={hex} boxShadow="inset 0 0 0 1px rgba(0,0,0,.06)" />
                    <Text fontFamily={MONO} fontSize="12.5px" color="var(--tt-text, #5a5a66)">
                      {hex}
                    </Text>
                  </Flex>
                ))}
              </Flex>
            </Box>
          ))}
        </Box>

        {/* Usage */}
        <Box as="section" id="usage" pt={{ base: '72px', md: '112px' }} pb={{ base: '80px', md: '128px' }}>
          <Eyebrow>07 · Usage</Eyebrow>
          <Heading as="h2" fontFamily={HEAD} fontWeight={700} letterSpacing="-0.025em" fontSize="clamp(28px, 3.4vw, 42px)" color="var(--tt-ink, #16161a)" mt="10px">
            Use it kindly
          </Heading>
          <SimpleGrid columns={{ base: 1, md: 2 }} spacingX="40px" spacingY="20px" mt="24px" maxW="880px">
            {USAGE_RULES.map((rule) => (
              <Flex key={rule.text} gap="14px" alignItems="flex-start">
                <Text fontSize="20px" lineHeight="28px" aria-hidden>
                  {rule.emoji}
                </Text>
                <Text fontSize="15.5px" lineHeight={1.65} color="var(--tt-text, #5a5a66)">
                  {rule.text}
                </Text>
              </Flex>
            ))}
          </SimpleGrid>
          <Text mt={{ base: '40px', md: '64px' }} fontSize="14px" color="var(--tt-muted, #9a9aa6)">
            Questions, remix ideas or something you wish was here?{' '}
            <Box as="a" href="/" color="var(--tt-ink, #16161a)" fontWeight={600} _hover={{ opacity: 0.7 }}>
              Come say hi on Thingtime
            </Box>
            {' '}🌈
          </Text>
        </Box>
      </Inner>

      {/* Rainbow bookend */}
      <Box height="6px" width="100%" backgroundImage={RAINBOW_GRADIENT} backgroundSize="200% auto" />
    </Box>
  );
}
