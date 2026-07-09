import React from 'react';
import { Box, Flex, Grid, Text } from '@chakra-ui/react';

import { registerKindRenderer } from './kindRegistry';
import type { KindRenderContext } from './kindRegistry';
import {
	Avatar,
	BodyText,
	CardTitle,
	KindBadge,
	KindCard,
	MutedMono,
	ProgressBar,
	StatCell,
	toArray,
	toNumberOr,
	toStringArray,
	toStringOr
} from './kindPrimitives';

// Knowledge, health & life kinds — weather, learning, sport, and the garden.

// ————— ⛅ weather —————

const WEATHER_EMOJI: Record<string, string> = {
	sunny: '☀️',
	clear: '☀️',
	cloudy: '☁️',
	overcast: '☁️',
	partly: '⛅',
	rain: '🌧️',
	showers: '🌦️',
	storm: '⛈️',
	snow: '❄️',
	fog: '🌫️',
	wind: '💨'
};

const weatherEmoji = (condition: string): string => {
	const c = condition.toLowerCase();
	for (const key of Object.keys(WEATHER_EMOJI)) {
		if (c.includes(key)) return WEATHER_EMOJI[key];
	}
	return '🌤️';
};

type WeatherValue = {
	location: string;
	temp: number | null;
	unit: string;
	condition: string;
	high: number | null;
	low: number | null;
	forecast: Array<{ day: string; condition: string; high: number | null; low: number | null }>;
};

const WeatherRenderer = ({ value }: { value: WeatherValue; context: KindRenderContext }) => (
	<KindCard>
		<Flex alignItems="center" columnGap={4}>
			<Text fontSize="44px" aria-hidden>
				{weatherEmoji(value.condition)}
			</Text>
			<Box>
				<Flex alignItems="baseline" columnGap={1}>
					<Text color="var(--tt-ink, #16161a)" fontSize="3xl" fontWeight={900} lineHeight="1">
						{value.temp !== null ? Math.round(value.temp) : '—'}°
					</Text>
					<MutedMono>{value.unit}</MutedMono>
				</Flex>
				<Text color="var(--tt-text, #5a5a66)" fontSize="sm" fontWeight={650}>
					{value.condition}
				</Text>
				<Flex columnGap={2}>
					<MutedMono>📍 {value.location}</MutedMono>
					{value.high !== null && value.low !== null ? (
						<MutedMono>
							H {Math.round(value.high)}° / L {Math.round(value.low)}°
						</MutedMono>
					) : null}
				</Flex>
			</Box>
		</Flex>
		{value.forecast.length ? (
			<Grid gap={2} marginTop={3} templateColumns={`repeat(${Math.min(value.forecast.length, 5)}, 1fr)`}>
				{value.forecast.slice(0, 5).map((day) => (
					<Flex key={day.day} alignItems="center" background="var(--tt-surface, #fafafb)" borderRadius="var(--tt-radius-sm, 9px)" flexDirection="column" paddingY={2} rowGap={0.5}>
						<Text color="var(--tt-muted, #9a9aa6)" fontSize="10px" fontWeight={800} textTransform="uppercase">
							{day.day}
						</Text>
						<Text fontSize="18px">{weatherEmoji(day.condition)}</Text>
						<Text color="var(--tt-ink, #16161a)" fontSize="xs" fontWeight={700}>
							{day.high !== null ? Math.round(day.high) : '—'}°{' '}
							<Box as="span" color="var(--tt-faint, #b6b6c0)">
								{day.low !== null ? Math.round(day.low) : '—'}°
							</Box>
						</Text>
					</Flex>
				))}
			</Grid>
		) : null}
	</KindCard>
);

// ————— 🏋️ workout —————

type WorkoutValue = { title: string; duration: string; calories: number | null; exercises: Array<{ name: string; sets: number | null; reps: string; weight: string }> };

