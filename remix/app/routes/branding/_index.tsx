// branding page which basically just renders a bunch of assets loaded from json encoded Thingtime ".tt" data files
// import from ./assets/all.ts = [{...},...]
import { Container, Flex, Heading, SimpleGrid, Text } from '@chakra-ui/react';
import { Thingtime } from '~/components/Thingtime/Thingtime';
import { LogoExport } from '~/components/Branding/LogoExport';
import { LOGO_FULL_MATRIX, LOGO_ICON_MATRIX, LOGO_THEMES } from '~/components/Branding/logoMatrix';
import Assets from './assets/all';

const LOGO_EXPORT_VARIANTS = [
  { name: 'Full logo', slug: 'logo', matrix: LOGO_FULL_MATRIX, colourMap: LOGO_THEMES.default },
  { name: 'Icon', slug: 'icon', matrix: LOGO_ICON_MATRIX, colourMap: LOGO_THEMES.default },
  { name: 'Full logo · pink', slug: 'logo-pink', matrix: LOGO_FULL_MATRIX, colourMap: LOGO_THEMES.pink },
  { name: 'Icon · pink', slug: 'icon-pink', matrix: LOGO_ICON_MATRIX, colourMap: LOGO_THEMES.pink }
];

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
        <Heading as="h2" size="md" color="var(--tt-ink, #16161a)" letterSpacing="-0.02em" pb={4}>
          Logo exports
        </Heading>
        <Text fontSize="sm" color="var(--tt-muted, #9a9aa6)" pb={5} maxW="560px">
          Download any variant as a scalable SVG or a rasterised PNG at your chosen width — both render from the same
          voxel matrix as the live logo.
        </Text>
        <SimpleGrid columns={[1, 2]} spacing={4} pb={12}>
          {LOGO_EXPORT_VARIANTS.map((variant) => (
            <LogoExport key={variant.slug} {...variant} />
          ))}
        </SimpleGrid>
        <Heading as="h2" size="md" color="var(--tt-ink, #16161a)" letterSpacing="-0.02em" pb={4}>
          Asset library
        </Heading>
        <Thingtime thing={Assets} />
      </Flex>
    </Container>
  );
}
