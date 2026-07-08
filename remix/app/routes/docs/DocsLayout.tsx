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
  Stack,
  Text
} from '@chakra-ui/react';
import { BookOpen, Boxes, ChevronDown, ChevronRight, Component, GripVertical, Menu, PanelLeftClose, PanelLeftOpen, Search, ServerCog, X } from 'lucide-react';
import { Link as RouterLink, Outlet, useLocation, useSearchParams } from 'react-router';

import { apiEndpointDocs, type ApiEndpointDoc } from '~/docs/apiDocs';

import { designEntries, designKindColors, getDesignEntryBySlug } from './designEntries';
import { designSystemEntries, designSystemStatusColors, getDesignSystemEntryBySlug } from './design-system/entries';

const docsNav = [
  {
    label: 'Overview',
    to: '/docs',
    icon: BookOpen,
    description: 'Docs home'
  },
  {
    label: 'API reference',
    to: '/docs/api',
    icon: ServerCog,
    description: 'Endpoint docs'
  },
  {
    label: 'Design mockups',
    to: '/docs/design',
    icon: Boxes,
    description: 'Standalone previews'
  },
  {
    label: 'Design system',
    to: '/docs/design-system',
    icon: Component,
    description: 'Component library'
  }
];

const DEFAULT_DRAWER_WIDTH = 280;
const MIN_DRAWER_WIDTH = 220;
const MAX_DRAWER_WIDTH = 420;

export type DocsOutletContext = {
  desktopDrawerOpen: boolean;
  openDesktopDrawer: () => void;
};

const isActivePath = (pathname: string, to: string) => {
  if (to === '/docs') {
    return pathname === '/docs';
  }

  return pathname === to || pathname.startsWith(`${to}/`);
};

const isDesignPath = (pathname: string) =>
  pathname === '/docs/design' || pathname.startsWith('/docs/design/');

const isDesignSystemPath = (pathname: string) =>
  pathname === '/docs/design-system' || pathname.startsWith('/docs/design-system/');

const isApiPath = (pathname: string) =>
  pathname === '/docs/api' || pathname.startsWith('/docs/api/');

const clampDrawerWidth = (width: number) =>
  Math.min(MAX_DRAWER_WIDTH, Math.max(MIN_DRAWER_WIDTH, width));

const groupLabel = (group: string) => group.charAt(0).toUpperCase() + group.slice(1);
const apiGroupPath = (group: string) => `/docs/api/${group}`;
const apiDocPath = (doc: ApiEndpointDoc) => `${apiGroupPath(doc.group)}/${doc.id}`;

const groupedApiDocs = apiEndpointDocs.reduce<Array<{ group: string; docs: ApiEndpointDoc[] }>>(
  (groups, doc) => {
    const existing = groups.find((item) => item.group === doc.group);

    if (existing) {
      existing.docs.push(doc);
    } else {
      groups.push({ group: doc.group, docs: [doc] });
    }

    return groups;
  },
  []
);

type DrawerDesignEntryListProps = {
  onNavigate?: () => void;
};

