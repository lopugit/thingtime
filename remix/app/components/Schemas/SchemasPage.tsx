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
  Link as ChakraLink,
  Stack,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr
} from '@chakra-ui/react';
import { ArrowRight, Check, Code2, Copy, Link2 } from 'lucide-react';
import { Link as RouterLink, useLocation } from 'react-router';

import { MigrationsPanel } from '~/components/Schemas/MigrationsPanel';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import {
  thingtimeSchemas,
  type ThingtimeSchema,
  type ThingtimeSchemaField,
  type ThingtimeSchemaKind
} from '~/schemas/registry';
import { CARD_STYLES } from '~/theme/card';

const CODE_BG = '#0b0b0f';
const CODE_BORDER = 'var(--tt-dark-border, #2a2a33)';
const CODE_TEXT = '#e6e6ec';
const CODE_MUTED = 'var(--tt-dark-muted, #8a8a95)';
const CODE_GREEN = 'var(--tt-dark-accent, #59ff9c)';
const CODE_BLUE = '#59bdff';
const CODE_YELLOW = '#ffc20e';
const CODE_ACCENT = 'var(--tt-accent, hotpink)';

type SchemaSection = {
  kind: ThingtimeSchemaKind;
  anchor: string;
  label: string;
  description: string;
};

const SECTIONS: SchemaSection[] = [
  {
    kind: 'root',
    anchor: 'root-schema',
    label: 'Root schema',
    description:
      'Every doc in the things collection follows this one shape — posts, comments, reactions, and shares alike.'
  },
  {
    kind: 'crystal',
    anchor: 'crystal-schemas',
    label: 'Crystal schemas (thingtime)',
    description:
      'Sub-schemas applied through a thing’s thingtime array. Each one’s fields live under the thing’s crystal.'
  },
  {
    kind: 'collection',
    anchor: 'collection-schemas',
    label: 'Collection schemas',
    description: 'Doc shapes for the non-thing collections — users, sessions, themes, and the rest.'
  }
];

const schemaAnchor = (schema: ThingtimeSchema) => `schema-${schema.id}`;

const fieldConstraints = (field: ThingtimeSchemaField) => {
  const bits: string[] = [];

  if (field.values?.length) {
    bits.push(`one of: ${field.values.join(', ')}`);
  }

  if (field.min !== undefined) {
    bits.push(`min ${field.min}`);
  }

  if (field.max !== undefined) {
    bits.push(`max ${field.max}${field.maxUnit ? ` ${field.maxUnit}` : ''}`);
  }

  return bits.join(' · ');
};

// Registry object fields can declare a closed child shape (e.g. post.listing);
// flatten those into dotted-path rows so the docs table documents the nesting
// the same way schema cards chip it (listing.title, listing.price, …).
const flattenDocFields = (
  fields: ThingtimeSchemaField[],
  prefix = ''
): Array<ThingtimeSchemaField & { path: string }> =>
  fields.flatMap((field) => {
    const path = prefix ? `${prefix}.${field.name}` : field.name;
    const row = { ...field, path };
    return field.children?.length ? [row, ...flattenDocFields(field.children, path)] : [row];
  });

const copyToClipboard = async (value: string) => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to the legacy path for sandboxed preview browsers.
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.left = '-9999px';
    textarea.style.opacity = '0';
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const copied = document.execCommand('copy');
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
};

function CopyValueButton({
  kind = 'link',
  label,
  size = 'sm',
  value
}: {
  kind?: 'code' | 'link';
  label: string;
  size?: 'xs' | 'sm';
  value: string;
}) {
  const [copied, setCopied] = React.useState(false);

  const copy = React.useCallback(async () => {
    const didCopy = await copyToClipboard(value);

    if (didCopy) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1100);
    }
  }, [value]);

  if (kind === 'code') {
    return (
      <IconButton
        aria-label={copied ? 'Copied' : label}
        bg="rgba(255, 255, 255, 0.08)"
        border="1px solid rgba(255, 255, 255, 0.08)"
        color={copied ? CODE_GREEN : CODE_TEXT}
        _hover={{ bg: 'rgba(255, 255, 255, 0.14)' }}
        icon={<Icon as={copied ? Check : Copy} boxSize={4} />}
        onClick={copy}
        size="sm"
        type="button"
        variant="ghost"
      />
    );
  }

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
      title={copied ? 'Copied' : label}
      type="button"
      variant="ghost"
    />
  );
}

