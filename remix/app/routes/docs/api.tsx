import React from 'react';
import {
  Badge,
  Box,
  Button,
  Flex,
  Grid,
  Heading,
  Icon,
  IconButton,
  Input,
  Link as ChakraLink,
  Select,
  SimpleGrid,
  Stack,
  Text
} from '@chakra-ui/react';
import { ArrowUpRight, Check, Code2, Link2, Search, ServerCog, TerminalSquare } from 'lucide-react';

import {
  apiEndpointDocs,
  buildPlatformExamples,
  type ApiEndpointDoc,
  type ApiHttpMethod
} from '~/docs/apiDocs';
import {
  CODE_BG,
  CODE_BORDER,
  CODE_TEXT,
  CodeBlock,
  type CodeLanguage,
  CopyCodeButton,
  copyToClipboard
} from './docsCode';
import { ApiTryIt } from './ApiTryIt';
import { Link as RouterLink, useLocation, useParams } from 'react-router';

import { ApiPlayground } from './ApiPlayground';

const METHOD_COLORS: Record<ApiHttpMethod, string> = {
  GET: 'blue',
  POST: 'purple',
  PUT: 'orange',
  PATCH: 'teal',
  DELETE: 'red'
};
const methodColor = (method: ApiHttpMethod) => METHOD_COLORS[method] || 'purple';
const groupLabel = (group: string) => group.charAt(0).toUpperCase() + group.slice(1);
const groupPagePath = (group: string) => `/docs/api/${group}`;
const docPagePath = (doc: ApiEndpointDoc) => `${groupPagePath(doc.group)}/${doc.id}`;
const docHashPath = (doc: ApiEndpointDoc) => `/docs/api#api-${doc.id}`;

type DocsPathLink = {
  copyHref: string;
  label: string;
  to: string;
};

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

const groupApiDocs = (docs: ApiEndpointDoc[]) =>
  docs.reduce<Array<{ group: string; docs: ApiEndpointDoc[] }>>((groups, doc) => {
    const existing = groups.find((item) => item.group === doc.group);

    if (existing) {
      existing.docs.push(doc);
    } else {
      groups.push({ group: doc.group, docs: [doc] });
    }

    return groups;
  }, []);

const languageForPlatform = (platform: string): CodeLanguage => {
  if (platform === 'curl' || platform === 'wget') return 'shell';
  if (platform === 'node') return 'javascript';
  if (platform === 'python') return 'python';
  if (platform === 'ruby') return 'ruby';
  return 'text';
};

const platformLabel = (platform: string) =>
  ({
    curl: 'cURL',
    wget: 'wget',
    node: 'Node.js',
    python: 'Python',
    ruby: 'Ruby'
  })[platform] || platform;

function CopyDocLinkButton({
  href,
  label = 'Copy doc deeplink',
  size = 'sm',
  variant = 'outline'
}: {
  href: string;
  label?: string;
  size?: 'xs' | 'sm';
  variant?: 'ghost' | 'outline';
}) {
  const [copied, setCopied] = React.useState(false);

  const copy = React.useCallback(async () => {
    try {
      const copiedValue = await copyToClipboard(href);

      if (copiedValue) {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1100);
      }
    } catch {
      // Clipboard access can be unavailable in sandboxed preview browsers.
    }
  }, [href]);
  const compact = size === 'xs';

  return (
    <IconButton
      aria-label={copied ? `Copied ${label}` : label}
      h={compact ? '18px' : undefined}
      icon={<Icon as={copied ? Check : Link2} boxSize={compact ? 3 : 4} />}
      minW={compact ? '18px' : undefined}
      onClick={copy}
      p={compact ? 0 : undefined}
      size={size}
      title={copied ? 'Copied doc link' : label}
      type="button"
      variant={variant}
    />
  );
}

