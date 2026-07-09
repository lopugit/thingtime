import React from 'react';
import { Box, Button, Flex, Image, Input, Switch, Text, Textarea } from '@chakra-ui/react';
import { useNavigate } from 'react-router';

import { AlgorithmManager } from './AlgorithmManager';
import { RainbowButton, SettingRow, SettingsSection } from './SettingsSection';
import { AccountSwitcher } from '~/components/Account/AccountSwitcher';
import { useLopu } from '~/components/Lopu/useLopu';
import { useDrawer } from '~/components/Nav/Drawer/useDrawer';
import { ColorControl } from '~/components/ThemeSettings/controls';
import { CurrentUser, useCurrentUser } from '~/hooks/useCurrentUser';
import { useApi } from '~/hooks/useApi';
import { useTtTheme } from '~/hooks/useTtTheme';
import { RAINBOW_TEXT } from '~/theme/rainbow';

// The dedicated /settings page: account, profile, feed algorithms, appearance
// and drawer preferences in stacked section cards. Fully usable logged out
// (account shows login CTAs; profile + algorithms hide; appearance + drawer
// are local-first and always work).

const BIO_MAX = 500;

const inputStyles = {
  background: 'var(--tt-surface-alt, #f5f5f7)',
  border: '1px solid var(--tt-border, #ececef)',
  borderRadius: 'var(--tt-radius-sm, 9px)'
} as const;

const FieldLabel = (props: { children: React.ReactNode }) => (
  <Text fontSize="xs" fontWeight={600} color="var(--tt-muted, #9a9aa6)">
    {props.children}
  </Text>
);

