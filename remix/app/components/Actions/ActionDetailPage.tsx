import React from 'react';
import {
	Box,
	Button,
	Checkbox,
	Flex,
	Input,
	Select,
	Stack,
	Text,
	Textarea
} from '@chakra-ui/react';
import { ArrowLeft, ExternalLink, Play } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';

import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useLopu } from '~/components/Lopu/useLopu';
import { readLocalCache } from '~/hooks/localCache';
import { CARD_STYLES } from '~/theme/card';
import { ActionChip } from './ActionChip';
import { opChipTone } from './ActionsPage';
import {
	ACTION_LIMIT_LABELS,
	actionCannotAccess,
	actionEffectsOf,
	actionLimitsOf,
	collectSchemaRefs,
	componentBindsAction,
	describeActionStep,
	displayRef,
	isActionThing,
	runInputDescriptorsOf,
	selectActionByKey,
	type ActionThing
} from './actionInspect';

const MUTED = 'var(--tt-muted, #9a9aa6)';
const monoLabel = {
	color: MUTED,
	fontFamily: 'var(--tt-font-mono, monospace)',
	fontSize: '11px',
	letterSpacing: '0.08em',
	textTransform: 'uppercase' as const
};

type RunResponse = {
	ok: boolean;
	runId?: string;
	status?: 'ok' | 'error';
	result?: unknown;
	error?: string;
	durationMs?: number;
	opsUsed?: number;
	depthUsed?: number;
	childActionsUsed?: number;
	trace?: { step: string; op: string; ms: number; target?: string; note?: string }[];
};

type RunRecord = {
	id: string;
	status: string;
	startedAt: string | null;
	durationMs: number | null;
	opsUsed: number | null;
	error: string | null;
	trace: { step: string; op: string; ms: number; target?: string }[];
};

const Section = ({ children, title }: { children: React.ReactNode; title: string }) => (
	<Box>
		<Text {...monoLabel} mb={2}>
			{title}
		</Text>
		{children}
	</Box>
);

