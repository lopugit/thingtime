import { Box, Button, Flex, Heading, Text, useBreakpointValue } from '@chakra-ui/react';
import React from 'react';

import { Eyebrow, formatBytes } from './BrandAssetSection';
import { ChipGroup } from './BrandChips';
import { BRAND_IMAGERY } from './brandImagery';
import type { ImageryFormatGroup, ImageryShape, ImageryTone } from './brandImagery';
import type { BrandSceneOptions } from './brandScenes';

// Ready-to-post imagery: one gallery over two committed sets —
//   · the curated generative scenes (brandImagery.ts): every lock-up and fun
//     cut across posts, stories, cards, banners, slides and wallpapers;
//   · the classic press kit: each format with wordmark, square or tree on a
//     plain light or dark background.
// Filters narrow it by logo, format and background; the list grows a page at a
// time. Scene-based pictures can be reopened in the studio ("Remix").

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

/** brandingImagery.generated.json: what the generator wrote for each scene. */
export type ImageryManifestItem = { id: string; name: string; w: number; h: number; url: string; bytes: number };

type GalleryEntry = {
  key: string;
  name: string;
  alt: string;
  w: number;
  h: number;
  url: string;
  bytes: number;
  shape: ImageryShape | null;
  fun: boolean;
  tone: ImageryTone;
  group: ImageryFormatGroup;
  /** Present when the picture can be rebuilt (and remixed) in the studio. */
  scene?: BrandSceneOptions;
};

const MONO = 'var(--tt-font-mono, "JetBrains Mono", monospace)';
const HEAD = 'var(--tt-font-heading, "Space Grotesk", sans-serif)';

const CLASSIC_GROUPS: Record<string, ImageryFormatGroup> = {
  'og-card': 'card',
  banner: 'banner',
  'linkedin-banner': 'banner',
  'social-square': 'square',
  'app-tile': 'square',
  'confetti-pattern': 'square',
  wallpaper: 'wallpaper',
  'wallpaper-4k': 'wallpaper',
  'wallpaper-phone': 'wallpaper'
};

const CLASSIC_SHAPES: Record<PressKitLogo, ImageryShape> = { wordmark: 'wordmark', square: 'square', icon: 'tree' };

type ShapeFilter = 'all' | ImageryShape | 'fun';
type GroupFilter = 'all' | ImageryFormatGroup;
type ToneFilter = 'all' | ImageryTone;

const SHAPE_OPTIONS: Array<{ value: ShapeFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'wordmark', label: 'Wordmark' },
  { value: 'square', label: 'Square' },
  { value: 'tree', label: 'Tree' },
  { value: 'fun', label: 'Ways to play' }
];

const GROUP_OPTIONS: Array<{ value: GroupFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'square', label: 'Square posts' },
  { value: 'portrait', label: 'Portrait posts' },
  { value: 'story', label: 'Stories' },
  { value: 'card', label: 'Link cards' },
  { value: 'banner', label: 'Banners' },
  { value: 'slide', label: 'Slides' },
  { value: 'wallpaper', label: 'Wallpapers' }
];

const TONE_OPTIONS: Array<{ value: ToneFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'colour', label: 'Colour' }
];

const FIRST_PAGE = 12;
const NEXT_PAGE = 24;

// Shortest-column-first. Adding entries never moves the ones already placed,
// so "Show more" appends instead of reshuffling the wall.
const toColumns = (entries: GalleryEntry[], count: number): GalleryEntry[][] => {
  const columns: GalleryEntry[][] = Array.from({ length: count }, () => []);
  const heights = Array.from({ length: count }, () => 0);
  for (const entry of entries) {
    const target = heights.indexOf(Math.min(...heights));
    columns[target].push(entry);
    heights[target] += entry.h / entry.w + 0.22; // picture + caption, in column widths
  }
  return columns;
};

