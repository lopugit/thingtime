import React from 'react';
import { Box, Flex, Spinner, Text } from '@chakra-ui/react';
import { Link as RouterLink } from 'react-router';
import { Check, ChevronDown, ShieldAlert, X } from 'lucide-react';

import { useIsMobileViewport } from '../Nav/Drawer/useDrawer';
import { LOPU_UI, lopuEyebrowSx, lopuFocusRingSx } from './lopuTheme';
import { isLopuConfirmUsable, toolGlyph, toolLabel, toolLinks, toolRowDetails, toolRowSummary, type LopuMessageToolCall, type LopuToolActivity, type LopuToolStatus } from './lopuTurnCore';

// One tool activity inside Lopu's bubble, drawn as a compact row (design
// brief): glyph · label · one-line summary · status · links · Undo, with a
// chevron that opens a details drawer showing the tool's input and result
// JSON. A destructive tool that stopped for approval (status 'confirm')
// grows a Confirm / Cancel pair under the row — the only way its grant ever
// leaves the client (design note §2.4). `LopuToolCallRow` is the same row
// for a persisted turn (history rows remember only name / ok / summary /
// thingId).

const StatusGlyph = ({ status }: { status: LopuToolStatus }) => {
	if (status === 'streaming' || status === 'running') {
		return <Spinner size="xs" speed="0.8s" color={LOPU_UI.muted} thickness="2px" label={status === 'streaming' ? 'streaming' : 'running'} flexShrink={0} />;
	}
	if (status === 'ok') {
		return (
			<Box as="span" display="inline-flex" color={LOPU_UI.positive} flexShrink={0} role="img" aria-label="done">
				<Check size={14} strokeWidth={2.4} aria-hidden />
			</Box>
		);
	}
	if (status === 'confirm') {
		return (
			<Box as="span" display="inline-flex" color={LOPU_UI.ink} flexShrink={0} role="img" aria-label="needs your confirmation">
				<ShieldAlert size={14} strokeWidth={2.2} aria-hidden />
			</Box>
		);
	}
	return (
		<Box as="span" display="inline-flex" color={LOPU_UI.danger} flexShrink={0} role="img" aria-label="failed">
			<X size={14} strokeWidth={2.4} aria-hidden />
		</Box>
	);
};

const patchCaption = (activity: LopuToolActivity): string | null => {
	if (!activity.patch) return null;
	const count = activity.patch.ops.length;
	return `${count} change${count === 1 ? '' : 's'} · ${activity.patch.persisted ? 'saved' : 'draft'}`;
};

const RowLink = ({ to, children }: { to: string; children: React.ReactNode }) => (
	<Box
		as={RouterLink}
		to={to}
		fontSize={LOPU_UI.fontSmall}
		fontWeight={600}
		color={LOPU_UI.link}
		textDecoration="underline"
		textUnderlineOffset="2px"
		textDecorationColor={LOPU_UI.faint}
		overflowWrap="anywhere"
		_hover={{ textDecorationColor: LOPU_UI.ink }}
		sx={lopuFocusRingSx}
	>
		{children}
	</Box>
);

