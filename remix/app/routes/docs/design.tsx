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
import { ExternalLink, Maximize2, Search, X } from 'lucide-react';
import { useSearchParams } from 'react-router';

import {
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

export default function DocsDesign() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = React.useState('');
  const [expandedPreview, setExpandedPreview] = React.useState(false);
  const previewRef = React.useRef<HTMLDivElement | null>(null);

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

  const selectEntry = (slug: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('entry', slug);
    setSearchParams(next);
  };

  const openFullscreen = async () => {
    if (previewRef.current?.requestFullscreen) {
      try {
        await previewRef.current.requestFullscreen();
        return;
      } catch {
        setExpandedPreview(true);
        return;
      }
    }

    setExpandedPreview(true);
  };

  const closeExpandedPreview = async () => {
    setExpandedPreview(false);

    if (document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen();
    }
  };

  const selectedKindColor = kindColors[selectedEntry.kind] || kindColors.Direction;

  return (
    <Grid
      templateColumns={{
        base: '1fr',
        xl: '280px minmax(0, 1fr)',
        '2xl': '300px minmax(560px, 1fr) 240px'
      }}
      columnGap={8}
      rowGap={6}
    >
      <Box as="aside" minW={0}>
        <Box position={{ base: 'relative', xl: 'sticky' }} top="96px">
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

          <Stack spacing={1} maxH={{ base: 'none', xl: 'calc(100vh - 190px)' }} overflowY="auto" pr={{ base: 0, xl: 2 }}>
            {filteredEntries.map((entry) => {
              const active = entry.slug === selectedEntry.slug;
              const kindColor = kindColors[entry.kind] || kindColors.Direction;

              return (
                <Box
                  as="button"
                  key={entry.slug}
                  data-testid={`design-entry-${entry.slug}`}
                  type="button"
                  onClick={() => selectEntry(entry.slug)}
                  bg={active ? 'white' : 'transparent'}
                  border="1px solid"
                  borderColor={active ? 'blackAlpha.300' : 'transparent'}
                  borderRadius="md"
                  cursor="pointer"
                  p={3}
                  textAlign="left"
                  transition="background 120ms ease, border-color 120ms ease"
                  _hover={{ bg: 'white', borderColor: 'blackAlpha.200' }}
                >
                  <Flex align="center" gap={2} mb={2}>
                    <Badge bg={kindColor.bg} color={kindColor.color} borderRadius="sm" px={2}>
                      {entry.kind}
                    </Badge>
                    <Text color="gray.500" fontSize="xs" fontFamily="mono" overflowWrap="anywhere">
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
              );
            })}
          </Stack>
        </Box>
      </Box>

      <Stack spacing={5} minW={0}>
        <Box borderBottom="1px solid" borderColor="blackAlpha.200" pb={5}>
          <Flex align="center" gap={2} mb={4} wrap="wrap">
            <Badge bg={selectedKindColor.bg} color={selectedKindColor.color} borderRadius="sm" px={2}>
              {selectedEntry.kind}
            </Badge>
            <Text color="gray.500" fontSize="sm" fontFamily="mono" overflowWrap="anywhere">
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
                Fullscreen
              </Button>
            </Flex>
          </Flex>
        </Box>

        <Box
          ref={previewRef}
          bg="white"
          border="1px solid"
          borderColor="blackAlpha.300"
          borderRadius={expandedPreview ? '0' : 'md'}
          overflow="hidden"
          position={expandedPreview ? 'fixed' : 'relative'}
          inset={expandedPreview ? 0 : undefined}
          zIndex={expandedPreview ? 10000 : undefined}
          h={expandedPreview ? '100vh' : undefined}
          w={expandedPreview ? '100vw' : undefined}
          minH={{ base: '68vh', xl: 'calc(100vh - 260px)' }}
          sx={{
            '&:fullscreen': {
              border: '0',
              borderRadius: '0',
              height: '100vh',
              width: '100vw'
            },
            '&:fullscreen iframe': {
              borderRadius: '0',
              height: '100vh'
            }
          }}
        >
          {expandedPreview ? (
            <IconButton
              aria-label="Close full-screen preview"
              icon={<Icon as={X} boxSize={5} />}
              position="absolute"
              right={4}
              top={4}
              zIndex={2}
              size="sm"
              bg="white"
              boxShadow="0 8px 24px rgba(15, 23, 42, 0.18)"
              onClick={closeExpandedPreview}
            />
          ) : null}
          <iframe
            data-testid="design-preview-frame"
            key={selectedEntry.slug}
            src={previewSrc}
            title={`${selectedEntry.title} preview`}
            allowFullScreen
            style={{
              border: 0,
              display: 'block',
              height: '100%',
              minHeight: 'inherit',
              width: '100%'
            }}
          />
        </Box>
      </Stack>

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
