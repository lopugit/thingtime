import React from 'react';
import { Badge, Box, Flex, Grid, Heading, Link as ChakraLink, Stack, Text } from '@chakra-ui/react';
import { useSearchParams } from 'react-router';

import { DeviceFrame } from './ConceptStories';
import type { ConceptEntry } from './entries';
import { conceptEntries, conceptStatusColors, getConceptEntryBySlug } from './entries';

// /docs/concepts — nested data viewer/editor concepts + the kind-renderer
// system, as live storybook-style pages. The DocsLayout drawer lists the
// concepts; this page renders the selected entry: the principle, desktop and
// mobile design notes, and interactive stories in a device frame.

const monoLabelProps = {
  color: 'var(--tt-muted, #9a9aa6)',
  fontFamily: 'var(--tt-font-mono, monospace)',
  fontSize: '11px',
  fontWeight: '600',
  letterSpacing: '0.14em',
  textTransform: 'uppercase'
} as const;

const SectionCard = (props: { children: React.ReactNode; id?: string }) => (
  <Box
    id={props.id}
    bg="var(--tt-card, #ffffff)"
    border="1px solid"
    borderColor="var(--tt-border, #ececef)"
    borderRadius="var(--tt-radius-lg, 16px)"
    boxShadow="var(--tt-shadow-card, 0 1px 2px rgba(0, 0, 0, 0.05))"
    p={5}
  >
    {props.children}
  </Box>
);

const NoteList = (props: { title: string; emoji: string; items: string[] }) => (
  <SectionCard>
    <Text {...monoLabelProps} mb={3}>
      {props.emoji} {props.title}
    </Text>
    <Stack spacing={3}>
      {props.items.map((item) => (
        <Flex key={item} gap={2}>
          <Text color="var(--tt-muted, #9a9aa6)" fontSize="sm">
            •
          </Text>
          <Text color="var(--tt-text, #5a5a66)" fontSize="sm" lineHeight="1.6">
            {item}
          </Text>
        </Flex>
      ))}
    </Stack>
  </SectionCard>
);

function ConceptStoriesSection({ entry }: { entry: ConceptEntry }) {
  return (
    <Stack spacing={5}>
      {entry.stories.map((story, index) => (
        <SectionCard key={story.id} id={`story-${story.id}`}>
          <Flex align="baseline" gap={3} mb={1} minW={0}>
            <Text {...monoLabelProps}>{String(index + 1).padStart(2, '0')}</Text>
            <Heading as="h3" fontSize="md">
              {story.title}
            </Heading>
          </Flex>
          <Text color="var(--tt-text, #5a5a66)" fontSize="sm" lineHeight="1.6" mb={4} maxW="760px">
            {story.description}
          </Text>
          <Box
            bg="var(--tt-surface, #fafafb)"
            border="1px solid"
            borderColor="var(--tt-border-light, #f0f0f2)"
            borderRadius="var(--tt-radius-md, 12px)"
            data-testid={`concept-story-${story.id}`}
            p={{ base: 3, md: 5 }}
          >
            <DeviceFrame defaultEdit={story.defaultEdit}>{(args) => story.render(args)}</DeviceFrame>
          </Box>
          {story.note && (
            <Text color="var(--tt-muted, #9a9aa6)" fontSize="xs" lineHeight="1.6" mt={3}>
              {story.note}
            </Text>
          )}
        </SectionCard>
      ))}
    </Stack>
  );
}

export default function DocsConcepts() {
  const [searchParams] = useSearchParams();
  const selectedEntry = getConceptEntryBySlug(searchParams.get('concept')) || conceptEntries[0];
  const statusColor = conceptStatusColors[selectedEntry.status];

  return (
    <Grid columnGap={8} rowGap={8} templateColumns={{ base: '1fr', '2xl': 'minmax(0, 1fr) 240px' }}>
      <Stack minW={0} spacing={6}>
        <Box borderBottom="1px solid" borderColor="var(--tt-border, #ececef)" pb={6}>
          <Flex align="center" gap={2} mb={4} wrap="wrap">
            <Badge bg="var(--tt-docs-accent-soft, #d7f5df)" borderRadius="sm" color="var(--tt-docs-accent-ink, #0f5132)" px={2}>
              Data viewers
            </Badge>
            <Badge bg={statusColor.bg} borderRadius="sm" color={statusColor.color} px={2}>
              {selectedEntry.status}
            </Badge>
            <Text color="var(--tt-muted, #9a9aa6)" fontFamily="var(--tt-font-mono, monospace)" fontSize="sm">
              /docs/concepts · {selectedEntry.slug}
            </Text>
          </Flex>

          <Heading
            as="h2"
            color="var(--tt-ink, #16161a)"
            fontSize={{ base: '3xl', md: '4xl' }}
            letterSpacing="-0.02em"
            lineHeight="1.05"
          >
            {selectedEntry.emoji} {selectedEntry.title}
          </Heading>
          <Text color="var(--tt-text, #5a5a66)" fontSize={{ base: 'md', md: 'lg' }} lineHeight="1.7" maxW="820px" mt={4}>
            {selectedEntry.summary}
          </Text>
        </Box>

        <SectionCard id="why">
          <Text {...monoLabelProps} mb={3}>
            Why this shape
          </Text>
          <Text color="var(--tt-text, #5a5a66)" fontSize="md" lineHeight="1.75" maxW="800px">
            {selectedEntry.why}
          </Text>
        </SectionCard>

        <Grid columnGap={5} rowGap={5} templateColumns={{ base: '1fr', lg: '1fr 1fr' }}>
          <NoteList emoji="🖥️" items={selectedEntry.desktop} title="Desktop" />
          <NoteList emoji="📱" items={selectedEntry.mobile} title="Mobile" />
        </Grid>

        <NoteList emoji="🎨" items={selectedEntry.editing} title="Editing" />

        <ConceptStoriesSection entry={selectedEntry} />

        <SectionCard id="adoption">
          <Text {...monoLabelProps} mb={3}>
            Put it on the site
          </Text>
          <Text color="var(--tt-text, #5a5a66)" fontSize="sm" lineHeight="1.7" maxW="800px">
            {selectedEntry.adoption}
          </Text>
          <Text color="var(--tt-muted, #9a9aa6)" fontFamily="var(--tt-font-mono, monospace)" fontSize="xs" mt={3} overflowWrap="anywhere">
            {selectedEntry.source}
          </Text>
        </SectionCard>
      </Stack>

      <Box
        as="aside"
        borderColor="var(--tt-border, #ececef)"
        borderLeft="1px solid"
        display={{ base: 'none', '2xl': 'block' }}
        pl={6}
      >
        <Box position="sticky" top="96px">
          <Text {...monoLabelProps} mb={4}>
            On this page
          </Text>
          <Stack fontSize="sm" spacing={3}>
            <ChakraLink color="var(--tt-text, #5a5a66)" href="#why">
              Why this shape
            </ChakraLink>
            {selectedEntry.stories.map((story) => (
              <ChakraLink key={story.id} color="var(--tt-text, #5a5a66)" href={`#story-${story.id}`}>
                {story.title}
              </ChakraLink>
            ))}
            <ChakraLink color="var(--tt-text, #5a5a66)" href="#adoption">
              Put it on the site
            </ChakraLink>
          </Stack>
        </Box>
      </Box>
    </Grid>
  );
}
