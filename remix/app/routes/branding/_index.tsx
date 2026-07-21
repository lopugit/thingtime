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
  return (
    <Container
      maxW="container"
      width="100%"
      px={['18px', '24px']}
      pt="calc(var(--thingtime-safe-area-top, 0px) + 108px)"
      pb={24}
    >
      <Flex flexDir="column">
        <Text
          fontFamily="mono"
          fontSize="11px"
          fontWeight={600}
          letterSpacing="0.14em"
          textTransform="uppercase"
          color="var(--tt-muted, #9a9aa6)"
          pb={2}
        >
          Brand
        </Text>
        <Heading as="h1" size="lg" color="var(--tt-ink, #16161a)" letterSpacing="-0.02em" pb={8}>
          Thingtime Branding Assets
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
