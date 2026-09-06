import React from 'react';
import {
  Badge,
  Box,
  Button,
  Center,
  Flex,
  Grid,
  Input,
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  Select,
  Switch,
  Text,
  Textarea
} from '@chakra-ui/react';
import { BookOpen, Braces, Columns3, LayoutGrid, Library, Plus, Rows3, Save, Search, SlidersHorizontal, Sparkles } from 'lucide-react';
import { Link, useNavigate } from 'react-router';

import { Rainbow } from '~/components/Rainbow/Rainbow';
import { ChakraThingRenderer, HtmlThingRenderer, isChakraThingNode } from '~/components/Kinds';
import type { ChakraThingNode, HtmlThingNode } from '~/components/Kinds';
import { isSafeCssText } from '~/components/Kinds/safeUrl';
import { EmojiPicker } from '~/components/Emoji/EmojiPicker';
import { useOutsideTapClose } from '~/hooks/useOutsideTapClose';
import { useRecentReactions } from '~/components/Emoji/useRecentReactions';
import { timeAgo } from '~/components/Feed/feedTypes';
import { useLopu } from '~/components/Lopu/useLopu';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { ACL_OWNER, getThingtimeSchema } from '~/schemas/registry';
import type { SchemaThingField } from '~/schemas/registry';
import { describeSchemaField } from '~/schemas/tools';
import { getUserDisplayName, getUserIdentityDetail } from '~/utils/userIdentity';

import {
  COMPONENT_LIBRARY_LABELS,
  collapseEntriesByFamily,
  deepLinkKeyFor,
  entryToCardSource,
  isAttributionTag,
  type BrowseComponentEntry,
  type BrowseComponentsResponse,
  type ComponentCardSource,
  type ComponentDesignRef
} from './componentBrowseTypes';
import {
  coerceArgValue,
  defaultsFromArgs,
  resolveTemplate,
  type ComponentArgSpec,
  type ComponentArgValues
} from './componentTemplate';

// /components — the UI-first sibling of /schemas. Cards render their
// component from the stored template, args are editable in place, the
// underlying schema hides behind a quiet expander, and "Save version" stores
// the current tester state as a standalone component thing in your Things.
//
// Browse cards stay INERT (claude-todo/20: the grid never arms a control):
// the preview is a plain render with no click wrapper, and the card is a
// LINK — title and preview open the component's dedicated page
// (/components/:key), where the live pane runs under the trust ladder.

const cacheKeyFor = (userId: string | null | undefined) => (userId ? `tt-components-${userId}` : null);
const PAGE_SIZE = 20;

type ViewMode = 'feed' | 'grid' | 'columns';
type SortMode = 'newest' | 'popular' | 'oldest';
type ScopeMode = 'all' | 'mine' | 'library';

const LIB_FILTERS = ['all', 'antd', 'bootstrap', 'mui', 'shadcn', 'untitled', 'daisyui', 'reactflow', 'thingtime'] as const;
type LibFilter = (typeof LIB_FILTERS)[number];

type CachedComponents = {
  q: string;
  sort: SortMode;
  view: ViewMode;
  scope: ScopeMode;
  lib: LibFilter;
  entries: BrowseComponentEntry[];
  nextCursor: string | null;
  total: number | null;
  totalCapped: boolean;
};

const pillProps = (active: boolean) =>
  ({
    background: active ? 'var(--tt-ink, #16161a)' : 'var(--tt-card, #ffffff)',
    border: '1px solid var(--tt-border, #ececef)',
    borderRadius: 'full',
    color: active ? 'var(--tt-card, #ffffff)' : 'var(--tt-text, #33333c)',
    fontSize: '12px',
    fontWeight: 600,
    height: '28px',
    paddingX: 3,
    _hover: { background: active ? 'var(--tt-ink, #16161a)' : 'var(--tt-surface-hover, #ececee)' }
  }) as const;

const monoLabel = {
  color: 'var(--tt-muted, #9a9aa6)',
  fontFamily: 'var(--tt-font-mono, monospace)',
  fontSize: '11px',
  letterSpacing: '0.08em',
  textTransform: 'uppercase' as const
};

const systemThingFields = () =>
  ((getThingtimeSchema('thing')?.fields || []) as unknown as SchemaThingField[]).filter(
    (field) => (field as { system?: boolean }).system
  );

const ShapeChip = ({ children, dim }: { children: React.ReactNode; dim?: boolean }) => (
  <Flex
    align="center"
    background="var(--tt-surface-alt, #f5f5f7)"
    borderRadius="var(--tt-radius-xs, 7px)"
    gap={1.5}
    opacity={dim ? 0.66 : 1}
    paddingX={2}
    paddingY={0.5}
  >
    <Text color="var(--tt-ink, #16161a)" fontFamily="var(--tt-font-mono, monospace)" fontSize="11px">
      {children}
    </Text>
  </Flex>
);

// ---------------------------------------------------------------------------
// Card preview: template resolved against the tester args, drawn only through
// the sanitising allowlist renderers. NOT armed — no onClickCapture, ever: a
// browse card is not a trusted surface, the dedicated page is.

const ComponentPreview = ({ source, values }: { source: ComponentCardSource; values: ComponentArgValues }) => {
  const resolved = React.useMemo(() => resolveTemplate(source.render, values), [source.render, values]);
  const background =
    source.previewBg && isSafeCssText(source.previewBg) ? source.previewBg : 'var(--tt-surface, #fafafb)';
  return (
    <Center
      background={background}
      border="1px solid var(--tt-border, #ececef)"
      borderRadius="var(--tt-radius-md, 12px)"
      minHeight="96px"
      overflow="hidden"
      padding={4}
    >
      <Box maxWidth="100%" sx={{ '& > *': { maxWidth: '100%' } }}>
        {isChakraThingNode(resolved) ? (
          <ChakraThingRenderer node={resolved as ChakraThingNode} />
        ) : (
          <HtmlThingRenderer node={resolved as HtmlThingNode} />
        )}
      </Box>
    </Center>
  );
};

