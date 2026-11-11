import React from 'react';
import { Box, Flex, Text } from '@chakra-ui/react';

import { registerKindRenderer } from './kindRegistry';
import type { KindRenderContext } from './kindRegistry';
import { leadingEmoji, splashEmoji } from '~/components/Feed/emojiSplash';
import {
	Avatar,
	BodyText,
	CardTitle,
	KindBadge,
	KindCard,
	MutedMono,
	ProgressBar,
	StarRating,
	maybeTimeAgo,
	toArray,
	toNumberOr,
	toStringArray,
	toStringOr
} from './kindPrimitives';

// Social & communication kinds — messages, people, opinions, and answers.

// ————— ✉️ email —————

type EmailValue = { from: string; to: string; subject: string; preview: string; sentAt: string; unread: boolean };

const EmailRenderer = ({ value }: { value: EmailValue; context: KindRenderContext }) => (
	<KindCard>
		<Flex columnGap={3}>
			<Avatar name={value.from} size={34} />
			<Box flex="1" minWidth={0}>
				<Flex alignItems="baseline" columnGap={2} justifyContent="space-between">
					<Text color="var(--tt-ink, #16161a)" fontSize="sm" fontWeight={value.unread ? 850 : 650} noOfLines={1}>
						{value.from}
					</Text>
					<Flex alignItems="center" columnGap={2} flexShrink={0}>
						{value.unread ? <Box background="var(--tt-link, #2f8fd6)" borderRadius="999px" height="8px" width="8px" /> : null}
						{value.sentAt ? <MutedMono>{maybeTimeAgo(value.sentAt)}</MutedMono> : null}
					</Flex>
				</Flex>
				{value.to ? <MutedMono>to {value.to}</MutedMono> : null}
				<Text color="var(--tt-ink, #16161a)" fontSize="sm" fontWeight={value.unread ? 750 : 600} marginTop={0.5} noOfLines={1}>
					{value.subject}
				</Text>
				<BodyText lines={2}>{value.preview}</BodyText>
			</Box>
		</Flex>
	</KindCard>
);

// ————— 💭 chat —————

type ChatMessage = { from: string; text: string; me: boolean };
type ChatValue = { title: string; messages: ChatMessage[] };

const ChatRenderer = ({ value }: { value: ChatValue; context: KindRenderContext }) => (
	<KindCard>
		{value.title ? (
			<Text color="var(--tt-muted, #9a9aa6)" fontSize="xs" fontWeight={700} marginBottom={2} textAlign="center">
				{value.title}
			</Text>
		) : null}
		<Flex flexDirection="column" rowGap={2}>
			{value.messages.slice(-8).map((message, idx) => (
				<Flex key={idx} flexDirection="column" alignItems={message.me ? 'flex-end' : 'flex-start'}>
					{!message.me && message.from ? (
						<Text color="var(--tt-muted, #9a9aa6)" fontSize="10px" fontWeight={700} marginBottom={0.5} marginLeft={2}>
							{message.from}
						</Text>
					) : null}
					<Box
						background={message.me ? 'var(--tt-ink, #16161a)' : 'var(--tt-surface-alt, #f5f5f7)'}
						borderRadius={message.me ? '16px 16px 4px 16px' : '16px 16px 16px 4px'}
						color={message.me ? 'var(--tt-card, #ffffff)' : 'var(--tt-ink, #16161a)'}
						fontSize="sm"
						lineHeight="1.45"
						maxWidth="82%"
						paddingX={3}
						paddingY={1.5}
					>
						{message.text}
					</Box>
				</Flex>
			))}
		</Flex>
	</KindCard>
);

// ————— 📇 contact —————

type ContactValue = { name: string; role: string; phone: string; email: string; address: string; avatarUrl: string | null };

