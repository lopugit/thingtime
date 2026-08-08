import React from 'react';
import {
	Badge,
	Box,
	Button,
	Flex,
	FormControl,
	FormLabel,
	Heading,
	Input,
	Modal,
	ModalBody,
	ModalCloseButton,
	ModalContent,
	ModalFooter,
	ModalHeader,
	ModalOverlay,
	Stack,
	Text
} from '@chakra-ui/react';
import { Eye, EyeOff, Lock } from 'lucide-react';

import { useLopu } from '~/components/Lopu/useLopu';
import { useApi } from '~/hooks/useApi';
import { CARD_STYLES } from '~/theme/card';
import { sensitiveRevealErrorMessage } from './sensitiveRevealError';

export type SensitiveThingRevealDescriptor = {
	reference: string;
	kind: 'mongodb-object-id';
	label: string;
	placeholder: string;
};

type RevealedValue = {
	reference: string;
	kind: 'mongodb-object-id';
	value: string;
};

type SensitiveThingRevealProps = {
	thingId: string;
	identityKey: string;
	revealables: SensitiveThingRevealDescriptor[];
};

const MONGODB_OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i;
const MUTED = 'var(--tt-muted, #9a9aa6)';

const kindLabel = (kind: SensitiveThingRevealDescriptor['kind']) =>
	kind === 'mongodb-object-id' ? 'MongoDB ObjectId' : 'Protected value';

const validRevealResponse = (
	response: unknown,
	descriptor: SensitiveThingRevealDescriptor
): response is { ok: true; reveal: RevealedValue } => {
	if (!response || typeof response !== 'object') return false;
	const candidate = response as { ok?: unknown; reveal?: unknown };
	if (candidate.ok !== true || !candidate.reveal || typeof candidate.reveal !== 'object') return false;
	const reveal = candidate.reveal as Record<string, unknown>;
	return (
		reveal.reference === descriptor.reference &&
		reveal.kind === descriptor.kind &&
		typeof reveal.value === 'string' &&
		MONGODB_OBJECT_ID_PATTERN.test(reveal.value)
	);
};

/**
 * A deliberately transient viewer for server-approved fields inside a
 * protected Thing. The component never caches a password or revealed value;
 * every Reveal action requires a new password-confirmed server request.
 */
const revealScopeKey = ({ thingId, identityKey, revealables }: SensitiveThingRevealProps) =>
	`${identityKey}\u0000${thingId}\u0000${revealables
		.map((descriptor) => `${descriptor.reference}:${descriptor.kind}`)
		.join('\u0000')}`;

