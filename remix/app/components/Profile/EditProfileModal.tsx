import React from 'react';
import { Box, Button, Center, Flex, Input, Text, Textarea } from '@chakra-ui/react';
import { X } from 'lucide-react';

import { ProfileAvatarCircle, ProfileBanner } from './ProfilePage';
import { DRAWER_MODAL_OVERLAY_Z, DRAWER_MODAL_Z, useIsMobileViewport } from '~/components/Nav/Drawer/useDrawer';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useLopu } from '~/components/Lopu/useLopu';
import { RAINBOW } from '~/theme/rainbow';
import { ProfileMediaField, type ProfileMediaFieldHandle } from './ProfileMediaField';
import { profileMediaUpdateFields, profileSaveErrorMessage, preservedProfileMediaSnapshot, type ProfileMediaFieldSnapshot } from './profileMediaCore';

// Edit-profile overlay following the UserSettingsModal pattern: rAF two-frame
// mount, Escape close, body scroll lock. Desktop: centred 560px card.
// Mobile: bottom sheet.

export type EditProfileModalProps = {
  open: boolean;
  onClose: () => void;
};

const BIO_MAX = 500;
const DISPLAY_NAME_MAX = 80;

const RAINBOW_ANIM = 'var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)';

const INPUT_STYLE = {
  borderColor: 'var(--tt-border, #ececef)',
  borderRadius: 'var(--tt-radius-md, 12px)',
  _focusVisible: { borderColor: 'var(--tt-rainbow-5, #a555e8)', boxShadow: 'none' }
} as const;

