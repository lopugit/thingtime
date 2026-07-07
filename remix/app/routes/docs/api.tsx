import React from 'react';
import {
  Badge,
  Box,
  Button,
  Flex,
  Grid,
  Heading,
  Icon,
  Input,
  Link as ChakraLink,
  Select,
  SimpleGrid,
  Stack,
  Text
} from '@chakra-ui/react';
import { ArrowUpRight, Code2, Search, ServerCog, TerminalSquare } from 'lucide-react';

import {
  apiEndpointDocs,
  buildPlatformExamples,
  type ApiEndpointDoc,
  type ApiHttpMethod
} from '~/docs/apiDocs';

const methodColor = (method: ApiHttpMethod) => (method === 'GET' ? 'blue' : 'purple');
const groupLabel = (group: string) => group.charAt(0).toUpperCase() + group.slice(1);

const formatJson = (value: unknown) => {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
};

const endpointMatches = (doc: ApiEndpointDoc, group: string, query: string) => {
  if (group !== 'all' && doc.group !== group) return false;

  const needle = query.trim().toLowerCase();
  if (!needle) return true;

  return [
    doc.id,
    doc.group,
    doc.title,
    doc.endpoint,
    doc.docsEndpoint,
    doc.summary,
    doc.detail,
    doc.methods.join(' '),
    doc.steps.join(' ')
  ]
    .join(' ')
    .toLowerCase()
    .includes(needle);
};

function CodeBlock({ children }: { children: string }) {
  return (
    <Box
      as="pre"
      bg="var(--tt-code-bg, #111827)"
      border="1px solid"
      borderColor="rgba(255, 255, 255, 0.08)"
      borderRadius="var(--tt-radius-sm, 9px)"
      color="#f8fafc"
      fontFamily="mono"
      fontSize="12px"
      lineHeight="1.6"
      maxH="320px"
      overflow="auto"
      p={4}
      whiteSpace="pre"
    >
      {children}
    </Box>
  );
}