// The run panel: one input per descriptor, then the live result + trace.
const RunPanel = ({ action, onRan }: { action: ActionThing; onRan?: () => void }) => {
	const api = useApi();
	const apiRef = React.useRef(api);
	apiRef.current = api;
	const lopu = useLopu();
	const lopuRef = React.useRef(lopu);
	lopuRef.current = lopu;
	// Keeps ONE descriptors identity across renders (runInputDescriptorsOf
	// returns a shared list for parameterless actions): `defaults` derives
	// from it and the effect below pushes that object into state, so a fresh
	// [] per render would re-fire setValues forever.
	const descriptors = React.useMemo(() => runInputDescriptorsOf(action.crystal), [action.crystal]);
	const defaults = React.useMemo(() => {
		const initial: Record<string, string | boolean> = {};
		for (const descriptor of descriptors) {
			const name = String(descriptor.name);
			if (descriptor.type === 'boolean') initial[name] = descriptor.default === true;
			else initial[name] = descriptor.default === undefined || descriptor.default === null ? '' : String(descriptor.default);
		}
		return initial;
	}, [descriptors]);
	const [values, setValues] = React.useState<Record<string, string | boolean>>(defaults);
	React.useEffect(() => setValues(defaults), [defaults]);
	const [running, setRunning] = React.useState(false);
	const [lastRun, setLastRun] = React.useState<RunResponse | null>(null);

	const run = React.useCallback(async () => {
		setRunning(true);
		try {
			const inputs: Record<string, unknown> = {};
			for (const descriptor of descriptors) {
				const name = String(descriptor.name);
				const value = values[name];
				if (value === '' || value === undefined) continue;
				inputs[name] = descriptor.type === 'number' ? Number(value) : value;
			}
			const response = (await apiRef.current.v1.actions.run({ action: action.id, inputs })) as RunResponse;
			setLastRun(response);
			onRan?.();
			if (response?.status === 'ok') {
				lopuRef.current({ title: `⚡ ${action.crystal.name || 'Action'} ran ✓`, description: `${response.durationMs}ms · ${response.opsUsed} ops`, status: 'success', duration: 6000 });
			} else {
				lopuRef.current({ title: 'Run finished with an error 🧯', description: response?.error || undefined, status: 'error' });
			}
		} catch (error: any) {
			const message = error?.error || error?.message || 'The run request failed';
			setLastRun({ ok: false, status: 'error', error: message });
			lopuRef.current({ title: 'That didn’t work 😔', description: message, status: 'error' });
		} finally {
			setRunning(false);
		}
	}, [action.id, action.crystal.name, descriptors, values, onRan]);

	return (
		<Box {...CARD_STYLES} p={{ base: 4, md: 5 }}>
			<Flex align="center" justify="space-between" mb={3}>
				<Text {...monoLabel}>Run</Text>
				<Button colorScheme="pink" isLoading={running} leftIcon={<Play size={14} />} onClick={run} size="sm">
					Run action
				</Button>
			</Flex>
			{descriptors.length ? (
				<Stack spacing={3}>
					{descriptors.map((descriptor) => {
						const name = String(descriptor.name);
						const label = String(descriptor.label || name);
						const type = String(descriptor.type);
						return (
							<Box key={name}>
								<Text color="var(--tt-text, #33333c)" fontSize="xs" fontWeight="600" mb={1}>
									{label}
									{descriptor.required === true ? ' *' : ''}
									<Text as="span" color={MUTED} fontWeight="400" ml={2}>
										{type}
									</Text>
								</Text>
								{type === 'boolean' ? (
									<Checkbox
										isChecked={values[name] === true}
										onChange={(event) => setValues((prior) => ({ ...prior, [name]: event.target.checked }))}
									/>
								) : type === 'enum' ? (
									<Select
										onChange={(event) => setValues((prior) => ({ ...prior, [name]: event.target.value }))}
										size="sm"
										value={String(values[name] ?? '')}
									>
										<option value="">—</option>
										{(Array.isArray(descriptor.values) ? descriptor.values : []).map((value: unknown) => (
											<option key={String(value)} value={String(value)}>
												{String(value)}
											</option>
										))}
									</Select>
								) : type === 'text' ? (
									<Textarea
										onChange={(event) => setValues((prior) => ({ ...prior, [name]: event.target.value }))}
										rows={3}
										size="sm"
										value={String(values[name] ?? '')}
									/>
								) : (
									<Input
										onChange={(event) => setValues((prior) => ({ ...prior, [name]: event.target.value }))}
										size="sm"
										type={type === 'number' ? 'number' : 'text'}
										value={String(values[name] ?? '')}
									/>
								)}
							</Box>
						);
					})}
				</Stack>
			) : (
				<Text color={MUTED} fontSize="sm">
					This action takes no inputs.
				</Text>
			)}
			{lastRun ? (
				<Box background="var(--tt-surface-alt, #f5f5f7)" borderRadius="var(--tt-radius-md, 12px)" mt={4} p={3}>
					<Flex align="center" gap={2} wrap="wrap">
						<ActionChip size="md" tone={lastRun.status === 'ok' ? 'ok' : 'danger'}>{lastRun.status}</ActionChip>
						{typeof lastRun.durationMs === 'number' ? (
							<Text color={MUTED} fontSize="xs">
								{lastRun.durationMs}ms · {lastRun.opsUsed} ops · depth {lastRun.depthUsed} · {lastRun.childActionsUsed} child actions
							</Text>
						) : null}
					</Flex>
					{lastRun.error ? (
						<Text color="var(--tt-danger, #e5484d)" fontSize="sm" mt={2} overflowWrap="anywhere">
							{lastRun.error}
						</Text>
					) : null}
					{Array.isArray(lastRun.trace) && lastRun.trace.length ? (
						<Stack mt={2} spacing={1}>
							{lastRun.trace.map((entry) => (
								<Flex align="center" gap={2} key={entry.step} wrap="wrap">
									<Text color={MUTED} fontFamily="var(--tt-font-mono, monospace)" fontSize="xs" minW="28px">
										{entry.step}
									</Text>
									<ActionChip size="sm" tone={opChipTone(entry.op)}>
										{entry.op}
									</ActionChip>
									<Text color={MUTED} fontSize="xs">
										{entry.ms}ms
									</Text>
									{entry.target ? (
										<Button as={Link} rightIcon={<ExternalLink size={11} />} size="xs" to={`/thing/${encodeURIComponent(entry.target)}`} variant="ghost">
											{entry.target.length > 18 ? `${entry.target.slice(0, 18)}…` : entry.target}
										</Button>
									) : null}
									{entry.note ? (
										<Text color={MUTED} fontSize="xs">
											{entry.note}
										</Text>
									) : null}
								</Flex>
							))}
						</Stack>
					) : null}
					{lastRun.result !== undefined && lastRun.result !== null ? (
						<Box as="pre" color="var(--tt-text, #33333c)" fontSize="xs" mt={2} overflowX="auto" whiteSpace="pre-wrap" overflowWrap="anywhere">
							{JSON.stringify(lastRun.result, null, 2)}
						</Box>
					) : null}
				</Box>
			) : null}
		</Box>
	);
};