const RowButton = ({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) => (
	<Box
		as="button"
		type="button"
		onClick={onClick}
		title={title}
		fontSize={LOPU_UI.fontSmall}
		fontWeight={600}
		color={LOPU_UI.ink}
		height="24px"
		px={2}
		borderRadius={LOPU_UI.radiusXs}
		border={LOPU_UI.border}
		bg={LOPU_UI.card}
		cursor="pointer"
		lineHeight={1}
		transition={`background ${LOPU_UI.transitionFast}`}
		_hover={{ bg: LOPU_UI.surfaceHover }}
		sx={lopuFocusRingSx}
	>
		{children}
	</Box>
);

// Confirm (ink, the primary) / Cancel (hairline) — 44px targets on touch
// viewports, the 32px control height elsewhere; visible focus rings.
const ConfirmButton = ({ onClick, primary, disabled, mobile, children }: { onClick: () => void; primary?: boolean; disabled?: boolean; mobile: boolean; children: React.ReactNode }) => (
	<Box
		as="button"
		type="button"
		onClick={onClick}
		disabled={disabled}
		display="inline-flex"
		alignItems="center"
		justifyContent="center"
		minH={`${mobile ? LOPU_UI.touchTarget : LOPU_UI.control}px`}
		minW={mobile ? '96px' : '84px'}
		px={3}
		borderRadius={LOPU_UI.pill}
		border={primary ? `1px solid ${LOPU_UI.ink}` : LOPU_UI.border}
		bg={primary ? LOPU_UI.ink : LOPU_UI.card}
		color={primary ? LOPU_UI.card : LOPU_UI.ink}
		fontSize={LOPU_UI.fontSmall}
		fontWeight={600}
		cursor={disabled ? 'not-allowed' : 'pointer'}
		opacity={disabled ? 0.55 : 1}
		transition={`background ${LOPU_UI.transitionFast}, opacity ${LOPU_UI.transitionFast}`}
		_hover={disabled ? undefined : primary ? { opacity: 0.9 } : { bg: LOPU_UI.surfaceHover }}
		sx={lopuFocusRingSx}
	>
		{children}
	</Box>
);

// The Confirm card body: what would happen (+ the target's id, which the
// server derived — never only a label), then Confirm / Cancel, or the
// outcome once the viewer chose (a grant is sent at most once).
const ConfirmBlock = ({
	activity,
	onConfirm,
	onDecline,
	disabled,
	mobile
}: {
	activity: LopuToolActivity;
	onConfirm?: () => void;
	onDecline?: () => void;
	disabled: boolean;
	mobile: boolean;
}) => {
	const confirm = activity.confirm;
	if (!confirm) return null;
	const usable = isLopuConfirmUsable(confirm);
	const subjectId = confirm.subject?.id;
	return (
		<Flex direction="column" gap={2} px={2.5} pb={2.5} pt={0.5} minW={0}>
			<Text fontSize={LOPU_UI.fontSmall} color={LOPU_UI.ink} lineHeight="1.5" overflowWrap="anywhere">
				{confirm.summary || 'Lopu needs your go-ahead for this step.'}
				{subjectId ? (
					<Text as="span" display="block" fontFamily={LOPU_UI.fontMono} fontSize="11px" color={LOPU_UI.muted} mt={0.5} overflowWrap="anywhere">
						id {subjectId}
					</Text>
				) : null}
			</Text>
			{confirm.resolved === 'confirmed' ? (
				<Text fontSize={LOPU_UI.fontSmall} color={LOPU_UI.muted}>
					Confirmed — Lopu is on it.
				</Text>
			) : confirm.resolved === 'declined' ? (
				<Text fontSize={LOPU_UI.fontSmall} color={LOPU_UI.muted}>
					Cancelled — nothing was changed.
				</Text>
			) : !usable ? (
				<Text fontSize={LOPU_UI.fontSmall} color={LOPU_UI.muted}>
					This confirmation has expired — ask Lopu again and confirm afresh.
				</Text>
			) : (
				<Flex gap={2} wrap="wrap" align="center">
					{onConfirm ? (
						<ConfirmButton onClick={onConfirm} primary disabled={disabled} mobile={mobile}>
							Confirm
						</ConfirmButton>
					) : null}
					{onDecline ? (
						<ConfirmButton onClick={onDecline} mobile={mobile}>
							Cancel
						</ConfirmButton>
					) : null}
					{disabled ? (
						<Text fontSize="11px" color={LOPU_UI.faint}>
							Wait for Lopu to finish replying
						</Text>
					) : null}
				</Flex>
			)}
		</Flex>
	);
};

const DetailsBlock = ({ title, text }: { title: string; text: string }) => (
	<Box minW={0}>
		<Text as="span" sx={lopuEyebrowSx} display="block" mb={1}>
			{title}
		</Text>
		<Box
			as="pre"
			m={0}
			px={2.5}
			py={2}
			maxH="240px"
			overflow="auto"
			fontFamily={LOPU_UI.fontMono}
			fontSize="11px"
			lineHeight="1.5"
			color={LOPU_UI.ink}
			bg={LOPU_UI.card}
			border={LOPU_UI.border}
			borderRadius={LOPU_UI.radiusSm}
			whiteSpace="pre-wrap"
			overflowWrap="anywhere"
		>
			{text}
		</Box>
	</Box>
);

const rowFrame = {
	className: 'lopuToolRow',
	border: LOPU_UI.border,
	borderRadius: LOPU_UI.radiusSm,
	bg: LOPU_UI.surfaceAlt,
	minW: 0,
	overflow: 'hidden'
} as const;

export const LopuToolCard = ({
	activity,
	canUndo = false,
	onUndo,
	compact = false,
	onConfirm,
	onDecline,
	confirmDisabled = false
}: {
	activity: LopuToolActivity;
	canUndo?: boolean;
	onUndo?: (toolId: string) => void;
	compact?: boolean;
	// the Confirm card's buttons (status 'confirm'); disabled while a reply streams
	onConfirm?: () => void;
	onDecline?: () => void;
	confirmDisabled?: boolean;
}) => {
	const [open, setOpen] = React.useState(false);
	const isMobile = useIsMobileViewport();
	const links = React.useMemo(() => toolLinks(activity), [activity]);
	const details = React.useMemo(() => toolRowDetails(activity), [activity]);
	const summary = activity.status === 'confirm' ? '' : toolRowSummary(activity);
	const caption = patchCaption(activity);
	const label = toolLabel(activity.name, activity.status);
	const failed = activity.status === 'error';
	const awaiting = activity.status === 'confirm' && !!activity.confirm;
	const detailsId = `lopu-tool-${activity.id}-details`;

	return (
		<Box {...rowFrame} role="group" aria-label={label} data-tool={activity.name} data-status={activity.status}>
			<Flex align="center" gap={2} minH={compact ? '28px' : '32px'} px={2.5} minW={0}>
				<Box as="span" fontSize="13px" lineHeight={1} flexShrink={0} aria-hidden="true">
					{toolGlyph(activity.name)}
				</Box>
				<Text as="span" fontSize={LOPU_UI.fontSmall} fontWeight={600} color={failed ? LOPU_UI.danger : LOPU_UI.ink} whiteSpace="nowrap" flexShrink={0}>
					{label}
				</Text>
				{summary ? (
					<Text as="span" fontSize={LOPU_UI.fontSmall} color={LOPU_UI.muted} isTruncated flex={1} minW={0} title={summary}>
						{summary}
					</Text>
				) : (
					<Box flex={1} />
				)}
				{caption ? (
					<Text as="span" fontSize="10px" fontFamily={LOPU_UI.fontMono} letterSpacing="0.04em" color={LOPU_UI.muted} flexShrink={0} display={{ base: 'none', sm: 'inline' }}>
						{caption}
					</Text>
				) : null}
				<StatusGlyph status={activity.status} />
				{details.hasDetails ? (
					<Box
						as="button"
						type="button"
						aria-expanded={open}
						aria-controls={detailsId}
						aria-label={open ? 'Hide details' : 'Show details'}
						title={open ? 'Hide details' : 'Show details'}
						display="inline-flex"
						alignItems="center"
						justifyContent="center"
						width="24px"
						height="24px"
						mr="-6px"
						borderRadius={LOPU_UI.radiusXs}
						color={LOPU_UI.muted}
						cursor="pointer"
						flexShrink={0}
						transition={`background ${LOPU_UI.transitionFast}, color ${LOPU_UI.transitionFast}`}
						_hover={{ bg: LOPU_UI.surfaceHover, color: LOPU_UI.ink }}
						sx={lopuFocusRingSx}
						onClick={() => setOpen((prev) => !prev)}
					>
						<ChevronDown size={14} strokeWidth={2} aria-hidden style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 120ms ease-out' }} />
					</Box>
				) : null}
			</Flex>
			{awaiting ? <ConfirmBlock activity={activity} onConfirm={onConfirm} onDecline={onDecline} disabled={confirmDisabled} mobile={isMobile} /> : null}
			{links.length || (canUndo && onUndo) ? (
				<Flex gap={3} px={2.5} pb={1.5} mt="-2px" wrap="wrap" align="center">
					{links.map((link) => (
						<RowLink key={link.href} to={link.href}>
							{link.label} →
						</RowLink>
					))}
					{canUndo && onUndo ? (
						<RowButton onClick={() => onUndo(activity.id)} title="Put the page back the way it was">
							Undo
						</RowButton>
					) : null}
				</Flex>
			) : null}
			{open && details.hasDetails ? (
				<Flex id={detailsId} direction="column" gap={2} px={2.5} py={2} borderTop={LOPU_UI.border}>
					{details.input ? <DetailsBlock title="Input" text={details.input} /> : null}
					{details.result ? <DetailsBlock title="Result" text={details.result} /> : null}
				</Flex>
			) : null}
		</Box>
	);
};

/** A persisted turn's tool call (history rows keep name · ok · summary · thingId only). */
export const LopuToolCallRow = ({ call, compact = false }: { call: LopuMessageToolCall; compact?: boolean }) => {
	const status: LopuToolStatus = call.ok ? 'ok' : 'error';
	const label = toolLabel(call.name, status);
	const summary = toolRowSummary({ name: call.name, status, result: { ok: call.ok, summary: call.summary } });
	return (
		<Box {...rowFrame} role="group" aria-label={label} data-tool={call.name} data-status={status}>
			<Flex align="center" gap={2} minH={compact ? '28px' : '32px'} px={2.5} minW={0}>
				<Box as="span" fontSize="13px" lineHeight={1} flexShrink={0} aria-hidden="true">
					{toolGlyph(call.name)}
				</Box>
				<Text as="span" fontSize={LOPU_UI.fontSmall} fontWeight={600} color={call.ok ? LOPU_UI.ink : LOPU_UI.danger} whiteSpace="nowrap" flexShrink={0}>
					{label}
				</Text>
				{summary ? (
					<Text as="span" fontSize={LOPU_UI.fontSmall} color={LOPU_UI.muted} isTruncated flex={1} minW={0} title={summary}>
						{summary}
					</Text>
				) : (
					<Box flex={1} />
				)}
				<StatusGlyph status={status} />
			</Flex>
			{call.thingId ? (
				<Flex px={2.5} pb={1.5} mt="-2px">
					<RowLink to={`/thing/${encodeURIComponent(call.thingId)}`}>Open →</RowLink>
				</Flex>
			) : null}
		</Box>
	);
};