const SensitiveThingRevealScope = ({
	thingId,
	revealables
}: SensitiveThingRevealProps) => {
	const { v1 } = useApi();
	const lopu = useLopu();
	const passwordRef = React.useRef<HTMLInputElement>(null);
	const controllerRef = React.useRef<AbortController | null>(null);
	const requestIdRef = React.useRef(0);
	const revealRef = React.useRef(v1.things.reveal);
	revealRef.current = v1.things.reveal;

	const [prompt, setPrompt] = React.useState<SensitiveThingRevealDescriptor | null>(null);
	const [password, setPassword] = React.useState('');
	const [submitting, setSubmitting] = React.useState(false);
	const [promptError, setPromptError] = React.useState<string | null>(null);
	const [revealed, setRevealed] = React.useState<RevealedValue | null>(null);

	const clearRequest = React.useCallback(() => {
		requestIdRef.current += 1;
		controllerRef.current?.abort();
		controllerRef.current = null;
	}, []);

	const clearTransientState = React.useCallback(() => {
		clearRequest();
		setPrompt(null);
		setPassword('');
		setSubmitting(false);
		setPromptError(null);
		setRevealed(null);
	}, [clearRequest]);

	React.useEffect(() => {
		const handleVisibilityChange = () => {
			if (document.visibilityState === 'hidden') clearTransientState();
		};
		document.addEventListener('visibilitychange', handleVisibilityChange);
		return () => {
			document.removeEventListener('visibilitychange', handleVisibilityChange);
			requestIdRef.current += 1;
			controllerRef.current?.abort();
			controllerRef.current = null;
		};
	}, [clearTransientState]);

	React.useEffect(() => {
		if (promptError && !submitting) passwordRef.current?.focus();
	}, [promptError, submitting]);

	const closePrompt = React.useCallback(() => {
		clearRequest();
		setPrompt(null);
		setPassword('');
		setSubmitting(false);
		setPromptError(null);
	}, [clearRequest]);

	const openPrompt = (descriptor: SensitiveThingRevealDescriptor) => {
		clearRequest();
		setRevealed(null);
		setPrompt(descriptor);
		setPassword('');
		setSubmitting(false);
		setPromptError(null);
	};

	const submitReveal = async (event: React.FormEvent) => {
		event.preventDefault();
		if (!prompt || submitting) return;
		const submittedPassword = password;
		setPassword('');
		if (!submittedPassword) {
			setPromptError('Enter your current password to continue.');
			passwordRef.current?.focus();
			return;
		}

		clearRequest();
		const controller = new AbortController();
		controllerRef.current = controller;
		const requestId = requestIdRef.current;
		setSubmitting(true);
		setPromptError(null);

		try {
			const response = await revealRef.current(
				{ thingId, reference: prompt.reference, password: submittedPassword },
				{ signal: controller.signal }
			);
			if (controller.signal.aborted || requestId !== requestIdRef.current) return;
			if (!validRevealResponse(response, prompt)) {
				throw new Error('Invalid reveal response');
			}

			setRevealed(response.reveal);
			setPrompt(null);
			setPromptError(null);
			lopu({ title: 'Protected value revealed', status: 'success', duration: 5000 });
		} catch (error) {
			if (controller.signal.aborted || requestId !== requestIdRef.current || (error instanceof Error && error.name === 'AbortError')) return;
			const message = sensitiveRevealErrorMessage(error);
			setPromptError(message);
			lopu({ title: 'Protected value could not be revealed', description: message, status: 'error', duration: 7000 });
		} finally {
			if (requestId === requestIdRef.current) {
				controllerRef.current = null;
				setSubmitting(false);
			}
		}
	};

	if (revealables.length === 0) return null;

	return (
		<>
			<Box {...CARD_STYLES} p={{ base: 4, md: 6 }} minW={0}>
				<Flex align="flex-start" gap={3} mb={4}>
					<Flex
						align="center"
						justify="center"
						width="34px"
						height="34px"
						borderRadius="full"
						bg="var(--tt-surface-alt, #f5f5f7)"
						flexShrink={0}
					>
						<Lock size={16} aria-hidden="true" />
					</Flex>
					<Box minW={0}>
						<Heading as="h2" fontSize="md">
							Protected values
						</Heading>
						<Text mt={1} color={MUTED} fontSize="xs">
							These values are stored privately. Revealing one requires your current password every time.
						</Text>
					</Box>
				</Flex>

				<Stack spacing={3}>
					{revealables.map((descriptor) => {
						const visible = revealed?.reference === descriptor.reference && revealed.kind === descriptor.kind;
						return (
							<Box key={`${descriptor.reference}:${descriptor.kind}`} borderWidth="1px" borderRadius="var(--tt-radius-lg, 14px)" p={3} minW={0}>
								<Flex align={{ base: 'stretch', sm: 'center' }} justify="space-between" gap={3} direction={{ base: 'column', sm: 'row' }}>
									<Box minW={0}>
										<Flex align="center" gap={2} wrap="wrap">
											<Text fontSize="sm" fontWeight="700">
												{descriptor.label}
											</Text>
											<Badge fontSize="9px">{kindLabel(descriptor.kind)}</Badge>
										</Flex>
										<Box
											as="code"
											display="block"
											mt={1.5}
											fontSize={{ base: '11px', md: '12px' }}
											color={visible ? 'var(--tt-ink, #16161a)' : MUTED}
											overflowWrap="anywhere"
											whiteSpace="pre-wrap"
											aria-label={visible ? `Revealed ${descriptor.label}` : `Redacted ${descriptor.label}`}
										>
											{visible ? revealed.value : descriptor.placeholder}
										</Box>
									</Box>
									<Flex gap={2} flexShrink={0}>
										{visible ? (
											<Button size="sm" variant="ghost" leftIcon={<EyeOff size={14} />} onClick={() => setRevealed(null)}>
												Hide
											</Button>
										) : null}
										<Button size="sm" leftIcon={<Eye size={14} />} onClick={() => openPrompt(descriptor)}>
											Reveal
										</Button>
									</Flex>
								</Flex>
							</Box>
						);
					})}
				</Stack>
			</Box>

			<Modal isOpen={prompt !== null} onClose={closePrompt} initialFocusRef={passwordRef} isCentered scrollBehavior="inside">
				<ModalOverlay />
				<ModalContent as="form" onSubmit={submitReveal} mx={3}>
					<ModalHeader pr={10}>Confirm to reveal</ModalHeader>
					<ModalCloseButton />
					<ModalBody>
						<Text color={MUTED} fontSize="sm" mb={4}>
							Enter your current Thingtime password to reveal {prompt?.label || 'this protected value'}. This confirmation applies only to this request.
						</Text>
						<FormControl isRequired isInvalid={Boolean(promptError)}>
							<FormLabel fontSize="sm">Current password</FormLabel>
							<Input
								ref={passwordRef}
								type="password"
								name="sensitive-reveal-password"
								autoComplete="current-password"
								value={password}
								onChange={(event) => {
									setPassword(event.target.value);
									if (promptError) setPromptError(null);
								}}
								isDisabled={submitting}
								aria-describedby={promptError ? 'sensitive-reveal-error' : 'sensitive-reveal-note'}
							/>
							{promptError ? (
								<Text id="sensitive-reveal-error" role="alert" mt={2} color="red.500" fontSize="xs">
									{promptError}
								</Text>
								) : (
									<Text id="sensitive-reveal-note" mt={2} color={MUTED} fontSize="xs">
										Neither your password nor the revealed value is stored in browser storage; hiding or leaving this page clears the reveal.
								</Text>
							)}
						</FormControl>
					</ModalBody>
					<ModalFooter gap={2}>
						<Button type="button" variant="ghost" onClick={closePrompt} isDisabled={submitting}>
							Cancel
						</Button>
						<Button type="submit" leftIcon={<Eye size={15} />} isLoading={submitting} loadingText="Confirming">
							Reveal once
						</Button>
					</ModalFooter>
				</ModalContent>
			</Modal>
		</>
	);
};

// Key the stateful scope inside the reusable component itself. A caller cannot
// accidentally paint a prior identity/Thing's transient value for one frame
// while React waits to run an effect after a prop change.
export const SensitiveThingReveal = (props: SensitiveThingRevealProps) => (
	<SensitiveThingRevealScope key={revealScopeKey(props)} {...props} />
);