function DrawerDesignEntryList({ onNavigate }: DrawerDesignEntryListProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = React.useState('');
  const selectedEntry =
    getDesignEntryBySlug(searchParams.get('entry')) || designEntries[0];

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
    onNavigate?.();
  };

  return (
    <Stack minH={0} spacing={3}>
      <Flex align="center" gap={2}>
        <Text
          color="var(--tt-muted, #9a9aa6)"
          fontFamily="mono"
          fontSize="11px"
          fontWeight="600"
          letterSpacing="0.14em"
          textTransform="uppercase"
        >
          Mockups
        </Text>
        <Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="xs">
          {designEntries.length}
        </Text>
      </Flex>

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
          bg="var(--tt-card, #ffffff)"
          borderColor="var(--tt-border, #ececef)"
          borderRadius="var(--tt-radius-sm, 9px)"
          data-testid="design-filter-input"
          fontSize="sm"
          onChange={(event) => setQuery(event.target.value)}
          pl={9}
          placeholder="Filter mockups"
          value={query}
        />
      </Box>

      <Stack spacing={0.5}>
        {filteredEntries.map((entry) => {
          const active = entry.slug === selectedEntry.slug;
          const kindColor = designKindColors[entry.kind] || designKindColors.Direction;

          return (
            <Box
              key={entry.slug}
              _hover={{ bg: active ? 'var(--tt-card, #ffffff)' : 'var(--tt-surface-hover, #ececee)' }}
              as="button"
              bg={active ? 'var(--tt-card, #ffffff)' : 'transparent'}
              borderLeft="3px solid"
              borderLeftColor={active ? 'var(--tt-docs-accent, #008060)' : 'transparent'}
              cursor="pointer"
              data-testid={`design-entry-${entry.slug}`}
              onClick={() => selectEntry(entry.slug)}
              px={3}
              py={2}
              textAlign="left"
              transition="background 140ms ease, border-color 140ms ease"
              type="button"
              w="100%"
            >
              <Flex align="center" gap={2} minW={0}>
                <Badge
                  bg={kindColor.bg}
                  borderRadius="sm"
                  color={kindColor.color}
                  flexShrink={0}
                  px={1.5}
                >
                  {entry.kind}
                </Badge>
                <Text fontSize="sm" fontWeight={active ? '700' : '600'} isTruncated minW={0}>
                  {entry.title}
                </Text>
              </Flex>
              <Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="xs" isTruncated mt={0.5}>
                {entry.slug}
              </Text>
            </Box>
          );
        })}
        {filteredEntries.length === 0 ? (
          <Text color="var(--tt-muted, #9a9aa6)" fontSize="xs" px={3} py={2}>
            No mockups match “{query}”.
          </Text>
        ) : null}
      </Stack>
    </Stack>
  );
}

type DrawerApiEndpointListProps = {
  onNavigate?: () => void;
};

