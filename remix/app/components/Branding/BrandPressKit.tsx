import { Box, Flex, Heading, SimpleGrid, Text } from '@chakra-ui/react';
import React from 'react';

import { Eyebrow } from './BrandAssetSection';

// Press-kit gallery: the generated marketing suite (OG cards, banners,
// wallpapers, tiles, patterns) as lazy-loaded images with plain download
// links — imagery first, zero chrome.

export type PressKitItem = {
  slug: string;
  name: string;
  description: string;
  surface: 'light' | 'dark' | 'gradient';
  w: number;
  h: number;
  url: string;
  bytes: number;
};

const MONO = 'var(--tt-font-mono, "JetBrains Mono", monospace)';
const HEAD = 'var(--tt-font-heading, "Space Grotesk", sans-serif)';

const formatBytes = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export const BrandPressKit = ({ items }: { items: PressKitItem[] }) => (
  <Box as="section" id="press-kit" pt={{ base: '72px', md: '112px' }}>
    <Eyebrow>05 · Press kit</Eyebrow>
    <Heading as="h2" fontFamily={HEAD} fontWeight={700} letterSpacing="-0.025em" fontSize="clamp(28px, 3.4vw, 42px)" color="var(--tt-ink, #16161a)" mt="10px">
      Ready-to-post imagery
    </Heading>
    <Text mt="12px" mb={{ base: '24px', md: '36px' }} maxW="620px" fontSize={{ base: '15px', md: '16px' }} lineHeight={1.65} color="var(--tt-text, #5a5a66)">
      A generated suite for articles, launch posts and slides — link cards, social banners, wallpapers and tiles, all
      rendered straight from the voxel matrix. Take anything.
    </Text>
    <SimpleGrid columns={{ base: 1, md: 2 }} spacingX="28px" spacingY="40px">
      {items.map((item) => (
        <Box key={item.slug}>
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
              {item.name}
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
