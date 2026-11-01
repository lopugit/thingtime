import React from 'react';
import { Box, Button, Flex, Heading, Input, SimpleGrid, Text, Textarea } from '@chakra-ui/react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useLopu } from '~/components/Lopu/useLopu';
import { DEFAULT_ALGORITHMS } from '~/components/Feed/defaultAlgorithms';
import type { PublicAlgorithm } from '~/components/Feed/feedTypes';

type Entry = { id: string; name: string; emoji: string; description?: string; ownerUsername?: string | null; eventCount: number };
const card = { border: '1px solid var(--tt-border, #ececef)', borderRadius: '16px', background: 'var(--tt-card, white)', p: 4 };

export default function Algorithms() {
	const api = useApi();
	const apiRef = React.useRef(api);
	apiRef.current = api;
	const user = useCurrentUser();
	const lopu = useLopu();
	const navigate = useNavigate();
	const [params, setParams] = useSearchParams();
	const query = params.get('q') || '';
	const [entries, setEntries] = React.useState<Entry[]>([]);
	const [mine, setMine] = React.useState<PublicAlgorithm[]>([]);
	const [cursor, setCursor] = React.useState<string | null>(null);
	const [loading, setLoading] = React.useState(false);
	const [error, setError] = React.useState('');
	const [editing, setEditing] = React.useState(false);
	const [name, setName] = React.useState('');
	const [description, setDescription] = React.useState('');
	const [publish, setPublish] = React.useState(false);
	const [busy, setBusy] = React.useState<string | null>(null);
	const seq = React.useRef(0);
	const viewer = React.useRef(user?.id);
	viewer.current = user?.id;
	const load = React.useCallback(
		async (after?: string | null) => {
			const request = ++seq.current;
			setLoading(true);
			setError('');
			try {
				const response = await apiRef.current.v1.algorithms.search({ q: query, cursor: after || undefined });
				if (request !== seq.current) return;
				setEntries((old) =>
					after ? [...old, ...response.algorithms.filter((entry: Entry) => !old.some((item) => item.id === entry.id))] : response.algorithms
				);
				setCursor(response.nextCursor);
			} catch (err: any) {
				if (request === seq.current) {
					setError(err?.error || err?.message || 'Could not load algorithms.');
					if (!after) setEntries([]);
				}
			} finally {
				if (request === seq.current) setLoading(false);
			}
		},
		[query]
	);
	React.useEffect(() => {
		++seq.current;
		const timer = setTimeout(() => void load(), 200);
		return () => {
			clearTimeout(timer);
			++seq.current;
		};
	}, [load]);
	const loadMine = React.useCallback(async () => {
		const id = viewer.current;
		if (!id) return;
		try {
			const response = await apiRef.current.v1.algorithms.list();
			if (viewer.current === id) setMine(response.algorithms);
		} catch {
			/* public directory remains usable */
		}
	}, []);
	React.useEffect(() => {
		setMine([]);
		setEditing(false);
		void loadMine();
	}, [user?.id, loadMine]);
	const create = async (branch?: Entry) => {
		if (!user) {
			navigate('/login');
			return;
		}
		if (busy) return;
		setBusy(branch?.id || 'create');
		try {
			const response = await apiRef.current.v1.algorithms.create(
				branch ? { name: `${branch.name}`.slice(0, 60), emoji: branch.emoji, branchFrom: branch.id } : { name, description, emoji: '🧠' }
			);
			setEditing(false);
			setName('');
			setDescription('');
			if (!branch && publish) {
				try {
					await apiRef.current.v1.algorithms.update({ id: response.algorithm.id, listed: true });
				} catch {
					lopu({ title: 'Saved privately', description: 'Publishing failed. You can retry from Your algorithms below.', status: 'info' });
				}
			}
			setPublish(false);
			await loadMine();
			await load();
			lopu({
				title: branch ? 'Your private copy is ready 🌿' : 'Algorithm created 🧠',
				description: 'Choose Use in feed to train it as you scroll.',
				status: 'success'
			});
		} catch (err: any) {
			lopu({ title: err?.error || 'Could not create algorithm', status: 'error' });
		} finally {
			setBusy(null);
		}
	};
	const update = async (item: PublicAlgorithm, action: 'publish' | 'unpublish' | 'share' | 'use') => {
		if (busy) return;
		setBusy(item.id);
		try {
			if (action === 'use') {
				await apiRef.current.v1.algorithms.setActive({ algorithmId: item.id });
				navigate('/feed');
				return;
			}
			if (action === 'publish') await apiRef.current.v1.algorithms.update({ id: item.id, listed: true });
			if (action === 'unpublish') await apiRef.current.v1.algorithms.update({ id: item.id, listed: false });
			if (action === 'share') {
				if (!item.shared) await apiRef.current.v1.algorithms.update({ id: item.id, shared: true });
				const href = `${window.location.origin}/feed?algorithm=${encodeURIComponent(item.id)}`;
				try {
					await navigator.clipboard.writeText(href);
					lopu({ title: 'Share link copied 🔗', status: 'success' });
				} catch {
					lopu({ title: 'Share link ready', link: { label: 'Open share link', href }, status: 'info' });
				}
			}
			await loadMine();
			await load();
		} catch (err: any) {
			lopu({ title: err?.error || 'Could not update algorithm', status: 'error' });
		} finally {
			setBusy(null);
		}
	};
	const defaults = DEFAULT_ALGORITHMS.filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(query.toLowerCase().trim()));
	return (
		<Box
			width="100%"
			minH="100vh"
			bg="var(--tt-surface, #fafafb)"
			color="var(--tt-ink, #16161a)"
			pt="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px) + 24px)"
			pb={16}
			px={4}
		>
			<Flex width="100%" maxW="920px" mx="auto" direction="column" gap={6}>
				<Link to="/feed">← Back to feed</Link>
				<Flex justify="space-between" align="center" gap={3} wrap="wrap">
					<Box>
						<Heading as="h1" size="lg">
							Algorithms 🧠
						</Heading>
						<Text mt={2}>Find your perspective. Create a feed, share it, or make it your own.</Text>
					</Box>
					<Button onClick={() => (user ? setEditing(!editing) : navigate('/login'))}>{editing ? 'Close editor' : 'Create algorithm'}</Button>
				</Flex>
				{editing && (
					<Box
						{...card}
						as="form"
						onSubmit={(event: React.FormEvent) => {
							event.preventDefault();
							void create();
						}}
					>
						<Heading size="sm" mb={3}>
							Create a learning algorithm
						</Heading>
						<Text as="label" htmlFor="algorithm-name">
							Name
						</Text>
						<Input id="algorithm-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={60} required mb={3} />
						<Text as="label" htmlFor="algorithm-description">
							Description
						</Text>
						<Textarea
							id="algorithm-description"
							value={description}
							onChange={(event) => setDescription(event.target.value)}
							maxLength={300}
							mb={3}
						/>
						<Text fontSize="sm" mb={3}>
							Starts with a fresh perspective and learns from the posts you read and engage with. Your description helps people discover it; it is not
							an instruction to the ranking engine.
						</Text>
						<label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
							<input type="checkbox" checked={publish} onChange={(event) => setPublish(event.target.checked)} />
							Publish to directory
						</label>
						<Text fontSize="xs" mt={2} mb={3}>
							Publishing or sharing lets others copy your learned interests, including author and topic preferences. Copies remain independent even if
							you stop sharing.
						</Text>
						<Button type="submit" isDisabled={!name.trim() || !!busy} isLoading={busy === 'create'}>
							Create
						</Button>
					</Box>
				)}
				<Input
					aria-label="Search algorithms"
					placeholder="Search algorithms…"
					value={query}
					maxLength={80}
					bg="var(--tt-card, white)"
					onChange={(event) => setParams(event.target.value ? { q: event.target.value } : {}, { replace: true })}
				/>
				<Box>
					<Heading size="md" mb={3}>
						Built-in perspectives
					</Heading>
					<SimpleGrid columns={[1, 2]} spacing={3}>
						{defaults.map((item) => (
							<Box {...card} key={item.id}>
								<Heading size="sm">
									{item.emoji} {item.name}
								</Heading>
								<Text my={3} fontSize="sm">
									{item.description}
								</Text>
								<Button as={Link} to={`/feed?sort=${item.id}`} size="sm">
									Use in feed
								</Button>
							</Box>
						))}
					</SimpleGrid>
				</Box>
				{user && (
					<Box>
						<Heading size="md" mb={3}>
							Your algorithms
						</Heading>
						<Text fontSize="sm" mb={3}>
							Share links allow copying your learned profile. Publishing also makes the name, description and training count searchable. Unpublishing
							keeps existing share links working; turn off sharing in Settings to revoke them.
						</Text>
						<Flex direction="column" gap={3}>
							{mine.map((item) => (
								<Box {...card} key={item.id} overflowWrap="anywhere">
									<Heading size="sm">
										{item.emoji} {item.name}
									</Heading>
									<Text my={2} fontSize="sm">
										{item.description || 'Learns as you scroll'} · {item.eventCount} signals ·{' '}
										{item.listed ? 'Published' : item.shared ? 'Link only' : 'Private'}
									</Text>
									<Flex gap={2} wrap="wrap">
										<Button size="sm" isDisabled={!!busy} onClick={() => update(item, 'use')}>
											Use in feed
										</Button>
										<Button size="sm" isDisabled={!!busy} onClick={() => update(item, 'share')}>
											Share link
										</Button>
										<Button size="sm" isDisabled={!!busy} onClick={() => update(item, item.listed ? 'unpublish' : 'publish')}>
											{item.listed ? 'Unpublish' : 'Publish to directory'}
										</Button>
									</Flex>
								</Box>
							))}
						</Flex>
						{!mine.length && <Text fontSize="sm">Create your first algorithm or branch a community algorithm below.</Text>}
					</Box>
				)}
				<Box>
					<Heading size="md" mb={3}>
						Community algorithms
					</Heading>
					{error && (
						<Text role="alert">
							{error}{' '}
							<Button size="sm" onClick={() => load()}>
								Retry
							</Button>
						</Text>
					)}
					{!entries.length && !error && (
						<Text role="status">{loading ? 'Finding algorithms…' : 'No published algorithms found. Be the first to share one.'}</Text>
					)}
					<SimpleGrid columns={[1, 2]} spacing={3}>
						{entries.map((item) => (
							<Box {...card} key={item.id} overflowWrap="anywhere">
								<Heading size="sm">
									{item.emoji} {item.name}
								</Heading>
								<Text fontSize="xs" my={2}>
									{item.ownerUsername ? `@${item.ownerUsername}` : 'Community member'} · {item.eventCount} training signals
								</Text>
								<Text fontSize="sm" mb={3}>
									{item.description || 'A perspective shaped by its creator.'}
								</Text>
								<Flex gap={2} wrap="wrap">
									<Button as={Link} size="sm" to={`/feed?algorithm=${encodeURIComponent(item.id)}`}>
										View shared algorithm
									</Button>
									<Button size="sm" isDisabled={!!busy} isLoading={busy === item.id} onClick={() => create(item)}>
										Branch a copy
									</Button>
								</Flex>
							</Box>
						))}
					</SimpleGrid>
					{cursor && (
						<Button mt={4} isLoading={loading} onClick={() => load(cursor)}>
							Load more
						</Button>
					)}
				</Box>
			</Flex>
		</Box>
	);
}
