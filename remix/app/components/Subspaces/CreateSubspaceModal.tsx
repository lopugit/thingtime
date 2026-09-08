import React from 'react';
import { Box, Button, Flex, Input, Modal, ModalBody, ModalContent, ModalHeader, ModalOverlay, Select, Text, Textarea } from '@chakra-ui/react';
import { useNavigate } from 'react-router';

import { useApi } from '~/hooks/useApi';
import { useLopu } from '~/components/Lopu/useLopu';
import { RAINBOW } from '~/theme/rainbow';
import { ACCESS_META, type PublicSubspace, type SubspaceAccess } from './subspaceTypes';

// "Found a subspace" — slug + name + description + access + icon/accent, then
// straight to /s/<slug>. The slug previews live as you type (lowercased,
// spaces → _) so what you see is the URL you get; the server re-validates.

const INK = 'var(--tt-ink, #16161a)';
const MUTED = 'var(--tt-muted, #9a9aa6)';
const BORDER = '1px solid var(--tt-border, #ececef)';
const RADIUS_MD = 'var(--tt-radius-md, 12px)';

export const previewSlug = (value: string) =>
	value
		.trim()
		.toLowerCase()
		.replace(/^s\//, '')
		.replace(/[\s-]+/g, '_')
		.replace(/[^a-z0-9_]/g, '')
		.slice(0, 30);

const Label = ({ children }: { children: React.ReactNode }) => (
	<Text fontFamily="mono" fontSize="10px" fontWeight={600} letterSpacing="0.08em" textTransform="uppercase" color={MUTED}>
		{children}
	</Text>
);

export const CreateSubspaceModal = (props: { isOpen: boolean; onClose: () => void; onCreated?: (subspace: PublicSubspace) => void }) => {
	const { isOpen, onClose, onCreated } = props;
	const api = useApi();
	const lopu = useLopu();
	const navigate = useNavigate();

	const [name, setName] = React.useState('');
	const [slug, setSlug] = React.useState('');
	const [slugTouched, setSlugTouched] = React.useState(false);
	const [description, setDescription] = React.useState('');
	const [access, setAccess] = React.useState<SubspaceAccess>('public');
	const [icon, setIcon] = React.useState('🪐');
	const [accent, setAccent] = React.useState('#7c5cff');
	const [nsfw, setNsfw] = React.useState(false);
	const [saving, setSaving] = React.useState(false);

	const effectiveSlug = slugTouched ? previewSlug(slug) : previewSlug(name);
	const valid = effectiveSlug.length >= 3 && name.trim().length > 0;

	const reset = () => {
		setName('');
		setSlug('');
		setSlugTouched(false);
		setDescription('');
		setAccess('public');
		setIcon('🪐');
		setAccent('#7c5cff');
		setNsfw(false);
	};

	const submit = async () => {
		if (!valid || saving) return;
		setSaving(true);
		try {
			const resp: any = await api.v1.subspaces.create({
				slug: effectiveSlug,
				name: name.trim(),
				description: description.trim() || undefined,
				access,
				nsfw,
				branding: { icon: icon.trim() || null, accent: accent.trim() || null }
			});
			const created: PublicSubspace = resp.subspace;
			lopu({ title: `s/${created.slug} is live 🪐`, description: 'You are its owner and first member.', status: 'success', duration: 6000 });
			reset();
			onClose();
			onCreated?.(created);
			navigate(`/s/${created.slug}`);
		} catch (err: any) {
			lopu({ title: err?.error || 'Could not create the subspace 😞', status: 'error' });
		} finally {
			setSaving(false);
		}
	};

	return (
		<Modal isOpen={isOpen} onClose={onClose} isCentered size="lg" autoFocus>
			<ModalOverlay />
			<ModalContent borderRadius="var(--tt-radius-lg, 16px)" background="var(--tt-card, #ffffff)" marginX={4} maxWidth="520px">
				<ModalHeader fontFamily="heading" fontSize="lg" color={INK} paddingBottom={2}>
					Found a subspace 🪐
				</ModalHeader>
				<ModalBody paddingBottom={5}>
					<Flex flexDirection="column" rowGap={3}>
						<Box>
							<Label>Name</Label>
							<Input
								size="sm"
								borderRadius={RADIUS_MD}
								placeholder="Rainbow Makers"
								value={name}
								maxLength={80}
								onChange={(event) => setName(event.target.value)}
								autoFocus
							/>
						</Box>
						<Box>
							<Label>URL</Label>
							<Flex alignItems="center" columnGap={1}>
								<Text fontSize="sm" color={MUTED} flexShrink={0}>
									/s/
								</Text>
								<Input
									size="sm"
									borderRadius={RADIUS_MD}
									fontFamily="mono"
									placeholder={previewSlug(name) || 'rainbow_makers'}
									value={slugTouched ? slug : effectiveSlug}
									maxLength={30}
									onChange={(event) => {
										setSlugTouched(true);
										setSlug(event.target.value);
									}}
								/>
							</Flex>
							<Text fontSize="xs" color={MUTED} marginTop={1}>
								3–30 lowercase letters, numbers, or _ · can’t be changed later
							</Text>
						</Box>
						<Box>
							<Label>Description</Label>
							<Textarea
								size="sm"
								borderRadius={RADIUS_MD}
								rows={2}
								placeholder="What is this place about?"
								value={description}
								maxLength={1000}
								onChange={(event) => setDescription(event.target.value)}
							/>
						</Box>
						<Flex columnGap={3} rowGap={3} flexWrap="wrap">
							<Box flex="1" minWidth="160px">
								<Label>Who can post</Label>
								{/* short option labels — the hint below the select instead of
								inside it, where it truncated/clipped at narrow widths */}
								<Select size="sm" borderRadius={RADIUS_MD} value={access} onChange={(event) => setAccess(event.target.value as SubspaceAccess)}>
									{(Object.keys(ACCESS_META) as SubspaceAccess[]).map((key) => (
										<option key={key} value={key}>
											{ACCESS_META[key].emoji} {ACCESS_META[key].label}
										</option>
									))}
								</Select>
								<Text fontSize="xs" color={MUTED} marginTop={1} whiteSpace="normal">
									{ACCESS_META[access].hint}
								</Text>
							</Box>
							<Box width="80px">
								<Label>Icon</Label>
								<Input size="sm" borderRadius={RADIUS_MD} textAlign="center" value={icon} maxLength={8} onChange={(event) => setIcon(event.target.value)} />
							</Box>
							<Box width="110px">
								<Label>Accent</Label>
								<Flex alignItems="center" columnGap={1}>
									<Input type="color" size="sm" padding={0} width="34px" borderRadius={RADIUS_MD} value={/^#[0-9a-f]{6}$/i.test(accent) ? accent : '#7c5cff'} onChange={(event) => setAccent(event.target.value)} />
									<Input size="sm" borderRadius={RADIUS_MD} fontFamily="mono" value={accent} maxLength={32} onChange={(event) => setAccent(event.target.value)} />
								</Flex>
							</Box>
						</Flex>
						<Flex as="label" alignItems="center" columnGap={2} cursor="pointer" fontSize="sm" color={INK}>
							<input type="checkbox" checked={nsfw} onChange={(event) => setNsfw(event.target.checked)} />
							18+ subspace 🔞
						</Flex>
						<Flex alignItems="center" columnGap={2} borderTop={BORDER} paddingTop={3}>
							<Text fontSize="xs" color={MUTED} noOfLines={1}>
								{valid ? `You’ll be the owner of /s/${effectiveSlug}` : 'Pick a name to see your URL'}
							</Text>
							<Button marginLeft="auto" size="sm" variant="ghost" borderRadius={RADIUS_MD} onClick={onClose}>
								Cancel
							</Button>
							<Button
								size="sm"
								color="white"
								fontFamily="heading"
								fontWeight={600}
								background={RAINBOW}
								backgroundSize="calc(100px + 200%)"
								sx={{ animation: 'var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)' }}
								_hover={{ opacity: 0.9 }}
								borderRadius={RADIUS_MD}
								isDisabled={!valid}
								isLoading={saving}
								onClick={submit}
							>
								Create 🪐
							</Button>
						</Flex>
					</Flex>
				</ModalBody>
			</ModalContent>
		</Modal>
	);
};
