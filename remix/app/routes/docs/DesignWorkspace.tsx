import React from 'react';
import {
  Badge,
  Box,
  Button,
  Flex,
  Icon,
  IconButton,
  Link as ChakraLink,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  Stack,
  Text,
  Tooltip
} from '@chakra-ui/react';
import {
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Info,
  Maximize2,
  Monitor,
  PanelLeftOpen,
  RotateCw,
  Smartphone,
  Tablet,
  X
} from 'lucide-react';
import { useOutletContext, useSearchParams } from 'react-router';

import type { DocsOutletContext } from './DocsLayout';
import {
  designEntries,
  designKindColors,
  getDesignEntryBySlug,
  getDesignEntryPreviewSrc
} from './designEntries';
import { PreviewFrame } from './PreviewPane';

const frameWidthPresets = [
  { key: 'full', icon: Monitor, label: 'Fill available width', width: null },
  { key: 'tablet', icon: Tablet, label: 'Tablet width · 768px', width: 768 },
  { key: 'phone', icon: Smartphone, label: 'Phone width · 390px', width: 390 }
] as const;

type FrameWidthKey = (typeof frameWidthPresets)[number]['key'];

type DesignWorkspaceProps = {
  testIdPrefix: 'design' | 'bundle';
};

export function DesignWorkspace({ testIdPrefix }: DesignWorkspaceProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const outletContext = useOutletContext<DocsOutletContext | undefined>();
  const [expandedPreview, setExpandedPreview] = React.useState(false);
  const [frameWidthKey, setFrameWidthKey] = React.useState<FrameWidthKey>('full');
  const [reloadToken, setReloadToken] = React.useState(0);

  const selectedEntry =
    getDesignEntryBySlug(searchParams.get('entry')) || designEntries[0];
  const selectedIndex = designEntries.findIndex(
    (entry) => entry.slug === selectedEntry.slug
  );
  const previewSrc = getDesignEntryPreviewSrc(selectedEntry);
  const selectedKindColor =
    designKindColors[selectedEntry.kind] || designKindColors.Direction;
  const frameWidth =
    frameWidthPresets.find((preset) => preset.key === frameWidthKey)?.width ?? null;

  React.useEffect(() => {
    if (!expandedPreview) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setExpandedPreview(false);
      }
    };

    window.addEventListener('keydown', closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [expandedPreview]);

  const selectEntry = (slug: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('entry', slug);
    setSearchParams(next);
  };

  const stepEntry = (delta: number) => {
    const nextIndex =
      (selectedIndex + delta + designEntries.length) % designEntries.length;
    selectEntry(designEntries[nextIndex].slug);
  };

  return (
    <Flex
      data-testid={`${testIdPrefix}-workspace`}
      direction="column"
      gap={3}
      h={{ base: 'calc(100vh - 202px)', md: 'calc(100vh - 210px)', lg: 'calc(100vh - 122px)' }}
      minH="460px"
      minW={0}
      sx={{
        '@supports (height: 100dvh)': {
          height: {
            base: 'calc(100dvh - 202px)',
            md: 'calc(100dvh - 210px)',
            lg: 'calc(100dvh - 122px)'
          }
        }
      }}
      w="100%"
    >
      <Flex
        align="center"
        bg="var(--tt-card, #ffffff)"
        border="1px solid"
        borderColor="var(--tt-border, #ececef)"
        borderRadius="var(--tt-radius-md, 12px)"
        boxShadow="var(--tt-shadow-card, 0 1px 2px rgba(0, 0, 0, 0.05))"
        columnGap={1}
        flexShrink={0}
        px={2}
        py={1.5}
        rowGap={1.5}
        wrap="wrap"
      >
        {outletContext && !outletContext.desktopDrawerOpen ? (
          <IconButton
            aria-label="Open docs navigation"
            data-testid={`${testIdPrefix}-workspace-open-nav`}
            display={{ base: 'none', lg: 'inline-flex' }}
            icon={<Icon as={PanelLeftOpen} boxSize={4} />}
            onClick={outletContext.openDesktopDrawer}
            size="sm"
            type="button"
            variant="ghost"
          />
        ) : null}

        <Menu autoSelect={false}>
          <MenuButton
            as={Button}
            data-testid={`${testIdPrefix}-entry-switcher`}
            maxW={{ base: '100%', sm: '360px' }}
            px={2}
            rightIcon={<Icon as={ChevronDown} boxSize={4} color="var(--tt-muted, #9a9aa6)" />}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Flex align="center" gap={2} minW={0}>
              <Badge
                bg={selectedKindColor.bg}
                borderRadius="sm"
                color={selectedKindColor.color}
                flexShrink={0}
                px={1.5}
              >
                {selectedEntry.kind}
              </Badge>
              <Text fontSize="sm" fontWeight="700" isTruncated>
                {selectedEntry.title}
              </Text>
            </Flex>
          </MenuButton>
          <MenuList maxH="60vh" overflowY="auto" zIndex={1500}>
            {designEntries.map((entry) => {
              const active = entry.slug === selectedEntry.slug;
              const entryKindColor =
                designKindColors[entry.kind] || designKindColors.Direction;

              return (
                <MenuItem
                  key={entry.slug}
                  alignItems="flex-start"
                  bg={active ? 'var(--tt-surface-alt, #f5f5f7)' : 'transparent'}
                  data-testid={`${testIdPrefix}-switch-${entry.slug}`}
                  gap={2}
                  onClick={() => selectEntry(entry.slug)}
                >
                  <Badge
                    bg={entryKindColor.bg}
                    borderRadius="sm"
                    color={entryKindColor.color}
                    flexShrink={0}
                    mt={0.5}
                    px={1.5}
                  >
                    {entry.kind}
                  </Badge>
                  <Box minW={0}>
                    <Text fontSize="sm" fontWeight={active ? '700' : '600'}>
                      {entry.title}
                    </Text>
                    <Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="xs" isTruncated>
                      {entry.slug}
                    </Text>
                  </Box>
                </MenuItem>
              );
            })}
          </MenuList>
        </Menu>

        <Flex align="center" flexShrink={0} gap={0.5}>
          <IconButton
            aria-label="Previous mockup"
            data-testid={`${testIdPrefix}-prev-entry`}
            icon={<Icon as={ChevronLeft} boxSize={4} />}
            onClick={() => stepEntry(-1)}
            size="sm"
            type="button"
            variant="ghost"
          />
          <Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="xs" whiteSpace="nowrap">
            {selectedIndex + 1} / {designEntries.length}
          </Text>
          <IconButton
            aria-label="Next mockup"
            data-testid={`${testIdPrefix}-next-entry`}
            icon={<Icon as={ChevronRight} boxSize={4} />}
            onClick={() => stepEntry(1)}
            size="sm"
            type="button"
            variant="ghost"
          />
        </Flex>

        <Text
          color="var(--tt-muted, #9a9aa6)"
          display={{ base: 'none', xl: 'block' }}
          flex="1"
          fontFamily="mono"
          fontSize="xs"
          isTruncated
          minW={0}
          px={2}
        >
          {previewSrc}
        </Text>
        <Box display={{ base: 'block', xl: 'none' }} flex="1" />

        <Popover placement="bottom-end">
          <PopoverTrigger>
            <IconButton
              aria-label={`About ${selectedEntry.title}`}
              data-testid={`${testIdPrefix}-entry-info`}
              icon={<Icon as={Info} boxSize={4} />}
              size="sm"
              type="button"
              variant="ghost"
            />
          </PopoverTrigger>
          <PopoverContent maxW="340px" zIndex={1500}>
            <PopoverArrow />
            <PopoverBody>
              <Stack fontSize="sm" spacing={2}>
                <Flex align="center" gap={2}>
                  <Badge
                    bg={selectedKindColor.bg}
                    borderRadius="sm"
                    color={selectedKindColor.color}
                    px={1.5}
                  >
                    {selectedEntry.kind}
                  </Badge>
                  <Text fontWeight="700">{selectedEntry.title}</Text>
                </Flex>
                <Text color="var(--tt-text, #5a5a66)" lineHeight="1.6">
                  {selectedEntry.summary}
                </Text>
                <Text color="var(--tt-muted, #9a9aa6)" fontSize="xs" lineHeight="1.6">
                  {selectedEntry.notes}
                </Text>
                <ChakraLink
                  color="var(--tt-docs-accent, #008060)"
                  fontFamily="mono"
                  fontSize="xs"
                  href={previewSrc}
                  isExternal
                  overflowWrap="anywhere"
                >
                  {previewSrc}
                </ChakraLink>
              </Stack>
            </PopoverBody>
          </PopoverContent>
        </Popover>

        <Flex
          align="center"
          bg="var(--tt-surface-alt, #f5f5f7)"
          borderRadius="11px"
          flexShrink={0}
          gap={0.5}
          p={0.5}
        >
          {frameWidthPresets.map((preset) => (
            <Tooltip key={preset.key} label={preset.label}>
              <IconButton
                aria-label={preset.label}
                bg={frameWidthKey === preset.key ? 'var(--tt-card, #ffffff)' : 'transparent'}
                borderRadius="var(--tt-radius-sm, 9px)"
                boxShadow={
                  frameWidthKey === preset.key
                    ? '0 0 0 1px var(--tt-border, #ececef), var(--tt-shadow-card, 0 1px 2px rgba(0, 0, 0, 0.05))'
                    : 'none'
                }
                color={frameWidthKey === preset.key ? 'var(--tt-ink, #16161a)' : 'var(--tt-muted, #9a9aa6)'}
                data-testid={`${testIdPrefix}-frame-width-${preset.key}`}
                icon={<Icon as={preset.icon} boxSize={4} />}
                onClick={() => setFrameWidthKey(preset.key)}
                size="sm"
                transition="background 140ms ease, box-shadow 140ms ease, color 140ms ease"
                type="button"
                variant="ghost"
              />
            </Tooltip>
          ))}
        </Flex>

        <Tooltip label="Reload preview">
          <IconButton
            aria-label="Reload preview"
            data-testid={`${testIdPrefix}-preview-reload`}
            icon={<Icon as={RotateCw} boxSize={4} />}
            onClick={() => setReloadToken((token) => token + 1)}
            size="sm"
            type="button"
            variant="ghost"
          />
        </Tooltip>
        <Tooltip label="Open in new tab">
          <IconButton
            as="a"
            aria-label="Open standalone preview in a new tab"
            data-testid={`${testIdPrefix}-preview-open`}
            href={previewSrc}
            icon={<Icon as={ExternalLink} boxSize={4} />}
            rel="noopener noreferrer"
            size="sm"
            target="_blank"
            variant="ghost"
          />
        </Tooltip>
        <Button
          _hover={{ bg: 'var(--tt-docs-accent-hover, #006e52)' }}
          bg="var(--tt-docs-accent, #008060)"
          borderRadius="var(--tt-radius-sm, 9px)"
          color="white"
          data-testid={`${testIdPrefix}-preview-fullscreen`}
          flexShrink={0}
          leftIcon={<Icon as={Maximize2} boxSize={3.5} />}
          onClick={() => setExpandedPreview(true)}
          size="sm"
          type="button"
        >
          Full screen
        </Button>
      </Flex>

      <Flex
        bg="var(--tt-surface-alt, #e8ecf1)"
        border="1px solid"
        borderColor="var(--tt-border, #ececef)"
        borderRadius="var(--tt-radius-lg, 16px)"
        flex="1"
        justify="center"
        minH={0}
        overflow="hidden"
        px={frameWidth ? { base: 2, md: 4 } : 0}
        py={frameWidth ? { base: 2, md: 4 } : 0}
      >
        <Box
          bg="var(--tt-card, #ffffff)"
          border={frameWidth ? '1px solid' : 'none'}
          borderColor="var(--tt-border, #ececef)"
          borderRadius={frameWidth ? 'var(--tt-radius-md, 12px)' : 'none'}
          boxShadow={frameWidth ? 'var(--tt-shadow-panel, 0 24px 60px -28px rgba(20, 20, 40, 0.28))' : 'none'}
          h="100%"
          maxW="100%"
          overflow="hidden"
          w={frameWidth ? `${frameWidth}px` : '100%'}
        >
          <PreviewFrame
            previewSrc={previewSrc}
            reloadToken={reloadToken}
            testId={`${testIdPrefix}-preview-frame`}
            title={selectedEntry.title}
          />
        </Box>
      </Flex>

      {expandedPreview ? (
        <Box
          bg="var(--tt-card, #ffffff)"
          h="100vh"
          inset={0}
          overflow="hidden"
          position="fixed"
          w="100vw"
          zIndex={12000}
        >
          <Flex
            align="center"
            bg="var(--tt-card, #ffffff)"
            borderBottom="1px solid"
            borderColor="var(--tt-border, #ececef)"
            gap={3}
            h="56px"
            left={0}
            position="absolute"
            px={{ base: 3, md: 4 }}
            right={0}
            top={0}
            zIndex={2}
          >
            <Button
              data-testid={`${testIdPrefix}-preview-close`}
              leftIcon={<Icon as={ArrowLeft} boxSize={4} />}
              onClick={() => setExpandedPreview(false)}
              size="sm"
              type="button"
              variant="outline"
            >
              Back / close preview
            </Button>
            <Text color="var(--tt-text, #5a5a66)" flex="1" fontSize="sm" fontWeight="650" isTruncated>
              {selectedEntry.title}
            </Text>
            <IconButton
              aria-label="Close full screen preview"
              icon={<Icon as={X} boxSize={5} />}
              onClick={() => setExpandedPreview(false)}
              size="sm"
              type="button"
            />
          </Flex>
          <PreviewFrame
            expanded
            previewSrc={previewSrc}
            reloadToken={reloadToken}
            testId={`${testIdPrefix}-expanded-preview-frame`}
            title={selectedEntry.title}
          />
        </Box>
      ) : null}
    </Flex>
  );
}