export const BrandPressKit = ({
  items,
  imagery,
  eyebrow,
  onRemix
}: {
  items: PressKitItem[];
  imagery: ImageryManifestItem[];
  eyebrow: string;
  onRemix: (scene: BrandSceneOptions) => void;
}) => {
  const [shape, setShape] = React.useState<ShapeFilter>('all');
  const [group, setGroup] = React.useState<GroupFilter>('all');
  const [tone, setTone] = React.useState<ToneFilter>('all');
  const [shown, setShown] = React.useState(FIRST_PAGE);
  const columnCount = useBreakpointValue({ base: 1, md: 2, xl: 3 }, { ssr: false }) ?? 1;

  const entries = React.useMemo<GalleryEntry[]>(() => {
    const files = new Map(imagery.map((file) => [file.id, file]));
    const scenes: GalleryEntry[] = [];
    for (const item of BRAND_IMAGERY) {
      const file = files.get(item.id);
      if (!file) continue;
      scenes.push({
        key: item.id,
        name: item.name,
        alt: item.alt,
        w: file.w,
        h: file.h,
        url: file.url,
        bytes: file.bytes,
        shape: item.shape,
        fun: item.fun,
        tone: item.tone,
        group: item.group,
        scene: item.scene
      });
    }
    const classics: GalleryEntry[] = items.map((item) => ({
      key: `classic-${item.slug}`,
      name: item.name,
      alt: `Thingtime ${item.name} — ${item.w}×${item.h} PNG`,
      w: item.w,
      h: item.h,
      url: item.url,
      bytes: item.bytes,
      shape: item.logo ? CLASSIC_SHAPES[item.logo] : null,
      fun: false,
      tone: item.surface,
      group: CLASSIC_GROUPS[item.kind] ?? 'square'
    }));
    return [...scenes, ...classics];
  }, [imagery, items]);

  const matching = React.useMemo(
    () =>
      entries.filter(
        (entry) =>
          (shape === 'all' || (shape === 'fun' ? entry.fun : entry.shape === shape)) &&
          (group === 'all' || entry.group === group) &&
          (tone === 'all' || entry.tone === tone)
      ),
    [entries, shape, group, tone]
  );

  const visible = matching.slice(0, shown);
  const columns = toColumns(visible, columnCount);
  const remaining = matching.length - visible.length;

  // A new filter starts again from the first page.
  const pick = <T,>(set: (next: T) => void) => (next: T) => {
    set(next);
    setShown(FIRST_PAGE);
  };

  return (
    <Box as="section" id="press-kit" pt={{ base: '72px', md: '112px' }}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <Heading as="h2" fontFamily={HEAD} fontWeight={700} letterSpacing="-0.025em" fontSize="clamp(28px, 3.4vw, 42px)" color="var(--tt-ink, #16161a)" mt="10px">
        Ready-to-post imagery
      </Heading>
      <Text mt="12px" mb={{ base: '20px', md: '24px' }} maxW="640px" fontSize={{ base: '15px', md: '16px' }} lineHeight={1.65} color="var(--tt-text, #5a5a66)">
        {entries.length} finished pictures for posts, stories, link cards, banners, slides and wallpapers — the wordmark,
        the square, the tree and every way to play, all rendered straight from the voxels. Take anything, or hit Remix
        to open one in the studio and make it yours.
      </Text>

      <Flex flexDir="column" gap="14px" mb={{ base: '24px', md: '32px' }}>
        <ChipGroup label="Logo" options={SHAPE_OPTIONS} value={shape} onChange={pick<ShapeFilter>((next) => setShape(next))} testId="imagery-filter-logo" />
        <ChipGroup label="Format" options={GROUP_OPTIONS} value={group} onChange={pick<GroupFilter>((next) => setGroup(next))} testId="imagery-filter-format" />
        <ChipGroup label="Background" options={TONE_OPTIONS} value={tone} onChange={pick<ToneFilter>((next) => setTone(next))} testId="imagery-filter-background" />
      </Flex>

      {matching.length === 0 ? (
        <Text fontSize="15px" color="var(--tt-text, #5a5a66)" py="24px" data-testid="imagery-empty">
          Nothing ready-made in that combination yet — the studio below can make it in a couple of clicks.
        </Text>
      ) : (
        <Flex gap={{ base: '0px', md: '24px' }} alignItems="flex-start" data-testid="imagery-grid">
          {columns.map((column, index) => (
            <Flex key={index} flexDir="column" gap="32px" flex="1 1 0" minW={0}>
              {column.map((entry) => (
                <Box key={entry.key} data-testid={`imagery-${entry.key}`}>
                  <Box borderRadius="18px" overflow="hidden" lineHeight={0} boxShadow="0 1px 3px rgba(20,20,40,.08), 0 18px 44px -28px rgba(20,20,40,.25)">
                    <img
                      src={entry.url}
                      alt={entry.alt}
                      width={entry.w}
                      height={entry.h}
                      loading="lazy"
                      decoding="async"
                      style={{ width: '100%', height: 'auto', display: 'block' }}
                    />
                  </Box>
                  <Text mt="12px" fontWeight={650} fontSize="14.5px" lineHeight={1.35} color="var(--tt-ink, #16161a)">
                    {entry.name}
                  </Text>
                  <Flex mt="4px" alignItems="center" columnGap="14px" rowGap="4px" flexWrap="wrap">
                    <Text fontFamily={MONO} fontSize="11px" color="var(--tt-muted, #9a9aa6)">
                      {entry.w}×{entry.h} · PNG · {formatBytes(entry.bytes)}
                    </Text>
                    <Box flex="1" />
                    {entry.scene ? (
                      <Box
                        as="button"
                        type="button"
                        onClick={() => entry.scene && onRemix(entry.scene)}
                        fontSize="13px"
                        fontWeight={600}
                        fontFamily="inherit"
                        color="var(--tt-text, #5a5a66)"
                        _hover={{ color: 'var(--tt-ink, #16161a)' }}
                        transition="color 140ms ease"
                        aria-label={`Remix ${entry.name} in the studio`}
                      >
                        Remix
                      </Box>
                    ) : null}
                    <Box
                      as="a"
                      href={entry.url}
                      download
                      fontSize="13px"
                      fontWeight={600}
                      color="var(--tt-ink, #16161a)"
                      _hover={{ opacity: 0.7 }}
                      transition="opacity 140ms ease"
                      aria-label={`Download ${entry.name}`}
                    >
                      Download ↓
                    </Box>
                  </Flex>
                </Box>
              ))}
            </Flex>
          ))}
        </Flex>
      )}

      {matching.length > 0 ? (
        <Flex mt="32px" alignItems="center" gap="16px" flexWrap="wrap">
          {remaining > 0 ? (
            <Button
              size="sm"
              height="38px"
              px={5}
              borderRadius="11px"
              bg="var(--tt-ink, #16161a)"
              color="var(--tt-card, #fff)"
              fontWeight={600}
              _hover={{ opacity: 0.88 }}
              _active={{ opacity: 0.8 }}
              onClick={() => setShown((count) => count + NEXT_PAGE)}
              data-testid="imagery-show-more"
            >
              Show more
            </Button>
          ) : null}
          <Text fontFamily={MONO} fontSize="11.5px" color="var(--tt-muted, #9a9aa6)" data-testid="imagery-count">
            Showing {visible.length} of {matching.length}
          </Text>
        </Flex>
      ) : null}
    </Box>
  );
};
