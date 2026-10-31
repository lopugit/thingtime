import { Box, Button, Flex, Input, Text, Textarea } from '@chakra-ui/react';
import React from 'react';
import { Link as RouterLink } from 'react-router';

import { PageShell } from '~/components/Layout/PageShell';
import { useLopu } from '~/components/Lopu/useLopu';

import {
	SUPPORT_CAMPAIGN_URL,
	SUPPORT_EMAIL,
	SUPPORT_INQUIRIES,
	supportMailto,
	type SupportInquiryKind
} from './supportContent';

const INK = 'var(--tt-ink, #16161a)';
const TEXT = 'var(--tt-text, #5a5a66)';
const BORDER = 'var(--tt-border, #e5e5eb)';
const CARD = 'var(--tt-card, #fff)';
const SURFACE = 'var(--tt-surface, #fafafb)';
const FOCUS = { outline: `2px solid ${INK}`, outlineOffset: '3px' };

const SUPPORT_OPTIONS = [
	{
		key: 'contribute',
		number: '01',
		title: 'Make a contribution',
		copy: 'Choose a one-off or monthly contribution to help cover the hosting, storage and AI bills that keep Thingtime running.',
		label: 'Contribute on GoFundMe ↗'
	},
	{
		key: 'setup',
		number: '02',
		title: 'Get hands-on help',
		copy: 'Have a project in mind? Ask about paid Thingtime setup, organising your information, or a tailored workflow.',
		label: 'Request a setup quote'
	},
	{
		key: 'sponsorship',
		number: '03',
		title: 'Become a sponsor',
		copy: 'Support Thingtime through your business with funding, infrastructure, or useful service credits.',
		label: 'Discuss sponsorship'
	}
] as const;

const SectionTitle = ({ children, id }: { children: React.ReactNode; id?: string }) => (
	<Text as="h2" id={id} color={INK} fontSize={['24px', '28px']} fontWeight={700} letterSpacing="-0.03em" lineHeight="1.2">
		{children}
	</Text>
);

