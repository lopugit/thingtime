import React from 'react';
import { Box, Button, Checkbox, Flex, Input, Select, Text } from '@chakra-ui/react';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { commanderSearchResults } from '~/components/Search/commanderSearch';
import { isFolder, thingDisplayName, thingIcon, sortThings, type ThingsThing } from '~/components/Things/thingsCore';
import { isProtectedThingtime } from '~/schemas/registry';
import { MAX_POST_THINGS, type PostThingReference } from './postThingReferences';

// Commander search + the same owned folder/list vocabulary as /things. Labels
// are transient UI state; the published payload contains only ids and modes.
export function PostThingPicker({ value, onChange }: { value: PostThingReference[]; onChange: (value: PostThingReference[]) => void }) {
  const api = useApi();
  const user = useCurrentUser();
  const apiRef = React.useRef(api); apiRef.current = api;
  const [query, setQuery] = React.useState('');
  const [path, setPath] = React.useState<Array<{ id: string; title: string }>>([]);
  const [items, setItems] = React.useState<ThingsThing[]>([]);
  const [labels, setLabels] = React.useState<Record<string, string>>({});
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [page, setPage] = React.useState<string | null>(null);
  const folder = path.at(-1)?.id || null;
  const request = `${user?.id || ''}:${query.trim()}:${folder || ''}`;
  const active = React.useRef(request); active.current = request;
  React.useEffect(() => { setPage(null); setCursor(null); setItems([]); }, [request]);
  React.useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true); setError('');
      try {
        const result = query.trim()
          ? await apiRef.current.v1.things.search({ q: query.trim(), limit: 30, cursor: page || undefined })
          : await apiRef.current.v1.things.list({ folder: folder || 'root', limit: 50, cursor: page || undefined });
        if (cancelled || active.current !== request) return;
        if (!result?.ok) throw new Error(result?.error || 'Could not load Things.');
        let rows = ((result.things || []) as ThingsThing[]).filter(thing => !isProtectedThingtime(thing.thingtime));
        if (query.trim()) {
          const ordered = commanderSearchResults({ query, things: rows, posts: result.posts, thingLimit: 30, peopleLimit: 0 });
          const byId = new Map(rows.map(thing => [thing.id, thing]));
          rows = ordered.flatMap(row => byId.has(row.id) ? [byId.get(row.id)!] : []);
        } else rows = sortThings(rows, 'name');
        setItems(previous => page ? [...new Map([...previous, ...rows].map(thing => [thing.id, thing])).values()] : rows);
        setLabels(previous => ({ ...previous, ...Object.fromEntries(rows.map(thing => [thing.id, thingDisplayName(thing)])) }));
        setCursor(result.nextCursor || null);
      } catch (failure) { if (!cancelled) setError(failure instanceof Error ? failure.message : 'Could not load Things.'); }
      finally { if (!cancelled) setLoading(false); }
    }, query.trim() ? 220 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [request, page, user?.id]);
  const selected = new Set(value.map(item => item.id));
  const toggle = (id: string) => onChange(selected.has(id) ? value.filter(item => item.id !== id) : value.length < MAX_POST_THINGS ? [...value, { id, mode: 'interactive' }] : value);
  return <Box border="1px solid var(--tt-border)" borderRadius="12px" p={3} minW={0} data-testid="post-thing-picker">
    <Input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search Things with Commander…" aria-label="Search Things to attach" size="sm" />
    <Flex gap={1} wrap="wrap" my={2} align="center">
      <Button size="xs" variant="ghost" onClick={() => { setQuery(''); setPath([]); }}>All my Things</Button>
      {path.map((entry, index) => <Button key={entry.id} size="xs" variant="ghost" maxW="180px" onClick={() => { setQuery(''); setPath(path.slice(0, index + 1)); }}>{entry.title}</Button>)}
      <Text fontSize="xs" color="var(--tt-muted)" ml="auto">{value.length}/{MAX_POST_THINGS} selected</Text>
    </Flex>
    <Box maxH="260px" overflowY="auto" borderTop="1px solid var(--tt-border)">
      {items.map(thing => <Flex key={thing.id} align="center" gap={2} py={2} minW={0} borderBottom="1px solid var(--tt-border)">
        <Checkbox size="md" minW="20px" sx={{ '.chakra-checkbox__control': { border: '2px solid var(--tt-muted, #9a9aa6)', width: '18px', height: '18px' } }} aria-label={`Attach ${thingDisplayName(thing)}`} isChecked={selected.has(thing.id)} isDisabled={!selected.has(thing.id) && value.length >= MAX_POST_THINGS} onChange={() => toggle(thing.id)} />
        <Text flexShrink={0}>{thingIcon(thing)}</Text>
        <Button variant="ghost" size="sm" flex={1} minW={0} justifyContent="flex-start" whiteSpace="normal" height="auto" py={1} textAlign="left" onClick={() => isFolder(thing) ? (setQuery(''), setPath([...path, { id: thing.id, title: thingDisplayName(thing) }])) : toggle(thing.id)}>{thingDisplayName(thing)}{isFolder(thing) ? ' ›' : ''}</Button>
      </Flex>)}
      {!items.length && <Text fontSize="sm" py={3} color="var(--tt-muted)">{loading ? 'Loading Things…' : 'No Things here.'}</Text>}
      {cursor && <Button size="sm" variant="ghost" isDisabled={loading} onClick={() => setPage(cursor)}>Load more</Button>}
    </Box>
    {error && <Text role="alert" color="red.500" fontSize="sm" mt={2}>{error}</Text>}
    {value.map(item => <Flex key={item.id} mt={2} gap={2} align="center" minW={0}>
      <Text fontSize="sm" flex={1} minW={0} noOfLines={2}>{labels[item.id] || item.id}</Text>
      <Select width="135px" flexShrink={0} size="xs" aria-label={`Display ${labels[item.id] || item.id}`} value={item.mode} onChange={event => onChange(value.map(entry => entry.id === item.id ? { ...entry, mode: event.target.value as PostThingReference['mode'] } : entry))}><option value="interactive">Interactive</option><option value="data">Data</option></Select>
      <Button size="xs" variant="ghost" aria-label={`Remove ${labels[item.id] || item.id}`} onClick={() => toggle(item.id)}>×</Button>
    </Flex>)}
    <Text fontSize="xs" color="var(--tt-muted)" mt={2}>Attached Things keep their own permissions. Readers only see Things they can access.</Text>
  </Box>;
}
