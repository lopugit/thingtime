import React from 'react';
import {
  Badge,
  Box,
  Button,
  Divider,
  Flex,
  Grid,
  Heading,
  Icon,
  IconButton,
  Input,
  Link as ChakraLink,
  Stack,
  Text
} from '@chakra-ui/react';
import { ArrowLeft, ExternalLink, Maximize2, Search, X } from 'lucide-react';
import { useSearchParams } from 'react-router';

import {
  designEntries,
  getDesignEntryBySlug,
  getDesignEntryPreviewSrc
} from './designEntries';
import { PreviewFrame, ResizablePreviewPane } from './PreviewPane';

const kindColors: Record<string, { bg: string; color: string }> = {
  Launch: { bg: '#d7f5df', color: '#0f5132' },
  Explorer: { bg: '#e8e9ff', color: '#2f356b' },
  App: { bg: '#fef3c7', color: '#78350f' },
  Direction: { bg: '#eef2f7', color: '#374151' }
};

const DEFAULT_INLINE_PREVIEW_HEIGHT = 360;
const DEFAULT_REFERENCE_PREVIEW_HEIGHT = 620;

export default function DocsDesign() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = React.useState('');
  const selectedEntry =
    getDesignEntryBySlug(searchParams.get('entry')) || designEntries[0];
  const [expandedEntrySlug, setExpandedEntrySlug] = React.useState<string | null>(null);
  const [openPreviewSlugs, setOpenPreviewSlugs] = React.useState<string[]>(() => [selectedEntry.slug]);
  const [inlinePreviewHeights, setInlinePreviewHeights] = React.useState<Record<string, number>>({});
  const [referencePreviewHeight, setReferencePreviewHeight] = React.useState(DEFAULT_REFERENCE_PREVIEW_HEIGHT);
  const pendingScrollSlugRef = React.useRef<string | null>(null);

  const previewSrc = getDesignEntryPreviewSrc(selectedEntry);
  const expandedEntry = getDesignEntryBySlug(expandedEntrySlug);
  const expandedPreviewSrc = expandedEntry ? getDesignEntryPreviewSrc(expandedEntry) : null;
  const filteredEntries = React.useMemo(() => {
    const normalisedQuery = query.trim().toLowerCase();

    if (!normalisedQuery) {
      return designEntries;
    }

    return designEntries.filter((entry) =>
      [entry.title, entry.slug, entry.kind, entry.summary]
        .join(' ')
        .toLowerCase()
        .includes(normalisedQuery)
    );
  }, [query]);

  React.useEffect(() => {
    setOpenPreviewSlugs((currentSlugs) =>
      currentSlugs.includes(selectedEntry.slug) ? currentSlugs : [...currentSlugs, selectedEntry.slug]
    );
  }, [selectedEntry.slug]);

  React.useEffect(() => {
    if (!expandedEntry) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setExpandedEntrySlug(null);
      }
    };

    window.addEventListener('keydown', closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [expandedEntry]);

  React.useEffect(() => {
    const slug = pendingScrollSlugRef.current;

    if (!slug || slug !== selectedEntry.slug) return;

    pendingScrollSlugRef.current = null;
    window.requestAnimationFrame(() => {
      document
        .getElementById(`design-inline-preview-${slug}`)
        ?.scrollIntoView({ block: 'start', inline: 'nearest' });
    });
  }, [selectedEntry.slug]);

  const selectEntry = (slug: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('entry', slug);
    pendingScrollSlugRef.current = slug;
    setOpenPreviewSlugs((currentSlugs) =>
      currentSlugs.includes(slug) ? currentSlugs : [...currentSlugs, slug]
    );
    setSearchParams(next);
  };

  const closeInlinePreview = (slug: string) => {
    setOpenPreviewSlugs((currentSlugs) => currentSlugs.filter((openSlug) => openSlug !== slug));
  };

  const setInlinePreviewHeight = React.useCallback((slug: string, height: number) => {
    setInlinePreviewHeights((currentHeights) => ({ ...currentHeights, [slug]: height }));
  }, []);

  const openFullscreen = (slug = selectedEntry.slug) => {
    setExpandedEntrySlug(slug);
  };

  const closeExpandedPreview = () => {
    setExpandedEntrySlug(null);
  };

  const selectedKindColor = kindColors[selectedEntry.kind] || kindColors.Direction;

  return (
    <Grid
      w="100%"
      overflow="hidden"
      templateColumns={{
        base: '1fr',
        xl: '280px minmax(0, 1fr)',
        '2xl': '300px minmax(560px, 1fr) 240px'
      }}
      columnGap={8}
      rowGap={6}
    >
      <Box as="aside" minW={0} maxW="100%" overflow="hidden">
        <Box position={{ base: 'relative', xl: 'sticky' }} top="96px" minW={0} maxW="100%">
          <Flex align="center" gap={2} mb={4}>
            <Badge bg="#d7f5df" color="#0f5132" borderRadius="sm" px={2}>
              Design
            </Badge>
            <Text color="gray.500" fontSize="sm" fontFamily="mono">
              {designEntries.length} bundles
            </Text>
          </Flex>

          <Box position="relative" mb={4}>
            <Icon as={Search} boxSize={4} color="gray.400" position="absolute" left={3} top="50%" transform="translateY(-50%)" />
            <Input
              data-testid="design-filter-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter mockups"
              bg="white"
              borderColor="blackAlpha.200"
              borderRadius="md"
              fontSize="sm"
              pl={9}
            />
          </Box>

          <Stack
            spacing={1}
            maxH={{ base: 'none', xl: 'calc(100vh - 190px)' }}
            overflowX="hidden"
            overflowY="auto"
            pr={{ base: 0, xl: 2 }}
          >
            {filteredEntries.map((entry) => {
              const active = entry.slug === selectedEntry.slug;
              const opened = openPreviewSlugs.includes(entry.slug);
              const kindColor = kindColors[entry.kind] || kindColors.Direction;
              const entryPreviewSrc = getDesignEntryPreviewSrc(entry);

              return (
                <Box
                  key={entry.slug}
                  bg={active || opened ? 'white' : 'transparent'}
                  border="1px solid"
                  borderColor={active ? 'blackAlpha.300' : opened ? 'blackAlpha.200' : 'transparent'}
                  borderRadius="md"
                  display="block"
                  maxW="100%"
                  overflow="hidden"
                  transition="background 120ms ease, border-color 120ms ease"
                  w="100%"
                  _hover={{ bg: 'white', borderColor: 'blackAlpha.200' }}
                >
                  <Box
                    as="button"
                    data-testid={`design-entry-${entry.slug}`}
                    type="button"
                    onClick={() => selectEntry(entry.slug)}
                    cursor="pointer"
                    display="block"
                    p={3}
                    textAlign="left"
                    w="100%"
                  >
                    <Flex align="center" gap={2} mb={2} minW={0}>
                      <Badge bg={kindColor.bg} color={kindColor.color} borderRadius="sm" flexShrink={0} px={2}>
                        {entry.kind}
                      </Badge>
                      <Text color="gray.500" flex="1" fontSize="xs" fontFamily="mono" minW={0} overflowWrap="anywhere">
                        {entry.slug}
                      </Text>
                    </Flex>
                    <Text fontSize="sm" fontWeight="700" lineHeight="1.3" mb={1}>
                      {entry.title}
                    </Text>
                    <Text color="gray.600" fontSize="xs" lineHeight="1.45">
                      {entry.summary}
                    </Text>
                  </Box>

                  {opened ? (
                    <Box
                      id={`design-inline-preview-${entry.slug}`}
                      data-testid={`design-inline-preview-${entry.slug}`}
                      borderTop="1px solid"
                      borderColor="blackAlpha.200"
                      p={3}
                      scrollMarginTop="80px"
                    >
                      <Flex align="center" gap={2} justify="space-between" mb={3} minW={0}>
                        <Text color="gray.500" fontSize="xs" fontWeight="700" textTransform="uppercase">
                          Preview
                        </Text>
                        <Flex gap={2} flexShrink={0}>
                          <IconButton
                            as="a"
                            aria-label={`Open ${entry.title}`}
                            href={entryPreviewSrc}
                            icon={<Icon as={ExternalLink} boxSize={3.5} />}
                            rel="noopener noreferrer"
                            size="xs"
                            target="_blank"
                            variant="outline"
                          />
                          <IconButton
                            aria-label={`Open ${entry.title} full screen`}
                            icon={<Icon as={Maximize2} boxSize={3.5} />}
                            onClick={() => openFullscreen(entry.slug)}
                            size="xs"
                            variant="outline"
                          />
                          <IconButton
                            aria-label={`Close ${entry.title} preview`}
                            icon={<Icon as={X} boxSize={3.5} />}
                            onClick={() => closeInlinePreview(entry.slug)}
                            size="xs"
                            variant="outline"
                          />
                        </Flex>
                      </Flex>

                      <ResizablePreviewPane
                        height={inlinePreviewHeights[entry.slug] || DEFAULT_INLINE_PREVIEW_HEIGHT}
                        maxHeight={1200}
                        minHeight={220}
                        onHeightChange={(height) => setInlinePreviewHeight(entry.slug, height)}
                        previewSrc={entryPreviewSrc}
                        testId={`design-inline-preview-frame-${entry.slug}`}
                        title={entry.title}
                      />
                    </Box>
                  ) : null}
                </Box>
              );
            })}
          </Stack>
        </Box>
      </Box>

      <Stack display={{ base: 'none', xl: 'flex' }} spacing={5} minW={0}>
        <Box borderBottom="1px solid" borderColor="blackAlpha.200" pb={5} minW={0}>
          <Flex align="center" gap={2} mb={4} minW={0} wrap="wrap">
            <Badge bg={selectedKindColor.bg} color={selectedKindColor.color} borderRadius="sm" px={2}>
              {selectedEntry.kind}
            </Badge>
            <Text color="gray.500" fontSize="sm" fontFamily="mono" minW={0} overflowWrap="anywhere">
              /docs/design?entry={selectedEntry.slug}
            </Text>
          </Flex>

          <Flex align={{ base: 'flex-start', md: 'center' }} justify="space-between" gap={4} direction={{ base: 'column', md: 'row' }}>
            <Box minW={0}>
              <Heading as="h2" fontSize={{ base: '2xl', md: '4xl' }} lineHeight="1.05" letterSpacing="0">
                {selectedEntry.title}
              </Heading>
              <Text color="gray.600" fontSize="md" lineHeight="1.65" mt={3} maxW="760px">
                {selectedEntry.summary}
              </Text>
            </Box>

            <Flex gap={2} flexShrink={0}>
              <Button
                as="a"
                data-testid="design-preview-open"
                href={previewSrc}
                target="_blank"
                rel="noopener noreferrer"
                size="sm"
                variant="outline"
                borderColor="blackAlpha.300"
                leftIcon={<Icon as={ExternalLink} boxSize={4} />}
              >
                Open
              </Button>
              <Button
                data-testid="design-preview-fullscreen"
                size="sm"
                bg="#008060"
                color="white"
                _hover={{ bg: '#006e52' }}
                onClick={() => openFullscreen(selectedEntry.slug)}
                leftIcon={<Icon as={Maximize2} boxSize={4} />}
              >
                Preview full screen
              </Button>
            </Flex>
          </Flex>
        </Box>

        <Box position="relative">
          <ResizablePreviewPane
            height={referencePreviewHeight}
            maxHeight={1400}
            minHeight={320}
            onHeightChange={setReferencePreviewHeight}
            previewSrc={previewSrc}
            testId="design-preview-frame"
            title={selectedEntry.title}
          />
        </Box>
      </Stack>

      {expandedEntry && expandedPreviewSrc ? (
        <Box
          bg="white"
          h="100vh"
          inset={0}
          overflow="hidden"
          position="fixed"
          w="100vw"
          zIndex={12000}
        >
          <Flex
            align="center"
            bg="white"
            borderBottom="1px solid"
            borderColor="blackAlpha.200"
            gap={3}
            h="56px"
            left={0}
            px={{ base: 3, md: 4 }}
            position="absolute"
            right={0}
            top={0}
            zIndex={2}
          >
            <Button
              data-testid="design-preview-close"
              leftIcon={<Icon as={ArrowLeft} boxSize={4} />}
              onClick={closeExpandedPreview}
              size="sm"
              variant="outline"
            >
              Back / close preview
            </Button>
            <Text color="gray.600" flex="1" fontSize="sm" fontWeight="650" isTruncated>
              {expandedEntry.title}
            </Text>
            <IconButton
              aria-label="Close full screen preview"
              icon={<Icon as={X} boxSize={5} />}
              size="sm"
              onClick={closeExpandedPreview}
            />
          </Flex>
          <PreviewFrame
            expanded
            previewSrc={expandedPreviewSrc}
            testId="design-expanded-preview-frame"
            title={expandedEntry.title}
          />
        </Box>
      ) : null}

      <Box as="aside" display={{ base: 'none', '2xl': 'block' }} borderLeft="1px solid" borderColor="blackAlpha.200" pl={6}>
        <Box position="sticky" top="96px">
          <Text fontSize="xs" fontWeight="700" color="gray.500" textTransform="uppercase" mb={4}>
            On this page
          </Text>
          <Stack spacing={4} fontSize="sm">
            <Box>
              <Text color="gray.500" mb={1}>
                Bundle
              </Text>
              <ChakraLink href={previewSrc} isExternal color="#008060" fontFamily="mono" overflowWrap="anywhere">
                {previewSrc}
              </ChakraLink>
            </Box>

            <Divider />

            <Box>
              <Text color="gray.500" mb={1}>
                Notes
              </Text>
              <Text color="gray.700" lineHeight="1.6">
                {selectedEntry.notes}
              </Text>
            </Box>

            <Divider />

            <Box>
              <Text color="gray.500" mb={2}>
                Controls
              </Text>
              <Flex gap={2}>
                <IconButton
                  aria-label="Open preview full screen"
                  icon={<Icon as={Maximize2} boxSize={4} />}
                  size="sm"
                  onClick={() => openFullscreen(selectedEntry.slug)}
                />
                <IconButton
                  as="a"
                  aria-label="Open standalone preview"
                  href={previewSrc}
                  target="_blank"
                  rel="noopener noreferrer"
                  icon={<Icon as={ExternalLink} boxSize={4} />}
                  size="sm"
                />
              </Flex>
            </Box>
          </Stack>
        </Box>
      </Box>
    </Grid>
  );
}
