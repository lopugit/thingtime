import {
  Badge,
  Box,
  Button,
  Divider,
  Flex,
  Grid,
  Heading,
  Icon,
  Link as ChakraLink,
  SimpleGrid,
  Stack,
  Text
} from '@chakra-ui/react';
import { ArrowRight, Boxes, Component, Gem, ServerCog, Shapes, Sparkles } from 'lucide-react';
import { Link as RouterLink } from 'react-router';

import { apiEndpointDocs } from '~/docs/apiDocs';
import { thingtimeSchemas } from '~/schemas/registry';

import { designEntries } from './designEntries';
import { designSystemEntries } from './design-system/entries';
import { conceptEntries } from './concepts/entries';

const referenceLinks = [
  { label: 'Limitless MCP Lab', to: '/docs/mcp', detail: 'Live contract, five workflows, embedded review UI' },
  { label: 'API reference', to: '/docs/api', detail: `${apiEndpointDocs.length} endpoints with JSON -docs routes` },
  { label: 'Login with Thingtime', to: '/docs/embed', detail: 'Embed SDK, permission scopes, SSO userinfo' },
  { label: 'Thingtime Schemas', to: '/docs/schemas', detail: `${thingtimeSchemas.length} schemas across root, crystal, and collection kinds` },
  { label: 'Design mockups', to: '/docs/design', detail: `${designEntries.length} standalone bundles` },
  { label: 'Design system', to: '/docs/design-system', detail: `${designSystemEntries.length} component ${designSystemEntries.length === 1 ? 'entry' : 'entries'}` },
  { label: 'Data viewer concepts', to: '/docs/concepts', detail: `${conceptEntries.length} live concepts + kind renderers` }
];

