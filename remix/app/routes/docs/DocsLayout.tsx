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
import { BookOpen, Boxes, ChevronRight, GripVertical, Menu, PanelLeftClose, PanelLeftOpen, Search, X } from 'lucide-react';
import { Link as RouterLink, Outlet, useLocation, useSearchParams } from 'react-router';

import { designEntries, designKindColors, getDesignEntryBySlug } from './designEntries';

const docsNav = [
  {
    label: 'Overview',
    to: '/docs',
    icon: BookOpen,
    description: 'Docs home'
  },
  {
    label: 'Design mockups',
    to: '/docs/design',
    icon: Boxes,
    description: 'Standalone previews'
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

const isDesignPath = (pathname: string) => pathname.startsWith('/docs/design');

const clampDrawerWidth = (width: number) =>
  Math.min(MAX_DRAWER_WIDTH, Math.max(MIN_DRAWER_WIDTH, width));

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
        <Text color="gray.500" fontSize="xs" fontWeight="700" textTransform="uppercase">
          Mockups
        </Text>
        <Text color="gray.500" fontFamily="mono" fontSize="xs">
          {designEntries.length}
        </Text>
      </Flex>

      <Box position="relative">
        <Icon
          as={Search}
          boxSize={4}
          color="gray.400"
          left={3}
          position="absolute"
          top="50%"
          transform="translateY(-50%)"
          zIndex={1}
        />
        <Input
          bg="white"
          borderColor="blackAlpha.200"
          borderRadius="md"
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
              _hover={{ bg: active ? 'white' : 'blackAlpha.50' }}
              as="button"
              bg={active ? 'white' : 'transparent'}
              borderLeft="3px solid"
              borderLeftColor={active ? '#008060' : 'transparent'}
              cursor="pointer"
              data-testid={`design-entry-${entry.slug}`}
              onClick={() => selectEntry(entry.slug)}
              px={3}
              py={2}
              textAlign="left"
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
              <Text color="gray.500" fontFamily="mono" fontSize="xs" isTruncated mt={0.5}>
                {entry.slug}
              </Text>
            </Box>
          );
        })}
        {filteredEntries.length === 0 ? (
          <Text color="gray.500" fontSize="xs" px={3} py={2}>
            No mockups match “{query}”.
          </Text>
        ) : null}
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
  return (
    <Stack spacing={6} minH="100%" p={{ base: 5, lg: 0 }}>
      <Flex align="center" gap={3} justify="space-between">
        <Box minW={0}>
          <Flex align="center" gap={2} mb={2}>
            <Text fontSize="xs" fontWeight="700" letterSpacing="0" textTransform="uppercase" color="gray.500">
              Thingtime
            </Text>
            <Badge bg="#d7f5df" color="#0f5132" borderRadius="sm" px={2}>
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

          return (
            <ChakraLink
              key={item.to}
              as={RouterLink}
              to={item.to}
              _hover={{ textDecoration: 'none', bg: 'blackAlpha.50' }}
              bg={active ? 'white' : 'transparent'}
              borderLeft="3px solid"
              borderColor={active ? '#008060' : 'transparent'}
              color={active ? '#111827' : 'gray.700'}
              display="block"
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
                  <Text fontSize="xs" color="gray.500" lineHeight="1.25">
                    {item.description}
                  </Text>
                </Box>
                <Icon as={ChevronRight} boxSize={3.5} ml="auto" opacity={active ? 1 : 0.25} />
              </Flex>
            </ChakraLink>
          );
        })}
      </Stack>

      {isDesignPath(pathname) ? <DrawerDesignEntryList onNavigate={onClose} /> : null}
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
      bg="#f7f7f5"
      color="#1f2933"
      minH="100vh"
      overflowX="hidden"
      pb={{ base: '96px', lg: 0 }}
      pt={{ base: '88px', md: '96px' }}
      w="100%"
    >
      <Grid
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
            borderColor="blackAlpha.200"
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
        bg="#f7f7f5"
        bottom={0}
        boxShadow="0 20px 80px rgba(15, 23, 42, 0.22)"
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
        bg="white"
        border="1px solid"
        borderColor="blackAlpha.200"
        borderRadius="999px"
        bottom="max(14px, env(safe-area-inset-bottom))"
        boxShadow="0 16px 48px rgba(15, 23, 42, 0.16)"
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
              bg={active ? '#111827' : 'transparent'}
              borderRadius="999px"
              color={active ? 'white' : 'gray.700'}
              flexShrink={0}
              fontSize="xs"
              fontWeight="700"
              px={2.5}
              py={2}
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
