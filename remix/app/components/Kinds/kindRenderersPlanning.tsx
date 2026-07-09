import React from 'react';
import { Box, Flex, Text } from '@chakra-ui/react';

import { registerKindRenderer } from './kindRegistry';
import type { KindRenderContext } from './kindRegistry';
import {
	BodyText,
	CardTitle,
	DateBlock,
	KindBadge,
	KindCard,
	MutedMono,
	ProgressBar,
	StatCell,
	formatDateTime,
	toArray,
	toNumberOr,
	toStringArray,
	toStringOr
} from './kindPrimitives';

// Planning & time kinds — events, tasks, trips, and everything with a date.

// ————— 📅 event —————

type EventValue = { title: string; startsAt: string; endsAt: string; venue: string; description: string; rsvpCount: number | null; online: boolean };

const EventRenderer = ({ value }: { value: EventValue; context: KindRenderContext }) => (
	<KindCard>
		<Flex columnGap={3}>
			<DateBlock date={value.startsAt} />
			<Box flex="1" minWidth={0}>
				<CardTitle size="sm">{value.title}</CardTitle>
				<Flex columnGap={2} flexWrap="wrap" marginTop={0.5}>
					<MutedMono>{formatDateTime(value.startsAt)}</MutedMono>
					{value.endsAt ? <MutedMono>→ {formatDateTime(value.endsAt)}</MutedMono> : null}
				</Flex>
				<Flex columnGap={2} flexWrap="wrap" marginTop={1.5} rowGap={1.5}>
					{value.venue ? <KindBadge tone="info">📍 {value.venue}</KindBadge> : null}
					{value.online ? <KindBadge>💻 Online</KindBadge> : null}
					{value.rsvpCount !== null ? <KindBadge tone="positive">🤝 {value.rsvpCount} going</KindBadge> : null}
				</Flex>
				<BodyText lines={2}>{value.description}</BodyText>
			</Box>
		</Flex>
	</KindCard>
);

// ————— 🎫 ticket —————

type TicketValue = { event: string; holder: string; date: string; seat: string; section: string; code: string };

const TicketRenderer = ({ value }: { value: TicketValue; context: KindRenderContext }) => (
	<KindCard padding={0}>
		<Flex>
			<Box flex="1" minWidth={0} padding={4}>
				<MutedMono>ADMIT ONE</MutedMono>
				<CardTitle size="sm">{value.event}</CardTitle>
				<Flex columnGap={4} marginTop={2.5} flexWrap="wrap" rowGap={2}>
					{value.date ? <StatCell label="date" value={formatDateTime(value.date)} /> : null}
					{value.section ? <StatCell label="section" value={value.section} /> : null}
					{value.seat ? <StatCell label="seat" value={value.seat} /> : null}
				</Flex>
				{value.holder ? (
					<Text color="var(--tt-muted, #9a9aa6)" fontSize="xs" marginTop={2}>
						👤 {value.holder}
					</Text>
				) : null}
			</Box>
			<Flex
				alignItems="center"
				justifyContent="center"
				borderLeft="2px dashed var(--tt-border, #ececef)"
				flexDirection="column"
				flexShrink={0}
				padding={3}
				rowGap={1}
				width="96px"
			>
				{/* pseudo-QR: deterministic pattern from the code string */}
				<Box display="grid" gridTemplateColumns="repeat(7, 6px)" gap="1.5px" aria-label="ticket code">
					{Array.from({ length: 49 }, (_, idx) => {
						const char = value.code.charCodeAt(idx % Math.max(value.code.length, 1)) || 42;
						return <Box key={idx} background={(char * (idx + 3)) % 5 < 2 ? 'var(--tt-ink, #16161a)' : 'transparent'} height="6px" width="6px" />;
					})}
				</Box>
				<MutedMono>{value.code}</MutedMono>
			</Flex>
		</Flex>
	</KindCard>
);

// ————— 🗓️ calendar —————

type CalendarValue = { title: string; days: Array<{ date: string; events: Array<{ time: string; title: string }> }> };