// ---------------------------------------------------------------------------
// Args tester: one live input per descriptor.

const ArgInput = ({
  spec,
  value,
  onChange
}: {
  spec: ComponentArgSpec;
  value: string | number | boolean | undefined;
  onChange: (spec: ComponentArgSpec, raw: string | boolean) => void;
}) => {
  const label = spec.label || spec.name;
  const inputProps = {
    background: 'var(--tt-card, #ffffff)',
    borderColor: 'var(--tt-border, #ececef)',
    fontSize: '13px',
    size: 'sm' as const
  };

  return (
    <Flex align={spec.type === 'text' ? 'flex-start' : 'center'} gap={2} minWidth={0}>
      <Text
        color="var(--tt-muted, #9a9aa6)"
        fontFamily="var(--tt-font-mono, monospace)"
        fontSize="11px"
        minWidth="72px"
        noOfLines={1}
        paddingTop={spec.type === 'text' ? '6px' : 0}
        title={spec.description || spec.name}
      >
        {label}
      </Text>
      {spec.type === 'boolean' && (
        <Switch isChecked={!!value} onChange={(event) => onChange(spec, event.target.checked)} size="sm" />
      )}
      {spec.type === 'enum' && (
        <Select {...inputProps} onChange={(event) => onChange(spec, event.target.value)} value={String(value ?? '')}>
          {(spec.values || []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      )}
      {spec.type === 'number' && (
        <Input
          {...inputProps}
          max={spec.max}
          min={spec.min}
          onChange={(event) => onChange(spec, event.target.value)}
          type="number"
          value={String(value ?? '')}
        />
      )}
      {spec.type === 'color' && (
        <Input
          {...inputProps}
          maxWidth="72px"
          onChange={(event) => onChange(spec, event.target.value)}
          padding="2px"
          type="color"
          value={String(value || '#888888')}
        />
      )}
      {spec.type === 'text' && (
        <Textarea {...inputProps} onChange={(event) => onChange(spec, event.target.value)} rows={2} value={String(value ?? '')} />
      )}
      {spec.type === 'string' && (
        <Input {...inputProps} maxLength={spec.maxLength} onChange={(event) => onChange(spec, event.target.value)} value={String(value ?? '')} />
      )}
    </Flex>
  );
};

// ---------------------------------------------------------------------------
// One component card.

type ComponentCardProps = {
  source: ComponentCardSource;
  onReact: (source: ComponentCardSource, token: string) => void;
  onSave: (source: ComponentCardSource) => void;
  onSaveVersion: (source: ComponentCardSource, values: ComponentArgValues, name: string, isPublic: boolean) => Promise<boolean>;
  loadFamily: (key: string) => Promise<BrowseComponentEntry[]>;
};

// in-card buttons keep working in place: a click on one never reaches the
// card's link targets
const stop = (event: React.SyntheticEvent) => event.stopPropagation();

const ComponentCard = React.memo(({ source: family, onReact, onSave, onSaveVersion, loadFamily }: ComponentCardProps) => {
  // `active` is the design currently on the card — the family's representative
  // until the designs click-through swaps in a sibling rendition. The rest of
  // the card body reads it through the `source` alias.
  const [active, setActive] = React.useState(family);
  // saved versions reopen with their snapshot; fresh cards start from defaults
  const [values, setValues] = React.useState<ComponentArgValues>(() => ({
    ...defaultsFromArgs(family.args),
    ...(family.savedArgs || {})
  }));
  const source = active;
  const entry = active.entry;

  // new page data re-keys the card — reset the active design and tester
  React.useEffect(() => {
    setActive(family);
    setValues({ ...defaultsFromArgs(family.args), ...(family.savedArgs || {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [family.key]);

  const switchDesign = React.useCallback(
    async (design: ComponentDesignRef) => {
      if (design.id === active.id) return;
      const entries = await loadFamily(deepLinkKeyFor(family));
      const nextEntry = entries.find((candidate) => candidate.id === design.id);
      const nextSource = nextEntry ? entryToCardSource(nextEntry) : null;
      if (!nextSource) return;
      nextSource.designs = family.designs;
      nextSource.key = family.key;
      setActive(nextSource);
      // args are shared across a family — keep the user's tweaks through a switch
      setValues((prev) => ({ ...defaultsFromArgs(nextSource.args), ...(nextSource.savedArgs || {}), ...prev }));
    },
    [active.id, loadFamily, family]
  );
  const [argsOpen, setArgsOpen] = React.useState(false);
  const [schemaOpen, setSchemaOpen] = React.useState(false);
  const [versionOpen, setVersionOpen] = React.useState(false);
  const [versionName, setVersionName] = React.useState('');
  const [versionPublic, setVersionPublic] = React.useState(false);
  const [savingVersion, setSavingVersion] = React.useState(false);
  const { recent } = useRecentReactions();
  const [pickerOpen, setPickerOpen] = React.useState(false);
  // outside-tap close (NOT closeOnBlur): dismissing the mobile keyboard blurs
  // the emoji search field and must not close the picker
  const pickerContentRef = useOutsideTapClose<HTMLElement>(pickerOpen, () => setPickerOpen(false));

  const onArgChange = React.useCallback((spec: ComponentArgSpec, raw: string | boolean) => {
    setValues((prev) => ({ ...prev, [spec.name]: coerceArgValue(spec, raw) }));
  }, []);

  const systemFields = React.useMemo(systemThingFields, []);
  const reactionEntries = Object.entries(entry?.reactionCounts || {}).filter(([, count]) => count > 0);
  const libraryLabel = COMPONENT_LIBRARY_LABELS[source.library] || source.library;

  // The card's dedicated page: the family's deep-link key, plus ?design=
  // when the click-through swapped in a sibling rendition (by library, or by
  // id when the family holds two renditions of one library — the same rule
  // the page's own design switcher writes).
  const pageHref = (suffix = '') => {
    const base = `/components/${encodeURIComponent(deepLinkKeyFor(family))}${suffix}`;
    if (active.id === family.id) return base;
    const sameLibrary = family.designs.filter((design) => design.library === active.library).length;
    return `${base}?design=${encodeURIComponent(sameLibrary > 1 ? active.id : active.library)}`;
  };

  const openVersionPanel = () => {
    setVersionName(`${source.name} v${(entry?.usageCount || 0) + 2}`);
    setVersionOpen((open) => !open);
  };

  const submitVersion = async () => {
    setSavingVersion(true);
    const ok = await onSaveVersion(source, values, versionName, versionPublic);
    setSavingVersion(false);
    if (ok) setVersionOpen(false);
  };

  return (
    <Flex
      background="var(--tt-card, #ffffff)"
      border="1px solid var(--tt-border, #ececef)"
      borderRadius="var(--tt-radius-lg, 16px)"
      direction="column"
      gap={3}
      padding={4}
      sx={{ breakInside: 'avoid' }}
    >
      <Flex align="center" gap={2} wrap="wrap">
        {/* a real link: middle-click, keyboard, and "open in new tab" all work */}
        <Text
          as={Link}
          color="var(--tt-ink, #16161a)"
          fontSize="md"
          fontWeight={700}
          to={pageHref()}
          _hover={{ textDecoration: 'underline' }}
          data-testid="component-card-title"
        >
          {source.name}
        </Text>
        <Badge
          background="var(--tt-surface-alt, #f5f5f7)"
          border="1px solid var(--tt-border, #ececef)"
          borderRadius="full"
          color="var(--tt-muted, #9a9aa6)"
          fontSize="10px"
          paddingX={2}
          textTransform="none"
        >
          {libraryLabel}
        </Badge>
        <Badge background="transparent" color="var(--tt-faint, #b6b6c0)" fontSize="10px" textTransform="none">
          {source.origin === 'platform' ? '🏛 Platform' : '🌱 Community'} · {source.category}
        </Badge>
        {source.version !== null && source.version > 1 && (
          <Badge background="transparent" color="var(--tt-faint, #b6b6c0)" fontSize="10px" textTransform="none">
            v{source.version}
          </Badge>
        )}
        {entry && entry.usageCount > 0 && (
          <Badge background="transparent" color="var(--tt-faint, #b6b6c0)" fontSize="10px" textTransform="none">
            {entry.usageCount} saved version{entry.usageCount === 1 ? '' : 's'}
          </Badge>
        )}
        <Box flex={1} />
        {entry && (
          <Text color="var(--tt-faint, #b6b6c0)" fontSize="11px">
            {entry.author ? getUserDisplayName(entry.author) : 'Thingtime'}
            {entry.author?.temporary ? ` · ${getUserIdentityDetail(entry.author)}` : ''} · {timeAgo(entry.createdAt)}
          </Text>
        )}
      </Flex>

      {source.description && (
        <Text color="var(--tt-text, #33333c)" fontSize="sm" lineHeight="1.55">
          {source.description}
        </Text>
      )}

      {/* the family's designs click-through — one functional component, many looks */}
      {family.designs.length > 1 && (
        <Flex align="center" gap={1.5} wrap="wrap">
          <Text {...monoLabel}>designs ({family.designs.length})</Text>
          {family.designs.map((design) => {
            const activeDesign = design.id === active.id;
            return (
              <Button
                background={activeDesign ? 'var(--tt-ink, #16161a)' : 'var(--tt-card, #ffffff)'}
                border="1px solid var(--tt-border, #ececef)"
                borderRadius="full"
                color={activeDesign ? 'var(--tt-card, #ffffff)' : 'var(--tt-muted, #9a9aa6)'}
                fontSize="10px"
                fontWeight={600}
                height="22px"
                key={design.id}
                minWidth={0}
                onClick={(event) => {
                  stop(event);
                  switchDesign(design);
                }}
                paddingX={2}
                size="xs"
                variant="unstyled"
                _hover={{ background: activeDesign ? 'var(--tt-ink, #16161a)' : 'var(--tt-surface-hover, #ececee)' }}
              >
                {COMPONENT_LIBRARY_LABELS[design.library] || design.library}
              </Button>
            );
          })}
        </Flex>
      )}

      {/* the preview stays an inert render; a real anchor stretched over it
          is the click/keyboard target that opens the dedicated page */}
      <Box position="relative" data-testid="component-card-preview">
        <ComponentPreview source={source} values={values} />
        <Box
          aria-label={`Open ${source.name}`}
          as={Link}
          borderRadius="var(--tt-radius-md, 12px)"
          bottom={0}
          left={0}
          position="absolute"
          right={0}
          to={pageHref()}
          top={0}
          _focusVisible={{ boxShadow: '0 0 0 2px var(--tt-link, #4c7dff)', outline: 'none' }}
          data-testid="component-card-open"
        />
      </Box>

      {source.args.length > 0 && (
        <Flex direction="column" gap={2}>
          <Button
            alignSelf="flex-start"
            color="var(--tt-muted, #9a9aa6)"
            fontSize="12px"
            leftIcon={<SlidersHorizontal size={13} />}
            onClick={(event) => {
              stop(event);
              setArgsOpen((open) => !open);
            }}
            size="xs"
            variant="ghost"
          >
            Args ({source.args.length}) {argsOpen ? '▾' : '▸'}
          </Button>
          {argsOpen && (
            <Flex
              background="var(--tt-surface, #fafafb)"
              border="1px solid var(--tt-border, #ececef)"
              borderRadius="var(--tt-radius-md, 12px)"
              direction="column"
              gap={2}
              padding={3}
            >
              {source.args.map((spec) => (
                <ArgInput key={spec.name} onChange={onArgChange} spec={spec} value={values[spec.name]} />
              ))}
              <Button
                alignSelf="flex-start"
                color="var(--tt-muted, #9a9aa6)"
                fontSize="11px"
                onClick={() => setValues(defaultsFromArgs(source.args))}
                size="xs"
                variant="link"
              >
                reset to defaults
              </Button>
            </Flex>
          )}
        </Flex>
      )}

      {/* the schema stays hidden away behind this quiet expander */}
      <Flex direction="column" gap={2}>
        <Button
          alignSelf="flex-start"
          color="var(--tt-faint, #b6b6c0)"
          fontSize="12px"
          leftIcon={<Braces size={13} />}
          onClick={(event) => {
            stop(event);
            setSchemaOpen((open) => !open);
          }}
          size="xs"
          variant="ghost"
        >
          Schema {schemaOpen ? '▾' : '▸'}
        </Button>
        {schemaOpen && (
          <Flex
            background="var(--tt-surface, #fafafb)"
            border="1px solid var(--tt-border, #ececef)"
            borderRadius="var(--tt-radius-md, 12px)"
            direction="column"
            gap={2.5}
            padding={3}
          >
            <Flex align="center" gap={1.5} wrap="wrap">
              <Text {...monoLabel}>inherits</Text>
              <Badge
                background="var(--tt-surface, #fafafb)"
                border="1px solid var(--tt-border, #ececef)"
                borderRadius="full"
                color="var(--tt-text, #33333c)"
                fontSize="10px"
                paddingX={2}
                textTransform="none"
                title={getThingtimeSchema('thing')?.summary}
              >
                {getThingtimeSchema('thing')?.title || 'thing'}
              </Badge>
              <Badge
                background="var(--tt-surface, #fafafb)"
                border="1px solid var(--tt-border, #ececef)"
                borderRadius="full"
                color="var(--tt-text, #33333c)"
                fontSize="10px"
                paddingX={2}
                textTransform="none"
                title={getThingtimeSchema('component')?.summary}
              >
                {getThingtimeSchema('component')?.title || 'component'}
              </Badge>
            </Flex>

            {source.args.length > 0 && (
              <Flex align="center" gap={1.5} wrap="wrap">
                <Text {...monoLabel}>args</Text>
                {source.args.map((spec) => (
                  <Flex
                    align="center"
                    background="var(--tt-surface-alt, #f5f5f7)"
                    borderRadius="var(--tt-radius-xs, 7px)"
                    gap={1.5}
                    key={spec.name}
                    paddingX={2}
                    paddingY={0.5}
                    title={spec.description}
                  >
                    <Text color="var(--tt-ink, #16161a)" fontFamily="var(--tt-font-mono, monospace)" fontSize="11px">
                      {spec.name}
                    </Text>
                    <Text color="var(--tt-muted, #9a9aa6)" fontSize="10px">
                      {spec.type === 'enum' ? `enum ${(spec.values || []).slice(0, 3).join('|')}${(spec.values || []).length > 3 ? '|…' : ''}` : spec.type}
                    </Text>
                  </Flex>
                ))}
              </Flex>
            )}

            <Flex align="center" gap={1.5} wrap="wrap">
              <Text {...monoLabel}>on create</Text>
              <ShapeChip>thingtime: ["component"]</ShapeChip>
              <ShapeChip>
                crystal: {'{ '}name, library, category, componentKey, version, args, savedArgs, render{' }'}
              </ShapeChip>
              <ShapeChip dim>acl?</ShapeChip>
              <ShapeChip dim>tags?</ShapeChip>
            </Flex>

            <Flex align="center" gap={1.5} wrap="wrap">
              <Text {...monoLabel} title="System props stamped by Thingtime — from the root Thing schema every thing inherits">
                thingtime adds
              </Text>
              {systemFields.map((field) => (
                <ShapeChip dim key={field.name}>
                  {field.name}: {describeSchemaField(field)}
                </ShapeChip>
              ))}
            </Flex>

            <Flex direction="column" gap={1}>
              <Text {...monoLabel}>definition</Text>
              <Box
                as="pre"
                background="var(--tt-card, #ffffff)"
                border="1px solid var(--tt-border, #ececef)"
                borderRadius="var(--tt-radius-xs, 7px)"
                color="var(--tt-text, #33333c)"
                fontFamily="var(--tt-font-mono, monospace)"
                fontSize="11px"
                maxHeight="260px"
                overflow="auto"
                padding={2.5}
              >
                {JSON.stringify(
                  {
                    name: source.name,
                    library: source.library,
                    category: source.category,
                    componentKey: source.componentKey,
                    version: source.version,
                    args: source.args,
                    ...(source.savedArgs ? { savedArgs: source.savedArgs } : {}),
                    render: source.render
                  },
                  null,
                  2
                )}
              </Box>
            </Flex>
          </Flex>
        )}
      </Flex>

      {entry && (
        <Flex align="center" gap={1.5} wrap="wrap">
          {reactionEntries.map(([token, count]) => {
            const mine = entry.viewerReactions.includes(token);
            return (
              <Button
                background={mine ? 'var(--tt-surface-alt, #f5f5f7)' : 'transparent'}
                border="1px solid var(--tt-border, #ececef)"
                borderRadius="full"
                height="26px"
                key={token}
                minWidth={0}
                onClick={(event) => {
                  stop(event);
                  onReact(source, token);
                }}
                paddingX={2}
                size="xs"
                variant="unstyled"
              >
                <Flex align="center" gap={1}>
                  <Text fontSize="13px">{token}</Text>
                  <Text color="var(--tt-muted, #9a9aa6)" fontSize="11px">
                    {count}
                  </Text>
                </Flex>
              </Button>
            );
          })}
          <Popover isLazy isOpen={pickerOpen} onClose={() => setPickerOpen(false)} placement="top-start" closeOnBlur={false}>
            <PopoverTrigger>
              <Button
                border="1px dashed var(--tt-border, #ececef)"
                borderRadius="full"
                color="var(--tt-muted, #9a9aa6)"
                height="26px"
                onClick={(event) => {
                  stop(event);
                  setPickerOpen((open) => !open);
                }}
                paddingX={2}
                size="xs"
                variant="unstyled"
              >
                <Flex align="center" gap={1}>
                  <Plus size={12} /> react
                </Flex>
              </Button>
            </PopoverTrigger>
            <PopoverContent ref={pickerContentRef as any} border="1px solid var(--tt-border, #ececef)" width="320px">
              <PopoverBody padding={2}>
                <EmojiPicker
                  activeTokens={entry.viewerReactions}
                  autoFocus
                  onPick={(token) => {
                    setPickerOpen(false);
                    onReact(source, token);
                  }}
                  recent={recent}
                />
              </PopoverBody>
            </PopoverContent>
          </Popover>
        </Flex>
      )}

      {source.tags.length > 0 && (
        <Flex align="center" gap={1.5} wrap="wrap">
          <Text {...monoLabel}>tags</Text>
          {[...source.tags].sort((a, b) => Number(isAttributionTag(b)) - Number(isAttributionTag(a))).map((tag) => {
            const attribution = isAttributionTag(tag);
            return (
              <Flex
                align="center"
                background={attribution ? 'var(--tt-surface-alt, #f5f5f7)' : 'transparent'}
                border="1px solid var(--tt-border, #ececef)"
                borderRadius="full"
                color={attribution ? 'var(--tt-ink, #16161a)' : 'var(--tt-muted, #9a9aa6)'}
                fontWeight={attribution ? 600 : 400}
                gap={1}
                key={tag}
                paddingX={2}
                paddingY="1px"
              >
                {attribution && <Sparkles size={10} />}
                <Text fontSize="10px">{tag}</Text>
              </Flex>
            );
          })}
        </Flex>
      )}

      <Flex gap={2} wrap="wrap">
        {entry && (
          <Button
            leftIcon={<Library size={14} />}
            onClick={(event) => {
              stop(event);
              onSave(source);
            }}
            size="xs"
            variant={entry.saved ? 'solid' : 'outline'}
          >
            {entry.saved ? 'In my library' : 'Add to library'}
          </Button>
        )}
        <Button
          leftIcon={<Save size={14} />}
          onClick={(event) => {
            stop(event);
            openVersionPanel();
          }}
          size="xs"
          variant="outline"
        >
          Save version
        </Button>
        {/* the dedicated page, landing on its docs section — a real link */}
        <Button as={Link} leftIcon={<BookOpen size={14} />} onClick={stop} size="xs" to={pageHref('/docs')} variant="ghost" data-testid="component-card-docs">
          Docs
        </Button>
      </Flex>

      {versionOpen && (
        <Flex
          align="center"
          background="var(--tt-surface, #fafafb)"
          border="1px solid var(--tt-border, #ececef)"
          borderRadius="var(--tt-radius-md, 12px)"
          gap={2}
          padding={3}
          wrap="wrap"
        >
          <Input
            background="var(--tt-card, #ffffff)"
            borderColor="var(--tt-border, #ececef)"
            flex={1}
            fontSize="13px"
            minWidth="180px"
            onChange={(event) => setVersionName(event.target.value)}
            placeholder="Version name"
            size="sm"
            value={versionName}
          />
          <Flex align="center" gap={1.5}>
            <Switch isChecked={versionPublic} onChange={(event) => setVersionPublic(event.target.checked)} size="sm" />
            <Text color="var(--tt-muted, #9a9aa6)" fontSize="12px">
              public
            </Text>
          </Flex>
          <Button colorScheme="pink" isLoading={savingVersion} onClick={submitVersion} size="sm">
            Save to my Things
          </Button>
        </Flex>
      )}
    </Flex>
  );
});
ComponentCard.displayName = 'ComponentCard';

// ---------------------------------------------------------------------------

export const ComponentsBrowsePage = () => {
  const navigate = useNavigate();
  const api = useApi();
  const lopu = useLopu();
  const user = useCurrentUser();

  const cacheKey = cacheKeyFor(user?.id);
  const cached = React.useMemo(
    () => (cacheKey ? readLocalCache<CachedComponents>(cacheKey) : null),
    [cacheKey]
  );

  const [q, setQ] = React.useState(cached?.q || '');
  const [sort, setSort] = React.useState<SortMode>(cached?.sort || 'newest');
  const [view, setView] = React.useState<ViewMode>(cached?.view || 'grid');
  const [scope, setScope] = React.useState<ScopeMode>(cached?.scope || 'all');
  const [lib, setLib] = React.useState<LibFilter>(cached?.lib || 'all');
  const [entries, setEntries] = React.useState<BrowseComponentEntry[]>(cached?.entries || []);
  const [nextCursor, setNextCursor] = React.useState<string | null>(cached?.nextCursor ?? null);
  const [total, setTotal] = React.useState<number | null>(cached?.total ?? null);
  const [totalCapped, setTotalCapped] = React.useState(cached?.totalCapped || false);
  const [loading, setLoading] = React.useState(false);

  const apiRef = React.useRef(api);
  apiRef.current = api;
  const lopuRef = React.useRef(lopu);
  lopuRef.current = lopu;
  const requestSeqRef = React.useRef(0);
  const stateRef = React.useRef({ q, sort, scope, lib, loading, nextCursor });
  stateRef.current = { q, sort, scope, lib, loading, nextCursor };
  const cacheKeyRef = React.useRef(cacheKey);
  cacheKeyRef.current = cacheKey;

  const runBrowse = React.useCallback(
    async (
      options: {
        cursor?: string | null;
        qOverride?: string;
        sortOverride?: SortMode;
        scopeOverride?: ScopeMode;
        libOverride?: LibFilter;
      } = {}
    ) => {
      const seq = ++requestSeqRef.current;
      const query = options.qOverride !== undefined ? options.qOverride : stateRef.current.q;
      const sortMode = options.sortOverride || stateRef.current.sort;
      const scopeMode = options.scopeOverride || stateRef.current.scope;
      const libMode = options.libOverride || stateRef.current.lib;
      const cursor = options.cursor || undefined;
      setLoading(true);
      try {
        const resp = (await apiRef.current.v1.components.browse({
          q: scopeMode === 'all' ? query.trim() || undefined : undefined,
          sort: scopeMode === 'all' ? sortMode : sortMode === 'oldest' ? 'oldest' : undefined,
          // catalog filters ride no-q pages only — the server ignores them
          // during text search, so don't send a misleading param
          lib: scopeMode === 'all' && !query.trim() && libMode !== 'all' ? libMode : undefined,
          // one card per family on the plain catalog view; q-search pages and
          // library-filtered views stay per-design (q collapses client-side)
          group:
            scopeMode === 'all' && !query.trim() && libMode === 'all' && sortMode === 'newest' ? 'family' : undefined,
          cursor,
          limit: PAGE_SIZE,
          library: scopeMode === 'library' ? 1 : undefined,
          mine: scopeMode === 'mine' ? 1 : undefined
        })) as BrowseComponentsResponse;
        if (seq !== requestSeqRef.current) return;
        if (!resp?.ok) throw resp;

        setEntries((prev) => {
          if (!cursor) return resp.components;
          const seen = new Set(prev.map((entry) => entry.id));
          return [...prev, ...resp.components.filter((entry) => !seen.has(entry.id))];
        });
        setNextCursor(resp.nextCursor);
        setTotal((prev) => (cursor && resp.total === null ? prev : resp.total));
        setTotalCapped(resp.totalCapped);

        if (!cursor) {
          const snapshot: CachedComponents = {
            q: query,
            sort: sortMode,
            view,
            scope: scopeMode,
            lib: libMode,
            entries: resp.components.slice(0, PAGE_SIZE),
            nextCursor: resp.nextCursor,
            total: resp.total,
            totalCapped: resp.totalCapped
          };
          // only persist when signed in, always under the per-user key
          if (cacheKeyRef.current) writeLocalCache(cacheKeyRef.current, snapshot);
        }
      } catch (err: any) {
        if (seq !== requestSeqRef.current) return;
        lopuRef.current({ title: err?.error || 'Component browsing hiccuped — try again 🌈', status: 'error' });
      } finally {
        if (seq === requestSeqRef.current) setLoading(false);
      }
    },
    [view]
  );

  // reconcile cached paint with fresh data
  React.useEffect(() => {
    runBrowse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setAndRun = (updates: { sort?: SortMode; scope?: ScopeMode; lib?: LibFilter }) => {
    if (updates.sort) setSort(updates.sort);
    if (updates.scope) setScope(updates.scope);
    if (updates.lib) setLib(updates.lib);
    runBrowse({ sortOverride: updates.sort, scopeOverride: updates.scope, libOverride: updates.lib });
  };

  // One card per family everywhere: grouped server pages arrive one-per-family
  // (collapse is then the identity), q-search pages collapse client-side over
  // the loaded entries.
  const sources = React.useMemo(() => collapseEntriesByFamily(entries), [entries]);

  // family design rosters hydrate lazily on first switch, cached per key
  const familyCacheRef = React.useRef(new Map<string, BrowseComponentEntry[]>());
  const loadFamily = React.useCallback(async (key: string): Promise<BrowseComponentEntry[]> => {
    const cached = familyCacheRef.current.get(key);
    if (cached) return cached;
    try {
      const resp = (await apiRef.current.v1.components.browse({ family: key })) as BrowseComponentsResponse;
      if (!resp?.ok) throw resp;
      familyCacheRef.current.set(key, resp.components);
      return resp.components;
    } catch (err: any) {
      lopuRef.current({ title: err?.error || 'Couldn’t load this component’s designs 🌈', status: 'error' });
      return [];
    }
  }, []);

  // ---- actions ------------------------------------------------------------

  const patchEntry = React.useCallback(
    (id: string, patch: Partial<BrowseComponentEntry> | ((entry: BrowseComponentEntry) => BrowseComponentEntry)) => {
      setEntries((prev) =>
        prev.map((entry) => (entry.id === id ? (typeof patch === 'function' ? patch(entry) : { ...entry, ...patch }) : entry))
      );
    },
    []
  );

  const handleReact = React.useCallback(
    (source: ComponentCardSource, token: string) => {
      if (!user) {
        lopuRef.current({ title: 'Sign in to react to components ✨', status: 'info', duration: 6000 });
        return;
      }
      const had = source.entry.viewerReactions.includes(token);
      patchEntry(source.id, (entry) => ({
        ...entry,
        viewerReactions: had ? entry.viewerReactions.filter((t) => t !== token) : [...entry.viewerReactions, token],
        reactionCounts: {
          ...entry.reactionCounts,
          [token]: Math.max(0, (entry.reactionCounts[token] || 0) + (had ? -1 : 1))
        }
      }));
      apiRef.current.v1.things
        .react({ id: source.id, emoji: token })
        .then((resp: any) => {
          if (resp?.ok) {
            patchEntry(source.id, { reactionCounts: resp.reactionCounts, viewerReactions: resp.viewerReactions });
          }
        })
        .catch((err: any) => {
          patchEntry(source.id, (entry) => ({
            ...entry,
            viewerReactions: had ? [...entry.viewerReactions, token] : entry.viewerReactions.filter((t) => t !== token),
            reactionCounts: {
              ...entry.reactionCounts,
              [token]: Math.max(0, (entry.reactionCounts[token] || 0) + (had ? 1 : -1))
            }
          }));
          lopuRef.current({ title: err?.error || 'Reaction didn’t land — try again 🌈', status: 'error' });
        });
    },
    [user, patchEntry]
  );

  const handleSave = React.useCallback(
    (source: ComponentCardSource) => {
      if (!user) {
        lopuRef.current({ title: 'Sign in to build your component library 📚', status: 'info', duration: 6000 });
        return;
      }
      const wasSaved = source.entry.saved;
      patchEntry(source.id, { saved: !wasSaved });
      apiRef.current.v1.things
        .save({ id: source.id })
        .then((resp: any) => {
          if (resp?.ok) {
            patchEntry(source.id, { saved: resp.saved });
            if (!resp.saved && stateRef.current.scope === 'library') {
              setEntries((prev) => prev.filter((entry) => entry.id !== source.id));
            }
          }
        })
        .catch((err: any) => {
          patchEntry(source.id, { saved: wasSaved });
          lopuRef.current({ title: err?.error || 'Save didn’t stick — try again 🌈', status: 'error' });
        });
    },
    [user, patchEntry]
  );

  const handleSaveVersion = React.useCallback(
    async (source: ComponentCardSource, values: ComponentArgValues, name: string, isPublic: boolean): Promise<boolean> => {
      if (!user) {
        lopuRef.current({ title: 'Sign in to save component versions ✨', status: 'info', duration: 6000 });
        return false;
      }
      const trimmed = name.trim();
      if (!trimmed) {
        lopuRef.current({ title: 'Give your version a name 🌱', status: 'info' });
        return false;
      }
      const savedArgs: Record<string, string | number | boolean> = {};
      for (const spec of source.args) {
        const value = values[spec.name];
        if (value !== undefined) savedArgs[spec.name] = value;
      }
      try {
        const resp: any = await apiRef.current.v1.things.create({
          thingtime: ['component'],
          crystal: {
            name: trimmed,
            description: source.description,
            library: source.library,
            category: source.category,
            ...(source.componentKey ? { componentKey: source.componentKey } : {}),
            version: (source.entry.usageCount || 0) + 2,
            args: source.args,
            savedArgs,
            render: source.render,
            ...(source.previewBg ? { previewBg: source.previewBg } : {}),
            forkOf: source.id
          },
          // private by default — flip the toggle to publish into the catalog
          ...(isPublic ? {} : { acl: [ACL_OWNER] })
        });
        if (!resp?.ok) throw resp;
        patchEntry(source.id, (entry) => ({ ...entry, usageCount: (entry.usageCount || 0) + 1 }));
        lopuRef.current({ title: `Saved "${trimmed}" to your Things ✨`, status: 'success' });
        return true;
      } catch (err: any) {
        lopuRef.current({ title: err?.error || 'Version didn’t save — try again 🌈', status: 'error' });
        return false;
      }
    },
    [user, patchEntry]
  );

  // ---- infinite scroll ----------------------------------------------------

  const loadMoreRef = React.useRef<() => void>(() => {});
  loadMoreRef.current = () => {
    if (stateRef.current.nextCursor && !stateRef.current.loading) {
      runBrowse({ cursor: stateRef.current.nextCursor });
    }
  };
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (observed) => {
        if (observed.some((observedEntry) => observedEntry.isIntersecting)) loadMoreRef.current();
      },
      { rootMargin: '600px 0px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  // ---- render -------------------------------------------------------------

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    runBrowse();
  };

  const cardFor = (source: ComponentCardSource) => (
    <ComponentCard
      key={source.key}
      loadFamily={loadFamily}
      onReact={handleReact}
      onSave={handleSave}
      onSaveVersion={handleSaveVersion}
      source={source}
    />
  );

  const countLabel = total !== null ? `${total}${totalCapped ? '+' : ''}` : entries.length ? String(entries.length) : '…';

  return (
    <Flex background="var(--tt-surface, #fafafb)" justifyContent="center" minHeight="100vh" width="100%">
      <Flex direction="column" gap={5} maxWidth={view === 'feed' ? '760px' : '1180px'} pb={24} paddingTop="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px) + 36px)" px={4} width="100%">
        <Flex align="baseline" gap={3} wrap="wrap">
          <Text color="var(--tt-ink, #16161a)" fontSize="2xl" fontWeight={800}>
            Components
          </Text>
          <Text color="var(--tt-muted, #9a9aa6)" fontSize="sm">
            living UI pieces — tweak the args, watch them render, save your versions
          </Text>
          <Box flex={1} />
          <Button
            color="var(--tt-muted, #9a9aa6)"
            fontSize="12px"
            onClick={() => navigate('/schemas')}
            size="xs"
            variant="ghost"
          >
            💎 Schemas
          </Button>
        </Flex>

        {/* same rainbow-ringed input as /search and /schemas */}
        <form onSubmit={submit}>
          <Center position="relative" width="100%">
            <Center
              borderRadius="var(--tt-radius-sm, 9px)"
              height="56px"
              overflow="hidden"
              padding="2px"
              position="relative"
              width="100%"
            >
              <Rainbow opacity={0.6} position="absolute" repeats={2} thickness={10} />
              <Flex
                align="center"
                background="var(--tt-card, #ffffff)"
                borderRadius="var(--tt-radius-xs, 7px)"
                gap={2}
                height="100%"
                position="relative"
                px={3}
                width="100%"
                zIndex={1}
              >
                <Search color="var(--tt-muted, #9a9aa6)" size={18} />
                <Input
                  _placeholder={{ color: 'var(--tt-muted, #9a9aa6)' }}
                  border="none"
                  fontSize="md"
                  height="100%"
                  onChange={(event) => setQ(event.target.value)}
                  outline="none"
                  padding={0}
                  placeholder="Search every component…"
                  value={q}
                  variant="unstyled"
                />
                <Button colorScheme="pink" isLoading={loading && !entries.length} size="sm" type="submit" variant="solid">
                  Search
                </Button>
              </Flex>
            </Center>
          </Center>
        </form>

        <Flex align="center" gap={2} wrap="wrap">
          <Text {...monoLabel}>library</Text>
          {LIB_FILTERS.map((filter) => (
            <Button {...pillProps(lib === filter)} key={filter} onClick={() => setAndRun({ lib: filter })}>
              {filter === 'all' ? 'All' : COMPONENT_LIBRARY_LABELS[filter] || filter}
            </Button>
          ))}
        </Flex>

        <Flex align="center" gap={2} wrap="wrap">
          <Text {...monoLabel}>view</Text>
          <Button {...pillProps(view === 'grid')} leftIcon={<LayoutGrid size={13} />} onClick={() => setView('grid')}>
            Grid
          </Button>
          <Button {...pillProps(view === 'feed')} leftIcon={<Rows3 size={13} />} onClick={() => setView('feed')}>
            Feed
          </Button>
          <Button {...pillProps(view === 'columns')} leftIcon={<Columns3 size={13} />} onClick={() => setView('columns')}>
            Columns
          </Button>
          <Box width={2} />
          <Text {...monoLabel}>sort</Text>
          <Button {...pillProps(sort === 'newest')} onClick={() => setAndRun({ sort: 'newest' })}>
            Newest
          </Button>
          <Button {...pillProps(sort === 'popular')} onClick={() => setAndRun({ sort: 'popular' })}>
            Popular
          </Button>
          <Button {...pillProps(sort === 'oldest')} onClick={() => setAndRun({ sort: 'oldest' })}>
            Oldest
          </Button>
          {user && (
            <>
              <Box width={2} />
              <Text {...monoLabel}>show</Text>
              <Button {...pillProps(scope === 'all')} onClick={() => setAndRun({ scope: 'all' })}>
                All
              </Button>
              <Button {...pillProps(scope === 'mine')} onClick={() => setAndRun({ scope: 'mine' })}>
                Mine
              </Button>
              <Button {...pillProps(scope === 'library')} leftIcon={<Library size={13} />} onClick={() => setAndRun({ scope: 'library' })}>
                Library
              </Button>
            </>
          )}
        </Flex>

        <Text color="var(--tt-faint, #b6b6c0)" fontSize="12px">
          {scope === 'all'
            ? `${countLabel} component${countLabel === '1' ? '' : 's'}${lib !== 'all' ? ` · ${COMPONENT_LIBRARY_LABELS[lib] || lib}` : ''}`
            : scope === 'mine'
              ? `${countLabel} of yours`
              : `${entries.length} in your library`}
        </Text>

        {view === 'feed' && <Flex direction="column" gap={3}>{sources.map(cardFor)}</Flex>}
        {view === 'grid' && (
          <Grid gap={3} templateColumns="repeat(auto-fill, minmax(340px, 1fr))">
            {sources.map(cardFor)}
          </Grid>
        )}
        {view === 'columns' && (
          <Box sx={{ columnCount: { base: 1, md: 2, xl: 3 }, columnGap: '12px', '& > *': { marginBottom: '12px' } }}>
            {sources.map(cardFor)}
          </Box>
        )}

        {!sources.length && !loading && (
          <Box
            border="1px dashed var(--tt-border, #ececef)"
            borderRadius="var(--tt-radius-lg, 16px)"
            color="var(--tt-muted, #9a9aa6)"
            padding={10}
            textAlign="center"
          >
            {scope === 'library'
              ? 'Nothing saved yet — browse All and tap “Add to library” 📚'
              : scope === 'mine'
                ? 'You haven’t saved a component version yet — tap “Save version” on any card ✨'
                : 'No components match — try a different search or library 🌈'}
          </Box>
        )}

        <div ref={sentinelRef} />
        {nextCursor && (
          <Button alignSelf="center" isLoading={loading} onClick={() => loadMoreRef.current()} size="sm" variant="outline">
            Load more
          </Button>
        )}
      </Flex>
    </Flex>
  );
};