const WorkoutRenderer = ({ value }: { value: WorkoutValue; context: KindRenderContext }) => (
	<KindCard>
		<Flex alignItems="center" columnGap={2} flexWrap="wrap">
			<CardTitle size="sm">🏋️ {value.title}</CardTitle>
			{value.duration ? <KindBadge>⏱ {value.duration}</KindBadge> : null}
			{value.calories !== null ? <KindBadge tone="accent">🔥 {value.calories} cal</KindBadge> : null}
		</Flex>
		<Flex flexDirection="column" marginTop={2}>
			{value.exercises.map((exercise, idx) => (
				<Flex key={idx} alignItems="baseline" borderTop={idx === 0 ? 'none' : '1px solid var(--tt-border-light, #f0f0f2)'} columnGap={3} justifyContent="space-between" paddingY={1.5}>
					<Text color="var(--tt-ink, #16161a)" fontSize="sm" fontWeight={650}>
						{exercise.name}
					</Text>
					<MutedMono>
						{exercise.sets !== null ? `${exercise.sets} × ` : ''}
						{exercise.reps}
						{exercise.weight ? ` @ ${exercise.weight}` : ''}
					</MutedMono>
				</Flex>
			))}
		</Flex>
	</KindCard>
);

// ————— 🎓 course —————

type CourseValue = { title: string; provider: string; level: string; lessons: number | null; duration: string; progress: number | null; description: string };

const CourseRenderer = ({ value }: { value: CourseValue; context: KindRenderContext }) => (
	<KindCard>
		<Flex columnGap={3}>
			<Flex alignItems="center" justifyContent="center" background="linear-gradient(135deg, #dcecf7, #e8e2f7)" borderRadius="var(--tt-radius-md, 12px)" flexShrink={0} fontSize="24px" height="56px" width="56px">
				🎓
			</Flex>
			<Box flex="1" minWidth={0}>
				<CardTitle size="sm">{value.title}</CardTitle>
				<Flex columnGap={2} flexWrap="wrap">
					{value.provider ? <MutedMono>{value.provider}</MutedMono> : null}
					{value.lessons !== null ? <MutedMono>· {value.lessons} lessons</MutedMono> : null}
					{value.duration ? <MutedMono>· {value.duration}</MutedMono> : null}
				</Flex>
				{value.level ? (
					<Box marginTop={1.5}>
						<KindBadge tone="info">{value.level}</KindBadge>
					</Box>
				) : null}
				<BodyText lines={2}>{value.description}</BodyText>
				{value.progress !== null ? (
					<Flex alignItems="center" columnGap={2} marginTop={2}>
						<Box flex="1">
							<ProgressBar value={value.progress} tone="info" />
						</Box>
						<MutedMono>{Math.round(value.progress)}%</MutedMono>
					</Flex>
				) : null}
			</Box>
		</Flex>
	</KindCard>
);

// ————— 🏅 certificate —————

type CertificateValue = { title: string; recipient: string; issuer: string; date: string; credentialId: string };

const CertificateRenderer = ({ value }: { value: CertificateValue; context: KindRenderContext }) => (
	<Box
		background="var(--tt-card, #ffffff)"
		border="3px double var(--tt-faint, #b6b6c0)"
		borderRadius="var(--tt-radius-lg, 16px)"
		padding={5}
		textAlign="center"
		width="100%"
	>
		<Text fontSize="30px">🏅</Text>
		<Text color="var(--tt-muted, #9a9aa6)" fontSize="10px" fontWeight={800} letterSpacing="0.2em" textTransform="uppercase" marginTop={1}>
			Certificate
		</Text>
		<Text color="var(--tt-ink, #16161a)" fontSize="lg" fontWeight={850} marginTop={1}>
			{value.title}
		</Text>
		{value.recipient ? (
			<Text color="var(--tt-text, #5a5a66)" fontSize="sm" marginTop={2}>
				awarded to <strong>{value.recipient}</strong>
			</Text>
		) : null}
		<Flex columnGap={2} justifyContent="center" marginTop={2} flexWrap="wrap">
			{value.issuer ? <MutedMono>{value.issuer}</MutedMono> : null}
			{value.date ? <MutedMono>· {value.date}</MutedMono> : null}
		</Flex>
		{value.credentialId ? (
			<Text color="var(--tt-faint, #b6b6c0)" fontFamily="var(--tt-font-mono, monospace)" fontSize="10px" marginTop={2}>
				{value.credentialId}
			</Text>
		) : null}
	</Box>
);

