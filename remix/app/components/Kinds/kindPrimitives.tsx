import React from 'react';
import { Box, Flex, Text } from '@chakra-ui/react';

import { timeAgo } from '~/components/Feed/feedTypes';

// Shared primitives + coercion helpers for every kind renderer file.
// Renderers stay tiny by composing these; they are all theme-token driven so
// the whole gallery re-skins with Thingtime themes.

// ————— card chrome —————

export const cardShell = {
	background: 'var(--tt-card, #ffffff)',
	border: '1px solid var(--tt-border, #ececef)',
	borderRadius: 'var(--tt-radius-lg, 16px)',
	boxShadow: 'var(--tt-shadow-card, 0 1px 2px rgba(0,0,0,0.05))',
	overflow: 'hidden',
	width: '100%'
} as const;

export const KindCard = (props: { children: React.ReactNode; padding?: number | string }) => (
	<Box {...cardShell} padding={props.padding ?? 4}>
		{props.children}
	</Box>
);

export const KindBadge = (props: { children: React.ReactNode; tone?: 'default' | 'positive' | 'danger' | 'accent' | 'info' }) => {
	const tones = {
		default: { bg: 'var(--tt-surface-alt, #f5f5f7)', color: 'var(--tt-muted, #9a9aa6)' },
		positive: { bg: 'var(--tt-positive-tint, #e4f6ea)', color: 'var(--tt-positive, #2f8f4f)' },
		danger: { bg: '#fdecef', color: 'var(--tt-danger, #d6455a)' },
		accent: { bg: 'var(--tt-accent-tint, #fff5fa)', color: 'var(--tt-accent, hotpink)' },
		info: { bg: '#e7f2fd', color: 'var(--tt-link, #2f8fd6)' }
	} as const;
	const tone = tones[props.tone || 'default'];

	return (
		<Box
			as="span"
			background={tone.bg}
			borderRadius="999px"
			color={tone.color}
			fontSize="11px"
			fontWeight={700}
			paddingX="8px"
			paddingY="2px"
			whiteSpace="nowrap"
		>
			{props.children}
		</Box>
	);
};

export const MutedMono = (props: { children: React.ReactNode }) => (
	<Text as="span" color="var(--tt-muted, #9a9aa6)" fontFamily="var(--tt-font-mono, monospace)" fontSize="11px">
		{props.children}
	</Text>
);

export const CardTitle = (props: { children: React.ReactNode; size?: string }) => (
	<Text color="var(--tt-ink, #16161a)" fontSize={props.size || 'md'} fontWeight={750}>
		{props.children}
	</Text>
);

export const BodyText = (props: { children: React.ReactNode; lines?: number }) => (
	<Text color="var(--tt-text, #5a5a66)" fontSize="sm" lineHeight="1.55" noOfLines={props.lines}>
		{props.children}
	</Text>
);

export const Avatar = (props: { name: string; src?: string | null; size?: number }) => {
	const size = props.size ?? 36;

	if (props.src) {
		return (
			<Box
				as="img"
				alt={props.name}
				src={props.src}
				borderRadius="999px"
				flexShrink={0}
				height={`${size}px`}
				objectFit="cover"
				width={`${size}px`}
			/>
		);
	}

	return (
		<Flex
			alignItems="center"
			background="var(--tt-accent-tint, #fff5fa)"
			borderRadius="999px"
			color="var(--tt-accent, hotpink)"
			flexShrink={0}
			fontSize={`${Math.round(size * 0.42)}px`}
			fontWeight={800}
			height={`${size}px`}
			justifyContent="center"
			width={`${size}px`}
		>
			{(props.name || '?').trim().charAt(0).toUpperCase()}
		</Flex>
	);
};

// cover / hero area with graceful emoji fallback when there's no image
export const CoverArea = (props: {
	image?: string | null;
	emoji: string;
	height?: string;
	gradient?: string;
	children?: React.ReactNode;
}) => (
	<Box
		position="relative"
		height={props.height || '120px'}
		background={props.image ? undefined : props.gradient || 'linear-gradient(135deg, var(--tt-accent-tint, #fff5fa) 0%, var(--tt-surface-alt, #f5f5f7) 100%)'}
		backgroundImage={props.image ? `url(${props.image})` : undefined}
		backgroundPosition="center"
		backgroundSize="cover"
	>
		{!props.image ? (
			<Flex alignItems="center" height="100%" justifyContent="center" fontSize="38px" opacity={0.85}>
				{props.emoji}
			</Flex>
		) : null}
		{props.children}
	</Box>
);

// ————— small data displays —————

export const Sparkline = ({ series, positive }: { series: number[]; positive: boolean }) => {
	if (series.length < 2) return null;

	const min = Math.min(...series);
	const max = Math.max(...series);
	const range = max - min || 1;
	const points = series
		.map((value, idx) => {
			const x = (idx / (series.length - 1)) * 100;
			const y = 28 - ((value - min) / range) * 24 + 2;
			return `${x.toFixed(1)},${y.toFixed(1)}`;
		})
		.join(' ');

	return (
		<Box as="svg" viewBox="0 0 100 32" width="100%" height="32px" preserveAspectRatio="none" aria-hidden>
			<polyline
				points={points}
				fill="none"
				stroke={positive ? 'var(--tt-positive, #2f8f4f)' : 'var(--tt-danger, #d6455a)'}
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
				vectorEffect="non-scaling-stroke"
			/>
		</Box>
	);
};