const ContactRenderer = ({ value }: { value: ContactValue; context: KindRenderContext }) => (
	<KindCard>
		<Flex alignItems="center" columnGap={3}>
			<Avatar name={value.name} size={48} src={value.avatarUrl} />
			<Box flex="1" minWidth={0}>
				<CardTitle size="sm">{value.name}</CardTitle>
				{value.role ? <MutedMono>{value.role}</MutedMono> : null}
			</Box>
		</Flex>
		<Flex flexDirection="column" marginTop={3} rowGap={1.5}>
			{value.phone ? (
				<Flex columnGap={2} fontSize="sm">
					<Text>📱</Text>
					<Box as="a" href={`tel:${value.phone}`} color="var(--tt-link, #2f8fd6)" fontWeight={600}>
						{value.phone}
					</Box>
				</Flex>
			) : null}
			{value.email ? (
				<Flex columnGap={2} fontSize="sm">
					<Text>✉️</Text>
					<Box as="a" href={`mailto:${value.email}`} color="var(--tt-link, #2f8fd6)" fontWeight={600}>
						{value.email}
					</Box>
				</Flex>
			) : null}
			{value.address ? (
				<Flex columnGap={2} fontSize="sm">
					<Text>📍</Text>
					<Text color="var(--tt-text, #5a5a66)">{value.address}</Text>
				</Flex>
			) : null}
		</Flex>
	</KindCard>
);

// ————— ❓ faq —————

type FaqValue = { title: string; items: Array<{ question: string; answer: string }> };

const FaqRenderer = ({ value }: { value: FaqValue; context: KindRenderContext }) => {
	const [open, setOpen] = React.useState<number | null>(0);

	return (
		<KindCard>
			{value.title ? <CardTitle size="sm">{value.title}</CardTitle> : null}
			<Flex flexDirection="column" marginTop={value.title ? 2 : 0}>
				{value.items.map((item, idx) => (
					<Box key={idx} borderTop={idx === 0 ? 'none' : '1px solid var(--tt-border-light, #f0f0f2)'} paddingY={2}>
						<Flex
							as="button"
							type="button"
							alignItems="baseline"
							columnGap={2}
							cursor="pointer"
							justifyContent="space-between"
							textAlign="left"
							width="100%"
							onClick={() => setOpen(open === idx ? null : idx)}
						>
							<Text color="var(--tt-ink, #16161a)" fontSize="sm" fontWeight={750}>
								{item.question}
							</Text>
							<Text color="var(--tt-faint, #b6b6c0)" fontSize="xs">
								{open === idx ? '▾' : '▸'}
							</Text>
						</Flex>
						{open === idx ? (
							<Box marginTop={1.5}>
								<BodyText>{item.answer}</BodyText>
							</Box>
						) : null}
					</Box>
				))}
			</Flex>
		</KindCard>
	);
};

// ————— 🗳️ poll —————

type PollValue = { question: string; options: Array<{ label: string; votes: number }>; totalVotes: number; closesAt: string };