const CalendarRenderer = ({ value }: { value: CalendarValue; context: KindRenderContext }) => (
	<KindCard>
		{value.title ? <CardTitle size="sm">🗓️ {value.title}</CardTitle> : null}
		<Flex flexDirection="column" marginTop={2} rowGap={2.5}>
			{value.days.map((day) => (
				<Flex key={day.date} columnGap={3}>
					<DateBlock date={day.date} size="sm" />
					<Flex flex="1" flexDirection="column" minWidth={0} rowGap={1}>
						{day.events.map((event, idx) => (
							<Flex key={idx} alignItems="baseline" columnGap={2}>
								<MutedMono>{event.time}</MutedMono>
								<Text color="var(--tt-ink, #16161a)" fontSize="sm" fontWeight={650} noOfLines={1}>
									{event.title}
								</Text>
							</Flex>
						))}
						{!day.events.length ? (
							<Text color="var(--tt-faint, #b6b6c0)" fontSize="sm">
								Free ✨
							</Text>
						) : null}
					</Flex>
				</Flex>
			))}
		</Flex>
	</KindCard>
);

// ————— ✅ task —————

type TaskValue = { title: string; done: boolean; due: string; priority: string; assignee: string; notes: string };

const priorityTone = (priority: string): 'danger' | 'accent' | 'default' => {
	const p = priority.toLowerCase();
	if (p === 'high' || p === 'urgent') return 'danger';
	if (p === 'medium') return 'accent';
	return 'default';
};

const TaskRenderer = ({ value }: { value: TaskValue; context: KindRenderContext }) => {
	const [done, setDone] = React.useState(value.done);

	return (
		<KindCard>
			<Flex columnGap={3}>
				<Flex
					as="button"
					type="button"
					aria-label={done ? 'Mark not done' : 'Mark done'}
					alignItems="center"
					justifyContent="center"
					background={done ? 'var(--tt-positive, #2f8f4f)' : 'transparent'}
					border={done ? 'none' : '2px solid var(--tt-faint, #b6b6c0)'}
					borderRadius="7px"
					color="white"
					cursor="pointer"
					flexShrink={0}
					fontSize="12px"
					fontWeight={800}
					height="22px"
					marginTop={0.5}
					width="22px"
					onClick={() => setDone((prev) => !prev)}
				>
					{done ? '✓' : ''}
				</Flex>
				<Box flex="1" minWidth={0}>
					<Text color="var(--tt-ink, #16161a)" fontSize="sm" fontWeight={700} textDecoration={done ? 'line-through' : 'none'} opacity={done ? 0.55 : 1}>
						{value.title}
					</Text>
					{value.notes ? <BodyText lines={2}>{value.notes}</BodyText> : null}
					<Flex columnGap={1.5} flexWrap="wrap" marginTop={1.5} rowGap={1.5}>
						{value.due ? <KindBadge tone="info">⏰ {value.due}</KindBadge> : null}
						{value.priority ? <KindBadge tone={priorityTone(value.priority)}>{value.priority}</KindBadge> : null}
						{value.assignee ? <KindBadge>👤 {value.assignee}</KindBadge> : null}
					</Flex>
				</Box>
			</Flex>
		</KindCard>
	);
};

// ————— 📋 task-list —————

type TaskListValue = { title: string; tasks: Array<{ title: string; done: boolean }> };

const TaskListRenderer = ({ value }: { value: TaskListValue; context: KindRenderContext }) => {
	const [tasks, setTasks] = React.useState(value.tasks);
	const doneCount = tasks.filter((task) => task.done).length;

	return (
		<KindCard>
			<Flex alignItems="baseline" justifyContent="space-between">
				<CardTitle size="sm">📋 {value.title}</CardTitle>
				<MutedMono>
					{doneCount}/{tasks.length}
				</MutedMono>
			</Flex>
			<Box marginTop={2}>
				<ProgressBar value={doneCount} max={tasks.length} tone="positive" />
			</Box>
			<Flex flexDirection="column" marginTop={2.5} rowGap={1.5}>
				{tasks.map((task, idx) => (
					<Flex
						key={idx}
						as="button"
						type="button"
						alignItems="center"
						columnGap={2}
						cursor="pointer"
						textAlign="left"
						onClick={() => setTasks((prev) => prev.map((t, tIdx) => (tIdx === idx ? { ...t, done: !t.done } : t)))}
					>
						<Text color={task.done ? 'var(--tt-positive, #2f8f4f)' : 'var(--tt-faint, #b6b6c0)'} fontSize="md">
							{task.done ? '☑' : '☐'}
						</Text>
						<Text color="var(--tt-text, #5a5a66)" fontSize="sm" textDecoration={task.done ? 'line-through' : 'none'} opacity={task.done ? 0.55 : 1}>
							{task.title}
						</Text>
					</Flex>
				))}
			</Flex>
		</KindCard>
	);
};

