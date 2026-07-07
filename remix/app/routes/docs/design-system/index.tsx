import React from 'react';
import {
  Badge,
  Box,
  Flex,
  Grid,
  Heading,
  Link as ChakraLink,
  Stack,
  Text
} from '@chakra-ui/react';
import { useSearchParams } from 'react-router';

import type { DesignSystemEntry, PropTable, TokenRow } from './entries';
import { designSystemEntries, designSystemStatusColors, getDesignSystemEntryBySlug } from './entries';

// /docs/design-system — storybook-style component library tab of the docs UI.
// The DocsLayout drawer lists the components; this page renders the selected
// entry as tabs: Stories (live canvases), API, Guidelines, Accessibility,
// Tokens.

const TAB_KEYS = ['stories', 'api', 'guidelines', 'accessibility', 'tokens'] as const;

type TabKey = (typeof TAB_KEYS)[number];

const tabLabels: Record<TabKey, string> = {
  stories: 'Stories',
  api: 'API',
  guidelines: 'Guidelines',
  accessibility: 'Accessibility',
  tokens: 'Tokens'
};

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

function StoriesTab({ entry }: { entry: DesignSystemEntry }) {
  return (
    <Stack spacing={5}>
      {entry.stories.map((story, index) => {
        const Story = story.render;

        return (
          <SectionCard key={story.id} id={`story-${story.id}`}>
            <Flex align="baseline" gap={3} mb={1} minW={0}>
              <Text {...monoLabelProps}>{String(index + 1).padStart(2, '0')}</Text>
              <Heading as="h3" fontSize="md">
                {story.title}
              </Heading>
            </Flex>
            <Text color="var(--tt-text, #5a5a66)" fontSize="sm" lineHeight="1.6" mb={4} maxW="720px">
              {story.description}
            </Text>
            <Box
              bg="var(--tt-surface, #fafafb)"
              border="1px solid"
              borderColor="var(--tt-border-light, #f0f0f2)"
              borderRadius="var(--tt-radius-md, 12px)"
              data-testid={`design-system-story-${story.id}`}
              p={{ base: 4, md: 6 }}
            >
              <Story />
            </Box>
            {story.note && (
              <Text color="var(--tt-muted, #9a9aa6)" fontSize="xs" lineHeight="1.6" mt={3}>
                {story.note}
              </Text>
            )}
          </SectionCard>
        );
      })}
    </Stack>
  );
}

function PropTableCard({ table }: { table: PropTable }) {
  return (
    <SectionCard>
      <Heading as="h3" fontFamily="var(--tt-font-mono, monospace)" fontSize="md" mb={1}>
        {table.title}
      </Heading>
      <Text color="var(--tt-muted, #9a9aa6)" fontFamily="var(--tt-font-mono, monospace)" fontSize="xs" mb={4} overflowWrap="anywhere">
        {table.source}
      </Text>
      <Stack spacing={0}>
        {table.rows.map((row, index) => (
          <Grid
            key={row.name}
            borderTop={index === 0 ? 'none' : '1px solid'}
            borderColor="var(--tt-border-light, #f0f0f2)"
            columnGap={4}
            py={3}
            rowGap={1}
            templateColumns={{ base: '1fr', md: '220px 1fr' }}
          >
            <Box minW={0}>
              <Text fontFamily="var(--tt-font-mono, monospace)" fontSize="sm" fontWeight="700" overflowWrap="anywhere">
                {row.name}
              </Text>
              <Text color="var(--tt-muted, #9a9aa6)" fontFamily="var(--tt-font-mono, monospace)" fontSize="xs" overflowWrap="anywhere">
                {row.type}
                {row.defaultValue ? ` = ${row.defaultValue}` : ''}
              </Text>
            </Box>
            <Text color="var(--tt-text, #5a5a66)" fontSize="sm" lineHeight="1.6">
              {row.description}
            </Text>
          </Grid>
        ))}
      </Stack>
    </SectionCard>
  );
}

