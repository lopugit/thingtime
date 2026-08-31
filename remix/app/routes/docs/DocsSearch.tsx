import React from 'react';
import { Badge, Box, Flex, Icon, IconButton, Input, Link as ChakraLink, Stack, Text } from '@chakra-ui/react';
import { Search, X } from 'lucide-react';
import { Link as RouterLink, useNavigate } from 'react-router';

import { docsSearchAreaColors, searchDocsIndex, tokenizeDocsQuery } from './docsSearchIndex';

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Carries the live ?q= into a result's destination so the results panel
// survives the navigation and the landed URL stays deep-linkable.
const withSearchQueryParam = (to: string, query: string) => {
  const [pathAndSearch, hash] = to.split('#');
  const [path, search] = pathAndSearch.split('?');
  const params = new URLSearchParams(search || '');

  params.set('q', query);

  return `${path}?${params.toString()}${hash ? `#${hash}` : ''}`;
};

// Wraps every query-term hit in a <mark> so results show WHY they matched.
const highlightTerms = (text: string, terms: string[]) => {
  if (terms.length === 0 || !text) {
    return text;
  }

  const pattern = new RegExp(
    `(${[...terms].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|')})`,
    'ig'
  );
  const parts = text.split(pattern);

  if (parts.length === 1) {
    return text;
  }

  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <Box
        as="mark"
        bg="var(--tt-docs-accent-soft, #d7f5df)"
        borderRadius="2px"
        color="inherit"
        key={`${part}-${index}`}
      >
        {part}
      </Box>
    ) : (
      <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>
    )
  );
};

type DocsSearchProps = {
  query: string;
  setQuery: (next: string) => void;
};

export function DocsSearch({ query, setQuery }: DocsSearchProps) {
  const navigate = useNavigate();
  const [activeIndex, setActiveIndex] = React.useState(0);

  const terms = React.useMemo(() => tokenizeDocsQuery(query), [query]);
  const results = React.useMemo(() => searchDocsIndex(query), [query]);
  const searching = terms.length > 0;

  React.useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((value) => Math.min(value + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((value) => Math.max(value - 1, 0));
    } else if (event.key === 'Enter') {
      const result = results[activeIndex];

      if (result) {
        event.preventDefault();
        navigate(withSearchQueryParam(result.doc.to, query));
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setQuery('');
    }
  };

  return (
    <Stack spacing={3}>
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
          aria-label="Search docs"
          bg="var(--tt-card, #ffffff)"
          borderColor="var(--tt-border, #ececef)"
          borderRadius="var(--tt-radius-sm, 9px)"
          data-testid="docs-search-input"
          fontSize="sm"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          pl={9}
          pr={searching ? 9 : 3}
          placeholder="Search docs"
          value={query}
        />
        {searching ? (
          <IconButton
            aria-label="Clear docs search"
            data-testid="docs-search-clear"
            icon={<Icon as={X} boxSize={3.5} />}
            onClick={() => setQuery('')}
            position="absolute"
            right={1}
            size="sm"
            top="50%"
            transform="translateY(-50%)"
            type="button"
            variant="ghost"
            zIndex={1}
          />
        ) : null}
      </Box>

      {searching ? (
        <Stack data-testid="docs-search-results" spacing={2}>
          <Flex align="center" gap={2}>
            <Text
              color="var(--tt-muted, #9a9aa6)"
              fontFamily="mono"
              fontSize="11px"
              fontWeight="600"
              letterSpacing="0.14em"
              textTransform="uppercase"
            >
              Results
            </Text>
            <Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="xs">
              {results.length}
            </Text>
          </Flex>

          <Stack spacing={0.5}>
            {results.map((result, index) => {
              const active = index === activeIndex;
              const areaColor = docsSearchAreaColors[result.doc.area];

              return (
                <ChakraLink
                  key={result.doc.id}
                  as={RouterLink}
                  _hover={{ bg: 'var(--tt-surface-hover, #ececee)', textDecoration: 'none' }}
                  bg={active ? 'var(--tt-card, #ffffff)' : 'transparent'}
                  borderLeft="3px solid"
                  borderLeftColor={active ? 'var(--tt-docs-accent, #008060)' : 'transparent'}
                  data-testid={`docs-search-result-${result.doc.id}`}
                  display="block"
                  onMouseEnter={() => setActiveIndex(index)}
                  px={3}
                  py={2}
                  to={withSearchQueryParam(result.doc.to, query)}
                  transition="background 140ms ease, border-color 140ms ease"
                >
                  <Flex align="center" gap={2} minW={0}>
                    <Badge bg={areaColor.bg} borderRadius="sm" color={areaColor.color} flexShrink={0} px={1.5}>
                      {result.doc.area}
                    </Badge>
                    <Text fontSize="sm" fontWeight={active ? '700' : '650'} isTruncated minW={0}>
                      {highlightTerms(result.doc.title, terms)}
                    </Text>
                  </Flex>
                  <Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="10px" isTruncated mt={0.5}>
                    {highlightTerms(result.doc.meta, terms)}
                  </Text>
                  <Text color="var(--tt-text, #5a5a66)" fontSize="xs" lineHeight="1.4" mt={1} noOfLines={2}>
                    {result.snippet.field === 'section' ? '§ ' : ''}
                    {highlightTerms(result.snippet.text, terms)}
                  </Text>
                </ChakraLink>
              );
            })}
            {results.length === 0 ? (
              <Text color="var(--tt-muted, #9a9aa6)" fontSize="xs" px={3} py={2}>
                No docs match “{query.trim()}”.
              </Text>
            ) : null}
          </Stack>
        </Stack>
      ) : null}
    </Stack>
  );
}
