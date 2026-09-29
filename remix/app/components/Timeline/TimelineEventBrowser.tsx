import React from 'react';
import { Box, Button, Flex, FormControl, FormLabel, Input, Select, Text } from '@chakra-ui/react';
import type { TimelineEvent } from '../../timeline/contract';
import type { LocalTimelineRow } from '../../timeline/localStore';
import {
	HISTORY_LOOKS,
	filterHistoryCards,
	historyCard,
	historyDate,
	historyDay,
	historyDayLabel,
	historyPositions,
	type HistoryCard,
	type HistoryFilters
} from '../../timeline/browserModel';

const time = (event: TimelineEvent) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(historyDate(event));
const icons: Record<string, string> = {
	webpage: '📄',
	component: '🧩',
	data: '💎',
	post: '📝',
	file: '📎',
	folder: '📁',
	action: '⚡',
	schema: '📋',
	theme: '🎨'
};
const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
function SyncPill({ card }: { card: HistoryCard }) {
	return (
		<span className={`history-sync ${card.row.status}`}>
			<i aria-hidden="true" />
			{card.row.status === 'accepted' ? 'Synced to your account' : 'Saved on this device'}
		</span>
	);
}
function SnapshotCard({ card, frame = false }: { card: HistoryCard; frame?: boolean }) {
	return (
		<div className={`history-snapshot ${frame ? 'frame' : ''}`}>
			<div className="history-snapshot-title">
				<span aria-hidden="true">{Object.prototype.hasOwnProperty.call(icons, card.kind) ? icons[card.kind] : '💎'}</span>
				<strong>{card.title}</strong>
			</div>
			<div className="history-caption">
				{card.kind || 'Recorded content'} · {card.removed ? 'before removal' : 'as of this version'}
			</div>
			{frame ? (
				<div className="history-fields">
					{card.excerpt ? (
						<p>{card.excerpt}</p>
					) : (
						card.fields.map((field) => (
							<div key={field.name}>
								<span>{field.name}</span>
								<b>{field.value}</b>
							</div>
						))
					)}
					{card.blockCount !== null ? (
						<p>
							{card.blockCount} page {card.blockCount === 1 ? 'block' : 'blocks'} · open details for the recorded preview
						</p>
					) : null}
					{card.large ? <p>Full content retained in your account</p> : null}
				</div>
			) : null}
		</div>
	);
}
function ChangeChips({ card }: { card: HistoryCard }) {
	return (
		<div className="history-chips">
			{card.chips.map((chip, index) => (
				<span className="history-change" key={index}>
					<span>{chip.label}</span>
					<del>{chip.before}</del>
					<span aria-hidden="true">→</span>
					<b>{chip.after}</b>
				</span>
			))}
			{card.changeCount > 3 ? <span className="history-caption">+{card.changeCount - 3} more</span> : null}
		</div>
	);
}

/** Every look selects the same immutable events and opens the same detail view.
 * No per-look data store, requests, fictional actors or invented version counts. */