function GuidelinesTab({ entry }: { entry: DesignSystemEntry }) {
  return (
    <Stack spacing={5}>
      <SectionCard>
        <Text {...monoLabelProps} mb={3}>
          Principle
        </Text>
        <Text color="var(--tt-text, #5a5a66)" fontSize="md" lineHeight="1.7" maxW="760px">
          {entry.guidelines.intro}
        </Text>
      </SectionCard>

      <Grid columnGap={5} rowGap={5} templateColumns={{ base: '1fr', lg: '1fr 1fr' }}>
        <SectionCard>
          <Text {...monoLabelProps} color="var(--tt-positive, #2f8f4f)" mb={3}>
            Do
          </Text>
          <Stack spacing={3}>
            {entry.guidelines.dos.map((item) => (
              <Flex key={item} gap={2}>
                <Text color="var(--tt-positive, #2f8f4f)" fontSize="sm">
                  ✓
                </Text>
                <Text color="var(--tt-text, #5a5a66)" fontSize="sm" lineHeight="1.6">
                  {item}
                </Text>
              </Flex>
            ))}
          </Stack>
        </SectionCard>
        <SectionCard>
          <Text {...monoLabelProps} color="var(--tt-danger, #d6455a)" mb={3}>
            Don&apos;t
          </Text>
          <Stack spacing={3}>
            {entry.guidelines.donts.map((item) => (
              <Flex key={item} gap={2}>
                <Text color="var(--tt-danger, #d6455a)" fontSize="sm">
                  ✕
                </Text>
                <Text color="var(--tt-text, #5a5a66)" fontSize="sm" lineHeight="1.6">
                  {item}
                </Text>
              </Flex>
            ))}
          </Stack>
        </SectionCard>
      </Grid>

      <SectionCard>
        <Text {...monoLabelProps} mb={3}>
          Adoption plan
        </Text>
        <Stack as="ol" spacing={3} sx={{ listStyle: 'none' }}>
          {entry.adoption.map((item, index) => (
            <Flex key={item} gap={3}>
              <Text color="var(--tt-muted, #9a9aa6)" fontFamily="var(--tt-font-mono, monospace)" fontSize="sm">
                {index + 1}.
              </Text>
              <Text color="var(--tt-text, #5a5a66)" fontSize="sm" lineHeight="1.6">
                {item}
              </Text>
            </Flex>
          ))}
        </Stack>
      </SectionCard>
    </Stack>
  );
}