// ————— 🕰️ timeline —————

type TimelineValue = { title: string; entries: Array<{ date: string; title: string; description: string }> };

const TimelineRenderer = ({ value }: { value: TimelineValue; context: KindRenderContext }) => (
	<KindCard>
		{value.title ? <CardTitle size="sm">🕰️ {value.title}</CardTitle> : null}
		<Flex flexDirection="column" marginTop={3}>
			{value.entries.map((entry, idx) => (
				<Flex key={idx} columnGap={3}>
					<Flex flexDirection="column" alignItems="center">
						<Box background={idx === 0 ? 'var(--tt-accent, hotpink)' : 'var(--tt-faint, #b6b6c0)'} borderRadius="999px" flexShrink={0} height="11px" width="11px" marginTop={1} />
						{idx < value.entries.length - 1 ? <Box background="var(--tt-border-light, #f0f0f2)" flex="1" width="2px" /> : null}
					</Flex>
					<Box flex="1" minWidth={0} paddingBottom={idx < value.entries.length - 1 ? 3 : 0}>
						<MutedMono>{entry.date}</MutedMono>
						<Text color="var(--tt-ink, #16161a)" fontSize="sm" fontWeight={750}>
							{entry.title}
						</Text>
						{entry.description ? <BodyText lines={2}>{entry.description}</BodyText> : null}
					</Box>
				</Flex>
			))}
		</Flex>
	</KindCard>
);

// ————— 🎯 milestone —————

type MilestoneValue = { title: string; progress: number; target: string; unit: string; note: string };

const MilestoneRenderer = ({ value }: { value: MilestoneValue; context: KindRenderContext }) => (
	<KindCard>
		<Flex alignItems="center" columnGap={4}>
			{/* progress ring */}
			<Box position="relative" flexShrink={0} height="76px" width="76px">
				<Box as="svg" viewBox="0 0 44 44" height="76px" width="76px" transform="rotate(-90deg)">
					<circle cx="22" cy="22" r="18" fill="none" stroke="var(--tt-surface-alt, #f5f5f7)" strokeWidth="5" />
					<circle
						cx="22"
						cy="22"
						r="18"
						fill="none"
						stroke="var(--tt-accent, hotpink)"
						strokeWidth="5"
						strokeLinecap="round"
						strokeDasharray={`${(Math.max(0, Math.min(100, value.progress)) / 100) * 113} 113`}
					/>
				</Box>
				<Flex alignItems="center" inset={0} justifyContent="center" position="absolute">
					<Text color="var(--tt-ink, #16161a)" fontSize="md" fontWeight={900}>
						{Math.round(value.progress)}%
					</Text>
				</Flex>
			</Box>
			<Box flex="1" minWidth={0}>
				<CardTitle size="sm">🎯 {value.title}</CardTitle>
				{value.target ? (
					<MutedMono>
						target: {value.target}
						{value.unit ? ` ${value.unit}` : ''}
					</MutedMono>
				) : null}
				{value.note ? <BodyText lines={2}>{value.note}</BodyText> : null}
			</Box>
		</Flex>
	</KindCard>
);

// ————— 🧳 itinerary —————

type ItineraryValue = { title: string; days: Array<{ label: string; stops: string[] }> };

const ItineraryRenderer = ({ value }: { value: ItineraryValue; context: KindRenderContext }) => (
	<KindCard>
		<CardTitle size="sm">🧳 {value.title}</CardTitle>
		<Flex flexDirection="column" marginTop={2.5} rowGap={2.5}>
			{value.days.map((day, idx) => (
				<Box key={idx}>
					<KindBadge tone="info">{day.label}</KindBadge>
					<Flex flexDirection="column" marginTop={1.5} paddingLeft={2} rowGap={1}>
						{day.stops.map((stop, stopIdx) => (
							<Flex key={stopIdx} alignItems="baseline" columnGap={2}>
								<Text color="var(--tt-faint, #b6b6c0)" fontSize="xs">
									{stopIdx === day.stops.length - 1 ? '📍' : '↓'}
								</Text>
								<Text color="var(--tt-text, #5a5a66)" fontSize="sm">
									{stop}
								</Text>
							</Flex>
						))}
					</Flex>
				</Box>
			))}
		</Flex>
	</KindCard>
);