export const SupportPage = () => {
	const lopu = useLopu();
	const [kind, setKind] = React.useState<SupportInquiryKind>('setup');
	// Each inquiry retains its own edits when visitors switch between options.
	// Drafts stay in this mounted page; no form contents are stored or submitted.
	const [drafts, setDrafts] = React.useState<Record<SupportInquiryKind, { subject: string; body: string }>>(() => ({
		setup: { subject: SUPPORT_INQUIRIES.setup.subject, body: SUPPORT_INQUIRIES.setup.body },
		sponsorship: { subject: SUPPORT_INQUIRIES.sponsorship.subject, body: SUPPORT_INQUIRIES.sponsorship.body }
	}));
	const draft = drafts[kind];
	const subjectRef = React.useRef<HTMLInputElement>(null);
	const messageRef = React.useRef<HTMLTextAreaElement>(null);
	const inquiryRef = React.useRef<HTMLDivElement>(null);

	const editDraft = (field: 'subject' | 'body', value: string) => {
		setDrafts((current) => ({ ...current, [kind]: { ...current[kind], [field]: value } }));
	};

	const chooseInquiry = (nextKind: SupportInquiryKind) => {
		setKind(nextKind);
		inquiryRef.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
		subjectRef.current?.focus({ preventScroll: true });
	};

	const copyDraft = async () => {
		try {
			await navigator.clipboard.writeText(`To: ${SUPPORT_EMAIL}\nSubject: ${draft.subject}\n\n${draft.body}`);
			lopu({ title: 'Email draft copied', description: 'Paste it into your email app, review it, and send when you are ready.', status: 'success' });
		} catch {
			messageRef.current?.focus();
			messageRef.current?.select();
			lopu({ title: 'Copy the selected message', description: 'Clipboard access is unavailable. Copy the selected text and use the recipient and subject shown above.', status: 'info' });
		}
	};

	return (
		<PageShell width={1100} columnProps={{ rowGap: 0, paddingX: [5, 8], paddingBottom: [12, 20] }}>
			<Flex as="section" direction="column" alignItems="flex-start" paddingTop={[10, 16]} paddingBottom={[9, 12]}>
				<Box as={RouterLink} to="/" color={TEXT} fontSize="13px" marginBottom={8} _hover={{ color: INK }} _focusVisible={FOCUS}>
					← Back to Thingtime
				</Box>
				<Text fontFamily="mono" fontSize="11px" fontWeight={600} letterSpacing="0.12em" color={TEXT} textTransform="uppercase">
					Built with care. Supported by people.
				</Text>
				<Text as="h1" marginTop={4} maxWidth="790px" color={INK} fontFamily="heading" fontSize={['40px', '56px', '64px']} fontWeight={700} letterSpacing="-0.055em" lineHeight="1.05">
					Help keep Thingtime growing.
				</Text>
				<Text color={TEXT} fontSize={['17px', '19px']} lineHeight="1.7" maxWidth="680px" marginTop={6}>
					A place for your ideas, information and everyday workflows. Your support helps fund infrastructure, AI usage, and the work of making Thingtime more useful.
				</Text>
			</Flex>

			<Box as="section" aria-label="Ways to support Thingtime" display="grid" gridTemplateColumns={['1fr', null, 'repeat(3, minmax(0, 1fr))']} gap={4}>
				{SUPPORT_OPTIONS.map((option) => (
					<Flex key={option.key} direction="column" alignItems="flex-start" minWidth={0} background={CARD} border={`1px solid ${BORDER}`} borderRadius="16px" padding={[6, 7]}>
						<Text fontFamily="mono" fontSize="12px" color={TEXT} marginBottom={6}>{option.number}</Text>
						<Text as="h2" color={INK} fontSize="21px" fontWeight={700} letterSpacing="-0.03em" lineHeight="1.3">{option.title}</Text>
						<Text color={TEXT} fontSize="15px" lineHeight="1.65" marginTop={3} marginBottom={7}>{option.copy}</Text>
						{option.key === 'contribute' ? (
							<Button as="a" href={SUPPORT_CAMPAIGN_URL} target="_blank" rel="noopener noreferrer" marginTop="auto" width="100%" minHeight="46px" height="auto" padding={3} whiteSpace="normal" textAlign="center" fontSize="14px" background={INK} color={CARD} _hover={{ opacity: 0.85 }} _focusVisible={FOCUS}>
								{option.label}
							</Button>
						) : (
							<Button onClick={() => chooseInquiry(option.key)} marginTop="auto" width="100%" minHeight="46px" height="auto" padding={3} whiteSpace="normal" textAlign="center" fontSize="14px" background={SURFACE} color={INK} border={`1px solid ${BORDER}`} _hover={{ borderColor: INK }} _focusVisible={FOCUS}>
								{option.label}
							</Button>
						)}
					</Flex>
				))}
			</Box>
			<Text color={TEXT} fontSize="13px" lineHeight="1.6" marginTop={4}>
				Contributions support the project; they do not purchase AI credits or paid services. GoFundMe handles contributions and adds a donor fee for monthly giving. Review its fees and terms at checkout.
			</Text>

			<Box ref={inquiryRef} as="section" aria-labelledby="support-inquiry-title" marginTop={[12, 16]} paddingTop={[8, 10]} borderTop={`1px solid ${BORDER}`} scrollMarginTop="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px) + 20px)">
				<Flex gap={[6, 10]} direction={['column', null, 'row']}>
					<Box flex="0 0 30%" minWidth={0}>
						<SectionTitle id="support-inquiry-title">Start a conversation</SectionTitle>
						<Text color={TEXT} fontSize="15px" lineHeight="1.7" marginTop={4}>
							Tell us what you have in mind. We’ll discuss scope, availability and a written quote or sponsorship agreement before any commitment.
						</Text>
						<Text color={TEXT} fontSize="13px" lineHeight="1.7" marginTop={4}>
							This prepares an email for you to review and send. You can also write directly to{' '}
							<Box as="a" href={`mailto:${SUPPORT_EMAIL}`} color={INK} textDecoration="underline" overflowWrap="anywhere" _focusVisible={FOCUS}>{SUPPORT_EMAIL}</Box>.
						</Text>
					</Box>
					<Flex flex="1" minWidth={0} direction="column" gap={5} background={CARD} border={`1px solid ${BORDER}`} borderRadius="16px" padding={[5, 7]}>
						<Box as="fieldset" border={0} minWidth={0}>
							<Text as="legend" fontSize="13px" color={INK} fontWeight={600} marginBottom={3}>I’m interested in</Text>
							<Flex gap={2} flexWrap="wrap">
								{(Object.keys(SUPPORT_INQUIRIES) as SupportInquiryKind[]).map((option) => (
									<Button key={option} onClick={() => setKind(option)} aria-pressed={kind === option} fontSize="13px" minHeight="42px" height="auto" padding={3} whiteSpace="normal" textAlign="left" background={kind === option ? INK : SURFACE} color={kind === option ? CARD : TEXT} border={`1px solid ${kind === option ? INK : BORDER}`} _hover={{ opacity: 0.85 }} _focusVisible={FOCUS}>
										{SUPPORT_INQUIRIES[option].label}
									</Button>
								))}
							</Flex>
						</Box>
						<Text color={TEXT} fontSize="13px" overflowWrap="anywhere">To: {SUPPORT_EMAIL}</Text>
						<Box>
							<Text as="label" htmlFor="support-subject" display="block" fontSize="13px" color={INK} fontWeight={600} marginBottom={2}>Subject</Text>
							<Input ref={subjectRef} id="support-subject" value={draft.subject} onChange={(event) => editDraft('subject', event.target.value)} maxLength={100} color={INK} borderColor={BORDER} fontSize="14px" _focusVisible={FOCUS} />
						</Box>
						<Box>
							<Text as="label" htmlFor="support-message" display="block" fontSize="13px" color={INK} fontWeight={600} marginBottom={2}>Your message</Text>
							<Textarea ref={messageRef} id="support-message" value={draft.body} onChange={(event) => editDraft('body', event.target.value)} maxLength={1200} rows={13} resize="vertical" minHeight="260px" color={INK} borderColor={BORDER} fontSize="14px" lineHeight="1.7" whiteSpace="pre-wrap" aria-describedby="support-draft-note" _focusVisible={FOCUS} />
							<Text id="support-draft-note" color={TEXT} fontSize="12px" lineHeight="1.6" marginTop={2}>
								Edit the draft before opening your email app. Keep this first note high level; leave out passwords, payment details and private workspace data. Drafts stay here until you leave this page.
							</Text>
						</Box>
						<Flex gap={3} flexWrap="wrap">
							<Button as="a" href={supportMailto(draft.subject, draft.body)} minHeight="44px" fontSize="14px" background={INK} color={CARD} _hover={{ opacity: 0.85 }} _focusVisible={FOCUS}>Open email draft ↗</Button>
							<Button onClick={copyDraft} minHeight="44px" fontSize="14px" variant="outline" color={INK} borderColor={BORDER} _hover={{ background: SURFACE }} _focusVisible={FOCUS}>Copy email draft</Button>
						</Flex>
						<Text color={TEXT} fontSize="12px" lineHeight="1.6">No email app set up? Copy the draft and paste it into your preferred email service. Nothing is sent by this page.</Text>
					</Flex>
				</Flex>
			</Box>

			<Flex as="section" direction={['column', 'row']} justifyContent="space-between" alignItems="flex-start" gap={6} marginTop={[12, 16]} paddingTop={8} borderTop={`1px solid ${BORDER}`}>
				<Box maxWidth="620px">
					<SectionTitle>Sharing helps, too.</SectionTitle>
					<Text color={TEXT} fontSize="15px" lineHeight="1.7" marginTop={3}>Introduce Thingtime to someone who could use it, or pass this page to a potential supporter. Every useful connection helps us find our next customer.</Text>
				</Box>
				<Box as={RouterLink} to="/things/Content" flexShrink={0} fontSize="14px" fontWeight={600} color={INK} paddingY={3} _hover={{ textDecoration: 'underline' }} _focusVisible={FOCUS}>Explore Thingtime →</Box>
			</Flex>
		</PageShell>
	);
};