function AccessibilityTab({ entry }: { entry: DesignSystemEntry }) {
  return (
    <Stack spacing={5}>
      <SectionCard>
        <Text {...monoLabelProps} mb={3}>
          Keyboard
        </Text>
        <Stack spacing={0}>
          {entry.keyboard.map((row, index) => (
            <Grid
              key={row.keys}
              borderTop={index === 0 ? 'none' : '1px solid'}
              borderColor="var(--tt-border-light, #f0f0f2)"
              columnGap={4}
              py={2.5}
              templateColumns="140px 1fr"
            >
              <Text fontFamily="var(--tt-font-mono, monospace)" fontSize="sm" fontWeight="700">
                {row.keys}
              </Text>
              <Text color="var(--tt-text, #5a5a66)" fontSize="sm">
                {row.action}
              </Text>
            </Grid>
          ))}
        </Stack>
      </SectionCard>

      <SectionCard>
        <Text {...monoLabelProps} mb={3}>
          Behaviour
        </Text>
        <Stack spacing={3}>
          {entry.accessibility.map((item) => (
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
    </Stack>
  );
}

function TokenPreview({ row }: { row: TokenRow }) {
  if (row.preview === 'color') {
    return (
      <Box
        bg={`var(${row.token})`}
        border="1px solid"
        borderColor="var(--tt-border, #ececef)"
        borderRadius="6px"
        flexShrink={0}
        h="20px"
        w="20px"
      />
    );
  }

  if (row.preview === 'radius') {
    return (
      <Box
        border="2px solid var(--tt-muted, #9a9aa6)"
        borderRadius={`var(${row.token})`}
        flexShrink={0}
        h="20px"
        w="20px"
      />
    );
  }

  if (row.preview === 'shadow') {
    return (
      <Box
        bg="var(--tt-card, #ffffff)"
        border="1px solid"
        borderColor="var(--tt-border, #ececef)"
        borderRadius="6px"
        boxShadow={`var(${row.token})`}
        flexShrink={0}
        h="20px"
        w="20px"
      />
    );
  }

  if (row.preview === 'font') {
    return (
      <Flex align="center" flexShrink={0} fontFamily={`var(${row.token})`} fontSize="13px" h="20px">
        Aa
      </Flex>
    );
  }

  return null;
}

function TokensTab({ entry }: { entry: DesignSystemEntry }) {
  return (
    <SectionCard>
      <Text {...monoLabelProps} mb={3}>
        Theme tokens used
      </Text>
      <Text color="var(--tt-text, #5a5a66)" fontSize="sm" lineHeight="1.6" mb={4} maxW="720px">
        Every colour, radius, and shadow comes from the runtime theme (see remix/app/theme/tokens.ts), so the menu
        re-skins with Thingtime, Fable, Prism, and Midnight without component changes.
      </Text>
      <Stack spacing={0}>
        {entry.tokens.map((row, index) => (
          <Grid
            key={row.token}
            alignItems="center"
            borderTop={index === 0 ? 'none' : '1px solid'}
            borderColor="var(--tt-border-light, #f0f0f2)"
            columnGap={4}
            py={2.5}
            templateColumns={{ base: '28px 1fr', md: '28px 260px 1fr' }}
          >
            <TokenPreview row={row} />
            <Text fontFamily="var(--tt-font-mono, monospace)" fontSize="sm" fontWeight="600" overflowWrap="anywhere">
              {row.token}
            </Text>
            <Text color="var(--tt-text, #5a5a66)" fontSize="sm" gridColumn={{ base: '1 / -1', md: 'auto' }}>
              {row.usedFor}
            </Text>
          </Grid>
        ))}
      </Stack>
    </SectionCard>
  );
}

export default function DocsDesignSystem() {
  const [searchParams, setSearchParams] = useSearchParams();

  const selectedEntry = getDesignSystemEntryBySlug(searchParams.get('component')) || designSystemEntries[0];

  const tabParam = searchParams.get('tab') as TabKey | null;
  const activeTab: TabKey = tabParam && TAB_KEYS.includes(tabParam) ? tabParam : 'stories';

  const selectTab = (tab: TabKey) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    setSearchParams(next);
  };

  const statusColor = designSystemStatusColors[selectedEntry.status];

  return (
    <Grid columnGap={8} rowGap={8} templateColumns={{ base: '1fr', '2xl': 'minmax(0, 1fr) 240px' }}>
      <Stack minW={0} spacing={6}>
        <Box borderBottom="1px solid" borderColor="var(--tt-border, #ececef)" pb={6}>
          <Flex align="center" gap={2} mb={4} wrap="wrap">
            <Badge bg="#fde2f1" borderRadius="sm" color="#8a2f61" px={2}>
              Component
            </Badge>
            <Badge bg={statusColor.bg} borderRadius="sm" color={statusColor.color} px={2}>
              {selectedEntry.status}
            </Badge>
            <Text color="var(--tt-muted, #9a9aa6)" fontFamily="var(--tt-font-mono, monospace)" fontSize="sm">
              /docs/design-system · {selectedEntry.slug}
            </Text>
          </Flex>

          <Heading
            as="h2"
            color="var(--tt-ink, #16161a)"
            fontSize={{ base: '3xl', md: '4xl' }}
            letterSpacing="-0.02em"
            lineHeight="1.05"
          >
            {selectedEntry.title}
          </Heading>
          <Text color="var(--tt-text, #5a5a66)" fontSize={{ base: 'md', md: 'lg' }} lineHeight="1.7" maxW="820px" mt={4}>
            {selectedEntry.summary}
          </Text>
          <Text color="var(--tt-muted, #9a9aa6)" fontSize="sm" lineHeight="1.6" maxW="820px" mt={2}>
            {selectedEntry.notes}
          </Text>

          <Flex gap={1} mt={5} overflowX="auto" pb={1}>
            {TAB_KEYS.map((tab) => {
              const active = tab === activeTab;

              return (
                <Box
                  key={tab}
                  as="button"
                  bg={active ? 'var(--tt-ink, #16161a)' : 'transparent'}
                  borderRadius="999px"
                  color={active ? 'var(--tt-card, #ffffff)' : 'var(--tt-text, #5a5a66)'}
                  cursor="pointer"
                  data-testid={`design-system-tab-${tab}`}
                  flexShrink={0}
                  fontSize="sm"
                  fontWeight="650"
                  onClick={() => selectTab(tab)}
                  px={4}
                  py={1.5}
                  transition="background 140ms ease, color 140ms ease"
                  type="button"
                  _hover={{ bg: active ? 'var(--tt-ink, #16161a)' : 'var(--tt-surface-hover, #ececee)' }}
                >
                  {tabLabels[tab]}
                </Box>
              );
            })}
          </Flex>
        </Box>

        {activeTab === 'stories' && (
          <>
            <SectionCard id="anatomy">
              <Text {...monoLabelProps} mb={3}>
                Anatomy
              </Text>
              <Stack spacing={3}>
                {selectedEntry.anatomy.map((item) => (
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
            <StoriesTab entry={selectedEntry} />
          </>
        )}

        {activeTab === 'api' && (
          <Stack spacing={5}>
            {selectedEntry.propTables.map((table) => (
              <PropTableCard key={table.title} table={table} />
            ))}
          </Stack>
        )}

        {activeTab === 'guidelines' && <GuidelinesTab entry={selectedEntry} />}
        {activeTab === 'accessibility' && <AccessibilityTab entry={selectedEntry} />}
        {activeTab === 'tokens' && <TokensTab entry={selectedEntry} />}
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
            {activeTab === 'stories' ? (
              <>
                <ChakraLink color="var(--tt-text, #5a5a66)" href="#anatomy">
                  Anatomy
                </ChakraLink>
                {selectedEntry.stories.map((story) => (
                  <ChakraLink key={story.id} color="var(--tt-text, #5a5a66)" href={`#story-${story.id}`}>
                    {story.title}
                  </ChakraLink>
                ))}
              </>
            ) : (
              <Text color="var(--tt-muted, #9a9aa6)" fontSize="xs" lineHeight="1.6">
                {tabLabels[activeTab]} for {selectedEntry.title}.
              </Text>
            )}
          </Stack>
        </Box>
      </Box>
    </Grid>
  );
}
