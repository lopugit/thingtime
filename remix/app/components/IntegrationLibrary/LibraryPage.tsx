import { libraryBuilderHref, libraryExamplePageId, libraryServicePageId } from '~/library/builderLinks';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import React from 'react';
import { Badge, Box, Button, Flex, Input, Select, SimpleGrid, Text } from '@chakra-ui/react';
import { Link, useParams, useSearchParams } from 'react-router';
import { PageHeader, PageShell } from '../Layout/PageShell';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useLopu } from '../Lopu/useLopu';
import { LIBRARY_CATEGORIES, LIBRARY_EXAMPLES, getLibraryExample, type LibraryExample } from '~/library/catalog';
import { exampleThings } from '~/library/reuse';
import { LibraryDemo } from './LibraryDemo';
const SIZE = 24;
const kinds = { component: 'Components', action: 'Actions', thing: 'API Things' };
const providers = [...new Set(LIBRARY_EXAMPLES.map((x) => x.provider))];
const panel = { border: '1px solid var(--tt-border, #e5e5e9)', borderRadius: '16px', background: 'var(--tt-surface-raised, white)' };

function Detail({ example }: { example: LibraryExample }) {
	const api = useApi();
	const user = useCurrentUser();
	const lopu = useLopu();
	const [tab, setTab] = React.useState('demo');
	const [saving, setSaving] = React.useState(false);
	const [saved, setSaved] = React.useState<string[]>([]);
	const savingRef = React.useRef(false);
	const copyId = React.useRef<string | null>(null);
	const save = async () => {
		if (savingRef.current || !user?.id) return;
		savingRef.current = true;
		setSaving(true);
		const prefix = (copyId.current ??= crypto.randomUUID());
		try {
			const ids: string[] = [];
			const things = exampleThings(example, prefix);
			for (let i = 0; i < things.length; i++) {
				const shareId = `library-copy-${prefix}-${i}`;
				let existing = await api.v1.things.get({ id: shareId }).catch(() => null);
				if (!existing?.thing) existing = await api.v1.things.create({ ...things[i], shareId });
				if (existing?.ok === false) throw new Error('Could not save this example.');
				ids.push(existing?.thing?.id || existing?.id || shareId);
			}
			setSaved(ids);
			lopu({
				title: 'Library example saved',
				description: 'Your private Things now include sample data, an input-preparation action, and a runnable component.',
				status: 'success'
			});
		} catch {
			lopu({ title: 'Could not finish saving', description: 'Try again to resume this copy without duplicating completed parts.', status: 'error' });
		} finally {
			setSaving(false);
			savingRef.current = false;
		}
	};
	const source = example.module
		? `import * as m from ${JSON.stringify(example.module)};\n\nconst input = ${JSON.stringify(
				example.input,
				null,
				2
		  )};\nconst root = document.getElementById('preview');\n\nasync function run() {\n  ${example.code}\n}\nconsole.log(await run());`
		: `// GET request to ${example.provider}\n// ${
				example.request?.auth ? 'Send the API key through your own server; never publish it.' : 'No account needed.'
		  }\n${JSON.stringify({ url: example.request!.url, params: example.request!.params || {}, input: example.input }, null, 2)}`;
	return (
		<>
			<Flex gap={3} flexWrap="wrap">
				<Link to="/library">← All 500 examples</Link>
				<Link to={libraryBuilderHref(libraryServicePageId(example.provider))}>All {example.provider} in Builder</Link>
				<Link to={libraryBuilderHref(libraryExamplePageId(example.id))}>Open example in Builder →</Link>
			</Flex>
			<PageHeader eyebrow={`${example.provider} / ${example.category}`} title={example.title} variant="ink" subtitle={example.description} />
			<Flex gap={2} flexWrap="wrap">
				<Badge>{kinds[example.kind]}</Badge>
				<Badge>{example.request?.auth ? 'API key required' : 'No key needed'}</Badge>
				<Badge>{example.module ? 'Remote module' : 'Live API'}</Badge>
			</Flex>
			<Flex gap={2} role="tablist" aria-label="Example views">
				{[
					['demo', 'Try it'],
					['source', 'Source'],
					['reuse', 'Reuse in Thingtime']
				].map(([key, label]) => (
					<Button key={key} role="tab" aria-selected={tab === key} variant={tab === key ? 'solid' : 'ghost'} onClick={() => setTab(key)} size="sm">
						{label}
					</Button>
				))}
			</Flex>
			<Box {...panel} p={[4, 6]} minW={0}>
				<Box display={tab === 'demo' ? 'block' : 'none'}>
					<LibraryDemo example={example} />
				</Box>
				{tab === 'source' && (
					<>
						<Text mb={3}>Version-pinned imports and editable sample inputs. Visual examples expect a preview element.</Text>
						<Box
							as="pre"
							p={4}
							bg="var(--tt-surface-sunken, #f1f1f4)"
							borderRadius="10px"
							whiteSpace="pre-wrap"
							overflowWrap="anywhere"
							fontSize="12px"
						>
							{source}
						</Box>
						<Button
							mt={3}
							size="sm"
							onClick={async () => {
								try {
									await navigator.clipboard.writeText(source);
									lopu({ title: 'Source copied', status: 'success' });
								} catch {
									lopu({ title: 'Select the source to copy it', status: 'info' });
								}
							}}
						>
							Copy source
						</Button>
					</>
				)}
				{tab === 'reuse' && (
					<>
						<Text as="h2" fontWeight={700} fontSize="lg">
							Three reusable Things
						</Text>
						<Text my={3}>
							Save the sample data, an Action Thing that prepares inputs, and a Component Thing that runs the remote example when you press Run. Add
							the component to any builder page.
						</Text>
						<Text fontSize="sm" mb={4}>
							The action returns the example ID and JSON inputs. Remote execution happens in the component. Your API key and live results are never
							included in the saved copy.
						</Text>
						{user?.id ? (
							<Button onClick={save} isDisabled={saving || saved.length > 0}>
								{saving ? 'Saving…' : saved.length ? 'Saved to your Things' : 'Save example to my Things'}
							</Button>
						) : (
							<Button as={Link} to="/login">
								Sign in to save
							</Button>
						)}
						{saved.length > 0 && (
							<Flex gap={4} mt={4} flexWrap="wrap">
								<Link to={`/thing/${saved[0]}`}>Data Thing ↗</Link>
								<Link to={`/actions/${saved[1]}`}>Preparation action ↗</Link>
								<Link to={`/components/${saved[2]}`}>Runnable component ↗</Link>
							</Flex>
						)}
					</>
				)}
			</Box>
			<Flex gap={4} flexWrap="wrap" fontSize="sm">
				<a href={example.docs} target="_blank" rel="noreferrer">
					Official documentation ↗
				</a>
				{example.module && (
					<a href={example.module} target="_blank" rel="noreferrer">
						Pinned remote module ↗
					</a>
				)}
			</Flex>
		</>
	);
}
export default function LibraryPage() {
	const { id } = useParams();
	const user = useCurrentUser();
	const [params, setParams] = useSearchParams();
	const [seeding, setSeeding] = React.useState(false);
	const lopu = useLopu();
	const seedBuilder = async () => {
		setSeeding(true);
		try {
			await requireThingtimeCapability('api.admin-webpages-seed-demos', '1.2.0');
			const response = await fetch('/api/v1/admin/webpages/seed-demos?catalog=integrations', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' });
			const data = await response.json();
			if (!response.ok || !data.ok || data.skipped) throw new Error(data.error || 'Some pages could not be prepared. Check the seed report.');
			lopu({ title: 'Builder library ready', description: `${data.created} new · ${data.refreshed} refreshed · ${data.unchanged} unchanged Things`, status: 'success' });
		} catch (error) {
			lopu({ title: 'Could not prepare builder pages', description: error instanceof Error ? error.message : 'Please try again.', status: 'error' });
		} finally { setSeeding(false); }
	};
	const q = params.get('q') || '';
	const category = params.get('category') || '';
	const kind = params.get('kind') || '';
	const provider = params.get('provider') || '';
	const access = params.get('access') || '';
	const change = (name: string, value: string) => {
		const next = new URLSearchParams(params);
		value ? next.set(name, value) : next.delete(name);
		next.delete('page');
		setParams(next, { replace: true });
	};
	const filtered = React.useMemo(
		() =>
			LIBRARY_EXAMPLES.filter(
				(example) =>
					(!category || example.category === category) &&
					(!provider || example.provider === provider) &&
					(!kind || example.kind === kind) &&
					(!access || (access === 'key') === !!example.request?.auth) &&
					(!q || `${example.title} ${example.provider} ${example.category} ${example.description}`.toLowerCase().includes(q.toLowerCase()))
			),
		[q, category, kind, provider, access]
	);
	const pages = Math.max(1, Math.ceil(filtered.length / SIZE));
	const page = Math.min(pages, Math.max(1, Math.floor(Number(params.get('page'))) || 1));
	const navigatePage = (next: number) => {
		const search = new URLSearchParams(params);
		search.set('page', String(next));
		setParams(search);
		window.scrollTo({ top: 0, behavior: 'smooth' });
	};
	const example = id ? getLibraryExample(id) : null;
	return (
		<PageShell width={1180}>
			<Flex gap={3} flexWrap="wrap">
				<Button as={Link} to={libraryBuilderHref()} size="sm" variant="outline">Open builder index →</Button>
				{user?.isAdmin && <Button size="sm" variant="ghost" onClick={seedBuilder} isLoading={seeding}>Prepare builder pages</Button>}
			</Flex>
			{id ? (
				example ? (
					<Detail key={`${id}:${user?.id || 'anonymous'}`} example={example} />
				) : (
					<>
						<PageHeader eyebrow="Library" title="Example not found" />
						<Link to="/library">Browse the library</Link>
					</>
				)
			) : (
				<>
					<PageHeader
						eyebrow="Things · Actions · Components"
						title="The integration library"
						variant="ink"
						subtitle="500 small starting points for something bigger. Explore popular libraries and live APIs, change the inputs, and make them yours."
					/>
					<Flex gap={6} py={2} flexWrap="wrap">
						{[
							[LIBRARY_EXAMPLES.length, 'examples'],
							[providers.length, 'libraries & services'],
							[LIBRARY_EXAMPLES.filter((x) => x.visual).length, 'visual demos']
						].map(([n, label]) => (
							<Box key={label}>
								<Text fontSize="2xl" fontWeight={700}>
									{n}
								</Text>
								<Text fontSize="xs" color="var(--tt-muted, #73737d)">
									{label}
								</Text>
							</Box>
						))}
					</Flex>
					<Box {...panel} p={4}>
						<Input
							aria-label="Search examples"
							placeholder="Search libraries, services, or something to build…"
							value={q}
							onChange={(e) => change('q', e.target.value)}
							mb={3}
						/>
						<SimpleGrid columns={[1, 2, 4]} gap={3}>
							<Select aria-label="Category" value={category} onChange={(e) => change('category', e.target.value)}>
								<option value="">All categories</option>
								{LIBRARY_CATEGORIES.map((x) => (
									<option key={x}>{x}</option>
								))}
							</Select>
							<Select aria-label="Provider" value={provider} onChange={(e) => change('provider', e.target.value)}>
								<option value="">All libraries & services</option>
								{providers.map((x) => (
									<option key={x}>{x}</option>
								))}
							</Select>
							<Select aria-label="Example type" value={kind} onChange={(e) => change('kind', e.target.value)}>
								<option value="">Things, actions & components</option>
								{Object.entries(kinds).map(([key, label]) => (
									<option key={key} value={key}>
										{label}
									</option>
								))}
							</Select>
							<Select aria-label="Access" value={access} onChange={(e) => change('access', e.target.value)}>
								<option value="">Any access</option>
								<option value="free">No API key</option>
								<option value="key">Bring an API key</option>
							</Select>
						</SimpleGrid>
					</Box>
					<Flex alignItems="center" justifyContent="space-between">
						<Text fontSize="sm" aria-live="polite">
							{filtered.length} examples · popular libraries first
						</Text>
						<Button variant="ghost" size="sm" onClick={() => setParams({})}>
							Clear filters
						</Button>
					</Flex>
					<SimpleGrid columns={[1, 2, 3]} gap={4}>
						{filtered.slice((page - 1) * SIZE, page * SIZE).map((item) => (
							<Box
								as={Link}
								to={`/library/${item.id}`}
								key={item.id}
								{...panel}
								p={5}
								minW={0}
								transition="border-color 0.15s"
								_hover={{ borderColor: 'var(--tt-muted, #73737d)', textDecoration: 'none' }}
								_focusVisible={{ outline: '2px solid #6366f1', outlineOffset: 2 }}
							>
								<Flex justifyContent="space-between" gap={2} mb={5}>
									<Text fontSize="xs" fontWeight={700} overflowWrap="anywhere">
										{item.provider}
									</Text>
									<Text fontSize="xs" color="var(--tt-muted, #73737d)">
										{item.request?.auth ? 'Key required' : 'No key'}
									</Text>
								</Flex>
								<Text as="h2" fontSize="lg" fontWeight={650} mb={2}>
									{item.title}
								</Text>
								<Text fontSize="sm" color="var(--tt-text, #60606b)" mb={5}>
									{item.description}
								</Text>
								<Flex justifyContent="space-between" gap={2} alignItems="center">
									<Badge fontSize="10px">{kinds[item.kind]}</Badge>
									<Text fontSize="sm">Try example ↗</Text>
								</Flex>
							</Box>
						))}
					</SimpleGrid>
					{!filtered.length && (
						<Box {...panel} p={8}>
							<Text>No examples match these filters. Try a different search or clear the filters.</Text>
						</Box>
					)}
					<Flex gap={3} justifyContent="center" alignItems="center" py={4}>
						<Button isDisabled={page <= 1} onClick={() => navigatePage(page - 1)}>
							Previous
						</Button>
						<Text fontSize="sm">
							{page} / {pages}
						</Text>
						<Button isDisabled={page >= pages} onClick={() => navigatePage(page + 1)}>
							Next
						</Button>
					</Flex>
					<Text fontSize="xs" color="var(--tt-muted, #73737d)">
						Nothing loads from a third party while you browse. Run an example to contact its CDN or provider. API results depend on provider
						availability and your account access.
					</Text>
				</>
			)}
		</PageShell>
	);
}