export const ActionDetailPage = () => {
	const { key } = useParams();
	const api = useApi();
	const apiRef = React.useRef(api);
	apiRef.current = api;
	const user = useCurrentUser();
	const navigate = useNavigate();
	const [state, setState] = React.useState<{ key: string; action: ActionThing | null; missing: boolean }>({
		key: '',
		action: null,
		missing: false
	});
	const [runs, setRuns] = React.useState<RunRecord[]>([]);
	const [schemaNames, setSchemaNames] = React.useState<Record<string, string>>({});
	const [usedBy, setUsedBy] = React.useState<{ id: string; name: string; componentKey: string | null }[]>([]);
	const actionId = state.action?.id || null;
	const loadRuns = React.useCallback(async () => {
		if (!actionId) return;
		const history = await apiRef.current.v1.actions.runs({ action: actionId, limit: 20 }).catch(() => null);
		if (history?.runs) setRuns(history.runs as RunRecord[]);
	}, [actionId]);
	const requestKey = `${key || ''} ${user?.id || 'anonymous'}`;
	// Reset per-action satellite state the moment the route targets a different
	// action (during render, so the first frame of B never shows A's runs,
	// Used-by chips, or schema names while B's fetches are still in flight).
	const [seenKey, setSeenKey] = React.useState(requestKey);
	if (seenKey !== requestKey) {
		setSeenKey(requestKey);
		setRuns([]);
		setUsedBy([]);
		setSchemaNames({});
	}
	// Optimistic first paint (house rule): the /actions list caches full action
	// crystals, so navigating from it can render the inspector instantly from
	// that cache while the authoritative fetch reconciles in the background.
	const cachedAction = React.useMemo(() => {
		if (!key) return null;
		const cache = readLocalCache<{ actions?: ActionThing[] }>(`tt-actions-${user?.id || 'anon'}`);
		return selectActionByKey(cache?.actions || [], key);
	}, [key, user?.id]);
	const visible = state.key === requestKey ? state : { key: requestKey, action: cachedAction, missing: false };

	React.useEffect(() => {
		if (!key) return;
		let cancelled = false;
		(async () => {
			try {
				let action: ActionThing | null = null;
				try {
					const byId = await apiRef.current.v1.things.get({ id: key });
					if (isActionThing(byId?.thing)) action = byId.thing as ActionThing;
				} catch {}
				if (!action && user?.id) {
					// fall back to the caller's own actionKey namespace
					const mine = await apiRef.current.v1.things.list({ thingtime: 'action', limit: 100 }).catch(() => null);
					action = selectActionByKey((mine?.things || []) as ActionThing[], key);
				}
				if (cancelled) return;
				setState({ key: requestKey, action, missing: !action });
				if (action) {
					const resolvedAction = action;
					// "Used by": your components whose render binds this action via
					// ttAction — the back-reference the original vision promised
					// (🧩 Invoice Card → Send button), clickable both directions.
					apiRef.current.v1.things
						.list({ thingtime: 'component', limit: 100 })
						.then((response: { things?: { id: string; crystal?: Record<string, unknown> }[] }) => {
							if (cancelled) return;
							const key = typeof resolvedAction.crystal.actionKey === 'string' ? resolvedAction.crystal.actionKey : null;
							const bound = (response?.things || [])
								.filter((component) => componentBindsAction(component.crystal?.render, { id: resolvedAction.id, actionKey: key }))
								.map((component) => ({
									id: component.id,
									name: typeof component.crystal?.name === 'string' ? (component.crystal.name as string) : 'Component',
									componentKey: typeof component.crystal?.componentKey === 'string' ? (component.crystal.componentKey as string) : null
								}));
							setUsedBy(bound);
						})
						.catch(() => {});
					const [history] = await Promise.all([
						apiRef.current.v1.actions.runs({ action: resolvedAction.id, limit: 20 }).catch(() => null),
						(async () => {
							const resolved: Record<string, string> = {};
							await Promise.all(
								collectSchemaRefs(resolvedAction.crystal).map(async (ref) => {
									try {
										const response = await apiRef.current.v1.things.get({ id: ref });
										const name = response?.thing?.crystal?.name;
										if (typeof name === 'string' && name) resolved[ref] = name;
									} catch {}
								})
							);
							if (!cancelled) setSchemaNames(resolved);
						})()
					]);
					if (!cancelled && history?.runs) setRuns(history.runs as RunRecord[]);
				}
			} catch {
				if (!cancelled) setState({ key: requestKey, action: null, missing: true });
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [key, requestKey, user?.id]);

	const action = visible.action;
	const crystal = action?.crystal || {};
	const effects = actionEffectsOf(crystal);
	const limits = actionLimitsOf(crystal);
	const cannot = actionCannotAccess(crystal.capabilities, schemaNames);
	const steps = Array.isArray(crystal.steps) ? crystal.steps : [];

	return (
		<Flex
			background="var(--tt-surface, #fafafb)"
			justify="center"
			minHeight="100vh"
			paddingBottom={16}
			paddingTop="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px))"
			width="100%"
		>
			<Stack maxW="920px" minW={0} px={{ base: 4, md: 6 }} pt={{ base: 4, md: 7 }} spacing={4} width="100%">
				<Flex align="center" gap={2}>
					<Button leftIcon={<ArrowLeft size={15} />} onClick={() => navigate('/actions')} size="sm" variant="ghost">
						Actions
					</Button>
				</Flex>

				{visible.missing ? (
					<Box {...CARD_STYLES} p={6}>
						<Text fontWeight="700">No action matches “{key}” 🤷‍♂️</Text>
						<Text color={MUTED} fontSize="sm" mt={2}>
							It may be private, deleted, or the key may belong to someone else’s namespace.
						</Text>
					</Box>
				) : !action ? (
					<Box minH="200px" />
				) : (
					<>
						<Box {...CARD_STYLES} p={{ base: 5, md: 6 }}>
							<Flex align="flex-start" justify="space-between" gap={3} wrap="wrap">
								<Box minW={0}>
									<Flex align="center" gap={2} wrap="wrap">
										<Text as="h1" fontSize="xl" fontWeight="800" color="var(--tt-ink, #16161a)">
											⚡ {crystal.name || 'Action'}
										</Text>
										{crystal.category ? <ActionChip dot={false} size="sm">{crystal.category}</ActionChip> : null}
										{typeof crystal.version === 'number' ? <ActionChip dot={false} size="sm">v{crystal.version}</ActionChip> : null}
										{action.visibility ? <ActionChip dot={false} size="sm">{action.visibility}</ActionChip> : null}
									</Flex>
									<Text {...monoLabel} mt={2} overflowWrap="anywhere">
										{crystal.actionKey ? `${crystal.actionKey} · ` : ''}
										{action.id}
									</Text>
									{crystal.description ? (
										<Text color="var(--tt-text, #33333c)" fontSize="sm" mt={3}>
											{crystal.description}
										</Text>
									) : null}
								</Box>
								<Button as={Link} rightIcon={<ExternalLink size={13} />} size="xs" to={`/thing/${encodeURIComponent(action.id)}`} variant="ghost">
									Thing view
								</Button>
							</Flex>
						</Box>

						<Box {...CARD_STYLES} p={{ base: 5, md: 6 }}>
							<Stack spacing={5}>
								<Section title="Takes">
									<Flex gap={1.5} wrap="wrap">
										{(crystal.inputs || []).length ? (
											(crystal.inputs || []).map((input) => (
												<ActionChip dot={false} key={String(input.name)} size="md">
													{String(input.name)}: {String(input.type)}
													{input.required === true ? ' *' : ''}
												</ActionChip>
											))
										) : (
											<Text color={MUTED} fontSize="sm">
												No inputs
											</Text>
										)}
									</Flex>
								</Section>

								<Section title="Does">
									<Stack spacing={1.5}>
										{steps.map((step, index) => (
											<Flex align="center" gap={2} key={index} wrap="wrap">
												<Text color={MUTED} fontFamily="var(--tt-font-mono, monospace)" fontSize="xs" minW="20px">
													{index + 1}
												</Text>
												<ActionChip size="sm" tone={opChipTone(String(step.op))}>
													{String(step.op)}
												</ActionChip>
												<Text color="var(--tt-text, #33333c)" fontSize="sm">
													{describeActionStep(step, schemaNames)}
												</Text>
												{step.op === 'actions.invoke' && typeof step.action === 'string' ? (
													<Button as={Link} size="xs" to={`/actions/${encodeURIComponent(step.action)}`} variant="ghost">
														open ⚡
													</Button>
												) : null}
											</Flex>
										))}
									</Stack>
								</Section>

								<Flex gap={8} wrap="wrap">
									<Section title="Can access">
										<Flex direction="column" gap={1}>
											{(crystal.capabilities || []).length ? (
												(crystal.capabilities || []).map((entry) => (
													<ActionChip key={entry.capability} size="md" tone="ok">
														{entry.capability}
														{entry.schemas?.length ? `: ${entry.schemas.map((ref) => displayRef(ref, schemaNames)).join(', ')}` : ''}
														{entry.actions?.length ? `: ${entry.actions.join(', ')}` : ''}
													</ActionChip>
												))
											) : (
												<Text color={MUTED} fontSize="sm">
													Nothing — a pure program
												</Text>
											)}
										</Flex>
									</Section>
									<Section title="Cannot access">
										<Flex direction="column" gap={1}>
											{cannot.map((line) => (
												<Text color={MUTED} fontSize="xs" key={line}>
													🚫 {line}
												</Text>
											))}
										</Flex>
									</Section>
									<Section title="Limits">
										<Flex direction="column" gap={1}>
											{Object.entries(limits).map(([key, value]) => (
												<Text color={MUTED} fontSize="xs" key={key}>
													⏱ {(ACTION_LIMIT_LABELS[key] || ((v: number) => `${key} ${v}`))(value)}
												</Text>
											))}
										</Flex>
									</Section>
								</Flex>

								{effects.creates.length || effects.reads.length || effects.updates || effects.invokes.length ? (
									<Section title="Effects (derived from the steps)">
										<Flex gap={1.5} wrap="wrap">
											{effects.creates.map((schema) => (
												<ActionChip key={`c-${schema}`} size="md" tone="create">
													creates {displayRef(schema, schemaNames)}
												</ActionChip>
											))}
											{effects.reads.map((schema) => (
												<ActionChip key={`r-${schema}`} size="md" tone="read">
													reads {schema === '*' ? 'things' : displayRef(schema, schemaNames)}
												</ActionChip>
											))}
											{effects.updates ? (
												<ActionChip size="md" tone="write">
													updates things
												</ActionChip>
											) : null}
											{effects.invokes.map((invoked) => (
												<Link key={`i-${invoked}`} to={`/actions/${encodeURIComponent(invoked)}`}>
													<ActionChip size="md" tone="invoke">
														⚡ {invoked}
													</ActionChip>
												</Link>
											))}
										</Flex>
									</Section>
								) : null}
							</Stack>
						</Box>

						{usedBy.length ? (
							<Box {...CARD_STYLES} p={{ base: 4, md: 5 }}>
								<Text {...monoLabel} mb={2}>
									Used by
								</Text>
								<Flex gap={2} wrap="wrap">
									{usedBy.map((component) => (
										<Link key={component.id} to={`/thing/${encodeURIComponent(component.id)}`}>
											<ActionChip size="md" tone="invoke">
												🧩 {component.name}
											</ActionChip>
										</Link>
									))}
								</Flex>
								<Text color={MUTED} fontSize="xs" mt={2}>
									Components whose render binds this action via ttAction — clicking their control runs it as the viewer.
								</Text>
							</Box>
						) : null}
						{user ? <RunPanel action={action} key={action.id} onRan={loadRuns} /> : null}

						<Box {...CARD_STYLES} p={{ base: 4, md: 5 }}>
							<Text {...monoLabel} mb={2}>
								Last runs
							</Text>
							{runs.length ? (
								<Stack spacing={2}>
									{runs.map((record) => (
										<Flex align="center" gap={2} key={record.id} wrap="wrap">
											<ActionChip size="sm" tone={record.status === 'ok' ? 'ok' : 'danger'}>{record.status}</ActionChip>
											<Text color={MUTED} fontSize="xs">
												{record.startedAt ? new Date(record.startedAt).toLocaleString() : '—'}
											</Text>
											<Text color={MUTED} fontSize="xs">
												{record.durationMs}ms · {record.opsUsed} ops
											</Text>
											{record.error ? (
												<Text color="var(--tt-danger, #e5484d)" fontSize="xs" overflowWrap="anywhere">
													{record.error}
												</Text>
											) : null}
										</Flex>
									))}
								</Stack>
							) : (
								<Text color={MUTED} fontSize="sm">
									No runs yet — this panel is the inspectable trail every invocation leaves.
								</Text>
							)}
						</Box>

						<Box {...CARD_STYLES} p={{ base: 4, md: 5 }}>
							<Text {...monoLabel} mb={2}>
								Definition
							</Text>
							<Box as="pre" color="var(--tt-text, #33333c)" fontSize="xs" overflowX="auto" whiteSpace="pre-wrap" overflowWrap="anywhere">
								{JSON.stringify(crystal, null, 2)}
							</Box>
						</Box>
					</>
				)}
			</Stack>
		</Flex>
	);
};
