import React from 'react';
import { Badge, Box, Button, Center, Flex, Text } from '@chakra-ui/react';
import { ArrowLeft, Link as LinkIcon } from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router';

import { ChakraThingRenderer, HtmlThingRenderer, isChakraThingNode } from '~/components/Kinds';
import type { ChakraThingNode, HtmlThingNode } from '~/components/Kinds';
import { isSafeCssText } from '~/components/Kinds/safeUrl';
import { useLopu } from '~/components/Lopu/useLopu';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { ACL_OWNER, getThingtimeSchema } from '~/schemas/registry';
import type { SchemaThingField } from '~/schemas/registry';
import { describeSchemaField } from '~/schemas/tools';

import {
  COMPONENT_LIBRARY_LABELS,
  designRank,
  entryToCardSource,
  isAttributionTag,
  type BrowseComponentEntry,
  type BrowseComponentsResponse,
  type ComponentCardSource
} from './componentBrowseTypes';
import {
  coerceArgValue,
  defaultsFromArgs,
  resolveTemplate,
  type ComponentArgSpec,
  type ComponentArgValues
} from './componentTemplate';

// /components/:key (+ /docs) — a component family's own deep-linked page:
// design switcher, big live preview, args tester, and full documentation
// (args reference, API usage, raw definition). :key resolves a familyKey, a
// componentKey slug, or a seeded shareId (component-<slug>); ?design=<library>
// picks the rendition.

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

const describeArg = (spec: ComponentArgSpec): string => {
  if (spec.type === 'enum') return `enum ${(spec.values || []).join(' | ')}`;
  if (spec.type === 'number') {
    const bounds = [spec.min, spec.max].filter((value) => typeof value === 'number');
    return bounds.length ? `number ${bounds.join('–')}` : 'number';
  }
  if (spec.type === 'string' && spec.maxLength) return `string ≤${spec.maxLength}`;
  return spec.type;
};