export const ProgressBar = (props: { value: number; max?: number; tone?: 'accent' | 'positive' | 'info' }) => {
	const max = props.max || 100;
	const percent = Math.max(0, Math.min(100, (props.value / (max || 1)) * 100));
	const colors = {
		accent: 'var(--tt-accent, hotpink)',
		positive: 'var(--tt-positive, #2f8f4f)',
		info: 'var(--tt-link, #2f8fd6)'
	};

	return (
		<Box background="var(--tt-surface-alt, #f5f5f7)" borderRadius="999px" height="8px" overflow="hidden" width="100%">
			<Box background={colors[props.tone || 'accent']} borderRadius="999px" height="100%" width={`${percent}%`} transition="width 240ms ease" />
		</Box>
	);
};

export const StarRating = (props: { rating: number; max?: number; count?: number | null }) => {
	const max = props.max || 5;
	const full = Math.round(Math.max(0, Math.min(max, props.rating)));

	return (
		<Flex alignItems="center" columnGap={1}>
			<Text fontSize="sm" letterSpacing="1px" aria-label={`${props.rating} out of ${max} stars`}>
				{'★'.repeat(full)}
				<Box as="span" color="var(--tt-faint, #b6b6c0)">
					{'★'.repeat(Math.max(0, max - full))}
				</Box>
			</Text>
			<Text color="var(--tt-ink, #16161a)" fontSize="xs" fontWeight={800}>
				{props.rating}
			</Text>
			{typeof props.count === 'number' ? <MutedMono>({props.count})</MutedMono> : null}
		</Flex>
	);
};

// calendar-leaf date block (event cards, bookings, tickets)
export const DateBlock = (props: { date: string; size?: 'sm' | 'md' }) => {
	const parsed = new Date(props.date);
	const valid = Number.isFinite(parsed.getTime());
	const month = valid ? parsed.toLocaleDateString(undefined, { month: 'short' }) : '—';
	const day = valid ? parsed.getDate() : '?';
	const sm = props.size === 'sm';

	return (
		<Flex
			flexDirection="column"
			alignItems="center"
			justifyContent="center"
			background="var(--tt-surface, #fafafb)"
			border="1px solid var(--tt-border, #ececef)"
			borderRadius="var(--tt-radius-md, 12px)"
			flexShrink={0}
			width={sm ? '44px' : '54px'}
			height={sm ? '44px' : '54px'}
		>
			<Text color="var(--tt-danger, #d6455a)" fontSize="9px" fontWeight={800} letterSpacing="0.1em" textTransform="uppercase">
				{month}
			</Text>
			<Text color="var(--tt-ink, #16161a)" fontSize={sm ? 'md' : 'lg'} fontWeight={800} lineHeight="1">
				{day}
			</Text>
		</Flex>
	);
};

// labelled stat cell (specs rows: beds/baths, sets/reps, stars/forks…)
export const StatCell = (props: { label: string; value: React.ReactNode }) => (
	<Box>
		<Text color="var(--tt-ink, #16161a)" fontSize="sm" fontWeight={800}>
			{props.value}
		</Text>
		<Text color="var(--tt-muted, #9a9aa6)" fontSize="10px" fontWeight={700} letterSpacing="0.06em" textTransform="uppercase">
			{props.label}
		</Text>
	</Box>
);

// step tracker (shipments, orders, multi-stage anything)
export const StepTracker = (props: { steps: string[]; currentIndex: number }) => (
	<Flex alignItems="flex-start">
		{props.steps.map((step, idx) => {
			const done = idx <= props.currentIndex;
			const last = idx === props.steps.length - 1;

			return (
				<Flex key={step} flex={last ? '0 0 auto' : '1'} flexDirection="column" minWidth={0}>
					<Flex alignItems="center">
						<Flex
							alignItems="center"
							justifyContent="center"
							background={done ? 'var(--tt-positive, #2f8f4f)' : 'var(--tt-surface-alt, #f5f5f7)'}
							border={done ? 'none' : '1px solid var(--tt-border, #ececef)'}
							borderRadius="999px"
							color="white"
							flexShrink={0}
							fontSize="9px"
							fontWeight={800}
							height="18px"
							width="18px"
						>
							{done ? '✓' : ''}
						</Flex>
						{!last ? (
							<Box flex="1" height="2px" background={idx < props.currentIndex ? 'var(--tt-positive, #2f8f4f)' : 'var(--tt-border-light, #f0f0f2)'} marginX={1} />
						) : null}
					</Flex>
					<Text color={done ? 'var(--tt-ink, #16161a)' : 'var(--tt-muted, #9a9aa6)'} fontSize="9.5px" fontWeight={700} marginTop={1} paddingRight={2}>
						{step}
					</Text>
				</Flex>
			);
		})}
	</Flex>
);

// ————— coercion helpers (the adapt() toolkit) —————

export const toStringOr = (value: unknown, fallback = ''): string =>
	typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;

export const toNumberOr = (value: unknown, fallback: number | null = null): number | null => {
	const parsed = typeof value === 'string' ? Number(value) : value;
	return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : fallback;
};

export const toArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export const toStringArray = (value: unknown): string[] =>
	toArray(value)
		.map((item) => toStringOr(item))
		.filter(Boolean);

export const maybeTimeAgo = (value: unknown): string => {
	const iso = toStringOr(value);
	if (!iso) return '';
	const stamp = timeAgo(iso);
	return stamp || iso;
};

export const formatPrice = (price: number | null, currency: string): string => {
	if (price === null) return 'Price on ask';
	try {
		return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(price);
	} catch {
		return `${currency || '$'}${price}`;
	}
};

export const formatDateTime = (value: unknown): string => {
	const iso = toStringOr(value);
	if (!iso) return '';
	const parsed = new Date(iso);
	if (!Number.isFinite(parsed.getTime())) return iso;
	return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};