export const EditProfileModal = (props: EditProfileModalProps) => {
  const { open, onClose } = props;

  const isMobile = useIsMobileViewport();
  const user = useCurrentUser();
  const api = useApi();
  const lopu = useLopu();

  const [displayName, setDisplayName] = React.useState('');
  const [bio, setBio] = React.useState('');
	const [avatarMedia, setAvatarMedia] = React.useState<ProfileMediaFieldSnapshot>(() => preservedProfileMediaSnapshot(null));
	const [bannerMedia, setBannerMedia] = React.useState<ProfileMediaFieldSnapshot>(() => preservedProfileMediaSnapshot(null));
  const [saving, setSaving] = React.useState(false);
	const avatarMediaRef = React.useRef<ProfileMediaFieldHandle | null>(null);
	const bannerMediaRef = React.useRef<ProfileMediaFieldHandle | null>(null);

  // seed fields from the current user each time the modal opens (latest-ref so
  // a mid-edit root-data refresh never clobbers typed values)
  const userRef = React.useRef(user);
  userRef.current = user;

  React.useEffect(() => {
    if (!open) return;
    const current = userRef.current;
    setDisplayName(current?.displayName || '');
    setBio(current?.bio || '');
		setAvatarMedia(preservedProfileMediaSnapshot(current?.avatarUrl || null));
		setBannerMedia(preservedProfileMediaSnapshot(current?.bannerUrl || null));
    setSaving(false);
  }, [open]);

  // two-frame mount so the open transition animates from the hidden state
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setVisible(false);
      return;
    }

    const raf = requestAnimationFrame(() => {
      setVisible(true);
    });

    return () => {
      cancelAnimationFrame(raf);
    };
  }, [open]);

  React.useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
			if (event.code === 'Escape' && !saving) {
        onClose();
      }
    };

    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
	}, [open, onClose, saving]);

  // freeze the page behind the modal
  React.useEffect(() => {
    if (!open) return;

    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const handleSave = async () => {
		if (saving || avatarMedia.blocking || bannerMedia.blocking) {
			if (!saving) {
				lopu({
					title: 'Profile media is not ready yet',
					description: 'Finish or remove the avatar and banner drafts before saving.',
					status: 'info'
				});
			}
			return;
		}
    setSaving(true);

    try {
			const response = await api.v1.profile.update({
        displayName: displayName.trim() || null,
        bio: bio.trim() ? bio.trim() : null,
				...profileMediaUpdateFields('avatar', avatarMedia.mutation),
				...profileMediaUpdateFields('banner', bannerMedia.mutation)
      });
			if (!response?.user) throw new Error('invalid profile response');
			avatarMediaRef.current?.commit(response.user.avatarUrl ?? null, response.user.avatarLinkedUrl ?? null);
			bannerMediaRef.current?.commit(response.user.bannerUrl ?? null, response.user.bannerLinkedUrl ?? null);
      lopu({ title: 'Profile updated ✨', status: 'success' });
      onClose();
		} catch (error: unknown) {
      lopu({
        title: 'Could not update profile 😔',
				description: profileSaveErrorMessage(error),
        status: 'error'
      });
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const fieldLabel = (label: string, right?: React.ReactNode) => (
    <Flex alignItems="center">
      <Text fontSize="xs" fontWeight={600} color="var(--tt-muted, #9a9aa6)">
        {label}
      </Text>
      {right && <Box marginLeft="auto">{right}</Box>}
    </Flex>
  );

  const content = (
    <Flex
      flexDirection="column"
      rowGap={4}
      padding={6}
      paddingBottom={isMobile ? 'calc(24px + var(--thingtime-safe-area-bottom))' : 6}
      whiteSpace="normal"
    >
      {/* header */}
      <Flex alignItems="center">
        <Text fontSize="md" fontWeight={700} color="var(--tt-ink, #16161a)">
          Edit profile ✏️
        </Text>
        <Center
          as="button"
          type="button"
          marginLeft="auto"
					width="44px"
					height="44px"
          borderRadius="8px"
          opacity={0.6}
          _hover={{ opacity: 1, background: 'var(--tt-surface-hover, #ececee)' }}
          cursor="pointer"
          aria-label="Close edit profile"
					onClick={() => {
						if (!saving) onClose();
					}}
        >
          <X size={15} strokeWidth={2} />
        </Center>
      </Flex>

      {/* live preview */}
      <Box position="relative" paddingBottom="24px">
				<ProfileBanner bannerUrl={bannerMedia.previewUrl} height="72px" radius="var(--tt-radius-md, 12px)" />
        <Box position="absolute" left="16px" bottom={0}>
          <ProfileAvatarCircle
						avatarUrl={avatarMedia.previewUrl}
            name={displayName || user?.displayName || user?.username || '?'}
            size="48px"
            fontSize="md"
            borderWidth="3px"
          />
        </Box>
      </Box>

      <Flex flexDirection="column" rowGap={1}>
        {fieldLabel('Display name 💫')}
        <Input
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          maxLength={DISPLAY_NAME_MAX}
          placeholder="How you appear around Thingtime"
          size="sm"
          {...INPUT_STYLE}
        />
      </Flex>

      <Flex flexDirection="column" rowGap={1}>
        {fieldLabel(
          'Bio ✍️',
					<Text fontFamily="mono" fontSize="xs" color={bio.length >= BIO_MAX ? 'var(--tt-danger, #e0426b)' : 'var(--tt-muted, #9a9aa6)'}>
            {bio.length}/{BIO_MAX}
          </Text>
        )}
        <Textarea
          value={bio}
          onChange={(event) => setBio(event.target.value)}
          maxLength={BIO_MAX}
          placeholder="A few lines about you"
          rows={4}
          size="sm"
          resize="vertical"
          {...INPUT_STYLE}
        />
      </Flex>

			{user ? (
				<ProfileMediaField
					ref={avatarMediaRef}
					slot="avatar"
					ownerId={user.id}
					savedUrl={user.avatarUrl}
					savedLinkedUrl={user.avatarLinkedUrl}
					disabled={saving}
					remainingBytes={user.storage.remainingBytes}
					storageStatus={user.storage.status}
					onChange={setAvatarMedia}
        />
			) : null}

			{user ? (
				<ProfileMediaField
					ref={bannerMediaRef}
					slot="banner"
					ownerId={user.id}
					savedUrl={user.bannerUrl}
					savedLinkedUrl={user.bannerLinkedUrl}
					disabled={saving}
					remainingBytes={user.storage.remainingBytes}
					storageStatus={user.storage.status}
					onChange={setBannerMedia}
        />
			) : null}

      {/* actions */}
			<Flex columnGap={2} justifyContent="flex-end" paddingRight={isMobile ? '52px' : 0} pt={1}>
        <Button
          size="sm"
					minHeight="44px"
          variant="outline"
          onClick={onClose}
					isDisabled={saving}
          borderColor="var(--tt-border, #ececef)"
          _hover={{ bg: 'var(--tt-surface-alt, #f5f5f7)' }}
          borderRadius="var(--tt-radius-md, 12px)"
        >
          Cancel ✖️
        </Button>
        <Button
          size="sm"
					minHeight="44px"
          onClick={handleSave}
          isLoading={saving}
					isDisabled={avatarMedia.blocking || bannerMedia.blocking}
          color="white"
          fontFamily="heading"
          fontWeight="600"
          background={RAINBOW}
          backgroundSize="calc(100px + 200%)"
          sx={{ animation: RAINBOW_ANIM }}
          _hover={{ opacity: 0.9 }}
          borderRadius="var(--tt-radius-md, 12px)"
        >
          Save ✨
        </Button>
      </Flex>
    </Flex>
  );

  return (
    <>
      <Box
        className="editProfileOverlay"
        position="fixed"
        zIndex={DRAWER_MODAL_OVERLAY_Z}
        top={0}
        right={0}
        bottom={0}
        left={0}
        background="rgba(0,0,0,0.4)"
        opacity={visible ? 1 : 0}
        transition="opacity 0.24s ease-out"
				onClick={() => {
					if (!saving) onClose();
				}}
      ></Box>

      {isMobile ? (
        <Box
          className="editProfileSheet"
          position="fixed"
          zIndex={DRAWER_MODAL_Z}
          right={0}
          bottom={0}
          left={0}
          height="88vh"
          sx={{
            '@supports (height: 100dvh)': {
              height: '88dvh'
            }
          }}
          background="var(--tt-card, white)"
          borderTopRadius="var(--tt-radius-xl, 20px)"
          boxShadow="0px -8px 30px rgba(0,0,0,0.18)"
          transform={visible ? 'translateY(0)' : 'translateY(100%)'}
          transition="transform 0.28s ease-out"
          overflowY="auto"
        >
          {content}
        </Box>
      ) : (
        <Center
          className="editProfileModal"
          position="fixed"
          zIndex={DRAWER_MODAL_Z}
          top={0}
          right={0}
          bottom={0}
          left={0}
          pointerEvents="none"
          padding={6}
        >
          <Box
            width="560px"
            maxWidth="100%"
            maxHeight="86vh"
            background="var(--tt-card, white)"
            borderRadius="var(--tt-radius-lg, 16px)"
            boxShadow="var(--tt-shadow-panel, 0px 18px 60px rgba(0,0,0,0.22))"
            transform={visible ? 'scale(1)' : 'scale(0.96)'}
            opacity={visible ? 1 : 0}
            transition="transform 0.22s ease-out, opacity 0.22s ease-out"
            overflowY="auto"
            pointerEvents="all"
          >
            {content}
          </Box>
        </Center>
      )}
    </>
  );
};