export const ComponentDetailPage = ({ docsFocus = false }: { docsFocus?: boolean }) => {
  const { key: rawKey } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const api = useApi();
  const lopu = useLopu();
  const user = useCurrentUser();

  const key = (rawKey || '').trim();
  const designParam = searchParams.get('design') || '';

  const [entries, setEntries] = React.useState<BrowseComponentEntry[] | null>(null);
  const [notFound, setNotFound] = React.useState(false);
  const apiRef = React.useRef(api);
  apiRef.current = api;
  const lopuRef = React.useRef(lopu);
  lopuRef.current = lopu;

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      // familyKey and componentKey resolve directly; a seeded shareId
      // (component-<slug>) resolves through its stripped componentKey
      const candidates = [key, ...(key.startsWith('component-') ? [key.slice('component-'.length)] : [])].filter(Boolean);
      for (const candidate of candidates) {
        try {
          const resp = (await apiRef.current.v1.components.browse({ family: candidate })) as BrowseComponentsResponse;
          if (cancelled) return;
          if (resp?.ok && resp.components.length) {
            setEntries(resp.components);
            return;
          }
        } catch {
          // fall through to the next candidate
        }
      }
      if (!cancelled) {
        setEntries([]);
        setNotFound(true);
      }
    };
    setEntries(null);
    setNotFound(false);
    load();
    return () => {
      cancelled = true;
    };
  }, [key]);

  const sources = React.useMemo(() => {
    const mapped = (entries || []).map(entryToCardSource).filter(Boolean) as ComponentCardSource[];
    return mapped.sort((a, b) => designRank(a.library) - designRank(b.library) || (a.id < b.id ? -1 : 1));
  }, [entries]);

  const active = React.useMemo(() => {
    if (!sources.length) return null;
    return (
      sources.find((source) => source.library === designParam) ||
      sources.find((source) => source.componentKey === key || source.id === key) ||
      sources[0]
    );
  }, [sources, designParam, key]);

  const [values, setValues] = React.useState<ComponentArgValues>({});
  React.useEffect(() => {
    if (active) setValues({ ...defaultsFromArgs(active.args), ...(active.savedArgs || {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  const docsRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (docsFocus && active && docsRef.current) {
      docsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [docsFocus, active]);

  const onArgChange = React.useCallback((spec: ComponentArgSpec, raw: string | boolean) => {
    setValues((prev) => ({ ...prev, [spec.name]: coerceArgValue(spec, raw) }));
  }, []);

  const pickDesign = (library: string) => {
    setSearchParams(library === sources[0]?.library ? {} : { design: library }, { replace: true });
  };

  const saveVersion = async () => {
    if (!active) return;
    if (!user) {
      lopuRef.current({ title: 'Sign in to save component versions ✨', status: 'info', duration: 6000 });
      return;
    }
    const savedArgs: Record<string, string | number | boolean> = {};
    for (const spec of active.args) {
      const value = values[spec.name];
      if (value !== undefined) savedArgs[spec.name] = value;
    }
    try {
      const resp: any = await apiRef.current.v1.things.create({
        thingtime: ['component'],
        crystal: {
          name: `${active.name} v${(active.entry.usageCount || 0) + 2}`,
          description: active.description,
          library: active.library,
          category: active.category,
          ...(active.componentKey ? { componentKey: active.componentKey } : {}),
          ...(active.familyKey ? { familyKey: active.familyKey } : {}),
          version: (active.entry.usageCount || 0) + 2,
          args: active.args,
          savedArgs,
          render: active.render,
          ...(active.previewBg ? { previewBg: active.previewBg } : {}),
          forkOf: active.id
        },
        acl: [ACL_OWNER]
      });
      if (!resp?.ok) throw resp;
      lopuRef.current({ title: 'Saved a version to your Things ✨', status: 'success' });
    } catch (err: any) {
      lopuRef.current({ title: err?.error || 'Version didn’t save — try again 🌈', status: 'error' });
    }
  };

  const copyLink = (suffix = '') => {
    const url = `${window.location.origin}/components/${encodeURIComponent(key)}${suffix}${
      active && active.library !== sources[0]?.library ? `?design=${encodeURIComponent(active.library)}` : ''
    }`;
    navigator.clipboard?.writeText(url).then(
      () => lopuRef.current({ title: 'Link copied 🔗', status: 'success', duration: 2500 }),
      () => lopuRef.current({ title: url, status: 'info', duration: 8000 })
    );
  };

  const resolved = React.useMemo(
    () => (active ? resolveTemplate(active.render, values) : null),
    [active, values]
  );
  const previewBackground =
    active?.previewBg && isSafeCssText(active.previewBg) ? active.previewBg : 'var(--tt-surface, #fafafb)';
  const systemFields = React.useMemo(systemThingFields, []);

  return (
    <Flex background="var(--tt-surface, #fafafb)" justifyContent="center" minHeight="100vh" width="100%">
      <Flex direction="column" gap={5} maxWidth="860px" pb={24} paddingTop="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px) + 36px)" px={4} width="100%">
        <Flex align="center" gap={2}>
          <Button leftIcon={<ArrowLeft size={14} />} onClick={() => navigate('/components')} size="xs" variant="ghost">
            Components
          </Button>
          <Box flex={1} />
          <Button leftIcon={<LinkIcon size={13} />} onClick={() => copyLink()} size="xs" variant="ghost">
            Copy link
          </Button>
        </Flex>

        {!active && !notFound && (
          <Box color="var(--tt-muted, #9a9aa6)" padding={10} textAlign="center">
            Loading component…
          </Box>
        )}

        {notFound && (
          <Box
            border="1px dashed var(--tt-border, #ececef)"
            borderRadius="var(--tt-radius-lg, 16px)"
            color="var(--tt-muted, #9a9aa6)"
            padding={10}
            textAlign="center"
          >
            No component answers to “{key}” — browse the catalog instead 🌈
          </Box>
        )}

        {active && (
          <>
            <Flex align="baseline" gap={3} wrap="wrap">
              <Text color="var(--tt-ink, #16161a)" fontSize="2xl" fontWeight={800}>
                {active.name}
              </Text>
              <Badge
                background="var(--tt-surface-alt, #f5f5f7)"
                border="1px solid var(--tt-border, #ececef)"
                borderRadius="full"
                color="var(--tt-muted, #9a9aa6)"
                fontSize="11px"
                paddingX={2}
                textTransform="none"
              >
                {COMPONENT_LIBRARY_LABELS[active.library] || active.library}
              </Badge>
              <Text color="var(--tt-faint, #b6b6c0)" fontSize="12px" fontFamily="var(--tt-font-mono, monospace)">
                {active.familyKey || active.componentKey || active.id} · {active.category}
              </Text>
            </Flex>

            {active.description && (
              <Text color="var(--tt-text, #33333c)" fontSize="sm" lineHeight="1.6">
                {active.description}
              </Text>
            )}

            {active.tags.length > 0 && (
              <Flex align="center" gap={1.5} wrap="wrap">
                {[...active.tags].sort((a, b) => Number(isAttributionTag(b)) - Number(isAttributionTag(a))).map((tag) => {
                  const attribution = isAttributionTag(tag);
                  return (
                    <Badge
                      background={attribution ? 'var(--tt-surface-alt, #f5f5f7)' : 'transparent'}
                      border="1px solid var(--tt-border, #ececef)"
                      borderRadius="full"
                      color={attribution ? 'var(--tt-ink, #16161a)' : 'var(--tt-muted, #9a9aa6)'}
                      fontSize="10px"
                      fontWeight={attribution ? 600 : 400}
                      key={tag}
                      paddingX={2}
                      textTransform="none"
                    >
                      {attribution ? `✨ ${tag}` : tag}
                    </Badge>
                  );
                })}
              </Flex>
            )}

            {sources.length > 1 && (
              <Flex align="center" gap={1.5} wrap="wrap">
                <Text {...monoLabel}>designs ({sources.length})</Text>
                {sources.map((source) => {
                  const activeDesign = source.id === active.id;
                  return (
                    <Button
                      background={activeDesign ? 'var(--tt-ink, #16161a)' : 'var(--tt-card, #ffffff)'}
                      border="1px solid var(--tt-border, #ececef)"
                      borderRadius="full"
                      color={activeDesign ? 'var(--tt-card, #ffffff)' : 'var(--tt-text, #33333c)'}
                      fontSize="11px"
                      fontWeight={600}
                      height="26px"
                      key={source.id}
                      onClick={() => pickDesign(source.library)}
                      paddingX={3}
                      size="xs"
                      variant="unstyled"
                      _hover={{ background: activeDesign ? 'var(--tt-ink, #16161a)' : 'var(--tt-surface-hover, #ececee)' }}
                    >
                      {COMPONENT_LIBRARY_LABELS[source.library] || source.library}
                    </Button>
                  );
                })}
              </Flex>
            )}

            <Center
              background={previewBackground}
              border="1px solid var(--tt-border, #ececef)"
              borderRadius="var(--tt-radius-lg, 16px)"
              minHeight="180px"
              overflow="hidden"
              padding={8}
            >
              <Box maxWidth="100%" sx={{ '& > *': { maxWidth: '100%' } }}>
                {isChakraThingNode(resolved) ? (
                  <ChakraThingRenderer node={resolved as ChakraThingNode} />
                ) : (
                  <HtmlThingRenderer node={resolved as HtmlThingNode} />
                )}
              </Box>
            </Center>

            {active.args.length > 0 && (
              <Flex
                background="var(--tt-card, #ffffff)"
                border="1px solid var(--tt-border, #ececef)"
                borderRadius="var(--tt-radius-md, 12px)"
                direction="column"
                gap={2}
                padding={4}
              >
                <Text {...monoLabel}>args tester</Text>
                {active.args.map((spec) => (
                  <ArgRow key={spec.name} onChange={onArgChange} spec={spec} value={values[spec.name]} />
                ))}
                <Flex gap={2}>
                  <Button
                    color="var(--tt-muted, #9a9aa6)"
                    fontSize="11px"
                    onClick={() => setValues(defaultsFromArgs(active.args))}
                    size="xs"
                    variant="link"
                  >
                    reset to defaults
                  </Button>
                  <Box flex={1} />
                  <Button colorScheme="pink" onClick={saveVersion} size="xs">
                    Save version to my Things
                  </Button>
                </Flex>
              </Flex>
            )}

            {/* ------------------------------ docs ------------------------------ */}
            <Flex direction="column" gap={3} ref={docsRef}>
              <Text color="var(--tt-ink, #16161a)" fontSize="lg" fontWeight={700} paddingTop={2}>
                Docs
              </Text>

              <Flex direction="column" gap={1.5}>
                <Text {...monoLabel}>deep links</Text>
                <Flex direction="column" gap={1}>
                  {[
                    { label: 'component page', suffix: '' },
                    { label: 'docs page', suffix: '/docs' }
                  ].map((link) => (
                    <Flex align="center" gap={2} key={link.suffix}>
                      <Text color="var(--tt-text, #33333c)" fontFamily="var(--tt-font-mono, monospace)" fontSize="12px">
                        /components/{key}
                        {link.suffix}
                      </Text>
                      <Button onClick={() => copyLink(link.suffix)} size="xs" variant="ghost" color="var(--tt-muted, #9a9aa6)">
                        copy
                      </Button>
                    </Flex>
                  ))}
                </Flex>
              </Flex>

              {active.args.length > 0 && (
                <Flex direction="column" gap={1.5}>
                  <Text {...monoLabel}>args reference</Text>
                  <Flex direction="column" gap={1}>
                    {active.args.map((spec) => (
                      <Flex align="baseline" gap={2} key={spec.name} wrap="wrap">
                        <Text color="var(--tt-ink, #16161a)" fontFamily="var(--tt-font-mono, monospace)" fontSize="12px" fontWeight={600}>
                          {spec.name}
                        </Text>
                        <Text color="var(--tt-muted, #9a9aa6)" fontSize="12px">
                          {describeArg(spec)}
                          {spec.default !== undefined ? ` · default ${JSON.stringify(spec.default)}` : ''}
                        </Text>
                        {spec.description && (
                          <Text color="var(--tt-faint, #b6b6c0)" fontSize="12px">
                            {spec.description}
                          </Text>
                        )}
                      </Flex>
                    ))}
                  </Flex>
                </Flex>
              )}

              <Flex direction="column" gap={1.5}>
                <Text {...monoLabel} title="System props stamped by Thingtime">
                  thingtime adds
                </Text>
                <Flex gap={1.5} wrap="wrap">
                  {systemFields.map((field) => (
                    <Text color="var(--tt-muted, #9a9aa6)" fontFamily="var(--tt-font-mono, monospace)" fontSize="11px" key={field.name}>
                      {field.name}: {describeSchemaField(field)}
                    </Text>
                  ))}
                </Flex>
              </Flex>

              <Flex direction="column" gap={1.5}>
                <Text {...monoLabel}>create via API</Text>
                <Box
                  as="pre"
                  background="var(--tt-card, #ffffff)"
                  border="1px solid var(--tt-border, #ececef)"
                  borderRadius="var(--tt-radius-xs, 7px)"
                  color="var(--tt-text, #33333c)"
                  fontFamily="var(--tt-font-mono, monospace)"
                  fontSize="11px"
                  overflow="auto"
                  padding={3}
                >
                  {`POST /api/v1/things\n${JSON.stringify(
                    {
                      thingtime: ['component'],
                      crystal: {
                        name: active.name,
                        library: active.library,
                        category: active.category,
                        ...(active.componentKey ? { componentKey: active.componentKey } : {}),
                        ...(active.familyKey ? { familyKey: active.familyKey } : {}),
                        args: '…',
                        render: '…'
                      }
                    },
                    null,
                    2
                  )}`}
                </Box>
              </Flex>

              <Flex direction="column" gap={1.5}>
                <Text {...monoLabel}>definition</Text>
                <Box
                  as="pre"
                  background="var(--tt-card, #ffffff)"
                  border="1px solid var(--tt-border, #ececef)"
                  borderRadius="var(--tt-radius-xs, 7px)"
                  color="var(--tt-text, #33333c)"
                  fontFamily="var(--tt-font-mono, monospace)"
                  fontSize="11px"
                  maxHeight="420px"
                  overflow="auto"
                  padding={3}
                >
                  {JSON.stringify(
                    {
                      name: active.name,
                      library: active.library,
                      category: active.category,
                      componentKey: active.componentKey,
                      familyKey: active.familyKey,
                      version: active.version,
                      args: active.args,
                      ...(active.savedArgs ? { savedArgs: active.savedArgs } : {}),
                      render: active.render
                    },
                    null,
                    2
                  )}
                </Box>
              </Flex>
            </Flex>
          </>
        )}
      </Flex>
    </Flex>
  );
};

// Local slim arg input row (the browse card has its own richer variant).
const ArgRow = ({
  spec,
  value,
  onChange
}: {
  spec: ComponentArgSpec;
  value: string | number | boolean | undefined;
  onChange: (spec: ComponentArgSpec, raw: string | boolean) => void;
}) => (
  <Flex align="center" gap={2}>
    <Text
      color="var(--tt-muted, #9a9aa6)"
      fontFamily="var(--tt-font-mono, monospace)"
      fontSize="11px"
      minWidth="90px"
      noOfLines={1}
      title={spec.description || spec.name}
    >
      {spec.label || spec.name}
    </Text>
    {spec.type === 'boolean' ? (
      <input checked={!!value} onChange={(event) => onChange(spec, event.target.checked)} type="checkbox" />
    ) : spec.type === 'enum' ? (
      <select
        onChange={(event) => onChange(spec, event.target.value)}
        style={{ border: '1px solid var(--tt-border, #ececef)', borderRadius: 7, fontSize: 13, padding: '4px 8px' }}
        value={String(value ?? '')}
      >
        {(spec.values || []).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    ) : (
      <input
        max={spec.max}
        min={spec.min}
        maxLength={spec.maxLength}
        onChange={(event) => onChange(spec, event.target.value)}
        style={{
          border: '1px solid var(--tt-border, #ececef)',
          borderRadius: 7,
          flex: 1,
          fontSize: 13,
          padding: '4px 8px'
        }}
        type={spec.type === 'number' ? 'number' : spec.type === 'color' ? 'color' : 'text'}
        value={String(value ?? '')}
      />
    )}
  </Flex>
);