// One-tap live voting when the host wires context.poll (PostCard supplies the
// server tally + an optimistic vote handler): tap to vote, tap another option
// to move your vote, tap your own again to remove it. The bars animate via
// ProgressBar's width transition. Logged-out viewers (canVote false) see
// results only. Surfaces with no vote pipeline (docs galleries, previews)
// keep the original self-contained demo behavior.
const PollRenderer = ({ value, context }: { value: PollValue; context: KindRenderContext }) => {
	const live = context.poll;
	// untrusted surfaces (rich comments) get no live vote wiring, so the tappable
	// demo there would paint a fake vote that never reaches the server — render
	// static results instead; the demo stays for trusted gallery/docs surfaces
	const demo = !live && !context.untrusted;
	const [demoPick, setDemoPick] = React.useState<number | null>(null);

	const viewerVote = live ? live.viewerVote : demo ? demoPick : null;
	const counts = live
		? value.options.map((_option, idx) => live.counts[idx] || 0)
		: value.options.map((option, idx) => option.votes + (demo && demoPick === idx ? 1 : 0));
	const total = live ? live.totalVotes : value.totalVotes + (demo && demoPick !== null ? 1 : 0);
	// results reveal on your vote ("vote once, watch the bars fill") — or right
	// away for viewers who can't vote (logged out / untrusted static)
	const showResults = viewerVote !== null || (live ? !live.canVote : !demo);
	const tappable = live ? live.canVote || !!live.onVote : demo && demoPick === null;

	const handleTap = (idx: number, anchor?: HTMLElement | null) => {
		if (live) {
			// the splash thunk resolves the option's emoji here (the renderer owns
			// the adapted labels) but FIRES in the host's vote handler, behind its
			// login/in-flight guards — only a tap that lands a vote on this option
			// (new or moved) bursts; dropped taps and unvotes stay quiet
			// (motion-gated inside splashEmoji)
			live.onVote?.(idx, () => splashEmoji(leadingEmoji(value.options[idx]?.label) ?? '🗳️', anchor));
			return;
		}
		if (demo && demoPick === null) setDemoPick(idx);
	};

	return (
		<KindCard>
			<CardTitle size="sm">🗳️ {value.question}</CardTitle>
			<Flex flexDirection="column" marginTop={3} rowGap={2}>
				{value.options.map((option, idx) => {
					const votes = counts[idx] || 0;
					const percent = total ? Math.round((votes / total) * 100) : 0;
					const mine = viewerVote === idx;

					return (
						<Box
							key={idx}
							as="button"
							type="button"
							cursor={tappable ? 'pointer' : 'default'}
							textAlign="left"
							aria-pressed={mine}
							aria-label={`Vote for ${option.label}`}
							borderRadius="var(--tt-radius-sm, 9px)"
							transition="background 0.12s ease"
							_hover={tappable ? { background: 'var(--tt-surface-alt, #f5f5f7)' } : undefined}
							paddingX={1}
							paddingY={0.5}
							marginX={-1}
							onClick={(event: React.MouseEvent<HTMLElement>) => handleTap(idx, event.currentTarget)}
						>
							<Flex justifyContent="space-between" columnGap={2} marginBottom={1}>
								<Text color={mine ? 'var(--tt-accent, hotpink)' : 'var(--tt-ink, #16161a)'} fontSize="sm" fontWeight={mine ? 800 : 600}>
									{mine ? '✓ ' : ''}
									{option.label}
								</Text>
								{showResults ? (
									<Text color="var(--tt-muted, #9a9aa6)" fontSize="xs" fontWeight={700} flexShrink={0}>
										{percent}% · {votes.toLocaleString()}
									</Text>
								) : null}
							</Flex>
							<ProgressBar value={showResults ? percent : 0} tone={mine ? 'accent' : 'info'} />
						</Box>
					);
				})}
			</Flex>
			<Flex columnGap={2} marginTop={3} alignItems="baseline">
				<MutedMono>{total.toLocaleString()} {total === 1 ? 'vote' : 'votes'}</MutedMono>
				{value.closesAt ? <MutedMono>· closes {maybeTimeAgo(value.closesAt)}</MutedMono> : null}
				{!showResults && tappable ? <MutedMono>· tap an option to vote</MutedMono> : null}
				{live && viewerVote !== null ? <MutedMono>· tap your pick again to unvote</MutedMono> : null}
			</Flex>
		</KindCard>
	);
};

// ————— ⭐ review —————

type ReviewValue = { rating: number; maxRating: number; title: string; text: string; reviewer: string; subject: string; date: string };

const ReviewRenderer = ({ value }: { value: ReviewValue; context: KindRenderContext }) => (
	<KindCard>
		<Flex alignItems="center" columnGap={2} flexWrap="wrap">
			<StarRating rating={value.rating} max={value.maxRating} />
			{value.subject ? <KindBadge tone="info">{value.subject}</KindBadge> : null}
		</Flex>
		{value.title ? (
			<Text color="var(--tt-ink, #16161a)" fontSize="sm" fontWeight={800} marginTop={1.5}>
				{value.title}
			</Text>
		) : null}
		<BodyText lines={4}>{value.text}</BodyText>
		<Flex alignItems="center" columnGap={2} marginTop={2.5}>
			<Avatar name={value.reviewer || '?'} size={22} />
			<Text color="var(--tt-ink, #16161a)" fontSize="xs" fontWeight={700}>
				{value.reviewer}
			</Text>
			{value.date ? <MutedMono>· {maybeTimeAgo(value.date)}</MutedMono> : null}
		</Flex>
	</KindCard>
);