export default function DocsIndex() {
  return (
    <Grid templateColumns={{ base: '1fr', '2xl': 'minmax(0, 1fr) 260px' }} columnGap={8} rowGap={8}>
      <Stack spacing={8} minW={0}>
        <Box borderBottom="1px solid" borderColor="var(--tt-border, #ececef)" pb={8}>
          <Flex align="center" gap={2} mb={4} wrap="wrap">
            <Badge
              bg="var(--tt-docs-accent-soft, #d7f5df)"
              borderRadius="sm"
              color="var(--tt-docs-accent-ink, #0f5132)"
              px={2}
            >
              Docs
            </Badge>
            <Text color="var(--tt-muted, #9a9aa6)" fontSize="sm" fontFamily="mono">
              /docs
            </Text>
          </Flex>

          <Heading
            as="h2"
            color="var(--tt-ink, #16161a)"
            fontSize={{ base: '3xl', md: '5xl' }}
            letterSpacing="-0.02em"
            lineHeight="1.02"
            maxW="760px"
          >
            Thingtime documentation
          </Heading>
          <Text color="var(--tt-text, #5a5a66)" fontSize={{ base: 'md', md: 'lg' }} lineHeight="1.7" mt={5} maxW="760px">
            A browser documentation surface for product reference pages and design artifacts.
          </Text>
        </Box>

        <SimpleGrid columns={{ base: 1 }} spacing={4}>
          <Box
            id="limitless-mcp-lab"
            bg="var(--tt-card, #ffffff)"
            border="1px solid"
            borderColor="var(--tt-border, #ececef)"
            borderRadius="var(--tt-radius-lg, 16px)"
            boxShadow="var(--tt-shadow-card, 0 1px 2px rgba(0, 0, 0, 0.05))"
            p={5}
          >
            <Flex align="center" gap={3} mb={4}>
              <Icon as={Sparkles} boxSize={5} color="var(--tt-docs-accent, #008060)" />
              <Heading as="h3" fontSize="lg">
                Limitless MCP Lab
              </Heading>
            </Flex>
            <Text color="var(--tt-text, #5a5a66)" fontSize="sm" lineHeight="1.6" mb={5}>
              Explore the live MCP contract through five composable workflows, then interact with the exact shipped
              review App using synthetic, non-mutating preview data.
            </Text>
            <Button
              as={RouterLink}
              to="/docs/mcp"
              size="sm"
              bg="var(--tt-docs-accent, #008060)"
              borderRadius="var(--tt-radius-sm, 9px)"
              color="white"
              _hover={{ bg: 'var(--tt-docs-accent-hover, #006e52)' }}
              rightIcon={<Icon as={ArrowRight} boxSize={4} />}
            >
              Open the lab
            </Button>
          </Box>

          <Box
            id="api-reference"
            bg="var(--tt-card, #ffffff)"
            border="1px solid"
            borderColor="var(--tt-border, #ececef)"
            borderRadius="var(--tt-radius-lg, 16px)"
            boxShadow="var(--tt-shadow-card, 0 1px 2px rgba(0, 0, 0, 0.05))"
            p={5}
          >
            <Flex align="center" gap={3} mb={4}>
              <Icon as={ServerCog} boxSize={5} color="var(--tt-docs-accent, #008060)" />
              <Heading as="h3" fontSize="lg">
                API reference
              </Heading>
            </Flex>
            <Text color="var(--tt-text, #5a5a66)" fontSize="sm" lineHeight="1.6" mb={5}>
              Browse every Thingtime API endpoint with request steps, payload examples, response shapes, and curl,
              wget, Node.js, Python, and Ruby snippets generated from the live docs registry.
            </Text>
            <Button
              as={RouterLink}
              to="/docs/api"
              size="sm"
              bg="var(--tt-docs-accent, #008060)"
              borderRadius="var(--tt-radius-sm, 9px)"
              color="white"
              _hover={{ bg: 'var(--tt-docs-accent-hover, #006e52)' }}
              rightIcon={<Icon as={ArrowRight} boxSize={4} />}
            >
              Browse API
            </Button>
          </Box>

          <Box
            id="thingtime-schemas"
            bg="var(--tt-card, #ffffff)"
            border="1px solid"
            borderColor="var(--tt-border, #ececef)"
            borderRadius="var(--tt-radius-lg, 16px)"
            boxShadow="var(--tt-shadow-card, 0 1px 2px rgba(0, 0, 0, 0.05))"
            p={5}
          >
            <Flex align="center" gap={3} mb={4}>
              <Icon as={Gem} boxSize={5} color="var(--tt-docs-accent, #008060)" />
              <Heading as="h3" fontSize="lg">
                Thingtime Schemas
              </Heading>
            </Flex>
            <Text color="var(--tt-text, #5a5a66)" fontSize="sm" lineHeight="1.6" mb={5}>
              Everything is a thing: browse the root Thing schema, the crystal sub-schemas applied via the thingtime
              array, and every collection schema — with fields tables, examples, and versions from the live registry.
            </Text>
            <Button
              as={RouterLink}
              to="/docs/schemas"
              size="sm"
              bg="var(--tt-docs-accent, #008060)"
              borderRadius="var(--tt-radius-sm, 9px)"
              color="white"
              _hover={{ bg: 'var(--tt-docs-accent-hover, #006e52)' }}
              rightIcon={<Icon as={ArrowRight} boxSize={4} />}
            >
              Browse schemas
            </Button>
          </Box>

          <Box
            id="design-browser"
            bg="var(--tt-card, #ffffff)"
            border="1px solid"
            borderColor="var(--tt-border, #ececef)"
            borderRadius="var(--tt-radius-lg, 16px)"
            boxShadow="var(--tt-shadow-card, 0 1px 2px rgba(0, 0, 0, 0.05))"
            p={5}
          >
            <Flex align="center" gap={3} mb={4}>
              <Icon as={Boxes} boxSize={5} color="var(--tt-docs-accent, #008060)" />
              <Heading as="h3" fontSize="lg">
                Design browser
              </Heading>
            </Flex>
            <Text color="var(--tt-text, #5a5a66)" fontSize="sm" lineHeight="1.6" mb={5}>
              Navigate the design exports, load each standalone HTML bundle, and open multiple previews at once.
            </Text>
            <Button
              as={RouterLink}
              to="/docs/design"
              size="sm"
              bg="var(--tt-docs-accent, #008060)"
              borderRadius="var(--tt-radius-sm, 9px)"
              color="white"
              _hover={{ bg: 'var(--tt-docs-accent-hover, #006e52)' }}
              rightIcon={<Icon as={ArrowRight} boxSize={4} />}
            >
              Browse mockups
            </Button>
          </Box>

          <Box
            id="design-system"
            bg="var(--tt-card, #ffffff)"
            border="1px solid"
            borderColor="var(--tt-border, #ececef)"
            borderRadius="var(--tt-radius-lg, 16px)"
            boxShadow="var(--tt-shadow-card, 0 1px 2px rgba(0, 0, 0, 0.05))"
            p={5}
          >
            <Flex align="center" gap={3} mb={4}>
              <Icon as={Component} boxSize={5} color="var(--tt-docs-accent, #008060)" />
              <Heading as="h3" fontSize="lg">
                Design system
              </Heading>
            </Flex>
            <Text color="var(--tt-text, #5a5a66)" fontSize="sm" lineHeight="1.6" mb={5}>
              Storybook-style component library: live stories, API reference, usage guidelines, accessibility notes,
              and theme tokens for Thingtime components — starting with the Thing Context Menu.
            </Text>
            <Button
              as={RouterLink}
              to="/docs/design-system"
              size="sm"
              bg="var(--tt-docs-accent, #008060)"
              borderRadius="var(--tt-radius-sm, 9px)"
              color="white"
              _hover={{ bg: 'var(--tt-docs-accent-hover, #006e52)' }}
              rightIcon={<Icon as={ArrowRight} boxSize={4} />}
            >
              Browse components
            </Button>
          </Box>

          <Box
            id="data-viewer-concepts"
            bg="var(--tt-card, #ffffff)"
            border="1px solid"
            borderColor="var(--tt-border, #ececef)"
            borderRadius="var(--tt-radius-lg, 16px)"
            boxShadow="var(--tt-shadow-card, 0 1px 2px rgba(0, 0, 0, 0.05))"
            p={5}
          >
            <Flex align="center" gap={3} mb={4}>
              <Icon as={Shapes} boxSize={5} color="var(--tt-docs-accent, #008060)" />
              <Heading as="h3" fontSize="lg">
                Data viewer concepts
              </Heading>
            </Flex>
            <Text color="var(--tt-text, #5a5a66)" fontSize="sm" lineHeight="1.6" mb={5}>
              Live, interactive concepts for making nested data friendly — Focus cards, Finder-style columns,
              document and form views, an orbiting galaxy — plus the kind-renderer gallery and the JSON-to-page
              pipeline, each with desktop and phone frames.
            </Text>
            <Button
              as={RouterLink}
              to="/docs/concepts"
              size="sm"
              bg="var(--tt-docs-accent, #008060)"
              borderRadius="var(--tt-radius-sm, 9px)"
              color="white"
              _hover={{ bg: 'var(--tt-docs-accent-hover, #006e52)' }}
              rightIcon={<Icon as={ArrowRight} boxSize={4} />}
            >
              Browse concepts
            </Button>
          </Box>
        </SimpleGrid>

        <Box
          bg="var(--tt-card, #ffffff)"
          border="1px solid"
          borderColor="var(--tt-border, #ececef)"
          borderRadius="var(--tt-radius-lg, 16px)"
          boxShadow="var(--tt-shadow-card, 0 1px 2px rgba(0, 0, 0, 0.05))"
          overflow="hidden"
        >
          <Box px={5} py={4}>
            <Heading as="h3" fontSize="lg">
              Reference map
            </Heading>
          </Box>
          <Divider />
          <Stack spacing={0}>
            {referenceLinks.map((item) => (
              <ChakraLink
                key={item.to}
                as={RouterLink}
                to={item.to}
                _hover={{ textDecoration: 'none', bg: 'var(--tt-surface-hover, #ececee)' }}
                px={5}
                py={4}
                transition="background 140ms ease"
              >
                <Flex align="center" gap={4}>
                  <Box minW={0}>
                    <Text fontWeight="650">{item.label}</Text>
                    <Text color="var(--tt-muted, #9a9aa6)" fontSize="sm" fontFamily="mono" overflowWrap="anywhere">
                      {item.detail}
                    </Text>
                  </Box>
                  <Icon as={ArrowRight} boxSize={4} ml="auto" />
                </Flex>
              </ChakraLink>
            ))}
          </Stack>
        </Box>
      </Stack>

      <Box
        as="aside"
        display={{ base: 'none', '2xl': 'block' }}
        borderLeft="1px solid"
        borderColor="var(--tt-border, #ececef)"
        pl={6}
      >
        <Box position="sticky" top="96px">
          <Text
            color="var(--tt-muted, #9a9aa6)"
            fontFamily="mono"
            fontSize="11px"
            fontWeight="600"
            letterSpacing="0.14em"
            mb={4}
            textTransform="uppercase"
          >
            On this page
          </Text>
          <Stack spacing={3} fontSize="sm">
            <ChakraLink href="#api-reference" color="var(--tt-text, #5a5a66)">
              API reference
            </ChakraLink>
            <ChakraLink href="#thingtime-schemas" color="var(--tt-text, #5a5a66)">
              Thingtime Schemas
            </ChakraLink>
            <ChakraLink href="#design-browser" color="var(--tt-text, #5a5a66)">
              Design browser
            </ChakraLink>
            <ChakraLink href="#design-system" color="var(--tt-text, #5a5a66)">
              Design system
            </ChakraLink>
            <ChakraLink href="#data-viewer-concepts" color="var(--tt-text, #5a5a66)">
              Data viewer concepts
            </ChakraLink>
          </Stack>
        </Box>
      </Box>
    </Grid>
  );
}