// ————— 📖 definition —————

type DefinitionValue = { word: string; phonetic: string; partOfSpeech: string; meanings: string[]; example: string };

const DefinitionRenderer = ({ value }: { value: DefinitionValue; context: KindRenderContext }) => (
	<KindCard>
		<Flex alignItems="baseline" columnGap={2} flexWrap="wrap">
			<Text color="var(--tt-ink, #16161a)" fontSize="xl" fontWeight={850}>
				{value.word}
			</Text>
			{value.phonetic ? <MutedMono>{value.phonetic}</MutedMono> : null}
			{value.partOfSpeech ? (
				<Text color="var(--tt-muted, #9a9aa6)" fontSize="sm" fontStyle="italic">
					{value.partOfSpeech}
				</Text>
			) : null}
		</Flex>
		<Flex flexDirection="column" marginTop={2} rowGap={1.5}>
			{value.meanings.map((meaning, idx) => (
				<Flex key={idx} columnGap={2} alignItems="baseline">
					<MutedMono>{idx + 1}.</MutedMono>
					<Text color="var(--tt-text, #5a5a66)" fontSize="sm" lineHeight="1.6">
						{meaning}
					</Text>
				</Flex>
			))}
		</Flex>
		{value.example ? (
			<Text color="var(--tt-muted, #9a9aa6)" fontSize="sm" fontStyle="italic" marginTop={2}>
				“{value.example}”
			</Text>
		) : null}
	</KindCard>
);

// ————— 🏆 leaderboard —————

type LeaderboardValue = { title: string; entries: Array<{ name: string; score: string; avatarUrl: string | null }> };