// ————— 🛎️ booking —————

type BookingValue = { title: string; confirmation: string; checkIn: string; checkOut: string; guests: number | null; location: string; status: string };

const BookingRenderer = ({ value }: { value: BookingValue; context: KindRenderContext }) => (
	<KindCard>
		<Flex alignItems="center" justifyContent="space-between">
			<CardTitle size="sm">🛎️ {value.title}</CardTitle>
			{value.status ? <KindBadge tone={value.status.toLowerCase() === 'confirmed' ? 'positive' : 'default'}>{value.status}</KindBadge> : null}
		</Flex>
		{value.location ? <MutedMono>📍 {value.location}</MutedMono> : null}
		<Flex columnGap={5} marginTop={3} flexWrap="wrap" rowGap={2}>
			{value.checkIn ? <StatCell label="check-in" value={value.checkIn} /> : null}
			{value.checkOut ? <StatCell label="check-out" value={value.checkOut} /> : null}
			{value.guests !== null ? <StatCell label="guests" value={`👥 ${value.guests}`} /> : null}
		</Flex>
		{value.confirmation ? (
			<Text color="var(--tt-muted, #9a9aa6)" fontFamily="var(--tt-font-mono, monospace)" fontSize="xs" marginTop={2.5}>
				Confirmation {value.confirmation}
			</Text>
		) : null}
	</KindCard>
);

// ————— 🛫 flight —————

type FlightValue = { from: string; fromCity: string; to: string; toCity: string; flightNumber: string; departs: string; arrives: string; gate: string; seat: string };

const FlightRenderer = ({ value }: { value: FlightValue; context: KindRenderContext }) => (
	<KindCard>
		<Flex alignItems="center" justifyContent="space-between">
			<MutedMono>🛫 {value.flightNumber}</MutedMono>
			{value.gate ? <KindBadge tone="info">Gate {value.gate}</KindBadge> : null}
		</Flex>
		<Flex alignItems="center" columnGap={3} marginTop={2}>
			<Box textAlign="left">
				<Text color="var(--tt-ink, #16161a)" fontSize="2xl" fontWeight={900} letterSpacing="0.02em">
					{value.from}
				</Text>
				<MutedMono>{value.fromCity}</MutedMono>
			</Box>
			<Flex alignItems="center" flex="1" minWidth="40px">
				<Box background="var(--tt-faint, #b6b6c0)" borderRadius="999px" height="7px" width="7px" />
				<Box borderTop="2px dashed var(--tt-faint, #b6b6c0)" flex="1" />
				<Text fontSize="md">✈️</Text>
				<Box borderTop="2px dashed var(--tt-faint, #b6b6c0)" flex="1" />
				<Box background="var(--tt-faint, #b6b6c0)" borderRadius="999px" height="7px" width="7px" />
			</Flex>
			<Box textAlign="right">
				<Text color="var(--tt-ink, #16161a)" fontSize="2xl" fontWeight={900} letterSpacing="0.02em">
					{value.to}
				</Text>
				<MutedMono>{value.toCity}</MutedMono>
			</Box>
		</Flex>
		<Flex columnGap={5} marginTop={3} flexWrap="wrap" rowGap={2}>
			{value.departs ? <StatCell label="departs" value={value.departs} /> : null}
			{value.arrives ? <StatCell label="arrives" value={value.arrives} /> : null}
			{value.seat ? <StatCell label="seat" value={value.seat} /> : null}
		</Flex>
	</KindCard>
);

// ————— registration —————

registerKindRenderer({
	kind: 'event',
	title: 'Event',
	emoji: '📅',
	description: 'Calendar-leaf date block, venue, and RSVP count.',
	category: 'Planning',
	aliases: ['meetup', 'concert', 'gathering'],
	match: (thing) => ('startsAt' in thing || 'when' in thing) && ('venue' in thing || 'rsvpCount' in thing || 'title' in thing) && !('checkIn' in thing),
	adapt: (thing): EventValue | null => {
		const title = toStringOr(thing.title, toStringOr(thing.name));
		const startsAt = toStringOr(thing.startsAt, toStringOr(thing.when, toStringOr(thing.date)));
		if (!title || !startsAt) return null;
		return {
			title,
			startsAt,
			endsAt: toStringOr(thing.endsAt),
			venue: toStringOr(thing.venue, toStringOr(thing.location)),
			description: toStringOr(thing.description),
			rsvpCount: toNumberOr(thing.rsvpCount, toNumberOr(thing.going)),
			online: thing.online === true
		};
	},
	render: EventRenderer
});