function EndpointDocs({ doc, origin }: { doc: ApiEndpointDoc; origin: string }) {
  const platformExamples = React.useMemo(() => buildPlatformExamples(doc, origin), [doc, origin]);
  const platforms = Object.entries(platformExamples);

  return (
    <Box
      id={`api-${doc.id}`}
      bg="var(--tt-card, #ffffff)"
      border="1px solid"
      borderColor="var(--tt-border, #ececef)"
      borderRadius="var(--tt-radius-lg, 16px)"
      boxShadow="var(--tt-shadow-card, 0 1px 2px rgba(0, 0, 0, 0.05))"
      p={{ base: 4, md: 5 }}
    >
      <Flex align="flex-start" gap={4} justify="space-between" wrap="wrap">
        <Box minW={0}>
          <Flex align="center" gap={2} mb={2} wrap="wrap">
            <Badge
              bg="var(--tt-docs-accent-soft, #d7f5df)"
              borderRadius="sm"
              color="var(--tt-docs-accent-ink, #0f5132)"
              px={2}
            >
              {groupLabel(doc.group)}
            </Badge>
            {doc.methods.map((method) => (
              <Badge key={method} colorScheme={methodColor(method)}>
                {method}
              </Badge>
            ))}
            <Badge colorScheme={doc.auth.mode === 'none' ? 'gray' : 'orange'}>{doc.auth.mode}</Badge>
          </Flex>

          <Heading as="h3" fontSize={{ base: 'xl', md: '2xl' }} letterSpacing="0">
            {doc.title}
          </Heading>
          <Text color="var(--tt-text, #5a5a66)" fontSize="sm" lineHeight="1.7" mt={2}>
            {doc.summary}
          </Text>
        </Box>

        <Button
          as={ChakraLink}
          href={doc.docsEndpoint}
          isExternal
          leftIcon={<Icon as={ArrowUpRight} boxSize={4} />}
          size="sm"
          variant="outline"
        >
          JSON docs
        </Button>
      </Flex>

      <SimpleGrid columns={{ base: 1, lg: 2 }} spacing={3} mt={5}>
        <Box>
          <Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="11px" fontWeight="700" mb={1}>
            Endpoint
          </Text>
          <Text fontFamily="mono" fontSize="sm" overflowWrap="anywhere">
            {doc.endpoint}
          </Text>
        </Box>
        <Box>
          <Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="11px" fontWeight="700" mb={1}>
            Docs endpoint
          </Text>
          <Text fontFamily="mono" fontSize="sm" overflowWrap="anywhere">
            {doc.docsEndpoint}
          </Text>
        </Box>
      </SimpleGrid>

      <Text color="var(--tt-text, #5a5a66)" fontSize="sm" lineHeight="1.7" mt={5}>
        {doc.detail}
      </Text>

      <Box mt={5}>
        <Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="11px" fontWeight="700" mb={2}>
          Auth
        </Text>
        <Text color="var(--tt-text, #5a5a66)" fontSize="sm" lineHeight="1.6">
          {doc.auth.description}
        </Text>
      </Box>

      <SimpleGrid columns={{ base: 1, xl: 2 }} spacing={5} mt={5}>
        <Box>
          <Flex align="center" gap={2} mb={3}>
            <Icon as={ServerCog} boxSize={4} color="var(--tt-docs-accent, #008060)" />
            <Heading as="h4" fontSize="md">
              Steps
            </Heading>
          </Flex>
          <Box as="ol" color="var(--tt-text, #5a5a66)" fontSize="sm" lineHeight="1.7" pl={5}>
            {doc.steps.map((step) => (
              <Box as="li" key={step} mb={1}>
                {step}
              </Box>
            ))}
          </Box>
        </Box>

        <Stack spacing={4}>
          <Box>
            <Flex align="center" gap={2} mb={3}>
              <Icon as={Code2} boxSize={4} color="var(--tt-docs-accent, #008060)" />
              <Heading as="h4" fontSize="md">
                Payload examples
              </Heading>
            </Flex>
            <Stack spacing={3}>
              {doc.requestExamples.map((example) => (
                <Box key={`${example.method}-${example.name}`}>
                  <Flex align="center" gap={2} mb={1} wrap="wrap">
                    <Badge colorScheme={methodColor(example.method)}>{example.method}</Badge>
                    <Text fontSize="sm" fontWeight="700">
                      {example.name}
                    </Text>
                  </Flex>
                  <Text color="var(--tt-text, #5a5a66)" fontSize="sm" lineHeight="1.6" mb={2}>
                    {example.description}
                  </Text>
                  {example.query ? <CodeBlock>{formatJson({ query: example.query })}</CodeBlock> : null}
                  {example.body !== undefined ? <CodeBlock>{formatJson(example.body)}</CodeBlock> : null}
                  {!example.query && example.body === undefined ? (
                    <Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="xs">
                      No request body.
                    </Text>
                  ) : null}
                </Box>
              ))}
            </Stack>
          </Box>
        </Stack>
      </SimpleGrid>

      <Box mt={6}>
        <Heading as="h4" fontSize="md" mb={3}>
          Response examples
        </Heading>
        <SimpleGrid columns={{ base: 1, xl: 2 }} spacing={3}>
          {doc.responseExamples.map((example) => (
            <Box key={`${example.status}-${example.description}`}>
              <Flex align="center" gap={2} mb={1} wrap="wrap">
                <Badge colorScheme={example.status >= 400 ? 'red' : example.status >= 300 ? 'yellow' : 'green'}>
                  HTTP {example.status}
                </Badge>
                <Text fontSize="sm" fontWeight="700">
                  {example.description}
                </Text>
              </Flex>
              {example.headers ? <CodeBlock>{formatJson({ headers: example.headers })}</CodeBlock> : null}
              {example.body !== undefined ? <CodeBlock>{formatJson(example.body)}</CodeBlock> : null}
            </Box>
          ))}
        </SimpleGrid>
      </Box>

      <Box mt={6}>
        <Flex align="center" gap={2} mb={3}>
          <Icon as={TerminalSquare} boxSize={4} color="var(--tt-docs-accent, #008060)" />
          <Heading as="h4" fontSize="md">
            Platform examples
          </Heading>
        </Flex>
        <SimpleGrid columns={{ base: 1, xl: 2 }} spacing={3}>
          {platforms.map(([platform, code]) => (
            <Box key={platform}>
              <Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="11px" fontWeight="700" mb={2}>
                {platform}
              </Text>
              <CodeBlock>{code}</CodeBlock>
            </Box>
          ))}
        </SimpleGrid>
      </Box>

      {doc.notes?.length ? (
        <Box
          bg="var(--tt-surface-alt, #f2f7f4)"
          border="1px solid"
          borderColor="var(--tt-border, #dce9df)"
          borderRadius="var(--tt-radius-sm, 9px)"
          mt={6}
          p={4}
        >
          <Text color="var(--tt-muted, #557064)" fontFamily="mono" fontSize="11px" fontWeight="700" mb={2}>
            Notes
          </Text>
          <Stack spacing={1}>
            {doc.notes.map((note) => (
              <Text key={note} color="var(--tt-text, #40564b)" fontSize="sm">
                {note}
              </Text>
            ))}
          </Stack>
        </Box>
      ) : null}
    </Box>
  );
}

