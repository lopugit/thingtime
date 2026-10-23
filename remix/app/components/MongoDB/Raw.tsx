import React from 'react';
import {
  Accordion,
  AccordionButton,
  AccordionIcon,
  AccordionItem,
  AccordionPanel,
  Badge,
  Box,
  Button,
  Flex,
  Heading,
  Input,
  Select,
  Switch,
  Text
} from '@chakra-ui/react';

import {
  MONGO_QUERY_COLLECTIONS,
  MONGO_QUERY_LIMITS,
  MONGO_QUERY_OPERATIONS,
  MONGO_SENSITIVE_QUERY_COLLECTIONS,
  type MongoQueryCollection,
  type MongoQueryOperation,
  type MongoQuerySuccess
} from '~/api/utils/mongodb/queryContract';
import { useLopu } from '~/components/Lopu/useLopu';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { FilterBuilder } from './FilterBuilder';
import { PipelineBuilder } from './PipelineBuilder';
import { RawResults } from './RawResults';
import {
  QueryBuilderError,
  compileMongoQueryRequest,
  createInitialWorkbenchState,
  makeBuilderId,
  type MongoWorkbenchState,
  type ProjectionRow,
  type SortRow
} from './queryBuilderState';

const inputStyles = {
  background: 'var(--tt-surface-alt, #f5f5f7)',
  border: '1px solid var(--tt-border, #ececef)',
  borderRadius: 'var(--tt-radius-sm, 9px)'
} as const;

const sensitiveCollections = new Set<string>(MONGO_SENSITIVE_QUERY_COLLECTIONS);
const explainDisabledOperations = new Set<MongoQueryOperation>([
  'estimatedDocumentCount',
  'indexes',
  'collectionStats'
]);