registerKindRenderer({
	kind: 'ticket',
	title: 'Ticket',
	emoji: '🎫',
	description: 'Perforated stub with seat, section, and a code block.',
	category: 'Planning',
	aliases: ['pass', 'admission'],
	match: (thing) => ('seat' in thing || 'section' in thing) && ('event' in thing || 'code' in thing),
	adapt: (thing): TicketValue | null => {
		const event = toStringOr(thing.event, toStringOr(thing.title));
		if (!event) return null;
		return {
			event,
			holder: toStringOr(thing.holder, toStringOr(thing.name)),
			date: toStringOr(thing.date),
			seat: toStringOr(thing.seat),
			section: toStringOr(thing.section),
			code: toStringOr(thing.code, 'TT-0000')
		};
	},
	render: TicketRenderer
});

registerKindRenderer({
	kind: 'calendar',
	title: 'Calendar / agenda',
	emoji: '🗓️',
	description: 'Days with timed entries — a week at a glance.',
	category: 'Planning',
	aliases: ['agenda', 'schedule'],
	match: (thing) =>
		Array.isArray(thing.days) &&
		toArray(thing.days).every((day) => day && typeof day === 'object' && 'date' in (day as Record<string, unknown>)),
	adapt: (thing): CalendarValue | null => {
		const days = toArray(thing.days).map((day) => {
			const record = (day || {}) as Record<string, unknown>;
			return {
				date: toStringOr(record.date),
				events: toArray(record.events).map((event) => {
					const eventRecord = (event || {}) as Record<string, unknown>;
					return typeof event === 'string'
						? { time: '', title: event }
						: { time: toStringOr(eventRecord.time), title: toStringOr(eventRecord.title, toStringOr(eventRecord.name)) };
				})
			};
		});
		if (!days.length) return null;
		return { title: toStringOr(thing.title, toStringOr(thing.name)), days };
	},
	render: CalendarRenderer
});

registerKindRenderer({
	kind: 'task',
	title: 'Task',
	emoji: '✅',
	description: 'A single to-do — checkbox, due date, priority, assignee.',
	category: 'Planning',
	aliases: ['todo', 'action-item'],
	match: (thing) => typeof thing.title === 'string' && ('done' in thing || 'due' in thing || 'priority' in thing) && !Array.isArray(thing.tasks),
	adapt: (thing): TaskValue | null => {
		const title = toStringOr(thing.title, toStringOr(thing.name));
		if (!title) return null;
		return {
			title,
			done: thing.done === true || thing.completed === true,
			due: toStringOr(thing.due, toStringOr(thing.dueDate)),
			priority: toStringOr(thing.priority),
			assignee: toStringOr(thing.assignee),
			notes: toStringOr(thing.notes, toStringOr(thing.description))
		};
	},
	render: TaskRenderer
});

registerKindRenderer({
	kind: 'task-list',
	title: 'Task list',
	emoji: '📋',
	description: 'Checklist with a live progress bar — tap to tick.',
	category: 'Planning',
	aliases: ['checklist', 'todos'],
	match: (thing) => Array.isArray(thing.tasks),
	adapt: (thing): TaskListValue | null => {
		const tasks = toArray(thing.tasks).map((task) => {
			const record = (task || {}) as Record<string, unknown>;
			return typeof task === 'string'
				? { title: task, done: false }
				: { title: toStringOr(record.title, toStringOr(record.name, 'Task')), done: record.done === true || record.completed === true };
		});
		if (!tasks.length) return null;
		return { title: toStringOr(thing.title, toStringOr(thing.name, 'To-do')), tasks };
	},
	render: TaskListRenderer
});

