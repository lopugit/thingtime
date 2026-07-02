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
import { ArrowLeft, ExternalLink, FileCode2, Maximize2, Search, X } from 'lucide-react';
import { useSearchParams } from 'react-router';

import {
  designEntries,
  getDesignEntryBySlug,
  getDesignEntryPreviewSrc
} from './designEntries';
import { PreviewFrame, ResizablePreviewPane } from './PreviewPane';

const DEFAULT_BUNDLE_PREVIEW_HEIGHT = 640;

export default function DocsDesignBundles() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = React.useState('');
  const [expandedPreview, setExpandedPreview] = React.useState(false);
  const [previewHeight, setPreviewHeight] = React.useState(DEFAULT_BUNDLE_PREVIEW_HEIGHT);

  const selectedEntry =
    getDesignEntryBySlug(searchParams.get('entry')) || designEntries[0];
  const previewSrc = getDesignEntryPreviewSrc(selectedEntry);
  const filteredEntries = React.useMemo(() => {
    const normalisedQuery = query.trim().toLowerCase();

    if (!normalisedQuery) return designEntries;

    return designEntries.filter((entry) =>
      [entry.title, entry.slug, entry.kind, entry.summary]
        .join(' ')
        .toLowerCase()
        .includes(normalisedQuery)
    );
  }, [query]);

  React.useEffect(() => {
    if (!expandedPreview) return undefined;

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

  const selectEntry = (slug: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('entry', slug);
    setSearchParams(next);
  };

  return (
    <Grid
      w="100%"
      overflow="hidden"
      templateColumns={{
        base: '1fr',
        xl: '320px minmax(0, 1fr)',
        '2xl': '340px minmax(560px, 1fr) 240px'
      }}
      columnGap={8}
      rowGap={6}
    >
      <Box as="aside" minW={0} order={{ base: 2, xl: 1 }}>
        <Box position={{ base: 'relative', xl: 'sticky' }} top="96px">
          <Flex align="center" gap={2} mb={4}>
            <Badge bg="#eef2ff" color="#3730a3" borderRadius="sm" px={2}>
              Static
            </Badge>
            <Text color="gray.500" fontSize="sm" fontFamily="mono">
              {designEntries.length} HTML bundles
            </Text>
          </Flex>

          <Box position="relative" mb={4}>
            <Icon as={Search} boxSize={4} color="gray.400" position="absolute" left={3} top="50%" transform="translateY(-50%)" />
            <Input
              data-testid="bundle-filter-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter bundles"
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
              const entryPreviewSrc = getDesignEntryPreviewSrc(entry);

              return (
                <Box
                  as="button"
                  key={entry.slug}
                  data-testid={`bundle-entry-${entry.slug}`}
                  type="button"
                  onClick={() => selectEntry(entry.slug)}
                  bg={active ? 'white' : 'transparent'}
                  border="1px solid"
                  borderColor={active ? 'blackAlpha.300' : 'transparent'}
                  borderRadius="md"
                  cursor="pointer"
                  display="block"
                  maxW="100%"
                  p={3}
                  textAlign="left"
                  transition="background 120ms ease, border-color 120ms ease"
                  w="100%"
                  _hover={{ bg: 'white', borderColor: 'blackAlpha.200' }}
                >
                  <Flex align="center" gap={2} mb={2} minW={0}>
                    <Badge bg="#eef2f7" color="#374151" borderRadius="sm" flexShrink={0} px={2}>
                      HTML
                    </Badge>
                    <Text color="gray.500" flex="1" fontSize="xs" fontFamily="mono" minW={0} overflowWrap="anywhere">
                      {entry.slug}
                    </Text>
                  </Flex>
                  <Text fontSize="sm" fontWeight="700" lineHeight="1.3" mb={1}>
                    {entry.title}
                  </Text>
                  <Text color="gray.600" fontSize="xs" lineHeight="1.45" overflowWrap="anywhere">
                    {entryPreviewSrc}
                  </Text>
                </Box>
              );
            })}
          </Stack>
        </Box>
      </Box>

      <Stack minW={0} order={{ base: 1, xl: 2 }} spacing={5}>
        <Box borderBottom="1px solid" borderColor="blackAlpha.200" pb={5} minW={0}>
          <Flex align="center" gap={2} mb={4} minW={0} wrap="wrap">
            <Badge bg="#eef2ff" color="#3730a3" borderRadius="sm" px={2}>
              Bundle
            </Badge>
            <Text color="gray.500" fontSize="sm" fontFamily="mono" minW={0} overflowWrap="anywhere">
              /docs/design-bundles
            </Text>
          </Flex>

          <Flex align={{ base: 'flex-start', md: 'center' }} justify="space-between" gap={4} direction={{ base: 'column', md: 'row' }}>
            <Box minW={0}>
              <Heading as="h2" fontSize={{ base: '2xl', md: '4xl' }} lineHeight="1.05" letterSpacing="0">
                Static bundle browser
              </Heading>
              <Text color="gray.600" fontSize="md" lineHeight="1.65" mt={3} maxW="760px">
                Browse every standalone HTML export directly from the docs surface.
              </Text>
            </Box>

            <Flex gap={2} flexShrink={0}>
              <Button
                as="a"
                data-testid="bundle-preview-open"
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
                data-testid="bundle-preview-fullscreen"
                size="sm"
                bg="#008060"
                color="white"
                _hover={{ bg: '#006e52' }}
                onClick={() => setExpandedPreview(true)}
                leftIcon={<Icon as={Maximize2} boxSize={4} />}
              >
                Preview full screen
              </Button>
            </Flex>
          </Flex>
        </Box>

        <Box minW={0}>
          <Flex align="center" gap={2} mb={3} minW={0} wrap="wrap">
            <Icon as={FileCode2} boxSize={4} color="#5c6ac4" />
            <Text fontWeight="700">{selectedEntry.title}</Text>
            <Text color="gray.500" fontSize="sm" fontFamily="mono" minW={0} overflowWrap="anywhere">
              {previewSrc}
            </Text>
          </Flex>
          <ResizablePreviewPane
            height={previewHeight}
            maxHeight={1400}
            minHeight={320}
            onHeightChange={setPreviewHeight}
            previewSrc={previewSrc}
            testId="bundle-preview-frame"
            title={selectedEntry.title}
          />
        </Box>
      </Stack>

      <Box as="aside" display={{ base: 'none', '2xl': 'block' }} borderLeft="1px solid" borderColor="blackAlpha.200" order={3} pl={6}>
        <Box position="sticky" top="96px">
          <Text fontSize="xs" fontWeight="700" color="gray.500" textTransform="uppercase" mb={4}>
            On this page
          </Text>
          <Stack spacing={4} fontSize="sm">
            <Box>
              <Text color="gray.500" mb={1}>
                Selected file
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
                Direct links open the generated file as-is; the browser pane previews the same bundle in place.
              </Text>
            </Box>
          </Stack>
        </Box>
      </Box>

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
              data-testid="bundle-preview-close"
              leftIcon={<Icon as={ArrowLeft} boxSize={4} />}
              onClick={() => setExpandedPreview(false)}
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
              onClick={() => setExpandedPreview(false)}
            />
          </Flex>
          <PreviewFrame
            expanded
            previewSrc={previewSrc}
            testId="bundle-expanded-preview-frame"
            title={selectedEntry.title}
          />
        </Box>
      ) : null}
    </Grid>
  );
}