const LeaderboardRenderer = ({ value }: { value: LeaderboardValue; context: KindRenderContext }) => (
	<KindCard>
		{value.title ? <CardTitle size="sm">🏆 {value.title}</CardTitle> : null}
		<Flex flexDirection="column" marginTop={2}>
			{value.entries.slice(0, 8).map((entry, idx) => (
				<Flex key={idx} alignItems="center" borderTop={idx === 0 ? 'none' : '1px solid var(--tt-border-light, #f0f0f2)'} columnGap={3} paddingY={1.5}>
					<Text fontSize="sm" fontWeight={800} color={idx < 3 ? 'var(--tt-ink, #16161a)' : 'var(--tt-muted, #9a9aa6)'} width="26px">
						{idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}`}
					</Text>
					<Avatar name={entry.name} size={26} src={entry.avatarUrl} />
					<Text color="var(--tt-ink, #16161a)" flex="1" fontSize="sm" fontWeight={650} noOfLines={1}>
						{entry.name}
					</Text>
					<Text color="var(--tt-ink, #16161a)" fontSize="sm" fontWeight={800}>
						{entry.score}
					</Text>
				</Flex>
			))}
		</Flex>
	</KindCard>
);

// ————— 🏟️ match —————

type MatchValue = { competition: string; status: string; home: { name: string; score: number | null }; away: { name: string; score: number | null }; venue: string; when: string };

const MatchRenderer = ({ value }: { value: MatchValue; context: KindRenderContext }) => (
	<KindCard>
		<Flex alignItems="center" justifyContent="space-between">
			<MutedMono>{value.competition}</MutedMono>
			{value.status ? <KindBadge tone={value.status.toLowerCase().includes('live') ? 'danger' : 'default'}>{value.status}</KindBadge> : null}
		</Flex>
		<Grid alignItems="center" gap={2} marginTop={3} templateColumns="1fr auto 1fr">
			<Flex alignItems="center" flexDirection="column" rowGap={1}>
				<Avatar name={value.home.name} size={40} />
				<Text color="var(--tt-ink, #16161a)" fontSize="sm" fontWeight={750} textAlign="center">
					{value.home.name}
				</Text>
			</Flex>
			<Text color="var(--tt-ink, #16161a)" fontSize="2xl" fontWeight={900} whiteSpace="nowrap">
				{value.home.score !== null ? value.home.score : '–'} : {value.away.score !== null ? value.away.score : '–'}
			</Text>
			<Flex alignItems="center" flexDirection="column" rowGap={1}>
				<Avatar name={value.away.name} size={40} />
				<Text color="var(--tt-ink, #16161a)" fontSize="sm" fontWeight={750} textAlign="center">
					{value.away.name}
				</Text>
			</Flex>
		</Grid>
		<Flex columnGap={2} justifyContent="center" marginTop={2}>
			{value.venue ? <MutedMono>📍 {value.venue}</MutedMono> : null}
			{value.when ? <MutedMono>· {value.when}</MutedMono> : null}
		</Flex>
	</KindCard>
);

// ————— 🚀 changelog —————

const CHANGE_TONES: Record<string, 'positive' | 'info' | 'danger' | 'accent'> = {
	added: 'positive',
	new: 'positive',
	improved: 'info',
	changed: 'info',
	fixed: 'accent',
	removed: 'danger',
	deprecated: 'danger'
};

type ChangelogValue = { version: string; date: string; changes: Array<{ type: string; text: string }> };

const ChangelogRenderer = ({ value }: { value: ChangelogValue; context: KindRenderContext }) => (
	<KindCard>
		<Flex alignItems="baseline" columnGap={2}>
			<CardTitle size="sm">🚀 {value.version}</CardTitle>
			{value.date ? <MutedMono>{value.date}</MutedMono> : null}
		</Flex>
		<Flex flexDirection="column" marginTop={2.5} rowGap={2}>
			{value.changes.map((change, idx) => (
				<Flex key={idx} alignItems="flex-start" columnGap={2}>
					<KindBadge tone={CHANGE_TONES[change.type.toLowerCase()] || 'default'}>{change.type}</KindBadge>
					<Text color="var(--tt-text, #5a5a66)" fontSize="sm" lineHeight="1.5">
						{change.text}
					</Text>
				</Flex>
			))}
		</Flex>
	</KindCard>
);

// ————— 🪴 plant —————

type PlantValue = { name: string; species: string; water: string; light: string; lastWatered: string; happy: boolean; notes: string };

const PlantRenderer = ({ value }: { value: PlantValue; context: KindRenderContext }) => (
	<KindCard>
		<Flex columnGap={3}>
			<Flex alignItems="center" justifyContent="center" background="linear-gradient(160deg, #e4f6ea, #d3ecdb)" borderRadius="var(--tt-radius-md, 12px)" flexShrink={0} fontSize="26px" height="60px" width="60px">
				🪴
			</Flex>
			<Box flex="1" minWidth={0}>
				<Flex alignItems="center" columnGap={2}>
					<CardTitle size="sm">{value.name}</CardTitle>
					<Text fontSize="sm">{value.happy ? '😊' : '🥀'}</Text>
				</Flex>
				{value.species ? (
					<Text color="var(--tt-muted, #9a9aa6)" fontSize="xs" fontStyle="italic">
						{value.species}
					</Text>
				) : null}
				<Flex columnGap={4} marginTop={2} flexWrap="wrap" rowGap={2}>
					{value.water ? <StatCell label="water" value={`💧 ${value.water}`} /> : null}
					{value.light ? <StatCell label="light" value={`☀️ ${value.light}`} /> : null}
					{value.lastWatered ? <StatCell label="last watered" value={value.lastWatered} /> : null}
				</Flex>
				{value.notes ? <BodyText lines={2}>{value.notes}</BodyText> : null}
			</Box>
		</Flex>
	</KindCard>
);

// ————— registration —————

registerKindRenderer({
	kind: 'weather',
	title: 'Weather',
	emoji: '⛅',
	description: 'Current conditions plus a five-day strip.',
	category: 'Knowledge',
	aliases: ['forecast', 'conditions'],
	match: (thing) => toNumberOr(thing.temp) !== null && ('condition' in thing || 'forecast' in thing),
	adapt: (thing): WeatherValue | null => {
		const location = toStringOr(thing.location, toStringOr(thing.city));
		if (!location) return null;
		return {
			location,
			temp: toNumberOr(thing.temp, toNumberOr(thing.temperature)),
			unit: toStringOr(thing.unit, 'C'),
			condition: toStringOr(thing.condition, 'Clear'),
			high: toNumberOr(thing.high),
			low: toNumberOr(thing.low),
			forecast: toArray(thing.forecast).map((day) => {
				const record = (day || {}) as Record<string, unknown>;
				return {
					day: toStringOr(record.day),
					condition: toStringOr(record.condition),
					high: toNumberOr(record.high),
					low: toNumberOr(record.low)
				};
			})
		};
	},
	render: WeatherRenderer
});

registerKindRenderer({
	kind: 'workout',
	title: 'Workout',
	emoji: '🏋️',
	description: 'Exercises with sets × reps @ weight, duration, calories.',
	category: 'Knowledge',
	aliases: ['exercise', 'training'],
	match: (thing) => Array.isArray(thing.exercises),
	adapt: (thing): WorkoutValue | null => {
		const exercises = toArray(thing.exercises).map((exercise) => {
			const record = (exercise || {}) as Record<string, unknown>;
			return typeof exercise === 'string'
				? { name: exercise, sets: null, reps: '', weight: '' }
				: {
						name: toStringOr(record.name, toStringOr(record.title, 'Exercise')),
						sets: toNumberOr(record.sets),
						reps: toStringOr(record.reps),
						weight: toStringOr(record.weight)
					};
		});
		if (!exercises.length) return null;
		return {
			title: toStringOr(thing.title, toStringOr(thing.name, 'Workout')),
			duration: toStringOr(thing.duration),
			calories: toNumberOr(thing.calories),
			exercises
		};
	},
	render: WorkoutRenderer
});

registerKindRenderer({
	kind: 'course',
	title: 'Course',
	emoji: '🎓',
	description: 'Provider, level, lesson count, and your progress.',
	category: 'Knowledge',
	aliases: ['class', 'tutorial'],
	match: (thing) => ('lessons' in thing || 'provider' in thing) && ('level' in thing || 'progress' in thing) && typeof thing.title === 'string',
	adapt: (thing): CourseValue | null => {
		const title = toStringOr(thing.title, toStringOr(thing.name));
		if (!title) return null;
		return {
			title,
			provider: toStringOr(thing.provider),
			level: toStringOr(thing.level),
			lessons: toNumberOr(thing.lessons),
			duration: toStringOr(thing.duration),
			progress: toNumberOr(thing.progress),
			description: toStringOr(thing.description)
		};
	},
	render: CourseRenderer
});

registerKindRenderer({
	kind: 'certificate',
	title: 'Certificate',
	emoji: '🏅',
	description: 'Double-ruled award card with issuer and credential id.',
	category: 'Knowledge',
	aliases: ['badge', 'achievement', 'award'],
	match: (thing) => 'issuer' in thing && ('recipient' in thing || 'credentialId' in thing),
	adapt: (thing): CertificateValue | null => {
		const title = toStringOr(thing.title, toStringOr(thing.name));
		if (!title) return null;
		return {
			title,
			recipient: toStringOr(thing.recipient, toStringOr(thing.awardedTo)),
			issuer: toStringOr(thing.issuer),
			date: toStringOr(thing.date),
			credentialId: toStringOr(thing.credentialId)
		};
	},
	render: CertificateRenderer
});

registerKindRenderer({
	kind: 'definition',
	title: 'Definition',
	emoji: '📖',
	description: 'Dictionary entry — word, phonetics, numbered senses.',
	category: 'Knowledge',
	aliases: ['word', 'glossary-term'],
	match: (thing) => typeof thing.word === 'string' && ('meanings' in thing || 'definition' in thing),
	adapt: (thing): DefinitionValue | null => {
		const word = toStringOr(thing.word);
		if (!word) return null;
		const meanings = toStringArray(thing.meanings);
		const single = toStringOr(thing.definition);
		return {
			word,
			phonetic: toStringOr(thing.phonetic),
			partOfSpeech: toStringOr(thing.partOfSpeech),
			meanings: meanings.length ? meanings : single ? [single] : [],
			example: toStringOr(thing.example)
		};
	},
	render: DefinitionRenderer
});

registerKindRenderer({
	kind: 'leaderboard',
	title: 'Leaderboard',
	emoji: '🏆',
	description: 'Ranked list with medals for the podium.',
	category: 'Knowledge',
	aliases: ['ranking', 'standings', 'top-list'],
	match: (thing) =>
		Array.isArray(thing.entries) &&
		toArray(thing.entries).every((entry) => entry && typeof entry === 'object' && 'score' in (entry as Record<string, unknown>)),
	adapt: (thing): LeaderboardValue | null => {
		const entries = toArray(thing.entries).map((entry) => {
			const record = (entry || {}) as Record<string, unknown>;
			return {
				name: toStringOr(record.name, toStringOr(record.player, 'Player')),
				score: toStringOr(record.score),
				avatarUrl: toStringOr(record.avatarUrl) || null
			};
		});
		if (!entries.length) return null;
		return { title: toStringOr(thing.title, toStringOr(thing.name)), entries };
	},
	render: LeaderboardRenderer
});

registerKindRenderer({
	kind: 'match',
	title: 'Sports match',
	emoji: '🏟️',
	description: 'Scoreboard — two sides, big score, live badge.',
	category: 'Knowledge',
	aliases: ['game-score', 'fixture', 'scoreboard'],
	match: (thing) =>
		Boolean(thing.home && typeof thing.home === 'object' && thing.away && typeof thing.away === 'object'),
	adapt: (thing): MatchValue | null => {
		const home = (thing.home || {}) as Record<string, unknown>;
		const away = (thing.away || {}) as Record<string, unknown>;
		const homeName = toStringOr(home.name, toStringOr(home.team));
		const awayName = toStringOr(away.name, toStringOr(away.team));
		if (!homeName || !awayName) return null;
		return {
			competition: toStringOr(thing.competition, toStringOr(thing.league)),
			status: toStringOr(thing.status),
			home: { name: homeName, score: toNumberOr(home.score) },
			away: { name: awayName, score: toNumberOr(away.score) },
			venue: toStringOr(thing.venue),
			when: toStringOr(thing.when, toStringOr(thing.date))
		};
	},
	render: MatchRenderer
});

registerKindRenderer({
	kind: 'changelog',
	title: 'Changelog',
	emoji: '🚀',
	description: 'Release notes — Added/Fixed/Removed chips per change.',
	category: 'Knowledge',
	aliases: ['release-notes', 'release'],
	match: (thing) => typeof thing.version === 'string' && Array.isArray(thing.changes),
	adapt: (thing): ChangelogValue | null => {
		const changes = toArray(thing.changes).map((change) => {
			const record = (change || {}) as Record<string, unknown>;
			return typeof change === 'string'
				? { type: 'Changed', text: change }
				: { type: toStringOr(record.type, 'Changed'), text: toStringOr(record.text, toStringOr(record.description)) };
		});
		if (!changes.length) return null;
		return { version: toStringOr(thing.version, 'v1.0.0'), date: toStringOr(thing.date), changes };
	},
	render: ChangelogRenderer
});

registerKindRenderer({
	kind: 'plant',
	title: 'Plant care',
	emoji: '🪴',
	description: 'A garden resident — water/light needs and mood.',
	category: 'Life',
	aliases: ['houseplant', 'garden-plant'],
	match: (thing) => typeof thing.name === 'string' && ('water' in thing || 'light' in thing) && ('species' in thing || 'happy' in thing || 'lastWatered' in thing),
	adapt: (thing): PlantValue | null => {
		const name = toStringOr(thing.name);
		if (!name) return null;
		return {
			name,
			species: toStringOr(thing.species),
			water: toStringOr(thing.water),
			light: toStringOr(thing.light),
			lastWatered: toStringOr(thing.lastWatered),
			happy: thing.happy !== false,
			notes: toStringOr(thing.notes)
		};
	},
	render: PlantRenderer
});