registerKindRenderer({
	kind: 'timeline',
	title: 'Timeline',
	emoji: '🕰️',
	description: 'Vertical dated milestones with connector rail.',
	category: 'Planning',
	aliases: ['history', 'milestones'],
	match: (thing) =>
		Array.isArray(thing.entries) &&
		toArray(thing.entries).every((entry) => entry && typeof entry === 'object' && 'date' in (entry as Record<string, unknown>)),
	adapt: (thing): TimelineValue | null => {
		const entries = toArray(thing.entries).map((entry) => {
			const record = (entry || {}) as Record<string, unknown>;
			return {
				date: toStringOr(record.date),
				title: toStringOr(record.title, toStringOr(record.name)),
				description: toStringOr(record.description)
			};
		});
		if (!entries.length) return null;
		return { title: toStringOr(thing.title, toStringOr(thing.name)), entries };
	},
	render: TimelineRenderer
});

registerKindRenderer({
	kind: 'milestone',
	title: 'Goal / milestone',
	emoji: '🎯',
	description: 'A progress ring toward a target.',
	category: 'Planning',
	aliases: ['goal', 'progress'],
	match: (thing) => toNumberOr(thing.progress) !== null && ('target' in thing || 'title' in thing) && !('raised' in thing),
	adapt: (thing): MilestoneValue | null => {
		const progress = toNumberOr(thing.progress);
		const title = toStringOr(thing.title, toStringOr(thing.name));
		if (progress === null || !title) return null;
		return {
			title,
			progress,
			target: toStringOr(thing.target),
			unit: toStringOr(thing.unit),
			note: toStringOr(thing.note, toStringOr(thing.description))
		};
	},
	render: MilestoneRenderer
});

registerKindRenderer({
	kind: 'itinerary',
	title: 'Itinerary',
	emoji: '🧳',
	description: 'Trip legs day by day, stop by stop.',
	category: 'Planning',
	aliases: ['trip', 'journey'],
	match: (thing) =>
		Array.isArray(thing.days) &&
		toArray(thing.days).every((day) => day && typeof day === 'object' && Array.isArray((day as Record<string, unknown>).stops)),
	adapt: (thing): ItineraryValue | null => {
		const days = toArray(thing.days).map((day, idx) => {
			const record = (day || {}) as Record<string, unknown>;
			return { label: toStringOr(record.label, `Day ${idx + 1}`), stops: toStringArray(record.stops) };
		});
		if (!days.length) return null;
		return { title: toStringOr(thing.title, toStringOr(thing.name, 'Trip')), days };
	},
	render: ItineraryRenderer
});

registerKindRenderer({
	kind: 'booking',
	title: 'Booking',
	emoji: '🛎️',
	description: 'Reservation confirmation — check-in/out, guests, code.',
	category: 'Planning',
	aliases: ['reservation', 'stay'],
	match: (thing) => 'checkIn' in thing || 'confirmation' in thing,
	adapt: (thing): BookingValue | null => {
		const title = toStringOr(thing.title, toStringOr(thing.name, toStringOr(thing.hotel)));
		if (!title) return null;
		return {
			title,
			confirmation: toStringOr(thing.confirmation),
			checkIn: toStringOr(thing.checkIn),
			checkOut: toStringOr(thing.checkOut),
			guests: toNumberOr(thing.guests),
			location: toStringOr(thing.location),
			status: toStringOr(thing.status, 'Confirmed')
		};
	},
	render: BookingRenderer
});

registerKindRenderer({
	kind: 'flight',
	title: 'Flight',
	emoji: '🛫',
	description: 'Boarding-pass style leg — airports, times, gate, seat.',
	category: 'Planning',
	aliases: ['boarding-pass'],
	match: (thing) => 'flightNumber' in thing || ('from' in thing && 'to' in thing && ('departs' in thing || 'gate' in thing)),
	adapt: (thing): FlightValue | null => {
		const from = toStringOr(thing.from).toUpperCase();
		const to = toStringOr(thing.to).toUpperCase();
		if (!from || !to) return null;
		return {
			from,
			fromCity: toStringOr(thing.fromCity),
			to,
			toCity: toStringOr(thing.toCity),
			flightNumber: toStringOr(thing.flightNumber, 'TT 001'),
			departs: toStringOr(thing.departs),
			arrives: toStringOr(thing.arrives),
			gate: toStringOr(thing.gate),
			seat: toStringOr(thing.seat)
		};
	},
	render: FlightRenderer
});
