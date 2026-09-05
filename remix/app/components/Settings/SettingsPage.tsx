import React from 'react';
import { Badge, Box, Button, Flex, Input, Progress, Switch, Text, Textarea } from '@chakra-ui/react';
import { useNavigate } from 'react-router';

import { AlgorithmManager } from './AlgorithmManager';
import { LinkedDeployments } from './LinkedDeployments';
import { NotificationSettingsSection } from './NotificationSettings';
import { SubspacePreferencesSection } from '~/components/Subspaces/SubspacePreferencesSection';
import { PasskeysManager } from './PasskeysManager';
import { TokenMinter } from './TokenMinter';
import { RainbowButton, SettingRow, SettingsSection } from './SettingsSection';
import { AccountSwitcher } from '~/components/Account/AccountSwitcher';
import { AdminPanel } from '~/components/Admin/AdminPanel';
import { ConnectedAppsSection } from '~/components/Apps/ConnectedAppsSection';
import { useLopu } from '~/components/Lopu/useLopu';
import { DRAWER_TOP_LEVEL_DEFAULT_LIMIT, useDrawer } from '~/components/Nav/Drawer/useDrawer';
import { ColorControl, ThingsBadgePaddingControl } from '~/components/ThemeSettings/controls';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import type { CurrentUser } from '~/hooks/useCurrentUser';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { useApi } from '~/hooks/useApi';
import { useTtTheme } from '~/hooks/useTtTheme';
import { RAINBOW_TEXT } from '~/theme/rainbow';
import { ProfileMediaField, type ProfileMediaFieldHandle } from '~/components/Profile/ProfileMediaField';
import {
	profileMediaUpdateFields,
	profileSaveErrorMessage,
	preservedProfileMediaSnapshot,
	type ProfileMediaFieldSnapshot
} from '~/components/Profile/profileMediaCore';
import { LOGIN_TO_CLAIM_LABEL, getUserMention } from '~/utils/userIdentity';

// The dedicated /settings page: account, profile, feed algorithms, appearance
// and drawer preferences in stacked section cards. Fully usable logged out
// (account shows login CTAs; profile + algorithms hide; appearance + drawer
// are local-first and always work).

const BIO_MAX = 500;

