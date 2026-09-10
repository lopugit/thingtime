import React from 'react';
import { Box, Button, Flex, Heading, Stack, Text, Textarea } from '@chakra-ui/react';
import { Link } from 'react-router';
import { RichTextBlocks } from '~/components/Kinds/kindRenderersMedia';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { CARD_STYLES } from '~/theme/card';

type CommentThing = { id: string; author?: { username?: string } | null; crystal: Record<string, any>; createdAt: string };

// The parent is only an identifier. Discussion state is neither read from nor
// written into its crystal, cache or embedded interaction fields.
export function ThingComments({ thingId, linkKey = '' }: { thingId: string; linkKey?: string }) {
	const user = useCurrentUser();
	return <Discussion key={`${user?.id || 'anonymous'}:${thingId}:${linkKey}`} thingId={thingId} linkKey={linkKey} />;
}

function Discussion({ thingId, linkKey }: { thingId: string; linkKey: string }) {
	const api = useApi();
	const user = useCurrentUser();
	const apiRef = React.useRef(api);
	apiRef.current = api;
	const live = React.useRef(true);
	const generation = React.useRef(0);
	const posting = React.useRef(false);
	const [comments, setComments] = React.useState<CommentThing[]>([]);
	const [cursor, setCursor] = React.useState<string | null>(null);
	const [loading, setLoading] = React.useState(false);
	const [loaded, setLoaded] = React.useState(false);
	const [error, setError] = React.useState('');
	const [draft, setDraft] = React.useState('');
	const [sending, setSending] = React.useState(false);
	const request = React.useRef<{ text: string; shareId: string } | null>(null);
	const fresh = React.useRef(new Map<string, CommentThing>());
	const load = React.useCallback(async (after?: string) => {
		const epoch = ++generation.current;
		setLoading(true); setError('');
		const previousFresh = new Set(fresh.current.keys());
		try {
			const { requireThingtimeCapability } = await import('~/api/utils/capabilities/requireCapability.client');
			await requireThingtimeCapability('api.things', '1.7.0');
			const response = await apiRef.current.v1.things.list({ target: thingId, thingtime: 'comment', key: linkKey, cursor: after, limit: 20 });
			if (!live.current || epoch !== generation.current) return;
			if (!response?.ok) throw Object.assign(new Error(response?.error || 'Could not load comments.'), { status: response?.status });
			for (const id of previousFresh) fresh.current.delete(id);
			setComments(previous => [...new Map<string, CommentThing>([...fresh.current.values(), ...(after ? previous : []), ...response.things].map(item => [item.id, item])).values()]);
			setCursor(response.nextCursor || null); setLoaded(true);
		} catch (failure) { if (live.current && epoch === generation.current) {
			if ([401, 403, 404].includes(Number((failure as any)?.status))) { setComments([]); fresh.current.clear(); setLoaded(false); }
			setError(failure instanceof Error ? failure.message : 'Could not load comments.');
		} }
		finally { if (live.current && epoch === generation.current) setLoading(false); }
	}, [thingId, linkKey]);
	React.useEffect(() => { live.current = true; void load(); return () => { live.current = false; ++generation.current; }; }, [load]);
	const submit = async () => {
		const text = draft.trim();
		if (!text || posting.current) return;
		posting.current = true;
		if (request.current?.text !== text) request.current = { text, shareId: crypto.randomUUID() };
		setSending(true); setError('');
		try {
			const { requireThingtimeCapability } = await import('~/api/utils/capabilities/requireCapability.client');
			await requireThingtimeCapability('api.things-comment', '1.4.0');
			const response = await apiRef.current.v1.things.comment({ id: thingId, key: linkKey, ...request.current });
			if (!live.current) return;
			if (!response?.ok) throw new Error(response?.error || 'Could not post comment.');
			const item: CommentThing = { id: response.comment.id, author: response.comment.author, crystal: { text: response.comment.text }, createdAt: response.comment.createdAt };
			fresh.current.set(item.id, item);
			setComments(previous => [item, ...previous.filter(comment => comment.id !== item.id)]);
			setDraft(''); request.current = null;
		} catch (failure) { if (live.current) setError(failure instanceof Error ? failure.message : 'Could not post comment.'); }
		finally { posting.current = false; if (live.current) setSending(false); }
	};
	return <Box {...CARD_STYLES} p={{ base: 4, md: 6 }} minW={0} data-testid="thing-comments">
		<Flex justify="space-between" align="center" gap={2} wrap="wrap"><Heading as="h2" size="sm">Comments</Heading><Button size="sm" variant="ghost" isDisabled={loading || sending} onClick={() => void load()}>Refresh comments</Button></Flex>
		<Text color="var(--tt-muted)" fontSize="sm" mt={2}>A separate discussion linked to this Thing. Comments follow its visibility and do not change its data.</Text>
		<Stack spacing={4} mt={4}>
			{comments.map(comment => <Box key={comment.id} borderTop="1px solid var(--tt-border)" pt={3} minW={0}>
				<Flex gap={2} wrap="wrap" fontSize="xs" color="var(--tt-muted)"><Text>{comment.author?.username ? `@${comment.author.username}` : 'Account unavailable'}</Text><Text as="time" dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleString()}</Text><Link to={`/thing/${encodeURIComponent(comment.id)}${linkKey ? `?key=${encodeURIComponent(linkKey)}` : ''}`}>Open comment / replies</Link></Flex>
				<Box mt={2} overflowWrap="anywhere">{comment.crystal.richText?.blocks ? <RichTextBlocks blocks={comment.crystal.richText.blocks} bodyFontSize="sm" /> : <Text whiteSpace="pre-wrap">{String(comment.crystal.text || '')}</Text>}</Box>
			</Box>)}
			{loaded && !comments.length ? <Text color="var(--tt-muted)" fontSize="sm">No comments yet.</Text> : null}
			{cursor ? <Button variant="outline" isDisabled={loading} onClick={() => void load(cursor)}>Load older comments</Button> : null}
			{error ? <Text role="alert" color="red.500" fontSize="sm">{error}</Text> : null}
			{user ? <Box as="form" onSubmit={event => { event.preventDefault(); void submit(); }}>
				<Textarea aria-label="Write a comment" placeholder="Add context, a question, or a note…" value={draft} maxLength={4000} isDisabled={sending} onChange={event => setDraft(event.target.value)} />
				<Button mt={2} type="submit" isDisabled={sending || !draft.trim()}>{sending ? 'Posting…' : 'Post comment'}</Button>
			</Box> : <Text fontSize="sm">Sign in to add a comment.</Text>}
		</Stack>
	</Box>;
}