function DocsPathLinks({ links }: { links: DocsPathLink[] }) {
  return (
    <Flex align="center" gap={1} mt={2.5} minW={0} wrap="nowrap">
      {links.map((link) => (
        <Flex align="center" gap={0.5} key={link.to} minW={0}>
          <ChakraLink
            as={RouterLink}
            color="var(--tt-muted, #6f6f7a)"
            fontFamily="mono"
            fontSize={{ base: '11px', md: '13px' }}
            fontWeight="700"
            minW={0}
            overflowWrap="anywhere"
            whiteSpace="nowrap"
            to={link.to}
            _hover={{ color: 'var(--tt-ink, #16161a)', textDecoration: 'none' }}
          >
            {link.label}
          </ChakraLink>
          <CopyDocLinkButton
            href={link.copyHref}
            label={`Copy ${link.label.toLowerCase()} docs URL`}
            size="xs"
            variant="ghost"
          />
        </Flex>
      ))}
    </Flex>
  );
}

function PlatformExamples({ platforms }: { platforms: Array<[string, string]> }) {
  const [active, setActive] = React.useState(platforms[0]?.[0] || 'curl');
  const activeCode = platforms.find(([platform]) => platform === active)?.[1] || platforms[0]?.[1] || '';

  return (
    <Box bg={CODE_BG} border="2px solid" borderColor={CODE_BORDER} color={CODE_TEXT} overflow="hidden">
      <Flex align="center" bg="rgba(89, 189, 255, 0.08)" borderBottom="2px solid" borderColor={CODE_BORDER}>
        <Flex
          as="div"
          flex="1"
          minW={0}
          overflowX="auto"
          role="tablist"
          sx={{
            scrollbarWidth: 'none',
            '&::-webkit-scrollbar': { display: 'none' }
          }}
        >
          {platforms.map(([platform]) => {
            const isActive = platform === active;

            return (
              <Button
                aria-selected={isActive}
                bg="transparent"
                borderBottom="4px solid"
                borderColor={isActive ? CODE_TEXT : 'transparent'}
                borderRadius="0"
                color={isActive ? CODE_TEXT : '#9cc4d8'}
                fontFamily="var(--tt-font-mono, ui-monospace, Menlo, monospace)"
                fontSize={{ base: '13px', md: '15px' }}
                fontWeight="800"
                key={platform}
                minH="44px"
                onClick={() => setActive(platform)}
                px={{ base: 3, md: 4 }}
                role="tab"
                _hover={{ bg: 'rgba(255, 255, 255, 0.06)', color: CODE_TEXT }}
              >
                {platformLabel(platform)}
              </Button>
            );
          })}
        </Flex>
        <Box p={2}>
          <CopyCodeButton code={activeCode} />
        </Box>
      </Flex>
      <CodeBlock framed={false} language={languageForPlatform(active)}>
        {activeCode}
      </CodeBlock>
    </Box>
  );
}