// Minimal JSON-only highlighter — keys blue, strings green, numbers yellow,
// literals accent (same palette as the docs API CodeBlock).
const highlightJsonLine = (line: string) => {
  const pattern = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?)|\b(true|false|null)\b/g;
  const parts: React.ReactNode[] = [];
  let cursor = 0;

  for (const match of line.matchAll(pattern)) {
    const [token, str, colon, num, literal] = match;
    const index = match.index || 0;

    if (index > cursor) {
      parts.push(line.slice(cursor, index));
    }

    const color = str ? (colon ? CODE_BLUE : CODE_GREEN) : num ? CODE_YELLOW : literal ? CODE_ACCENT : CODE_TEXT;

    parts.push(
      <Box as="span" color={color} key={`${index}-${token}`}>
        {str && colon ? str : token}
      </Box>
    );

    if (str && colon) {
      parts.push(colon);
    }

    cursor = index + token.length;
  }

  if (cursor < line.length) {
    parts.push(line.slice(cursor));
  }

  return parts.length ? parts : ' ';
};

function CodeBlock({ children }: { children: string }) {
  const lines = String(children || '').split('\n');

  return (
    <Box
      bg={CODE_BG}
      border="2px solid"
      borderColor={CODE_BORDER}
      color={CODE_TEXT}
      fontFamily="var(--tt-font-mono, ui-monospace, Menlo, monospace)"
      fontSize={{ base: '12px', md: '13px' }}
      lineHeight="1.75"
      maxH="320px"
      overflow="auto"
      position="relative"
    >
      <Box position="absolute" right={2} top={2} zIndex={1}>
        <CopyValueButton kind="code" label="Copy JSON" value={children} />
      </Box>
      <Box as="pre" m={0} minW="max-content" px={{ base: 3, md: 4 }} py={4} pr={12}>
        <Box as="code" display="block">
          {lines.map((line, index) => (
            <Box
              as="span"
              display="grid"
              gap={3}
              gridTemplateColumns="3ch minmax(0, 1fr)"
              key={`${index}-${line}`}
              whiteSpace="pre"
            >
              <Box as="span" color={CODE_MUTED} textAlign="right" userSelect="none">
                {index + 1}
              </Box>
              <Box as="span">{highlightJsonLine(line)}</Box>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

function SchemaCard({ copyHref, schema }: { copyHref: string; schema: ThingtimeSchema }) {
  return (
    <Box {...CARD_STYLES} id={schemaAnchor(schema)} minW={0} p={{ base: 4, md: 5 }} scrollMarginTop="112px">
      <Flex align="flex-start" gap={4} justify="space-between" wrap="wrap">
        <Box minW={0}>
          <Flex align="center" gap={2} mb={2} wrap="wrap">
            <Badge
              bg="var(--tt-docs-accent-soft, #d7f5df)"
              borderRadius="sm"
              color="var(--tt-docs-accent-ink, #0f5132)"
              px={2}
            >
              {schema.kind}
            </Badge>
            <Badge colorScheme="blue">v{schema.version}</Badge>
            {schema.collection ? (
              <Badge colorScheme="gray" fontFamily="mono" textTransform="none">
                {schema.collection}
              </Badge>
            ) : null}
            {schema.requiresTarget ? <Badge colorScheme="orange">requires target</Badge> : null}
          </Flex>

          <Heading as="h3" fontSize={{ base: 'xl', md: '2xl' }} letterSpacing="0">
            {schema.title}
          </Heading>
          <Flex align="center" gap={1} minW={0} mt={2.5}>
            <Text
              color="var(--tt-muted, #6f6f7a)"
              fontFamily="mono"
              fontSize={{ base: '11px', md: '13px' }}
              fontWeight="700"
              overflowWrap="anywhere"
            >
              {schema.id}
            </Text>
            <CopyValueButton label={`Copy ${schema.id} schema deeplink`} size="xs" value={copyHref} />
          </Flex>
          <Text color="var(--tt-text, #5a5a66)" fontSize="sm" lineHeight="1.7" mt={2}>
            {schema.summary}
          </Text>
        </Box>
      </Flex>

      <Text color="var(--tt-text, #5a5a66)" fontSize="sm" lineHeight="1.7" mt={4}>
        {schema.detail}
      </Text>

      <Box mt={5}>
        <Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="11px" fontWeight="700" mb={2}>
          Fields
        </Text>
        {schema.fields.length ? (
          <Box
            border="1px solid"
            borderColor="var(--tt-border, #ececef)"
            borderRadius="var(--tt-radius-sm, 9px)"
            overflowX="auto"
          >
            <Table minW="640px" size="sm">
              <Thead>
                <Tr>
                  <Th>Name</Th>
                  <Th>Type</Th>
                  <Th>Required</Th>
                  <Th>Description</Th>
                </Tr>
              </Thead>
              <Tbody>
                {flattenDocFields(schema.fields).map((field) => {
                  const constraints = fieldConstraints(field);

                  return (
                    <Tr key={field.path}>
                      <Td fontFamily="mono" fontSize="xs" fontWeight="700" whiteSpace="nowrap">
                        {field.path}
                      </Td>
                      <Td color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="xs" whiteSpace="nowrap">
                        {field.type}
                      </Td>
                      <Td>
                        <Badge colorScheme={field.required ? 'green' : 'gray'}>
                          {field.required ? 'required' : 'optional'}
                        </Badge>
                      </Td>
                      <Td color="var(--tt-text, #5a5a66)" fontSize="sm" lineHeight="1.6" minW="280px">
                        {field.description}
                        {constraints ? (
                          <Text as="span" color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="xs">
                            {' '}
                            — {constraints}
                          </Text>
                        ) : null}
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          </Box>
        ) : (
          <Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="xs">
            No crystal fields — this schema’s presence in thingtime is the whole payload.
          </Text>
        )}
      </Box>

      <Box mt={5}>
        <Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="11px" fontWeight="700" mb={2}>
          Example
        </Text>
        <CodeBlock>{JSON.stringify(schema.example, null, 2)}</CodeBlock>
      </Box>
    </Box>
  );
}

export function SchemasPage() {
  const { hash } = useLocation();
  const user = useCurrentUser();
  const origin = typeof window === 'undefined' ? 'https://thingtime.com' : window.location.origin;

  const sections = React.useMemo(
    () =>
      SECTIONS.map((section) => ({
        ...section,
        schemas: thingtimeSchemas.filter((schema) => schema.kind === section.kind)
      })),
    []
  );

  React.useEffect(() => {
    if (!hash) return;

    const targetId = decodeURIComponent(hash.slice(1));

    window.requestAnimationFrame(() => {
      document.getElementById(targetId)?.scrollIntoView({ block: 'start' });
    });
  }, [hash]);

  const crystalCount = sections.find((section) => section.kind === 'crystal')?.schemas.length || 0;
  const collectionCount = sections.find((section) => section.kind === 'collection')?.schemas.length || 0;

  return (
    <Grid columnGap={8} rowGap={8} templateColumns={{ base: '1fr', '2xl': 'minmax(0, 1fr) 280px' }}>
      <Stack minW={0} spacing={8}>
        <Box borderBottom="1px solid" borderColor="var(--tt-border, #ececef)" pb={8}>
          <Flex align="center" gap={2} mb={4} wrap="wrap">
            <Badge
              bg="var(--tt-docs-accent-soft, #d7f5df)"
              borderRadius="sm"
              color="var(--tt-docs-accent-ink, #0f5132)"
              px={2}
            >
              Schemas
            </Badge>
            <Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="sm">
              /schemas
            </Text>
          </Flex>

          <Heading
            as="h2"
            color="var(--tt-ink, #16161a)"
            fontSize={{ base: '3xl', md: '5xl' }}
            letterSpacing="-0.02em"
            lineHeight="1.02"
            maxW="840px"
          >
            Thingtime Schemas
          </Heading>
          <Text color="var(--tt-text, #5a5a66)" fontSize={{ base: 'md', md: 'lg' }} lineHeight="1.7" maxW="840px" mt={5}>
            Everything is a thing. One root Thing schema shapes every doc in the things collection, sub-schemas are
            applied through the thingtime array, and each sub-schema’s payload lives under crystal.
          </Text>
        </Box>

        <Flex gap={2} wrap="wrap">
          <Badge colorScheme="green">{thingtimeSchemas.length} schemas</Badge>
          <Badge colorScheme="gray">{crystalCount} thingtime kinds</Badge>
          <Badge colorScheme="gray">{collectionCount} collections</Badge>
        </Flex>

        {sections.map((section) => (
          <Box as="section" id={section.anchor} key={section.kind} minW={0} scrollMarginTop="112px">
            <Flex align="center" gap={2} mb={2} wrap="wrap">
              <Text
                color="var(--tt-muted, #9a9aa6)"
                fontFamily="mono"
                fontSize="11px"
                fontWeight="700"
                letterSpacing="0.14em"
                textTransform="uppercase"
              >
                {section.label}
              </Text>
              <Badge colorScheme="green">{section.schemas.length}</Badge>
            </Flex>
            <Text color="var(--tt-text, #5a5a66)" fontSize="sm" lineHeight="1.7" maxW="760px" mb={4}>
              {section.description}
            </Text>

            <Stack spacing={5}>
              {section.schemas.map((schema) => (
                <SchemaCard copyHref={`${origin}/schemas#${schemaAnchor(schema)}`} key={schema.id} schema={schema} />
              ))}
            </Stack>
          </Box>
        ))}

        <Box {...CARD_STYLES} id="schemas-json-api" p={5} scrollMarginTop="112px">
          <Flex align="center" gap={3} mb={3}>
            <Icon as={Code2} boxSize={5} color="var(--tt-docs-accent, #008060)" />
            <Heading as="h3" fontSize="lg">
              JSON API
            </Heading>
          </Flex>
          <Text color="var(--tt-text, #5a5a66)" fontSize="sm" lineHeight="1.6" mb={3}>
            This registry is served as JSON too — fetch every schema, or a single one with ?id=&lt;schemaId&gt;.
          </Text>
          <Flex align="center" gap={1} wrap="wrap">
            <Text fontFamily="mono" fontSize="sm" overflowWrap="anywhere">
              GET /api/v1/schemas
            </Text>
            <CopyValueButton label="Copy schemas API URL" size="xs" value={`${origin}/api/v1/schemas`} />
          </Flex>
          <Button
            as={RouterLink}
            mt={4}
            rightIcon={<Icon as={ArrowRight} boxSize={4} />}
            size="sm"
            to="/docs/api"
            variant="outline"
          >
            API reference
          </Button>
        </Box>

        {user?.isAdmin ? <MigrationsPanel /> : null}
      </Stack>

      <Box
        as="aside"
        borderColor="var(--tt-border, #ececef)"
        borderLeft="1px solid"
        display={{ base: 'none', '2xl': 'block' }}
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
          <Stack fontSize="sm" maxH="calc(100vh - 160px)" overflowY="auto" pr={2} spacing={4}>
            {sections.map((section) => (
              <Box key={section.kind}>
                <ChakraLink
                  color="var(--tt-muted, #9a9aa6)"
                  fontFamily="mono"
                  fontSize="10px"
                  fontWeight="700"
                  href={`#${section.anchor}`}
                  letterSpacing="0.14em"
                  textTransform="uppercase"
                  _hover={{ color: 'var(--tt-ink, #16161a)', textDecoration: 'none' }}
                >
                  {section.label}
                </ChakraLink>
                <Stack mt={1.5} spacing={2}>
                  {section.schemas.map((schema) => (
                    <ChakraLink color="var(--tt-text, #5a5a66)" href={`#${schemaAnchor(schema)}`} key={schema.id}>
                      <Text fontWeight="650">{schema.title}</Text>
                      <Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="xs" overflowWrap="anywhere">
                        {schema.id}
                      </Text>
                    </ChakraLink>
                  ))}
                </Stack>
              </Box>
            ))}
            <ChakraLink color="var(--tt-text, #5a5a66)" href="#schemas-json-api">
              <Text fontWeight="650">JSON API</Text>
            </ChakraLink>
            {user?.isAdmin ? (
              <ChakraLink color="var(--tt-text, #5a5a66)" href="#database-migrations">
                <Text fontWeight="650">Database migrations</Text>
              </ChakraLink>
            ) : null}
          </Stack>
        </Box>
      </Box>
    </Grid>
  );
}