function DrawerApiEndpointList({ onNavigate }: DrawerApiEndpointListProps) {
  const location = useLocation();
  const activeHash = location.hash.replace(/^#/, '');
  const activePathname = location.pathname;

  return (
    <Stack data-testid="docs-api-endpoint-menu" spacing={4} pl={4}>
      {groupedApiDocs.map((group) => (
        <Box key={group.group}>
          <Flex align="center" gap={2} mb={1.5}>
            <ChakraLink
              as={RouterLink}
              color="var(--tt-muted, #9a9aa6)"
              fontFamily="mono"
              fontSize="10px"
              fontWeight="700"
              letterSpacing="0.14em"
              onClick={onNavigate}
              to={apiGroupPath(group.group)}
              textTransform="uppercase"
              _hover={{ color: 'var(--tt-ink, #16161a)', textDecoration: 'none' }}
            >
              {groupLabel(group.group)}
            </ChakraLink>
            <Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="10px">
              {group.docs.length}
            </Text>
          </Flex>

          <Stack spacing={0.5}>
            {group.docs.map((doc) => {
              const hash = `api-${doc.id}`;
              const docPath = apiDocPath(doc);
              const active = activeHash === hash || activePathname === docPath;

              return (
                <ChakraLink
                  key={doc.id}
                  as={RouterLink}
                  _hover={{ bg: 'var(--tt-surface-hover, #ececee)', textDecoration: 'none' }}
                  bg={active ? 'var(--tt-card, #ffffff)' : 'transparent'}
                  borderLeft="2px solid"
                  borderLeftColor={active ? 'var(--tt-docs-accent, #008060)' : 'transparent'}
                  color={active ? 'var(--tt-ink, #16161a)' : 'var(--tt-text, #5a5a66)'}
                  display="block"
                  onClick={onNavigate}
                  px={2}
                  py={1.5}
                  to={docPath}
                  transition="background 140ms ease, border-color 140ms ease, color 140ms ease"
                >
                  <Text fontSize="xs" fontWeight={active ? '750' : '650'} isTruncated lineHeight="1.25">
                    {doc.title}
                  </Text>
                  <Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="10px" isTruncated mt={0.5}>
                    {doc.endpoint}
                  </Text>
                </ChakraLink>
              );
            })}
          </Stack>
        </Box>
      ))}
    </Stack>
  );
}

type DrawerDesignSystemListProps = {
  onNavigate?: () => void;
};

function DrawerDesignSystemList({ onNavigate }: DrawerDesignSystemListProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedEntry =
    getDesignSystemEntryBySlug(searchParams.get('component')) || designSystemEntries[0];

  const selectEntry = (slug: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('component', slug);
    setSearchParams(next);
    onNavigate?.();
  };

  return (
    <Stack minH={0} spacing={3}>
      <Flex align="center" gap={2}>
        <Text
          color="var(--tt-muted, #9a9aa6)"
          fontFamily="mono"
          fontSize="11px"
          fontWeight="600"
          letterSpacing="0.14em"
          textTransform="uppercase"
        >
          Components
        </Text>
        <Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="xs">
          {designSystemEntries.length}
        </Text>
      </Flex>

      <Stack spacing={0.5}>
        {designSystemEntries.map((entry) => {
          const active = entry.slug === selectedEntry.slug;
          const statusColor = designSystemStatusColors[entry.status];

          return (
            <Box
              key={entry.slug}
              _hover={{ bg: active ? 'var(--tt-card, #ffffff)' : 'var(--tt-surface-hover, #ececee)' }}
              as="button"
              bg={active ? 'var(--tt-card, #ffffff)' : 'transparent'}
              borderLeft="3px solid"
              borderLeftColor={active ? 'var(--tt-docs-accent, #008060)' : 'transparent'}
              cursor="pointer"
              data-testid={`design-system-entry-${entry.slug}`}
              onClick={() => selectEntry(entry.slug)}
              px={3}
              py={2}
              textAlign="left"
              transition="background 140ms ease, border-color 140ms ease"
              type="button"
              w="100%"
            >
              <Flex align="center" gap={2} minW={0}>
                <Badge
                  bg={statusColor.bg}
                  borderRadius="sm"
                  color={statusColor.color}
                  flexShrink={0}
                  px={1.5}
                >
                  {entry.status}
                </Badge>
                <Text fontSize="sm" fontWeight={active ? '700' : '600'} isTruncated minW={0}>
                  {entry.title}
                </Text>
              </Flex>
              <Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="xs" isTruncated mt={0.5}>
                {entry.slug}
              </Text>
            </Box>
          );
        })}
      </Stack>
    </Stack>
  );
}

type DocsDrawerContentProps = {
  closeTestId?: string;
  onClose?: () => void;
  pathname: string;
  showClose?: boolean;
};

function DocsDrawerContent({ closeTestId, onClose, pathname, showClose = false }: DocsDrawerContentProps) {
  const [apiOpen, setApiOpen] = React.useState(isApiPath(pathname));

  React.useEffect(() => {
    if (isApiPath(pathname)) {
      setApiOpen(true);
    }
  }, [pathname]);

  return (
    <Stack spacing={6} minH="100%" p={{ base: 5, lg: 0 }}>
      <Flex align="center" gap={3} justify="space-between">
        <Box minW={0}>
          <Flex align="center" gap={2} mb={2}>
            <Text
              color="var(--tt-muted, #9a9aa6)"
              fontFamily="mono"
              fontSize="11px"
              fontWeight="600"
              letterSpacing="0.14em"
              textTransform="uppercase"
            >
              Thingtime
            </Text>
            <Badge
              bg="var(--tt-docs-accent-soft, #d7f5df)"
              borderRadius="sm"
              color="var(--tt-docs-accent-ink, #0f5132)"
              px={2}
            >
              Docs
            </Badge>
          </Flex>

          <Heading as="h1" fontSize="lg" lineHeight="1.2">
            API-style reference
          </Heading>
        </Box>

        {showClose ? (
          <IconButton
            aria-label="Close docs navigation"
            data-testid={closeTestId}
            icon={<Icon as={X} boxSize={5} />}
            onClick={onClose}
            size="md"
            type="button"
            variant="ghost"
          />
        ) : null}
      </Flex>

      <Stack spacing={1}>
        {docsNav.map((item) => {
          const active = isActivePath(pathname, item.to);
          const isApiItem = item.to === '/docs/api';
          const expanded = isApiItem && apiOpen;

          return (
            <Box key={item.to}>
              <Flex
                _hover={{ bg: 'var(--tt-surface-hover, #ececee)' }}
                bg={active ? 'var(--tt-card, #ffffff)' : 'transparent'}
                borderLeft="3px solid"
                borderColor={active ? 'var(--tt-docs-accent, #008060)' : 'transparent'}
                color={active ? 'var(--tt-ink, #16161a)' : 'var(--tt-text, #5a5a66)'}
                transition="background 140ms ease, color 140ms ease"
              >
                <ChakraLink
                  as={RouterLink}
                  to={item.to}
                  _hover={{ textDecoration: 'none' }}
                  display="block"
                  flex="1"
                  minW={0}
                  onClick={onClose}
                  px={3}
                  py={2.5}
                >
                  <Flex align="center" gap={3} minW={0}>
                    <Icon as={item.icon} boxSize={4} flexShrink={0} />
                    <Box minW={0}>
                      <Text fontSize="sm" fontWeight="650" lineHeight="1.25">
                        {item.label}
                      </Text>
                      <Text fontSize="xs" color="var(--tt-muted, #9a9aa6)" lineHeight="1.25">
                        {item.description}
                      </Text>
                    </Box>
                  </Flex>
                </ChakraLink>
                <IconButton
                  aria-expanded={expanded}
                  aria-label={expanded ? `Collapse ${item.label} endpoints` : `Expand ${item.label} endpoints`}
                  display={isApiItem ? 'inline-flex' : 'none'}
                  icon={<Icon as={expanded ? ChevronDown : ChevronRight} boxSize={3.5} />}
                  onClick={() => setApiOpen((value) => !value)}
                  size="sm"
                  type="button"
                  variant="ghost"
                />
                {!isApiItem ? <Icon as={ChevronRight} boxSize={3.5} mr={3} mt={3} opacity={active ? 1 : 0.25} /> : null}
              </Flex>
              {expanded ? (
                <Box borderLeft="1px solid" borderColor="var(--tt-border, #ececef)" ml={5} mt={3} pb={2}>
                  <DrawerApiEndpointList onNavigate={onClose} />
                </Box>
              ) : null}
            </Box>
          );
        })}
      </Stack>

      {isDesignPath(pathname) ? <DrawerDesignEntryList onNavigate={onClose} /> : null}
      {isDesignSystemPath(pathname) ? <DrawerDesignSystemList onNavigate={onClose} /> : null}
    </Stack>
  );
}

export default function DocsLayout() {
  const { pathname } = useLocation();
  const designRoute = isDesignPath(pathname);
  const [drawerWidth, setDrawerWidth] = React.useState(DEFAULT_DRAWER_WIDTH);
  const [desktopDrawerOpen, setDesktopDrawerOpen] = React.useState(true);
  const [mobileDrawerOpen, setMobileDrawerOpen] = React.useState(false);

  const openDesktopDrawer = React.useCallback(() => setDesktopDrawerOpen(true), []);
  const outletContext = React.useMemo<DocsOutletContext>(
    () => ({ desktopDrawerOpen, openDesktopDrawer }),
    [desktopDrawerOpen, openDesktopDrawer]
  );

  React.useEffect(() => {
    setMobileDrawerOpen(false);
    window.scrollTo({ left: 0, top: 0 });
  }, [pathname]);

  const startDrawerResize = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();

      const startX = event.clientX;
      const startWidth = drawerWidth;

      const handlePointerMove = (moveEvent: PointerEvent) => {
        setDrawerWidth(clampDrawerWidth(startWidth + moveEvent.clientX - startX));
      };

      const stopResize = () => {
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', stopResize);
      };

      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', stopResize);
    },
    [drawerWidth]
  );

  return (
    <Box
      bg="var(--tt-surface, #f7f7f5)"
      color="var(--tt-ink, #1f2933)"
      minH="100vh"
      overflowX="hidden"
      pb={{ base: '96px', lg: 0 }}
      pt={{ base: '88px', md: '96px' }}
      w="100%"
    >
      <Grid
        boxSizing="border-box"
        templateColumns={{
          base: 'minmax(0, 1fr)',
          lg: desktopDrawerOpen ? `${drawerWidth}px minmax(0, 1fr)` : 'minmax(0, 1fr)'
        }}
        columnGap={{ base: 0, lg: desktopDrawerOpen ? 8 : 0 }}
        maxW={designRoute ? '100%' : '1680px'}
        mx="auto"
        px={{ base: 4, md: 6, xl: 8 }}
        pb={designRoute ? { base: 4, lg: 6 } : 16}
        w="100%"
      >
        {desktopDrawerOpen ? (
          <Box
            as="aside"
            borderRight="1px solid"
            borderColor="var(--tt-border, #ececef)"
            display={{ base: 'none', lg: 'block' }}
            minW={0}
            pb={0}
            position="relative"
            pr={6}
            w={`${drawerWidth}px`}
          >
            <Box maxH="calc(100vh - 112px)" overflowY="auto" position="sticky" pr={2} top="96px">
              <Flex justify="flex-end" mb={3}>
                <IconButton
                  aria-label="Collapse docs navigation"
                  icon={<Icon as={PanelLeftClose} boxSize={4} />}
                  onClick={() => setDesktopDrawerOpen(false)}
                  size="sm"
                  type="button"
                  variant="ghost"
                />
              </Flex>
              <DocsDrawerContent pathname={pathname} />
            </Box>

            <Box
              alignItems="center"
              bottom={0}
              display="flex"
              justifyContent="center"
              position="absolute"
              right="-12px"
              top={0}
              w="24px"
            >
              <IconButton
                aria-label="Resize docs navigation"
                cursor="col-resize"
                h="64px"
                icon={<Icon as={GripVertical} boxSize={4} />}
                minW="24px"
                onPointerDown={startDrawerResize}
                size="xs"
                type="button"
                variant="ghost"
              />
            </Box>
          </Box>
        ) : null}

        <Box as="main" minW={0}>
          {!desktopDrawerOpen && !designRoute ? (
            <Flex display={{ base: 'none', lg: 'flex' }} justify="flex-start" mb={4}>
              <IconButton
                aria-label="Open docs navigation"
                icon={<Icon as={PanelLeftOpen} boxSize={4} />}
                onClick={openDesktopDrawer}
                size="sm"
                type="button"
                variant="outline"
              />
            </Flex>
          ) : null}
          <Outlet context={outletContext} />
        </Box>
      </Grid>

      <Box
        as="aside"
        bg="var(--tt-surface, #f7f7f5)"
        bottom={0}
        boxShadow="var(--tt-shadow-panel, 0 24px 60px -28px rgba(20, 20, 40, 0.28))"
        data-testid="docs-mobile-drawer"
        display={{ base: mobileDrawerOpen ? 'block' : 'none', lg: 'none' }}
        left={0}
        overflowY="auto"
        position="fixed"
        top={0}
        w="100vw"
        zIndex={11000}
      >
        <DocsDrawerContent
          closeTestId="docs-mobile-drawer-close"
          onClose={() => setMobileDrawerOpen(false)}
          pathname={pathname}
          showClose
        />
      </Box>

      <Flex
        align="center"
        bg="var(--tt-card, #ffffff)"
        border="1px solid"
        borderColor="var(--tt-border, #ececef)"
        borderRadius="999px"
        bottom="max(14px, env(safe-area-inset-bottom))"
        boxShadow="var(--tt-shadow-popover, 0 16px 40px -12px rgba(20, 20, 40, 0.3))"
        display={{ base: 'flex', lg: 'none' }}
        gap={1}
        left={3}
        maxW="calc(100vw - 96px)"
        overflowX="auto"
        p={1}
        position="fixed"
        zIndex={1300}
      >
        <Button
          borderRadius="999px"
          data-testid="docs-mobile-menu"
          flexShrink={0}
          leftIcon={<Icon as={Menu} boxSize={4} />}
          onClick={() => setMobileDrawerOpen(true)}
          size="sm"
          type="button"
          variant="ghost"
        >
          Menu
        </Button>
        {docsNav.map((item) => {
          const active = isActivePath(pathname, item.to);

          return (
            <ChakraLink
              key={item.to}
              as={RouterLink}
              to={item.to}
              _hover={{ textDecoration: 'none' }}
              bg={active ? 'var(--tt-ink, #111827)' : 'transparent'}
              borderRadius="999px"
              color={active ? 'white' : 'var(--tt-text, #5a5a66)'}
              flexShrink={0}
              fontSize="xs"
              fontWeight="700"
              px={2.5}
              py={2}
              transition="background 140ms ease, color 140ms ease"
              whiteSpace="nowrap"
            >
              {item.label}
            </ChakraLink>
          );
        })}
      </Flex>
    </Box>
  );
}