const formatStorageBytes = (bytes: number): string => {
	if (bytes < 1024) return `${bytes} B`;
	const units = ['KiB', 'MiB', 'GiB', 'TiB'];
	let value = bytes;
	let unit = -1;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[unit]}`;
};

const AccountStorageSummary = (props: { user: NonNullable<CurrentUser> }) => {
	const { storage } = props.user;
	const percent =
		storage.status === 'unavailable' || storage.usedBytes === null || storage.allowanceBytes === null || storage.allowanceBytes <= 0
			? null
			: Math.min(100, (storage.usedBytes / storage.allowanceBytes) * 100);
	const statusLabel = storage.status === 'ready' ? 'Exact' : storage.status === 'reconciling' ? 'Reconciling' : 'Unavailable';
	const statusScheme = storage.status === 'ready' ? 'green' : storage.status === 'reconciling' ? 'orange' : 'gray';

	return (
		<Box
			width="100%"
			border="1px solid var(--tt-border, #ececef)"
			borderRadius="var(--tt-radius-md, 12px)"
			padding={3}
			background="var(--tt-surface-alt, #f5f5f7)"
		>
			<Flex alignItems="center" columnGap={2} rowGap={1} flexWrap="wrap">
				<Text fontSize="sm" fontWeight={700}>
					Account storage
				</Text>
				<Badge colorScheme={statusScheme} fontSize="9px">
					{statusLabel}
				</Badge>
				<Text marginLeft="auto" fontSize="sm" fontWeight={600}>
					{storage.status === 'unavailable' || storage.usedBytes === null
						? 'Not available yet'
						: `${formatStorageBytes(storage.usedBytes)} / ${
								storage.allowanceBytes === null ? 'Unlimited' : formatStorageBytes(storage.allowanceBytes)
							}${storage.status === 'reconciling' ? ' · provisional' : ''}`}
				</Text>
			</Flex>
			{percent !== null && (
				<Progress value={percent} size="xs" colorScheme={(storage.overageBytes ?? 0) > 0 ? 'red' : 'purple'} borderRadius="full" mt={2} />
			)}
			<Text mt={2} fontSize="11px" color="var(--tt-muted, #777783)" lineHeight="1.45">
				{storage.status === 'reconciling'
					? 'The bytes shown are provisional. Content growth is briefly paused while Thingtime verifies every stored byte.'
					: 'Includes posts, comments, reactions, saves, schemas, themes, algorithms, and app data once.'}
			</Text>
			{storage.status === 'ready' && storage.usedBytes !== null && (
				<Text mt={1} fontSize="10px" color="var(--tt-muted, #9a9aa6)" wordBreak="break-word">
					Exact logical usage: {storage.usedBytes.toLocaleString()} bytes
					{storage.remainingBytes === null ? '' : ` · ${storage.remainingBytes.toLocaleString()} bytes remaining`}
					{(storage.overageBytes ?? 0) > 0 ? ` · ${storage.overageBytes!.toLocaleString()} bytes over allowance` : ''}
				</Text>
			)}
			{storage.status === 'reconciling' && storage.usedBytes !== null && (
				<Text mt={1} fontSize="10px" color="var(--tt-muted, #9a9aa6)" wordBreak="break-word">
					Provisional ledger reading: {storage.usedBytes.toLocaleString()} bytes
					{storage.remainingBytes === null ? '' : ` · approximately ${storage.remainingBytes.toLocaleString()} bytes remaining`}
				</Text>
			)}
		</Box>
	);
};

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
	const [avatarMedia, setAvatarMedia] = React.useState<ProfileMediaFieldSnapshot>(() => preservedProfileMediaSnapshot(user.avatarUrl));
	const [bannerMedia, setBannerMedia] = React.useState<ProfileMediaFieldSnapshot>(() => preservedProfileMediaSnapshot(user.bannerUrl));
  const [birthday, setBirthday] = React.useState(user.birthday || '');
  const [saving, setSaving] = React.useState(false);
	const avatarMediaRef = React.useRef<ProfileMediaFieldHandle | null>(null);
	const bannerMediaRef = React.useRef<ProfileMediaFieldHandle | null>(null);

  const handleSave = async () => {
    if (bio.length > BIO_MAX) {
      lopu({
        title: 'Bio is a little long ✂️',
        description: `Keep it under ${BIO_MAX} characters.`,
        status: 'error'
      });
      return;
    }
		if (avatarMedia.blocking || bannerMedia.blocking) {
			lopu({
				title: 'Profile media is not ready yet',
				description: 'Finish or remove the avatar and banner drafts before saving.',
				status: 'info'
			});
			return;
		}
    setSaving(true);
    try {
			const response = await api.v1.profile.update({
        displayName: displayName.trim() || null,
        bio: bio.trim() || null,
				...profileMediaUpdateFields('avatar', avatarMedia.mutation),
				...profileMediaUpdateFields('banner', bannerMedia.mutation),
        birthday: birthday.trim() || null
      });
			if (!response?.user) throw new Error('invalid profile response');
			avatarMediaRef.current?.commit(response.user.avatarUrl ?? null, response.user.avatarLinkedUrl ?? null);
			bannerMediaRef.current?.commit(response.user.bannerUrl ?? null, response.user.bannerLinkedUrl ?? null);
      lopu({ title: 'Profile saved ✨', status: 'success', duration: 4000 });
		} catch (error: unknown) {
      lopu({
        title: 'Could not save profile 😔',
				description: profileSaveErrorMessage(error),
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

      <Flex flexDirection="column" rowGap={1}>
        <FieldLabel>Birthday 🎂</FieldLabel>
        <Input
          size="sm"
          type="date"
          value={birthday}
          min="1900-01-01"
          max={new Date().toISOString().slice(0, 10)}
          onChange={(e) => setBirthday(e.target.value)}
          {...inputStyles}
        />
        <Text fontSize="11px" color="var(--tt-muted, #9a9aa6)">
          Private — never shown on your profile. Apps you log in to only see it if you approve the
          birthday permission on their consent screen.
        </Text>
      </Flex>

      <Box>
				<RainbowButton size="sm" minHeight="44px" isLoading={saving} isDisabled={avatarMedia.blocking || bannerMedia.blocking} onClick={handleSave}>
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
    topLevelLimitIsUnlimited,
    setTopLevelLimit,
    setTopLevelLimitUnlimited,
    resetOrdering
  } = useDrawer();

	const { theme, preset, overrides, hasOverrides, appliedThemeShareId, builtinThemes, setPreset, setColor, setGeneral, resetOverrides } = useTtTheme();
	const thingsBadgeCustomPadding =
		typeof overrides.general?.thingsBadgeCustomPadding === 'string'
			? overrides.general.thingsBadgeCustomPadding
			: theme.general.thingsBadgeCustomPadding;

  const [loggingOut, setLoggingOut] = React.useState(false);
  const topLevelLimitValue = typeof topLevelLimit === 'number' ? topLevelLimit : DRAWER_TOP_LEVEL_DEFAULT_LIMIT;

  const lowerTopLevelLimit = () => {
    setTopLevelLimit(topLevelLimitIsUnlimited ? DRAWER_TOP_LEVEL_DEFAULT_LIMIT : topLevelLimitValue - 1);
  };

  const raiseTopLevelLimit = () => {
    setTopLevelLimit(topLevelLimitIsUnlimited ? DRAWER_TOP_LEVEL_DEFAULT_LIMIT : topLevelLimitValue + 1);
  };

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
      lopu({ title: `Logged out — switched to ${getUserMention(resp.user)} ✨`, status: 'success', duration: 6000 });
      return;
    }
    lopu({ title: 'Logged out', status: 'success', duration: 6000 });
    navigate('/login');
  };

  // Email 2FA — optimistic per the house rule: first paint comes from the
  // synchronous local cache (last-known value per user), the server state
  // reconciles in the background, and the toggle flips instantly + reverts on
  // failure. Cache key is per-user so the account switcher can't bleed states.
  const twoFactorCacheKey = user ? `tt-two-factor-${user.id}` : null;
	const [twoFactorEnabled, setTwoFactorEnabled] = React.useState<boolean>(() =>
		twoFactorCacheKey ? readLocalCache<boolean>(twoFactorCacheKey) === true : false
  );
  const [twoFactorSaving, setTwoFactorSaving] = React.useState(false);

  React.useEffect(() => {
    if (!user) return;
    const cacheKey = `tt-two-factor-${user.id}`;
    setTwoFactorEnabled(readLocalCache<boolean>(cacheKey) === true);
    let cancelled = false;
    api.v1.auth.twoFactor
      .get()
      .then((resp: any) => {
        if (cancelled || typeof resp?.enabled !== 'boolean') return;
        setTwoFactorEnabled(resp.enabled);
        writeLocalCache(cacheKey, resp.enabled);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const handleTwoFactorToggle = async (enabled: boolean) => {
    if (!user || twoFactorSaving) return;
    const previous = twoFactorEnabled;
    setTwoFactorEnabled(enabled); // optimistic — revert on failure
    setTwoFactorSaving(true);
    try {
      const resp = await api.v1.auth.twoFactor.set({ enabled });
      if (resp?.ok) {
        setTwoFactorEnabled(!!resp.enabled);
        if (twoFactorCacheKey) writeLocalCache(twoFactorCacheKey, !!resp.enabled);
        lopu({
          title: resp.enabled ? 'Email 2FA is on 🔐' : 'Email 2FA is off',
					description: resp.enabled ? 'Logins now need a 6-digit code from your inbox.' : 'Logins go back to password only.',
          status: 'success',
          duration: 6000
        });
      } else {
        setTwoFactorEnabled(previous);
        lopu({ title: 'Could not update 2FA', description: resp?.error, status: 'error', duration: 6000 });
      }
    } catch (err: any) {
      setTwoFactorEnabled(previous);
      lopu({
        title: 'Could not update 2FA',
        description: err?.error || 'Please try again in a moment.',
        status: 'error',
        duration: 6000
      });
    } finally {
      setTwoFactorSaving(false);
    }
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
						<Flex flexDirection="column" rowGap={3} width="100%">
							<AccountStorageSummary user={user} />
            <Flex columnGap={2} rowGap={2} flexWrap="wrap">
              {user.temporary ? (
                <Button size="xs" variant="outline" onClick={() => navigate('/login')}>
                  {LOGIN_TO_CLAIM_LABEL}
                </Button>
              ) : (
                <>
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
                </>
              )}
            </Flex>
						</Flex>
          )}
        </SettingsSection>

        {/* security (auth only) — email 2FA + the reset flow's home */}
        {user && !user.temporary && (
          <SettingsSection eyebrow="Security" description="Extra checks between a password and a session.">
            <Flex flexDirection="column">
              <SettingRow
                label="Email 2FA 🔐"
								hint={user.emailVerified ? 'Logins also need a 6-digit code emailed to you' : 'Verify your email first — codes are delivered there'}
              >
                <Switch
                  isChecked={twoFactorEnabled}
                  isDisabled={!user.emailVerified || twoFactorSaving}
                  onChange={(e) => handleTwoFactorToggle(e.target.checked)}
                ></Switch>
              </SettingRow>
              <SettingRow label="Password" hint="Rotate it via an emailed single-use link">
                <Button size="xs" variant="outline" onClick={() => navigate('/reset-password')}>
                  Reset 🔑
                </Button>
              </SettingRow>
              <Box paddingY={2}>
                <PasskeysManager />
              </Box>
            </Flex>
          </SettingsSection>
        )}

        {/* connected apps — grants + everything each app stores */}
        {user && <ConnectedAppsSection userId={user.id} />}

        {/* token minter (auth only) — scoped API tokens for AIs & scripts */}
        {user && (
          <SettingsSection
            eyebrow="Token minter 🪙"
            description="Mint scoped API tokens to hand to an AI, agent, or script — it can push new things, update things, and scan your things, without your password. Expire them by time (1ms to never) or by number of uses, optionally sandbox one to only the things it creates, and revoke anytime."
          >
            <TokenMinter key={user.id} userId={user.id} />
          </SettingsSection>
        )}

        {/* notifications (auth only) — per-type switches for the bell */}
        {user && <NotificationSettingsSection user={user} />}

        {/* subspaces — vote pills + default sort (per-browser preferences) */}
        <SubspacePreferencesSection />

        {/* admin (admins only) */}
        {user?.isAdmin && (
          <SettingsSection eyebrow="Admin" description="Global controls — AI conflict resolution, rate limits, and admin access.">
            <AdminPanel />
          </SettingsSection>
        )}

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

        {/* 3b · linked deployments (auth only) */}
        {user && (
          <SettingsSection
            eyebrow="Linked deployments"
            description="Link your account on another Thingtime deployment (production, develop, a fork…) and keep your data in sync — push, pull, two-way, or per-path rules."
          >
            <LinkedDeployments key={user.id} userId={user.id} />
          </SettingsSection>
        )}

        {/* 4 · appearance — mirrors UserSettingsModal's theming section */}
        <SettingsSection eyebrow="Appearance">
          <Flex flexDirection="column">
						<SettingRow label="Theme" hint={appliedThemeShareId ? `Custom theme applied: ${theme.name}` : 'Pick a base look'}>
              <Flex columnGap={1} flexWrap="wrap" justifyContent="flex-end">
                {builtinThemes.map((builtin) => {
                  const active = preset === builtin.name && !hasOverrides && !appliedThemeShareId;
                  return (
										<Button key={builtin.name} size="xs" variant={active ? 'solid' : 'ghost'} onClick={() => handlePreset(builtin.name)}>
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
								<Button size="xs" variant={theme.general.shadow === 'soft' ? 'solid' : 'ghost'} onClick={() => setGeneral('shadow', 'soft')}>
                  Soft
                </Button>
								<Button size="xs" variant={theme.general.shadow === 'hard' ? 'solid' : 'ghost'} onClick={() => setGeneral('shadow', 'hard')}>
                  Hard 🧱
                </Button>
              </Flex>
            </SettingRow>

			<SettingRow label="Things badge padding" hint="View / Show / Arrange / Kind controls">
				<ThingsBadgePaddingControl
					value={theme.general.thingsBadgePadding}
					customValue={thingsBadgeCustomPadding}
					onValueChange={(value) => setGeneral('thingsBadgePadding', value)}
					onCustomValueChange={(value) => setGeneral('thingsBadgeCustomPadding', value)}
				/>
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
              <Flex alignItems="center" columnGap={2} rowGap={2} flexWrap="wrap" justifyContent="flex-end">
								<Button size="xs" variant="outline" onClick={lowerTopLevelLimit} isDisabled={!topLevelLimitIsUnlimited && topLevelLimitValue <= 1}>
                  −
                </Button>
                <Text minWidth="74px" textAlign="center" fontSize="sm">
                  {topLevelLimitIsUnlimited ? 'Unlimited' : topLevelLimit}
                </Text>
                <Button size="xs" variant="outline" onClick={raiseTopLevelLimit}>
                  +
                </Button>
                <Button size="xs" variant={topLevelLimitIsUnlimited ? 'solid' : 'outline'} onClick={setTopLevelLimitUnlimited}>
                  Unlimited
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