export function TimelineEventBrowser({
	rows,
	filters,
	onFilters,
	selected,
	onSelect,
	initialThingId,
	older,
	hasOlder,
	ready
}: {
	rows: LocalTimelineRow[];
	filters: HistoryFilters;
	onFilters: (next: HistoryFilters) => void;
	selected: TimelineEvent | null;
	onSelect: (event: TimelineEvent) => void;
	initialThingId?: string | null;
	older: () => Promise<void>;
	hasOlder: boolean;
	ready: boolean;
}) {
	const cards = React.useMemo(() => rows.map(historyCard), [rows]);
	const [visibleCount, setVisibleCount] = React.useState(80);
	const matches = React.useMemo(() => filterHistoryCards(cards, filters), [cards, filters]);
	const filtered = React.useMemo(() => matches.slice(0, visibleCount), [matches, visibleCount]);
	const [playing, setPlaying] = React.useState(false);
	const [loadingOlder, setLoadingOlder] = React.useState(false);
	const [scrollWindow, setScrollWindow] = React.useState({ start: 0, size: 100 });
	const strip = React.useRef<HTMLDivElement>(null);
	const buttons = React.useRef(new Map<string, HTMLButtonElement>());
	const width = filters.look === 'line' ? 180 : filters.compact ? 220 : 272;
	const positions = React.useMemo(() => historyPositions(filtered, width, filters.realTime), [filtered, width, filters.realTime]);
	const current = positions.findIndex((item) => item.card.row.event.id === selected?.id);
	const selectRef = React.useRef(onSelect);
	selectRef.current = onSelect;
	const currentRef = React.useRef(current);
	currentRef.current = current;
	const positionsRef = React.useRef(positions);
	positionsRef.current = positions;
	const update = (patch: Partial<HistoryFilters>) => {
		setPlaying(false);
		setVisibleCount(80);
		onFilters({ ...filters, ...patch });
	};
	React.useEffect(() => {
		setPlaying(false);
	}, [filters.look, filters.thingId, filters.query, filters.day]);
	React.useEffect(() => {
		if (!playing) return;
		const timer = window.setInterval(() => {
			const next = currentRef.current + 1;
			if (next >= positionsRef.current.length || document.visibilityState === 'hidden') {
				setPlaying(false);
				return;
			}
			selectRef.current(positionsRef.current[next].card.row.event);
		}, 1800);
		return () => window.clearInterval(timer);
	}, [playing]);
	const measure = React.useCallback(() => {
		const element = strip.current;
		if (element)
			setScrollWindow({
				start: (element.scrollLeft / element.scrollWidth) * 100,
				size: Math.min(100, (element.clientWidth / element.scrollWidth) * 100)
			});
	}, []);
	React.useEffect(() => {
		const element = strip.current;
		if (!element) return;
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		measure();
		return () => observer.disconnect();
	}, [measure, filters.look, positions.length, width]);
	React.useEffect(() => {
		const button = selected && buttons.current.get(selected.id);
		const element = strip.current;
		if (!button || !element) return;
		const bounds = button.getBoundingClientRect();
		const viewport = element.getBoundingClientRect();
		if (bounds.left < viewport.left || bounds.right > viewport.right)
			element.scrollTo({ left: element.scrollLeft + bounds.left - viewport.left - (element.clientWidth - bounds.width) / 2, behavior: 'instant' });
	}, [selected, filters.look]);
	const chooseIndex = (index: number, focus = false) => {
		const event = positions[Math.min(Math.max(index, 0), positions.length - 1)]?.card.row.event;
		if (event) {
			onSelect(event);
			if (focus) buttons.current.get(event.id)?.focus({ preventScroll: true });
		}
	};
	const keyboard = (event: React.KeyboardEvent) => {
		if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.altKey || event.metaKey || event.ctrlKey)
			return;
		const index =
			event.key === 'ArrowLeft'
				? current - 1
				: event.key === 'ArrowRight'
				? current + 1
				: event.key === 'Home'
				? 0
				: event.key === 'End'
				? positions.length - 1
				: null;
		if (index !== null) {
			event.preventDefault();
			setPlaying(false);
			chooseIndex(index, true);
		}
	};
	const targets = React.useMemo(() => [...new Map(cards.map((card) => [card.row.event.thingId, card.title])).entries()], [cards]);
	const target = filters.thingId || selected?.thingId || initialThingId || targets[0]?.[0] || '';
	const pageTarget = filters.related ? filters.thingId :
		cards.find(card => card.row.event.thingId === target && card.kinds.includes('webpage'))?.row.event.thingId ||
		cards.find(card => card.kinds.includes('webpage'))?.row.event.thingId || '';
	const shownTargets = filters.related ? targets.filter(([id]) => id === filters.thingId || cards.some(card => card.row.event.thingId === id && card.kinds.includes('webpage'))) : targets;
	const days = React.useMemo(() => {
		const counts = new Map<string, number>();
		for (const card of filterHistoryCards(cards, { ...filters, day: '' })) counts.set(card.day, (counts.get(card.day) ?? 0) + 1);
		const today = new Date();
		today.setHours(12, 0, 0, 0);
		return Array.from({ length: 30 }, (_, index) => {
			const date = new Date(today);
			date.setDate(date.getDate() - 29 + index);
			const key = historyDay(date);
			return { key, count: counts.get(key) ?? 0 };
		});
	}, [cards, filters]);
	const lanes = [...new Set(positions.map(({ card }) => card.row.event.branchId))].sort((a, b) =>
		a === 'main' ? -1 : b === 'main' ? 1 : a.localeCompare(b)
	);
	const stripWidth = Math.max(300, (positions.at(-1)?.x ?? 0) + width + 20);
	return (
		<Box className="history-browser" minW={0}>
			<Flex className="history-toolbar" gap={3} wrap="wrap" align="center">
				<Flex role="group" aria-label="History scope" className="history-segment">
					<Button size="sm" variant="ghost" aria-pressed={!filters.thingId} onClick={() => update({ thingId: '', related: false, day: '' })}>
						Everything
					</Button>
					<Button
						size="sm"
						variant="ghost"
						aria-pressed={!!filters.thingId && !filters.related}
						isDisabled={!target}
						onClick={() => update({ thingId: selected?.thingId || target, related: false, day: '' })}
					>
						This Thing
					</Button>
					<Button size="sm" variant="ghost" aria-pressed={filters.related} isDisabled={!pageTarget} onClick={() => update({ thingId: pageTarget, related: true, day: '' })}>
						Page + related
					</Button>
				</Flex>
				{filters.thingId ? (
					<Select
						aria-label="Thing in History"
						size="sm"
						maxW="280px"
						value={filters.thingId}
						onChange={(event) => update({ thingId: event.target.value, day: '' })}
					>
						{!targets.some(([id]) => id === filters.thingId) ? <option value={filters.thingId}>Selected Thing</option> : null}
						{shownTargets.map(([id, title]) => (
							<option value={id} key={id}>
								{title}
							</option>
						))}
					</Select>
				) : null}
				<Input
					type="search"
					aria-label="Search loaded history"
					placeholder="Search loaded history…"
					size="sm"
					flex="1"
					minW="180px"
					maxLength={160}
					value={filters.query}
					onChange={(event) => update({ query: event.target.value })}
				/>
			</Flex>
			<Flex className="history-toolbar" gap={3} wrap="wrap" align="center">
				<Text fontSize="xs" color="var(--tt-muted)">
					Look
				</Text>
				<Flex role="group" aria-label="History look" className="history-segment">
					{HISTORY_LOOKS.map((look) => (
						<Button key={look} size="sm" variant="ghost" aria-pressed={filters.look === look} onClick={() => update({ look })}>
							{titleCase(look)}
						</Button>
					))}
				</Flex>
				{filters.look !== 'list' ? (
					<>
						<Button size="xs" variant="ghost" aria-pressed={filters.compact} onClick={() => update({ compact: !filters.compact })}>
							{filters.compact ? 'Compact' : 'Comfortable'}
						</Button>
						<Button size="xs" variant="ghost" aria-pressed={filters.realTime} onClick={() => update({ realTime: !filters.realTime })}>
							{filters.realTime ? 'Time spacing' : 'Even spacing'}
						</Button>
					</>
				) : null}
			</Flex>
			<Flex className="history-toolbar" gap={2} wrap="wrap">
				{(
					[
						[
							'kind',
							'Kind',
							[
								['webpage', 'Pages'],
								['component', 'Components'],
								['data', 'Data'],
								['post', 'Posts'],
								['file', 'Files'],
								['folder', 'Folders'],
								['action', 'Actions'],
								['schema', 'Schemas'],
								['theme', 'Themes']
							]
						],
						[
							'source',
							'Source',
							[
								['client', 'Editor'],
								['api', 'API'],
								['ai', 'Lopu'],
								['action', 'Action'],
								['system', 'Thingtime']
							]
						],
						[
							'operation',
							'Change',
							[
								['create', 'Created'],
								['update', 'Edited'],
								['restore', 'Restored'],
								['merge', 'Combined'],
								['delete', 'Removed'],
								['effect', 'Activity']
							]
						],
						[
							'sync',
							'Saved',
							[
								['pending', 'On this device'],
								['accepted', 'Synced to account']
							]
						]
					] as const
				).map(([key, label, options]) => (
					<FormControl key={key} flex="1 1 120px" minW="110px">
						<FormLabel fontSize="xs" mb={1}>
							{label}
						</FormLabel>
						<Select
							aria-label={`History ${label.toLowerCase()}`}
							size="sm"
							value={filters[key]}
							onChange={(event) => update({ [key]: event.target.value })}
						>
							<option value="">All</option>
							{options.map(([value, name]) => (
								<option value={value} key={value}>
									{name}
								</option>
							))}
						</Select>
					</FormControl>
				))}
			</Flex>
			<div className="history-density">
				<div className="history-density-heading">
					<span>Last 30 days · loaded changes</span>
					{filters.day ? (
						<Button size="xs" variant="ghost" onClick={() => update({ day: '' })}>
							Clear day
						</Button>
					) : null}
				</div>
				<div className="history-bars" role="group" aria-label="Jump to a day">
					{days.map((day) => (
						<button
							type="button"
							key={day.key}
							aria-label={`${historyDayLabel(day.key)}, ${day.count} loaded changes`}
							aria-pressed={filters.day === day.key}
							title={`${historyDayLabel(day.key)} · ${day.count}`}
							onClick={() => update({ day: filters.day === day.key ? '' : day.key })}
						>
							<i
								style={{ height: `${Math.max(8, (day.count / Math.max(1, ...days.map((day) => day.count))) * 100)}%` }}
								data-active={day.count > 0}
							/>
						</button>
					))}
				</div>
			</div>
			<Text fontSize="xs" color="var(--tt-muted)" px={3} py={2}>
				{filtered.length} of {matches.length} matching changes · {rows.length} loaded{filters.day ? ` · ${historyDayLabel(filters.day)}` : ''}. Search
				and filters apply to this loaded window.{hasOlder ? ' Load older changes to explore further.' : ''}
			</Text>
			{ready && !filtered.length ? (
				<Box p={5}>
					<Text fontWeight="600">{cards.length ? 'No matching changes in this window' : 'No recorded changes yet'}</Text>
					<Text fontSize="sm" color="var(--tt-muted)" mt={1}>
						{cards.length
							? 'Try another filter or load older changes.'
							: 'New changes will appear here. Earlier activity cannot be reconstructed automatically.'}
					</Text>
				</Box>
			) : null}
			{filters.look === 'list' ? (
				<div className="history-event-list" aria-label="History events">
					{filtered.map((card, index) => (
						<React.Fragment key={card.row.event.id}>
							{index === 0 || card.day !== filtered[index - 1].day ? <div className="history-day">{historyDayLabel(card.day)}</div> : null}
							<button
								type="button"
								className="history-event"
								data-operation={card.row.event.operation}
								data-variation={card.row.event.branchId !== 'main'}
								aria-pressed={selected?.id === card.row.event.id}
								onClick={() => onSelect(card.row.event)}
							>
								<span className="history-rail" aria-hidden="true">
									<i />
								</span>
								<span className="history-event-content">
									<span className="history-caption">
										{time(card.row.event)} · {card.source}
										{card.row.event.branchId !== 'main' ? ' · Variation' : ''}
									</span>
									<strong className="history-event-label">{card.row.event.label}</strong>
									<SnapshotCard card={card} />
									<ChangeChips card={card} />
									<SyncPill card={card} />
								</span>
							</button>
						</React.Fragment>
					))}
				</div>
			) : (
				<>
					<Flex gap={2} px={3} py={2} wrap="wrap" align="center">
						<Button
							size="xs"
							onClick={() => {
								setPlaying(false);
								chooseIndex(current - 1);
							}}
							isDisabled={current <= 0}
						>
							← Previous
						</Button>
						<Button
							size="xs"
							onClick={() => {
								setPlaying(false);
								chooseIndex(current + 1);
							}}
							isDisabled={current >= positions.length - 1}
						>
							Next →
						</Button>
						<Button
							size="xs"
							aria-pressed={playing}
							isDisabled={!positions.length}
							onClick={() => {
								if (!playing && current >= positions.length - 1) chooseIndex(0);
								setPlaying((value) => !value);
							}}
						>
							{playing ? 'Pause' : 'Play'}
						</Button>
						<Text fontSize="xs" color="var(--tt-muted)">
							{current >= 0 ? `${current + 1} of ${positions.length}` : 'Choose a moment'} · ← → Home End
						</Text>
					</Flex>
					<div
						className={`history-strip ${filters.look}`}
						ref={strip}
						onScroll={measure}
						onKeyDown={keyboard}
						aria-label="History events"
						tabIndex={0}
					>
						{lanes.map((branch) => (
							<div className="history-lane" key={branch} data-variation={branch !== 'main'} style={{ width: stripWidth }}>
								<div className="history-lane-label">
									{branch === 'main' ? 'Saved changes' : 'Private variation'}
									{branch !== 'main' ? <span title={branch}> · {branch.slice(0, 35)}</span> : null}
								</div>
								<div className="history-spine">
									<i style={{ width: current >= 0 ? positions[current].x + width / 2 : 0 }} />
								</div>
								{positions
									.filter(({ card }) => card.row.event.branchId === branch)
									.map(({ card, x, index }, laneIndex) => (
										<button
											type="button"
											className="history-stop"
											data-operation={card.row.event.operation}
											data-side={laneIndex % 2 ? 'below' : 'above'}
											data-future={current >= 0 && index > current}
											key={card.row.event.id}
											style={{ left: x, width }}
											ref={(element) => {
												if (element) buttons.current.set(card.row.event.id, element);
												else buttons.current.delete(card.row.event.id);
											}}
											aria-label={`${card.row.event.label} · ${card.title} · ${historyDayLabel(card.day)} ${time(card.row.event)}`}
											aria-pressed={selected?.id === card.row.event.id}
											onClick={() => {
												setPlaying(false);
												onSelect(card.row.event);
											}}
										>
											<span className="history-node" aria-hidden="true" />
											<span className="history-stop-card">
												<span className="history-caption">
													{historyDayLabel(card.day)} · {time(card.row.event)}
												</span>
												{filters.look !== 'line' ? <SnapshotCard card={card} frame={filters.look === 'frames'} /> : <strong>{card.title}</strong>}
												<strong className="history-event-label">{card.row.event.label}</strong>
												{filters.look !== 'line' ? <ChangeChips card={card} /> : null}
												<span className="history-caption">{card.source}</span>
												<SyncPill card={card} />
											</span>
										</button>
									))}
							</div>
						))}
					</div>
					{positions.length ? (
						<div className="history-minimap">
							<div className="history-minimap-track" aria-hidden="true">
								{positions.map(({ card, x }) => (
									<i key={card.row.event.id} style={{ left: `${(x / stripWidth) * 100}%` }} data-selected={selected?.id === card.row.event.id} />
								))}
								<span className="history-minimap-window" style={{ left: `${scrollWindow.start}%`, width: `${scrollWindow.size}%` }} />
							</div>
							<input
								type="range"
								aria-label="Selected history moment"
								min={0}
								max={positions.length - 1}
								value={Math.max(0, current)}
								onChange={(event) => {
									setPlaying(false);
									chooseIndex(Number(event.target.value));
								}}
							/>
						</div>
					) : null}
				</>
			)}
			{matches.length > filtered.length ? (
				<Button m={3} size="sm" variant="outline" onClick={() => setVisibleCount((count) => count + 80)}>
					Show more loaded changes
				</Button>
			) : null}
			{hasOlder ? (
				<Button
					m={3}
					size="sm"
					variant="outline"
					isLoading={loadingOlder}
					onClick={async () => {
						setLoadingOlder(true);
						try {
							await older();
						} finally {
							setLoadingOlder(false);
						}
					}}
				>
					Load older changes
				</Button>
			) : null}
		</Box>
	);
}