const SectionCard = ({
  eyebrow,
  title,
  description,
  children
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) => (
  <Flex
    flexDirection="column"
    rowGap={4}
    minWidth={0}
    padding={{ base: 4, md: 5 }}
    border="1px solid var(--tt-border, #ececef)"
    borderRadius="var(--tt-radius-lg, 16px)"
    background="var(--tt-card, #ffffff)"
    boxShadow="var(--tt-shadow-card, 0 1px 2px rgba(0, 0, 0, 0.05))"
  >
    <Box>
      <Text fontSize="10px" fontWeight={700} letterSpacing="0.12em" textTransform="uppercase" color="var(--tt-muted, #777783)">
        {eyebrow}
      </Text>
      <Heading size="sm" letterSpacing="-0.015em" color="var(--tt-ink, #16161a)">
        {title}
      </Heading>
      {description ? (
        <Text paddingTop={1} maxWidth="760px" fontSize="sm" color="var(--tt-muted, #777783)">
          {description}
        </Text>
      ) : null}
    </Box>
    {children}
  </Flex>
);

const ProjectionBuilder = ({ value, onChange }: { value: ProjectionRow[]; onChange: (value: ProjectionRow[]) => void }) => {
  const update = (index: number, row: ProjectionRow) => {
    const next = [...value];
    next[index] = row;
    onChange(next);
  };
  return (
    <Flex flexDirection="column" rowGap={2} minWidth={0}>
      {value.map((row, index) => (
        <Flex key={row.id} gap={2} flexWrap={{ base: 'wrap', md: 'nowrap' }}>
          <Input
            aria-label="Projection field"
            size="sm"
            fontFamily="mono"
            value={row.field}
            placeholder="field.path"
            onChange={(event) => update(index, { ...row, field: event.target.value })}
            {...inputStyles}
          />
          <Select
            aria-label="Projection mode"
            size="sm"
            width={{ base: 'calc(100% - 42px)', md: '160px' }}
            flexShrink={0}
            value={row.mode}
            onChange={(event) => update(index, { ...row, mode: event.target.value as ProjectionRow['mode'] })}
            {...inputStyles}
          >
            <option value="include">Include</option>
            <option value="exclude">Exclude</option>
          </Select>
          <Button
            aria-label="Remove projection field"
            size="sm"
            variant="ghost"
            colorScheme="red"
            flexShrink={0}
            onClick={() => onChange(value.filter((_, rowIndex) => rowIndex !== index))}
          >
            ✕
          </Button>
        </Flex>
      ))}
      <Box>
        <Button
          size="xs"
          variant="outline"
          onClick={() => onChange([...value, { id: makeBuilderId('projection'), field: '', mode: 'include' }])}
        >
          + Projection field
        </Button>
      </Box>
    </Flex>
  );
};

const SortBuilder = ({ value, onChange }: { value: SortRow[]; onChange: (value: SortRow[]) => void }) => {
  const update = (index: number, row: SortRow) => {
    const next = [...value];
    next[index] = row;
    onChange(next);
  };
  return (
    <Flex flexDirection="column" rowGap={2} minWidth={0}>
      {value.map((row, index) => (
        <Flex key={row.id} gap={2} flexWrap={{ base: 'wrap', md: 'nowrap' }}>
          <Input
            aria-label="Sort field"
            size="sm"
            fontFamily="mono"
            value={row.field}
            placeholder="field.path"
            onChange={(event) => update(index, { ...row, field: event.target.value })}
            {...inputStyles}
          />
          <Select
            aria-label="Sort direction"
            size="sm"
            width={{ base: 'calc(100% - 42px)', md: '180px' }}
            flexShrink={0}
            value={row.direction}
            onChange={(event) => update(index, { ...row, direction: Number(event.target.value) as 1 | -1 })}
            {...inputStyles}
          >
            <option value={1}>Ascending · 1</option>
            <option value={-1}>Descending · -1</option>
          </Select>
          <Button
            aria-label="Remove sort field"
            size="sm"
            variant="ghost"
            colorScheme="red"
            flexShrink={0}
            onClick={() => onChange(value.filter((_, rowIndex) => rowIndex !== index))}
          >
            ✕
          </Button>
        </Flex>
      ))}
      <Box>
        <Button
          size="xs"
          variant="outline"
          onClick={() => onChange([...value, { id: makeBuilderId('sort'), field: '', direction: 1 }])}
        >
          + Sort field
        </Button>
      </Box>
    </Flex>
  );
};

const downloadText = (name: string, text: string) => {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
};

export const Raw = () => {
  const user = useCurrentUser();
  const api = useApi();
  const lopu = useLopu();
  const apiRef = React.useRef(api);
  apiRef.current = api;

  const [state, setState] = React.useState<MongoWorkbenchState>(() => createInitialWorkbenchState());
  const [response, setResponse] = React.useState<MongoQuerySuccess | null>(null);
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const controllerRef = React.useRef<AbortController | null>(null);
  const supportsMatchOptions = !['estimatedDocumentCount', 'indexes', 'collectionStats'].includes(state.operation);

  React.useEffect(
    () => () => {
      controllerRef.current?.abort();
    },
    []
  );

  const preview = React.useMemo(() => {
    try {
      return { text: JSON.stringify(compileMongoQueryRequest(state), null, 2), error: null };
    } catch (previewError) {
      return {
        text: '',
        error: previewError instanceof Error ? previewError.message : 'The query needs one more look'
      };
    }
  }, [state]);

  const execute = React.useCallback(
    async (explain = false) => {
      if (running) return;
      let request: Record<string, unknown>;
      try {
        request = compileMongoQueryRequest(state, explain);
      } catch (queryError) {
        const message = queryError instanceof QueryBuilderError ? queryError.message : 'Please check the query fields.';
        setError(message);
        lopu({ title: 'This query needs a tiny fix 🛠️', description: message, status: 'error' });
        return;
      }

      const controller = new AbortController();
      controllerRef.current = controller;
      setRunning(true);
      setError(null);
      try {
        const next = (await apiRef.current.v1.mongodb.rawResults(request, { signal: controller.signal })) as MongoQuerySuccess;
        setResponse(next);
        lopu({
          title: explain ? 'Execution plan ready 🧭' : 'Query complete ✨',
          description: `${next.resultCount} result${next.resultCount === 1 ? '' : 's'} in ${next.durationMs} ms`,
          status: 'success',
          duration: 4500
        });
      } catch (queryError: any) {
        if (controller.signal.aborted) return;
        const message = queryError?.error || queryError?.message || 'MongoDB could not run this query.';
        setError(message);
        lopu({ title: 'MongoDB could not run that query', description: message, status: 'error' });
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
          setRunning(false);
        }
      }
    },
    [lopu, running, state]
  );

  const cancel = () => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setRunning(false);
    lopu({ title: 'Query cancelled', status: 'info', duration: 3000 });
  };

  const copyQuery = async () => {
    if (preview.error) {
      setError(preview.error);
      return;
    }
    await navigator.clipboard.writeText(preview.text);
    lopu({ title: 'Query copied 📋', status: 'success', duration: 3500 });
  };

  if (!user?.isAdmin) {
    return (
      <Flex
        minHeight="60vh"
        alignItems="center"
        justifyContent="center"
        padding={6}
        border="1px solid var(--tt-border, #ececef)"
        borderRadius="var(--tt-radius-lg, 16px)"
        background="var(--tt-card, #ffffff)"
      >
        <Box maxWidth="520px" textAlign="center">
          <Text fontSize="3xl" paddingBottom={3}>
            🔐
          </Text>
          <Heading size="md">Admin access required</Heading>
          <Text paddingTop={2} color="var(--tt-muted, #777783)">
            The MongoDB workbench can inspect private application data, so both this page and every query are protected by the server-side admin gate.
          </Text>
        </Box>
      </Flex>
    );
  }

  const operation = MONGO_QUERY_OPERATIONS.find((entry) => entry.value === state.operation)!;
  const sensitiveCollection = sensitiveCollections.has(state.collection);
  const explainDisabled = explainDisabledOperations.has(state.operation);

  const setCollection = (collection: MongoQueryCollection) =>
    setState((current) => ({
      ...current,
      collection,
      operation: collection && sensitiveCollections.has(collection) && current.operation === 'aggregate' ? 'find' : current.operation
    }));

  return (
    <Flex
      flexDirection="column"
      rowGap={5}
      minWidth={0}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          void execute(false);
        }
      }}
    >
      <Flex alignItems="flex-start" gap={4} flexWrap="wrap">
        <Box maxWidth="760px">
          <Flex alignItems="center" gap={2} paddingBottom={2}>
            <Text fontFamily="mono" fontSize="10px" fontWeight={700} letterSpacing="0.14em" textTransform="uppercase" color="var(--tt-muted, #777783)">
              MongoDB · No-code
            </Text>
            <Badge colorScheme="purple" variant="subtle">
              Admin only
            </Badge>
            <Badge colorScheme="green" variant="subtle">
              Read only
            </Badge>
          </Flex>
          <Heading size="lg" letterSpacing="-0.025em" color="var(--tt-ink, #16161a)">
            Query Workbench
          </Heading>
          <Text paddingTop={2} color="var(--tt-muted, #777783)">
            Click together filters, typed BSON values, projections, sorts, and full read-only aggregation pipelines—then run, explain, copy, or export the result.
          </Text>
        </Box>
      </Flex>

      <SectionCard eyebrow="1 · Target" title="Choose a collection and query tool" description={operation.description}>
        <Flex gap={3} flexDirection={{ base: 'column', md: 'row' }}>
          <Box width={{ base: '100%', md: '280px' }} flexShrink={0}>
            <Text fontSize="xs" fontWeight={700} paddingBottom={1} color="var(--tt-muted, #777783)">
              Collection
            </Text>
            <Select
              aria-label="MongoDB collection"
              size="sm"
              value={state.collection}
              onChange={(event) => setCollection(event.target.value as MongoQueryCollection)}
              {...inputStyles}
            >
              {MONGO_QUERY_COLLECTIONS.map((collection) => (
                <option key={collection} value={collection}>
                  {collection}{sensitiveCollections.has(collection) ? ' · protected' : ''}
                </option>
              ))}
            </Select>
          </Box>
          <Box flex="1 1 auto" minWidth={0}>
            <Text fontSize="xs" fontWeight={700} paddingBottom={1} color="var(--tt-muted, #777783)">
              Operation
            </Text>
            <Flex gap={2} flexWrap="wrap">
              {MONGO_QUERY_OPERATIONS.map((entry) => {
                const disabled = entry.value === 'aggregate' && sensitiveCollection;
                return (
                  <Button
                    key={entry.value}
                    size="sm"
                    variant={state.operation === entry.value ? 'solid' : 'outline'}
                    colorScheme={state.operation === entry.value ? 'purple' : undefined}
                    isDisabled={disabled}
                    title={disabled ? 'Aggregation is disabled for collections containing authentication material.' : entry.description}
                    onClick={() => setState((current) => ({ ...current, operation: entry.value }))}
                  >
                    {entry.label}
                  </Button>
                );
              })}
            </Flex>
          </Box>
        </Flex>
        {sensitiveCollection ? (
          <Box padding={3} borderRadius="var(--tt-radius-md, 12px)" background="orange.50" color="orange.800">
            <Text fontSize="sm" fontWeight={700}>
              Protected collection
            </Text>
            <Text fontSize="xs">
              Passwords, tokens, session identifiers, credentials, private keys, and credentialed MongoDB URLs are always redacted. Computed projections and aggregation are disabled here so aliases cannot bypass that rule.
            </Text>
          </Box>
        ) : null}
      </SectionCard>

      <Flex
        padding={{ base: 3, md: 4 }}
        gap={2}
        alignItems="center"
        flexWrap="wrap"
        border="1px solid var(--tt-border, #ececef)"
        borderRadius="var(--tt-radius-lg, 16px)"
        background="var(--tt-surface, #fafafb)"
      >
        <Button colorScheme="purple" size="sm" isLoading={running} loadingText="Running" onClick={() => void execute(false)}>
          Run query · ⌘↵
        </Button>
        {running ? (
          <Button size="sm" variant="outline" onClick={cancel}>
            Cancel
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          isDisabled={running || explainDisabled}
          title={explainDisabled ? 'Explain is not available for this metadata operation.' : 'Run with executionStats verbosity.'}
          onClick={() => void execute(true)}
        >
          Explain plan
        </Button>
        <Button size="sm" variant="ghost" onClick={copyQuery}>
          Copy query
        </Button>
        <Button
          size="sm"
          variant="ghost"
          isDisabled={!!preview.error}
          onClick={() => downloadText(`thingtime-${state.collection}-${state.operation}-query.json`, preview.text)}
        >
          Export query
        </Button>
        <Button
          size="sm"
          variant="ghost"
          marginLeft={{ base: 0, md: 'auto' }}
          onClick={() => {
            setState(createInitialWorkbenchState());
            setError(null);
            lopu({ title: 'Query reset ✨', status: 'info', duration: 3000 });
          }}
        >
          Reset
        </Button>
      </Flex>

      {['find', 'findOne', 'countDocuments', 'distinct'].includes(state.operation) ? (
        <SectionCard
          eyebrow="2 · Filter"
          title="Match the documents you want"
          description="Nest ALL, ANY, and NONE groups, then choose from MongoDB comparison, logical, array, type, bitwise, evaluation, and geospatial predicates. A blank builder means match everything."
        >
          <FilterBuilder value={state.filter} onChange={(filter) => setState((current) => ({ ...current, filter }))} />
          {state.operation === 'distinct' ? (
            <Box maxWidth="440px">
              <Text fontSize="xs" fontWeight={700} paddingBottom={1} color="var(--tt-muted, #777783)">
                Distinct field
              </Text>
              <Input
                aria-label="Distinct field"
                size="sm"
                fontFamily="mono"
                value={state.distinctField}
                placeholder="crystal.type"
                onChange={(event) => setState((current) => ({ ...current, distinctField: event.target.value }))}
                {...inputStyles}
              />
            </Box>
          ) : null}
        </SectionCard>
      ) : null}

      {state.operation === 'aggregate' ? (
        <SectionCard
          eyebrow="2 · Pipeline"
          title="Build a read-only aggregation"
          description="Each stage uses the same recursive BSON document builder, so nested expressions, arrays, facets, and joins are clickable without JavaScript or eval. Mutating, change-stream, session-inspection, and server-JavaScript stages are blocked by the API."
        >
          <PipelineBuilder value={state.pipeline} onChange={(pipeline) => setState((current) => ({ ...current, pipeline }))} />
        </SectionCard>
      ) : null}

      {state.operation === 'find' || state.operation === 'findOne' ? (
        <SectionCard eyebrow="3 · Shape" title="Choose fields and ordering" description="Projection can include fields or exclude fields, but MongoDB does not allow both styles together except for _id.">
          <Flex gap={6} flexDirection={{ base: 'column', lg: 'row' }} minWidth={0}>
            <Box flex="1 1 0" minWidth={0}>
              <Text fontSize="xs" fontWeight={700} paddingBottom={2} color="var(--tt-muted, #777783)">
                Projection
              </Text>
              <ProjectionBuilder value={state.projection} onChange={(projection) => setState((current) => ({ ...current, projection }))} />
            </Box>
            <Box flex="1 1 0" minWidth={0}>
              <Text fontSize="xs" fontWeight={700} paddingBottom={2} color="var(--tt-muted, #777783)">
                Sort
              </Text>
              <SortBuilder value={state.sort} onChange={(sort) => setState((current) => ({ ...current, sort }))} />
            </Box>
          </Flex>
        </SectionCard>
      ) : null}

      <SectionCard eyebrow="{ } · Options" title="Bound execution and tune matching">
        <Accordion allowToggle>
          <AccordionItem border="0">
            <AccordionButton paddingX={0}>
              <Box as="span" flex="1" textAlign="left" fontSize="sm" fontWeight={700}>
                Query options
              </Box>
              <AccordionIcon />
            </AccordionButton>
            <AccordionPanel paddingX={0} paddingBottom={0}>
              <Flex flexDirection="column" rowGap={4}>
                <Flex gap={3} flexWrap="wrap">
                  {['find', 'aggregate', 'distinct', 'indexes'].includes(state.operation) ? (
                    <Box width={{ base: '100%', sm: '150px' }}>
                      <Text fontSize="xs" fontWeight={700} paddingBottom={1} color="var(--tt-muted, #777783)">
                        Result limit
                      </Text>
                      <Input
                        aria-label="Result limit"
                        size="sm"
                        type="number"
                        min={1}
                        max={MONGO_QUERY_LIMITS.maxLimit}
                        value={state.limit}
                        onChange={(event) => setState((current) => ({ ...current, limit: Number(event.target.value) }))}
                        {...inputStyles}
                      />
                    </Box>
                  ) : null}
                  {state.operation === 'find' || state.operation === 'findOne' ? (
                    <Box width={{ base: '100%', sm: '150px' }}>
                      <Text fontSize="xs" fontWeight={700} paddingBottom={1} color="var(--tt-muted, #777783)">
                        Skip
                      </Text>
                      <Input
                        aria-label="Documents to skip"
                        size="sm"
                        type="number"
                        min={0}
                        max={MONGO_QUERY_LIMITS.maxSkip}
                        value={state.skip}
                        onChange={(event) => setState((current) => ({ ...current, skip: Number(event.target.value) }))}
                        {...inputStyles}
                      />
                    </Box>
                  ) : null}
                  <Box width={{ base: '100%', sm: '170px' }}>
                    <Text fontSize="xs" fontWeight={700} paddingBottom={1} color="var(--tt-muted, #777783)">
                      Max time · ms
                    </Text>
                    <Input
                      aria-label="Maximum execution time"
                      size="sm"
                      type="number"
                      min={100}
                      max={MONGO_QUERY_LIMITS.maxMaxTimeMS}
                      value={state.maxTimeMS}
                      onChange={(event) => setState((current) => ({ ...current, maxTimeMS: Number(event.target.value) }))}
                      {...inputStyles}
                    />
                  </Box>
                  {supportsMatchOptions ? (
                    <Box minWidth={{ base: '100%', sm: '240px' }} flex="1 1 240px">
                      <Text fontSize="xs" fontWeight={700} paddingBottom={1} color="var(--tt-muted, #777783)">
                        Index hint · optional
                      </Text>
                      <Input
                        aria-label="Index hint"
                        size="sm"
                        fontFamily="mono"
                        value={state.hint}
                        placeholder="index_name"
                        onChange={(event) => setState((current) => ({ ...current, hint: event.target.value }))}
                        {...inputStyles}
                      />
                    </Box>
                  ) : null}
                </Flex>

                {supportsMatchOptions ? (
                  <>
                    <Flex alignItems="center" gap={2} flexWrap="wrap">
                      <Switch
                        aria-label="Enable collation"
                        size="sm"
                        isChecked={state.collationEnabled}
                        onChange={(event) =>
                          setState((current) => ({ ...current, collationEnabled: event.target.checked }))
                        }
                      />
                      <Text fontSize="sm" fontWeight={700}>
                        Locale collation
                      </Text>
                    </Flex>
                    {state.collationEnabled ? (
                      <Flex gap={3} flexWrap="wrap">
                        <Box width={{ base: '100%', sm: '160px' }}>
                          <Text fontSize="xs" fontWeight={700} paddingBottom={1} color="var(--tt-muted, #777783)">
                            Locale
                          </Text>
                          <Input
                            aria-label="Collation locale"
                            size="sm"
                            value={state.collationLocale}
                            onChange={(event) =>
                              setState((current) => ({ ...current, collationLocale: event.target.value }))
                            }
                            {...inputStyles}
                          />
                        </Box>
                        <Box width={{ base: '100%', sm: '180px' }}>
                          <Text fontSize="xs" fontWeight={700} paddingBottom={1} color="var(--tt-muted, #777783)">
                            Strength
                          </Text>
                          <Select
                            aria-label="Collation strength"
                            size="sm"
                            value={state.collationStrength}
                            onChange={(event) =>
                              setState((current) => ({
                                ...current,
                                collationStrength: Number(event.target.value)
                              }))
                            }
                            {...inputStyles}
                          >
                            <option value={1}>1 · Base characters</option>
                            <option value={2}>2 · Accents</option>
                            <option value={3}>3 · Case</option>
                            <option value={4}>4 · Punctuation</option>
                            <option value={5}>5 · Identical</option>
                          </Select>
                        </Box>
                        <Flex alignItems="center" gap={2}>
                          <Switch
                            aria-label="Collation case level"
                            size="sm"
                            isChecked={state.collationCaseLevel}
                            onChange={(event) =>
                              setState((current) => ({ ...current, collationCaseLevel: event.target.checked }))
                            }
                          />
                          <Text fontSize="xs">Case level</Text>
                        </Flex>
                        <Flex alignItems="center" gap={2}>
                          <Switch
                            aria-label="Collation numeric ordering"
                            size="sm"
                            isChecked={state.collationNumericOrdering}
                            onChange={(event) =>
                              setState((current) => ({
                                ...current,
                                collationNumericOrdering: event.target.checked
                              }))
                            }
                          />
                          <Text fontSize="xs">Numeric ordering</Text>
                        </Flex>
                      </Flex>
                    ) : null}
                  </>
                ) : null}

                {state.operation === 'aggregate' ? (
                  <Flex alignItems="center" gap={2}>
                    <Switch
                      aria-label="Allow aggregation disk use"
                      size="sm"
                      isChecked={state.allowDiskUse}
                      onChange={(event) => setState((current) => ({ ...current, allowDiskUse: event.target.checked }))}
                    />
                    <Text fontSize="sm">Allow temporary disk use for large aggregation stages</Text>
                  </Flex>
                ) : null}
              </Flex>
            </AccordionPanel>
          </AccordionItem>
        </Accordion>
      </SectionCard>

      <SectionCard eyebrow="Preview" title="Generated query request" description="This is the exact bounded JSON request sent to Thingtime's API. Typed BSON values use MongoDB Extended JSON.">
        <Accordion allowToggle>
          <AccordionItem border="0">
            <AccordionButton paddingX={0}>
              <Box as="span" flex="1" textAlign="left" fontSize="sm" fontWeight={700}>
                {preview.error ? 'Fix the builder to preview' : 'Show request JSON'}
              </Box>
              <AccordionIcon />
            </AccordionButton>
            <AccordionPanel paddingX={0} paddingBottom={0}>
              {preview.error ? (
                <Text role="alert" fontSize="sm" color="red.600">
                  {preview.error}
                </Text>
              ) : (
                <Box
                  as="pre"
                  margin={0}
                  maxHeight="420px"
                  overflow="auto"
                  whiteSpace="pre-wrap"
                  wordBreak="break-word"
                  padding={4}
                  fontFamily="mono"
                  fontSize="12px"
                  lineHeight={1.6}
                  background="var(--tt-surface, #fafafb)"
                  border="1px solid var(--tt-border, #ececef)"
                  borderRadius="var(--tt-radius-md, 12px)"
                >
                  {preview.text}
                </Box>
              )}
            </AccordionPanel>
          </AccordionItem>
        </Accordion>
      </SectionCard>

      <RawResults response={response} running={running} error={error} onClear={() => setResponse(null)} />
    </Flex>
  );
};