function EndpointDocs({
  copyHref,
  doc,
  origin,
  pathLinks
}: {
  copyHref: string;
  doc: ApiEndpointDoc;
  origin: string;
  pathLinks: DocsPathLink[];
}) {
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
      position="relative"
      scrollMarginTop="112px"
    >
      <Box aria-hidden="true" h="1px" id={doc.id} position="absolute" top="-112px" w="1px" />
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
          <DocsPathLinks links={pathLinks} />
          <Text color="var(--tt-text, #5a5a66)" fontSize="sm" lineHeight="1.7" mt={2}>
            {doc.summary}
          </Text>
        </Box>

        <Flex gap={2}>
          <CopyDocLinkButton href={copyHref} />
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
            Docs JSON endpoint
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
                  {example.query ? <CodeBlock language="json">{formatJson({ query: example.query })}</CodeBlock> : null}
                  {example.body !== undefined ? <CodeBlock language="json">{formatJson(example.body)}</CodeBlock> : null}
                  {!example.query && example.body === undefined ? (
                    <Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="xs">
                      No request body.
                    </Text>
                  ) : null}
                  <ApiTryIt doc={doc} example={example} />
                </Box>
              ))}
            </Stack>
          </Box>
        </Stack>
      </SimpleGrid>

      <ApiPlayground doc={doc} />

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
              {example.headers ? <CodeBlock language="json">{formatJson({ headers: example.headers })}</CodeBlock> : null}
              {example.body !== undefined ? <CodeBlock language="json">{formatJson(example.body)}</CodeBlock> : null}
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
        <PlatformExamples platforms={platforms} />
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
  const { hash } = useLocation();
  const params = useParams();
  const [group, setGroup] = React.useState('all');
  const [query, setQuery] = React.useState('');
  const origin = typeof window === 'undefined' ? 'https://thingtime.com' : window.location.origin;
  const groups = React.useMemo(() => Array.from(new Set(apiEndpointDocs.map((doc) => doc.group))), []);
  const routeGroup = params.group || '';
  const routeDocId = params.docId || '';
  const routeGroupDocs = React.useMemo(
    () => (routeGroup ? apiEndpointDocs.filter((doc) => doc.group === routeGroup) : []),
    [routeGroup]
  );
  const routeDoc = React.useMemo(
    () => (routeDocId ? routeGroupDocs.find((doc) => doc.id === routeDocId) : undefined),
    [routeDocId, routeGroupDocs]
  );
  const routeNotFound = Boolean(routeGroup && routeGroupDocs.length === 0) || Boolean(routeDocId && !routeDoc);
  const visibleDocs = React.useMemo(
    () => {
      if (routeNotFound) return [];
      if (routeDoc) return [routeDoc];
      if (routeGroup) return routeGroupDocs.filter((doc) => endpointMatches(doc, 'all', query));

      return apiEndpointDocs.filter((doc) => endpointMatches(doc, group, query));
    },
    [group, query, routeDoc, routeGroup, routeGroupDocs, routeNotFound]
  );
  const groupedVisibleDocs = React.useMemo(() => groupApiDocs(visibleDocs), [visibleDocs]);
  const pagePath = routeDoc
    ? docPagePath(routeDoc)
    : routeGroup
      ? groupPagePath(routeGroup)
      : '/docs/api';
  const pageTitle = routeDoc
    ? routeDoc.title
    : routeGroup
      ? `${groupLabel(routeGroup)} API endpoints`
      : 'Thingtime API reference';
  const pageDescription = routeDoc
    ? `Dedicated endpoint docs for ${routeDoc.endpoint}. Use the link button on this card to copy this endpoint page.`
    : routeGroup
      ? `Only ${groupLabel(routeGroup)} endpoints are shown on this category page.`
      : 'Every documented endpoint also serves JSON docs at the same path with -docs appended.';
  const copyHrefForDoc = React.useCallback(
    (doc: ApiEndpointDoc) => {
      if (routeDoc) return `${origin}${docPagePath(doc)}`;
      if (routeGroup) return `${origin}${groupPagePath(routeGroup)}#api-${doc.id}`;

      return `${origin}${docHashPath(doc)}`;
    },
    [origin, routeDoc, routeGroup]
  );
  const pathLinksForDoc = React.useCallback(
    (doc: ApiEndpointDoc): DocsPathLink[] => [
      {
        copyHref: `${origin}${groupPagePath(doc.group)}#${doc.id}`,
        label: doc.group,
        to: `${groupPagePath(doc.group)}#${doc.id}`
      },
      {
        copyHref: `${origin}${docPagePath(doc)}`,
        label: doc.id,
        to: docPagePath(doc)
      }
    ],
    [origin]
  );

  React.useEffect(() => {
    if (!hash) return;

    const targetId = decodeURIComponent(hash.slice(1));
    const targetDoc = apiEndpointDocs.find((doc) => `api-${doc.id}` === targetId || doc.id === targetId);

    if (!targetDoc) return;

    setGroup((currentGroup) =>
      currentGroup === 'all' || currentGroup === targetDoc.group ? currentGroup : 'all'
    );
    setQuery((currentQuery) => (endpointMatches(targetDoc, 'all', currentQuery) ? currentQuery : ''));
  }, [hash]);

  React.useEffect(() => {
    if (!hash) return;

    const targetId = decodeURIComponent(hash.slice(1));

    window.requestAnimationFrame(() => {
      document.getElementById(targetId)?.scrollIntoView({ block: 'start' });
    });
  }, [hash, visibleDocs]);

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
              {pagePath}
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
            {routeNotFound ? 'API docs not found' : pageTitle}
          </Heading>
          <Text color="var(--tt-text, #5a5a66)" fontSize={{ base: 'md', md: 'lg' }} lineHeight="1.7" mt={5} maxW="840px">
            {routeNotFound ? 'The requested API docs page does not match a documented category or endpoint.' : pageDescription}
          </Text>
          {routeGroup ? (
            <Flex gap={2} mt={5} wrap="wrap">
              <Button as={RouterLink} size="sm" to="/docs/api" variant="outline">
                All API docs
              </Button>
              {routeDoc ? (
                <Button as={RouterLink} size="sm" to={groupPagePath(routeDoc.group)} variant="outline">
                  {groupLabel(routeDoc.group)} category
                </Button>
              ) : null}
            </Flex>
          ) : null}
        </Box>

        {!routeDoc && !routeNotFound ? (
          <SimpleGrid columns={{ base: 1, lg: 3 }} spacing={3}>
            {!routeGroup ? (
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
            ) : (
              <Box>
                <Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="11px" fontWeight="700" mb={1}>
                  Category
                </Text>
                <Button as={RouterLink} justifyContent="flex-start" to="/docs/api" variant="outline" w="100%">
                  {groupLabel(routeGroup)}
                </Button>
              </Box>
            )}
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
        ) : null}

        <Flex gap={2} wrap="wrap">
          <Badge colorScheme="green">{visibleDocs.length} endpoints</Badge>
          <Badge colorScheme="gray">{routeGroup ? `${routeGroupDocs.length} in category` : `${apiEndpointDocs.length} total`}</Badge>
          <Badge colorScheme="gray">{apiEndpointDocs.length * 2} docs smoke tests</Badge>
        </Flex>

        {routeNotFound ? (
          <Box
            bg="var(--tt-card, #ffffff)"
            border="1px solid"
            borderColor="var(--tt-border, #ececef)"
            borderRadius="var(--tt-radius-lg, 16px)"
            p={{ base: 4, md: 5 }}
          >
            <Text color="var(--tt-text, #5a5a66)" fontSize="sm" lineHeight="1.7">
              Try the full API reference or choose a category from the docs drawer.
            </Text>
            <Button as={RouterLink} mt={4} size="sm" to="/docs/api" variant="outline">
              All API docs
            </Button>
          </Box>
        ) : null}

        <Stack spacing={7}>
          {groupedVisibleDocs.map((section) => (
            <Box as="section" key={section.group} minW={0}>
              <Flex align="center" gap={2} mb={3} wrap="wrap">
                <ChakraLink
                  as={RouterLink}
                  color="var(--tt-muted, #9a9aa6)"
                  fontFamily="mono"
                  fontSize="11px"
                  fontWeight="700"
                  letterSpacing="0.14em"
                  to={groupPagePath(section.group)}
                  textTransform="uppercase"
                  _hover={{ color: 'var(--tt-ink, #16161a)', textDecoration: 'none' }}
                >
                  {groupLabel(section.group)}
                </ChakraLink>
                <Badge colorScheme="green">{section.docs.length}</Badge>
              </Flex>

              <Stack spacing={5}>
                {section.docs.map((doc) => (
                  <EndpointDocs
                    copyHref={copyHrefForDoc(doc)}
                    doc={doc}
                    key={doc.id}
                    origin={origin}
                    pathLinks={pathLinksForDoc(doc)}
                  />
                ))}
              </Stack>
            </Box>
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
          <Stack spacing={4} fontSize="sm" maxH="calc(100vh - 160px)" overflowY="auto" pr={2}>
            {groupedVisibleDocs.map((section) => (
              <Box key={section.group}>
                <ChakraLink
                  as={RouterLink}
                  color="var(--tt-muted, #9a9aa6)"
                  fontFamily="mono"
                  fontSize="10px"
                  fontWeight="700"
                  letterSpacing="0.14em"
                  mb={1.5}
                  to={groupPagePath(section.group)}
                  textTransform="uppercase"
                  _hover={{ color: 'var(--tt-ink, #16161a)', textDecoration: 'none' }}
                >
                  {groupLabel(section.group)}
                </ChakraLink>
                <Stack spacing={2}>
                  {section.docs.map((doc) => (
                    <ChakraLink
                      key={doc.id}
                      as={RouterLink}
                      color="var(--tt-text, #5a5a66)"
                      to={routeGroup ? docPagePath(doc) : docHashPath(doc)}
                    >
                      <Text fontWeight="650">{doc.title}</Text>
                      <Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="xs" overflowWrap="anywhere">
                        {doc.endpoint}
                      </Text>
                    </ChakraLink>
                  ))}
                </Stack>
              </Box>
            ))}
          </Stack>
        </Box>
      </Box>
    </Grid>
  );
}