// ————— 💼 job —————

type JobValue = { role: string; company: string; location: string; salary: string; type: string; tags: string[]; description: string; postedAt: string };

const JobRenderer = ({ value }: { value: JobValue; context: KindRenderContext }) => (
	<KindCard>
		<Flex columnGap={3}>
			<Avatar name={value.company || value.role} size={42} />
			<Box flex="1" minWidth={0}>
				<CardTitle size="sm">{value.role}</CardTitle>
				<Flex columnGap={2} flexWrap="wrap">
					{value.company ? <MutedMono>{value.company}</MutedMono> : null}
					{value.location ? <MutedMono>· 📍 {value.location}</MutedMono> : null}
					{value.postedAt ? <MutedMono>· {maybeTimeAgo(value.postedAt)}</MutedMono> : null}
				</Flex>
				<Flex columnGap={1.5} flexWrap="wrap" marginTop={2} rowGap={1.5}>
					{value.salary ? <KindBadge tone="positive">💵 {value.salary}</KindBadge> : null}
					{value.type ? <KindBadge>{value.type}</KindBadge> : null}
					{value.tags.map((tag) => (
						<KindBadge key={tag} tone="info">
							{tag}
						</KindBadge>
					))}
				</Flex>
				<BodyText lines={2}>{value.description}</BodyText>
			</Box>
		</Flex>
	</KindCard>
);

// ————— registration —————
// Explicit registration, called lazily by kindRegistry: "sideEffects": false would
// tree-shake a bare side-effect import out of production builds.

