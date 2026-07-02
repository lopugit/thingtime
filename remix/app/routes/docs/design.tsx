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
import { ArrowDownToLine, ArrowLeft, ExternalLink, Maximize2, Search, X } from 'lucide-react';
import { useSearchParams } from 'react-router';

import {
  type DesignEntry,
  designEntries,
  getDesignEntryBySlug,
  getDesignEntryPreviewSrc
} from './designEntries';

const kindColors: Record<string, { bg: string; color: string }> = {
  Launch: { bg: '#d7f5df', color: '#0f5132' },
  Explorer: { bg: '#e8e9ff', color: '#2f356b' },
  App: { bg: '#fef3c7', color: '#78350f' },
  Direction: { bg: '#eef2f7', color: '#374151' }
};

type PreviewFrameProps = {
  entry: DesignEntry;
  expanded?: boolean;
  height?: string;
  previewSrc: string;
  testId: string;
};

function PreviewFrame({ entry, expanded = false, height = '100%', previewSrc, testId }: PreviewFrameProps) {
  return (
    <iframe
      data-testid={testId}
      key={`${testId}-${entry.slug}`}
      src={previewSrc}
      title={`${entry.title} preview`}
      allowFullScreen
      style={{
        border: 0,
        display: 'block',
        height: expanded ? 'calc(100vh - 56px)' : height,
        marginTop: expanded ? '56px' : 0,
        minHeight: 'inherit',
        width: '100%'
      }}
    />
  );
}

export default function DocsDesign() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = React.useState('');
  const [expandedPreview, setExpandedPreview] = React.useState(false);
  const previewRef = React.useRef<HTMLDivElement | null>(null);
  const fullPreviewRef = React.useRef<HTMLDivElement | null>(null);
  const pendingScrollSlugRef = React.useRef<string | null>(null);

  const selectedEntry =
    getDesignEntryBySlug(searchParams.get('entry')) || designEntries[0];
  const previewSrc = getDesignEntryPreviewSrc(selectedEntry);
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
    if (!expandedPreview) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setExpandedPreview(false);
      }
    };

    window.addEventListener('keydown', closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [expandedPreview]);

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
    setSearchParams(next);
  };

  const openFullscreen = () => {
    setExpandedPreview(true);
  };

  const closeExpandedPreview = () => {
    setExpandedPreview(false);
  };

  const scrollToFullPreview = () => {
    fullPreviewRef.current?.scrollIntoView({ block: 'start', inline: 'nearest' });
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
              PR #25
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
              const kindColor = kindColors[entry.kind] || kindColors.Direction;
              const entryPreviewSrc = getDesignEntryPreviewSrc(entry);

              return (
                <Box
                  key={entry.slug}
                  bg={active ? 'white' : 'transparent'}
                  border="1px solid"
                  borderColor={active ? 'blackAlpha.300' : 'transparent'}
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

                  {active ? (
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
                            onClick={openFullscreen}
                            size="xs"
                            variant="outline"
                          />
                          <IconButton
                            aria-label="Jump to full preview"
                            display={{ base: 'none', xl: 'inline-flex' }}
                            icon={<Icon as={ArrowDownToLine} boxSize={3.5} />}
                            onClick={scrollToFullPreview}
                            size="xs"
                            variant="outline"
                          />
                        </Flex>
                      </Flex>

                      <Box
                        bg="white"
                        border="1px solid"
                        borderColor="blackAlpha.200"
                        borderRadius="sm"
                        h={{ base: '360px', md: '430px', xl: '300px' }}
                        overflow="hidden"
                      >
                        <PreviewFrame
                          entry={entry}
                          height="100%"
                          previewSrc={entryPreviewSrc}
                          testId={`design-inline-preview-frame-${entry.slug}`}
                        />
                      </Box>
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
                onClick={openFullscreen}
                leftIcon={<Icon as={Maximize2} boxSize={4} />}
              >
                Preview full screen
              </Button>
            </Flex>
          </Flex>
        </Box>

        <Box
          ref={(node) => {
            previewRef.current = node;
            fullPreviewRef.current = node;
          }}
          bg="white"
          border="1px solid"
          borderColor="blackAlpha.300"
          borderRadius="md"
          overflow="hidden"
          position="relative"
          minH={{ base: '68vh', xl: 'calc(100vh - 260px)' }}
        >
          <PreviewFrame
            entry={selectedEntry}
            previewSrc={previewSrc}
            testId="design-preview-frame"
          />
        </Box>
      </Stack>

      {expandedPreview ? (
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
              {selectedEntry.title}
            </Text>
            <IconButton
              aria-label="Close full screen preview"
              icon={<Icon as={X} boxSize={5} />}
              size="sm"
              onClick={closeExpandedPreview}
            />
          </Flex>
          <PreviewFrame
            entry={selectedEntry}
            expanded
            previewSrc={previewSrc}
            testId="design-expanded-preview-frame"
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
                  onClick={openFullscreen}
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