export default function DocsApi() {
  const [group, setGroup] = React.useState('all');
  const [query, setQuery] = React.useState('');
  const origin = typeof window === 'undefined' ? 'https://thingtime.com' : window.location.origin;
  const groups = React.useMemo(() => Array.from(new Set(apiEndpointDocs.map((doc) => doc.group))).sort(), []);
  const visibleDocs = React.useMemo(
    () => apiEndpointDocs.filter((doc) => endpointMatches(doc, group, query)),
    [group, query]
  );

  return (
    <Grid templateColumns={{ base: '1fr', '2xl': 'minmax(0, 1fr) 280px' }} columnGap={8} rowGap={8}>
      <Stack spacing={8} minW={0}>
        <Box borderBottom="1px solid" borderColor="var(--tt-border, #ececef)" pb={8}>
          <Flex align="center" gap={2} mb={4} wrap="wrap">
            <Badge
              bg="var(--tt-docs-accent-soft, #d7f5df)"
              borderRadius="sm"
              color="var(--tt-docs-accent-ink, #0f5132)"
              px={2}
            >
              API
            </Badge>
            <Text color="var(--tt-muted, #9a9aa6)" fontSize="sm" fontFamily="mono">
              /docs/api
            </Text>
          </Flex>

          <Heading
            as="h2"
            color="var(--tt-ink, #16161a)"
            fontSize={{ base: '3xl', md: '5xl' }}
            letterSpacing="0"
            lineHeight="1.02"
            maxW="840px"
          >
            Thingtime API reference
          </Heading>
          <Text color="var(--tt-text, #5a5a66)" fontSize={{ base: 'md', md: 'lg' }} lineHeight="1.7" mt={5} maxW="840px">
            Every documented endpoint also serves JSON docs at the same path with <Box as="span" fontFamily="mono">-docs</Box> appended.
          </Text>
        </Box>

        <SimpleGrid columns={{ base: 1, lg: 3 }} spacing={3}>
          <Box>
            <Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="11px" fontWeight="700" mb={1}>
              Group
            </Text>
            <Select value={group} onChange={(event) => setGroup(event.target.value)}>
              <option value="all">All groups</option>
              {groups.map((item) => (
                <option key={item} value={item}>
                  {groupLabel(item)}
                </option>
              ))}
            </Select>
          </Box>
          <Box gridColumn={{ base: 'auto', lg: 'span 2' }}>
            <Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="11px" fontWeight="700" mb={1}>
              Search
            </Text>
            <Box position="relative">
              <Icon
                as={Search}
                boxSize={4}
                color="var(--tt-faint, #b6b6c0)"
                left={3}
                position="absolute"
                top="50%"
                transform="translateY(-50%)"
                zIndex={1}
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="endpoint, method, group, or capability"
                pl={9}
              />
            </Box>
          </Box>
        </SimpleGrid>

        <Flex gap={2} wrap="wrap">
          <Badge colorScheme="green">{visibleDocs.length} endpoints</Badge>
          <Badge colorScheme="gray">{apiEndpointDocs.length} total</Badge>
          <Badge colorScheme="gray">{apiEndpointDocs.length * 2} docs smoke tests</Badge>
        </Flex>

        <Stack spacing={5}>
          {visibleDocs.map((doc) => (
            <EndpointDocs key={doc.id} doc={doc} origin={origin} />
          ))}
        </Stack>
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
            Endpoints
          </Text>
          <Stack spacing={2} fontSize="sm" maxH="calc(100vh - 160px)" overflowY="auto" pr={2}>
            {visibleDocs.map((doc) => (
              <ChakraLink key={doc.id} href={`#api-${doc.id}`} color="var(--tt-text, #5a5a66)">
                <Text fontWeight="650">{doc.title}</Text>
                <Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="xs" overflowWrap="anywhere">
                  {doc.endpoint}
                </Text>
              </ChakraLink>
            ))}
          </Stack>
        </Box>
      </Box>
    </Grid>
  );
}