export const registerSocialKinds = () => {

registerKindRenderer({
	kind: 'email',
	title: 'Email',
	emoji: '✉️',
	description: 'Inbox-row card — sender, subject, preview, unread dot.',
	category: 'Social',
	aliases: ['mail', 'message'],
	match: (thing) => typeof thing.subject === 'string' && ('from' in thing || 'to' in thing),
	adapt: (thing): EmailValue | null => {
		const subject = toStringOr(thing.subject);
		if (!subject) return null;
		return {
			from: toStringOr(thing.from, 'Someone'),
			to: toStringOr(thing.to),
			subject,
			preview: toStringOr(thing.preview, toStringOr(thing.body, toStringOr(thing.text))),
			sentAt: toStringOr(thing.sentAt, toStringOr(thing.date)),
			unread: thing.unread === true
		};
	},
	render: EmailRenderer
});

registerKindRenderer({
	kind: 'chat',
	title: 'Chat thread',
	emoji: '💭',
	description: 'Bubble conversation — theirs left, yours right.',
	category: 'Social',
	aliases: ['conversation', 'thread', 'dm'],
	match: (thing) => Array.isArray(thing.messages),
	adapt: (thing): ChatValue | null => {
		const messages = toArray(thing.messages)
			.map((message) => {
				const record = (message || {}) as Record<string, unknown>;
				return {
					from: toStringOr(record.from, toStringOr(record.author)),
					text: toStringOr(record.text, toStringOr(record.body)),
					me: record.me === true || toStringOr(record.from).toLowerCase() === 'me'
				};
			})
			.filter((message) => message.text);
		if (!messages.length) return null;
		return { title: toStringOr(thing.title, toStringOr(thing.with)), messages };
	},
	render: ChatRenderer
});

registerKindRenderer({
	kind: 'contact',
	title: 'Contact card',
	emoji: '📇',
	description: 'vCard — name, role, tappable phone/email, address.',
	category: 'Social',
	aliases: ['vcard', 'person-card', 'business-card'],
	match: (thing) => typeof thing.name === 'string' && ('phone' in thing || 'email' in thing) && !('subject' in thing),
	adapt: (thing): ContactValue | null => {
		const name = toStringOr(thing.name);
		if (!name) return null;
		return {
			name,
			role: toStringOr(thing.role, toStringOr(thing.title)),
			phone: toStringOr(thing.phone),
			email: toStringOr(thing.email),
			address: toStringOr(thing.address),
			avatarUrl: toStringOr(thing.avatarUrl) || null
		};
	},
	render: ContactRenderer
});

registerKindRenderer({
	kind: 'faq',
	title: 'FAQ',
	emoji: '❓',
	description: 'Question/answer accordion.',
	category: 'Social',
	aliases: ['qa', 'questions'],
	match: (thing) =>
		Array.isArray(thing.items) &&
		toArray(thing.items).length > 0 &&
		toArray(thing.items).every((item) => item && typeof item === 'object' && 'question' in (item as Record<string, unknown>)),
	adapt: (thing): FaqValue | null => {
		const items = toArray(thing.items)
			.map((item) => {
				const record = (item || {}) as Record<string, unknown>;
				return { question: toStringOr(record.question, toStringOr(record.q)), answer: toStringOr(record.answer, toStringOr(record.a)) };
			})
			.filter((item) => item.question);
		if (!items.length) return null;
		return { title: toStringOr(thing.title), items };
	},
	render: FaqRenderer
});

registerKindRenderer({
	kind: 'poll',
	title: 'Poll',
	emoji: '🗳️',
	description: 'Vote once, watch the bars fill — options with live percentages.',
	category: 'Social',
	aliases: ['survey', 'vote'],
	match: (thing) => typeof thing.question === 'string' && Array.isArray(thing.options),
	adapt: (thing): PollValue | null => {
		const question = toStringOr(thing.question);
		const options = toArray(thing.options).map((option) => {
			const record = (option || {}) as Record<string, unknown>;
			return typeof option === 'string'
				? { label: option, votes: 0 }
				: { label: toStringOr(record.label, toStringOr(record.text)), votes: toNumberOr(record.votes, 0) || 0 };
		});
		if (!question || options.length < 2) return null;
		return {
			question,
			options,
			totalVotes: toNumberOr(thing.totalVotes, options.reduce((sum, option) => sum + option.votes, 0)) || 0,
			closesAt: toStringOr(thing.closesAt)
		};
	},
	render: PollRenderer
});

registerKindRenderer({
	kind: 'review',
	title: 'Review',
	emoji: '⭐',
	description: 'Star rating with title, body, and reviewer.',
	category: 'Social',
	aliases: ['rating', 'testimonial'],
	match: (thing) => toNumberOr(thing.rating) !== null && (typeof thing.text === 'string' || typeof thing.review === 'string'),
	adapt: (thing): ReviewValue | null => {
		const rating = toNumberOr(thing.rating);
		if (rating === null) return null;
		return {
			rating,
			maxRating: toNumberOr(thing.maxRating, 5) || 5,
			title: toStringOr(thing.title),
			text: toStringOr(thing.text, toStringOr(thing.review)),
			reviewer: toStringOr(thing.reviewer, toStringOr(thing.by, 'Anonymous')),
			subject: toStringOr(thing.subject, toStringOr(thing.product)),
			date: toStringOr(thing.date)
		};
	},
	render: ReviewRenderer
});

registerKindRenderer({
	kind: 'job',
	title: 'Job posting',
	emoji: '💼',
	description: 'Role, company, salary range, and skill tags.',
	category: 'Social',
	aliases: ['vacancy', 'position'],
	match: (thing) => typeof thing.role === 'string' && ('company' in thing || 'salary' in thing),
	adapt: (thing): JobValue | null => {
		const role = toStringOr(thing.role, toStringOr(thing.title));
		if (!role) return null;
		return {
			role,
			company: toStringOr(thing.company),
			location: toStringOr(thing.location),
			salary: toStringOr(thing.salary),
			type: toStringOr(thing.type, toStringOr(thing.employmentType)),
			tags: toStringArray(thing.tags ?? thing.skills),
			description: toStringOr(thing.description),
			postedAt: toStringOr(thing.postedAt)
		};
	},
	render: JobRenderer
});

};