// Inline profile editor — mount keyed on user id so switching accounts
// reinitialises the form from the fresh user.
const ProfileSettingsForm = (props: { user: NonNullable<CurrentUser> }) => {
  const { user } = props;
  const api = useApi();
  const lopu = useLopu();

  const [displayName, setDisplayName] = React.useState(user.displayName || '');
  const [bio, setBio] = React.useState(user.bio || '');
  const [avatarUrl, setAvatarUrl] = React.useState(user.avatarUrl || '');
  const [bannerUrl, setBannerUrl] = React.useState(user.bannerUrl || '');
  const [saving, setSaving] = React.useState(false);

  const handleSave = async () => {
    if (bio.length > BIO_MAX) {
      lopu({
        title: 'Bio is a little long ✂️',
        description: `Keep it under ${BIO_MAX} characters.`,
        status: 'error'
      });
      return;
    }
    setSaving(true);
    try {
      await api.v1.profile.update({
        displayName: displayName.trim() || null,
        bio: bio.trim() || null,
        avatarUrl: avatarUrl.trim() || null,
        bannerUrl: bannerUrl.trim() || null
      });
      lopu({ title: 'Profile saved ✨', status: 'success', duration: 4000 });
    } catch (err: any) {
      lopu({
        title: 'Could not save profile 😔',
        description: err?.error || 'Please try again in a moment.',
        status: 'error'
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Flex flexDirection="column" rowGap={4}>
      <Flex flexDirection="column" rowGap={1}>
        <FieldLabel>Display name ✏️</FieldLabel>
        <Input
          size="sm"
          value={displayName}
          placeholder="How you appear across Thingtime"
          onChange={(e) => setDisplayName(e.target.value)}
          {...inputStyles}
        />
      </Flex>

      <Flex flexDirection="column" rowGap={1}>
        <Flex alignItems="center">
          <FieldLabel>Bio 📝</FieldLabel>
          <Text marginLeft="auto" fontSize="11px" color="var(--tt-muted, #9a9aa6)">
            {bio.length}/{BIO_MAX}
          </Text>
        </Flex>
        <Textarea
          size="sm"
          rows={3}
          maxLength={BIO_MAX}
          value={bio}
          placeholder="A few lines about you…"
          onChange={(e) => setBio(e.target.value)}
          {...inputStyles}
        />
      </Flex>

      <Flex flexDirection="column" rowGap={1}>
        <FieldLabel>Avatar URL 🖼️</FieldLabel>
        <Flex alignItems="center" columnGap={2}>
          <Input
            size="sm"
            value={avatarUrl}
            placeholder="https://…"
            onChange={(e) => setAvatarUrl(e.target.value)}
            {...inputStyles}
          />
          {avatarUrl.trim() && (
            <Image
              src={avatarUrl.trim()}
              alt="Avatar preview"
              width="32px"
              height="32px"
              borderRadius="999px"
              objectFit="cover"
              flexShrink={0}
              border="1px solid var(--tt-border, #ececef)"
              fallback={<Box width="32px" flexShrink={0} />}
            />
          )}
        </Flex>
      </Flex>

      <Flex flexDirection="column" rowGap={1}>
        <FieldLabel>Banner URL 🌄</FieldLabel>
        <Input
          size="sm"
          value={bannerUrl}
          placeholder="https://…"
          onChange={(e) => setBannerUrl(e.target.value)}
          {...inputStyles}
        />
        {bannerUrl.trim() && (
          <Box
            height="48px"
            borderRadius="var(--tt-radius-md, 12px)"
            border="1px solid var(--tt-border, #ececef)"
            backgroundImage={`url(${bannerUrl.trim()})`}
            backgroundSize="cover"
            backgroundPosition="center"
          />
        )}
      </Flex>

      <Box>
        <RainbowButton size="sm" isLoading={saving} onClick={handleSave}>
          Save changes ✨
        </RainbowButton>
      </Box>
    </Flex>
  );
};

export const SettingsPage = () => {
  const user = useCurrentUser();
  const api = useApi();
  const lopu = useLopu();
  const navigate = useNavigate();

  const {
    direction,
    setDirection,
    searchClosesDrawer,
    setSearchClosesDrawer,
    topLevelLimit,
    setTopLevelLimit,
    resetOrdering
  } = useDrawer();

  const { theme, preset, hasOverrides, appliedThemeShareId, builtinThemes, setPreset, setColor, setGeneral, resetOverrides } =
    useTtTheme();

  const [loggingOut, setLoggingOut] = React.useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    let resp;
    try {
      resp = await api.v1.auth.logout();
    } catch (err: any) {
      lopu({
        title: 'Logout failed',
        description: err?.error || 'Please try again in a moment.',
        status: 'error'
      });
      setLoggingOut(false);
      return;
    }
    setLoggingOut(false);
    // Switcher semantics: other signed-in accounts stay — the next one takes
    // over and settings re-renders on it. Only a fully signed-out browser
    // leaves for /login.
    if (resp?.user) {
      lopu({ title: `Logged out — switched to @${resp.user.username} ✨`, status: 'success', duration: 6000 });
      return;
    }
    lopu({ title: 'Logged out', status: 'success', duration: 6000 });
    navigate('/login');
  };

  const handleResendVerification = async () => {
    if (!user) return;
    try {
      const resp = await api.v1.auth.resendVerification({ email: user.email });
      lopu({
        title: 'Verification email sent 📬',
        description: 'Check your inbox to verify your account.',
        status: 'success',
        link: resp?.verificationLink ? { label: '🔗 Verify now (dev)', href: resp.verificationLink } : undefined
      });
    } catch (err: any) {
      lopu({
        title: 'Could not send verification 😔',
        description: err?.error || 'Please try again in a moment.',
        status: 'error'
      });
    }
  };

  const handleResetOrdering = () => {
    resetOrdering();
    lopu({ title: 'Menu order reset ✨', status: 'success', duration: 6000 });
  };

  // Match ThemeStudio.applyPreset: picking a preset also clears the
  // server-side active theme so cross-device pickup doesn't resurrect it.
  const handlePreset = (name: string) => {
    setPreset(name);
    if (user) {
      api.v1.themes.setActive({ themeId: null }).catch(() => {});
    }
  };

  return (
    <Flex
      justifyContent="center"
      width="100%"
      minHeight="100vh"
      background="var(--tt-surface, #fafafb)"
      paddingTop="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px))"
    >
      <Flex flexDirection="column" rowGap={4} width={['100%', '680px']} px={4} pb={12} whiteSpace="normal">
        {/* page header */}
        <Box paddingTop={[4, 8]}>
          <Text
            fontFamily="var(--tt-font-mono, ui-monospace, Menlo, monospace)"
            fontSize="10px"
            fontWeight={600}
            letterSpacing="0.08em"
            textTransform="uppercase"
            color="var(--tt-muted, #9a9aa6)"
          >
            Thingtime · your space, your rules
          </Text>
          <Box
            as="h1"
            fontFamily="heading"
            fontSize="2xl"
            fontWeight={700}
            letterSpacing="-0.02em"
            background={RAINBOW_TEXT}
            backgroundSize="calc(100px + 200%)"
            sx={{
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              animation: 'var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)'
            }}
          >
            Settings ⚙️
          </Box>
        </Box>

        {/* 1 · account — the switcher lists every signed-in account and hosts
            the add / register-new inline forms */}
        <SettingsSection eyebrow="Account">
          <AccountSwitcher />
          {user && (
            <Flex columnGap={2} rowGap={2} flexWrap="wrap">
              <Button size="xs" variant="outline" onClick={() => navigate('/profile')}>
                Profile 👤
              </Button>
              <Button size="xs" variant="outline" isLoading={loggingOut} onClick={handleLogout}>
                Log out 🗝️
              </Button>
              {!user.emailVerified && (
                <Button size="xs" variant="outline" onClick={handleResendVerification}>
                  Resend verification 📬
                </Button>
              )}
            </Flex>
          )}
        </SettingsSection>

        {/* 2 · profile (auth only) */}
        {user && (
          <SettingsSection eyebrow="Profile" description="How you show up on your profile page and in the feed.">
            <ProfileSettingsForm key={user.id} user={user} />
          </SettingsSection>
        )}

        {/* 3 · feed algorithms (auth only) */}
        {user && (
          <SettingsSection
            eyebrow="Feed algorithms"
            description="Algorithms learn from what you linger on in the feed — the active one trains as you scroll. Keep a few for different moods, branch the ones you like, and switch anytime."
          >
            <AlgorithmManager key={user.id} />
          </SettingsSection>
        )}

        {/* 4 · appearance — mirrors UserSettingsModal's theming section */}
        <SettingsSection eyebrow="Appearance">
          <Flex flexDirection="column">
            <SettingRow
              label="Theme"
              hint={appliedThemeShareId ? `Custom theme applied: ${theme.name}` : 'Pick a base look'}
            >
              <Flex columnGap={1} flexWrap="wrap" justifyContent="flex-end">
                {builtinThemes.map((builtin) => {
                  const active = preset === builtin.name && !hasOverrides && !appliedThemeShareId;
                  return (
                    <Button
                      key={builtin.name}
                      size="xs"
                      variant={active ? 'solid' : 'ghost'}
                      onClick={() => handlePreset(builtin.name)}
                    >
                      {builtin.name}
                    </Button>
                  );
                })}
              </Flex>
            </SettingRow>

            <SettingRow label="Accent colour" hint="CTAs and highlights">
              <ColorControl value={theme.colors.accent} onChange={(v) => setColor('accent', v)} />
            </SettingRow>

            <SettingRow label="Shadows" hint="Soft blur or hard offset">
              <Flex columnGap={1}>
                <Button
                  size="xs"
                  variant={theme.general.shadow === 'soft' ? 'solid' : 'ghost'}
                  onClick={() => setGeneral('shadow', 'soft')}
                >
                  Soft
                </Button>
                <Button
                  size="xs"
                  variant={theme.general.shadow === 'hard' ? 'solid' : 'ghost'}
                  onClick={() => setGeneral('shadow', 'hard')}
                >
                  Hard 🧱
                </Button>
              </Flex>
            </SettingRow>

            <SettingRow label="Motion" hint="Rainbow + decorative animation">
              <Switch isChecked={theme.general.motion} onChange={(e) => setGeneral('motion', e.target.checked)}></Switch>
            </SettingRow>

            <SettingRow label="Theme Studio" hint="Full editor: colours, fonts, save + share themes">
              <Button size="xs" variant="outline" onClick={() => navigate('/themes')}>
                Open 🎨
              </Button>
            </SettingRow>

            {hasOverrides && (
              <SettingRow label="Customisations" hint="Back to the selected preset">
                <Button size="xs" variant="outline" onClick={() => resetOverrides()}>
                  Reset
                </Button>
              </SettingRow>
            )}
          </Flex>
        </SettingsSection>

        {/* 5 · drawer — mirrors UserSettingsModal's drawer section */}
        <SettingsSection eyebrow="Drawer">
          <Flex flexDirection="column">
            <SettingRow label="Opens from" hint="Which edge the drawer slides out from">
              <Flex columnGap={1}>
                <Button size="xs" variant={direction === 'left' ? 'solid' : 'ghost'} onClick={() => setDirection('left')}>
                  Left
                </Button>
                <Button size="xs" variant={direction === 'right' ? 'solid' : 'ghost'} onClick={() => setDirection('right')}>
                  Right
                </Button>
              </Flex>
            </SettingRow>

            <SettingRow label="Search closes drawer" hint="Close the drawer when opening search">
              <Switch isChecked={searchClosesDrawer} onChange={(e) => setSearchClosesDrawer(e.target.checked)}></Switch>
            </SettingRow>

            <SettingRow label="Top-level items" hint="How many items show before “More”">
              <Flex alignItems="center" columnGap={2}>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => setTopLevelLimit(topLevelLimit - 1)}
                  isDisabled={topLevelLimit <= 1}
                >
                  −
                </Button>
                <Text width="20px" textAlign="center" fontSize="sm">
                  {topLevelLimit}
                </Text>
                <Button size="xs" variant="outline" onClick={() => setTopLevelLimit(topLevelLimit + 1)}>
                  +
                </Button>
              </Flex>
            </SettingRow>

            <SettingRow label="Menu ordering" hint="Restore the default drag-reordered menu layout">
              <Button size="xs" variant="outline" onClick={handleResetOrdering}>
                Reset
              </Button>
            </SettingRow>
          </Flex>
        </SettingsSection>
      </Flex>
    </Flex>
  );
};
