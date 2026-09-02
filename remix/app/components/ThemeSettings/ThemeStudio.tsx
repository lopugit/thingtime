import { Box, Flex, Input, Switch, Text } from '@chakra-ui/react';
import React from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router';

import { useLopu } from '~/components/Lopu/useLopu';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useTtTheme } from '~/hooks/useTtTheme';
import { RAINBOW } from '~/theme/rainbow';

import {
	ColorControl,
	CustomisePanel,
	CustomiseToggle,
	isHexColor,
	ThingsBadgePaddingControl
} from './controls';
import { CURATED_FONTS, themeToCssVars, TtTheme } from '~/theme/tokens';

const MONO = 'var(--tt-font-mono, ui-monospace, Menlo, monospace)';

const sectionHeaderStyle = {
	fontSize: '11px',
	fontWeight: 700,
	letterSpacing: '0.12em',
	textTransform: 'uppercase' as const,
	color: 'var(--tt-muted, #9a9aa6)',
	fontFamily: MONO
};

/* Small live preview card rendered with a theme's own token values. */
export const ThemePreviewCard = React.memo(({ theme, active }: { theme: TtTheme; active?: boolean }) => {
	const vars = React.useMemo(() => themeToCssVars(theme), [theme]);
	return (
		<Box
			border={active ? '2px solid var(--tt-accent, hotpink)' : '1px solid var(--tt-border, #ececef)'}
			borderRadius={vars['--tt-radius-md']}
			overflow="hidden"
			background={vars['--tt-page-bg']}
			boxShadow={vars['--tt-shadow-card']}
			width="100%"
		>
			<Flex direction="column" gap="6px" padding="12px">
				<Flex gap="4px">
					{theme.colors.rainbow.map((color, i) => (
						<Box key={i} width="14px" height="14px" background={color} borderRadius={vars['--tt-radius-xs']} />
					))}
				</Flex>
				<Text fontWeight={700} fontSize="sm" color={theme.colors.ink} fontFamily={vars['--tt-font-heading']}>
					Aa Thingtime
				</Text>
				<Flex gap="6px" alignItems="center">
					<Box
						background={theme.colors.ink}
						color={theme.colors.card}
						fontSize="10px"
						fontWeight={600}
						padding="3px 8px"
						borderRadius={vars['--tt-radius-sm']}
					>
						Button
					</Box>
					<Box
						background={theme.colors.accent}
						color={theme.colors.accentContrast}
						fontSize="10px"
						fontWeight={700}
						padding="3px 8px"
						borderRadius={vars['--tt-radius-sm']}
						boxShadow={theme.general.shadow === 'hard' ? `2px 2px 0 ${theme.colors.ink}` : 'none'}
					>
						CTA
					</Box>
					<Box flex="1" height="6px" background={theme.colors.surfaceAlt} borderRadius="999px" />
				</Flex>
			</Flex>
		</Box>
	);
});
ThemePreviewCard.displayName = 'ThemePreviewCard';

const Row = ({ label, hint, customKey, children }: any) => {
	// each option can expand its customise panel (custom classes/CSS) below
	const [customOpen, setCustomOpen] = React.useState(false);

	return (
		<Box>
			<Flex alignItems="center" justifyContent="space-between" gap="16px" paddingY="10px" flexWrap="wrap">
				<Box minWidth="140px">
					<Flex alignItems="center" gap="6px">
						<Text fontSize="sm" fontWeight={600} color="var(--tt-ink, #16161a)">
							{label}
						</Text>
						{customKey ? <CustomiseToggle open={customOpen} onToggle={() => setCustomOpen((o) => !o)} /> : null}
					</Flex>
					{hint ? (
						<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">
							{hint}
						</Text>
					) : null}
				</Box>
				<Flex alignItems="center" gap="8px" flexWrap="wrap">
					{children}
				</Flex>
			</Flex>
			{customKey && customOpen ? <CustomisePanel targetKey={customKey} /> : null}
		</Box>
	);
};

const FontSelect = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
	<Box
		as="select"
		value={value}
		onChange={(e: any) => onChange(e.target.value)}
		background="var(--tt-surface-alt, #f5f5f7)"
		border="1px solid var(--tt-border, #ececef)"
		borderRadius="var(--tt-radius-sm, 9px)"
		fontSize="13px"
		padding="6px 10px"
		cursor="pointer"
	>
		{CURATED_FONTS.map((font) => (
			<option key={font.label} value={font.css}>
				{font.label}
			</option>
		))}
	</Box>
);

const StepControl = ({ value, onChange, min, max, step = 1, format = (v: number) => String(v) }: any) => (
	<Flex alignItems="center" gap="6px">
		<Box
			as="button"
			onClick={() => onChange(Math.max(min, Math.round((value - step) * 100) / 100))}
			width="26px"
			height="26px"
			borderRadius="var(--tt-radius-xs, 7px)"
			border="1px solid var(--tt-border, #ececef)"
			background="var(--tt-card, #fff)"
			color="var(--tt-text, #5a5a66)"
			cursor="pointer"
		>
			−
		</Box>
		<Text fontSize="13px" fontFamily={MONO} minWidth="44px" textAlign="center">
			{format(value)}
		</Text>
		<Box
			as="button"
			onClick={() => onChange(Math.min(max, Math.round((value + step) * 100) / 100))}
			width="26px"
			height="26px"
			borderRadius="var(--tt-radius-xs, 7px)"
			border="1px solid var(--tt-border, #ececef)"
			background="var(--tt-card, #fff)"
			color="var(--tt-text, #5a5a66)"
			cursor="pointer"
		>
			＋
		</Box>
	</Flex>
);

const PillButton = ({ active, onClick, children, ...props }: any) => (
	<Box
		as="button"
		onClick={onClick}
		padding="7px 13px"
		borderRadius="var(--tt-radius-sm, 9px)"
		border={active ? '1px solid var(--tt-border, #ececef)' : '1px solid transparent'}
		background={active ? 'var(--tt-card, #fff)' : 'transparent'}
		color={active ? 'var(--tt-ink, #16161a)' : 'var(--tt-muted, #9a9aa6)'}
		boxShadow={active ? 'var(--tt-shadow-card, 0 1px 2px rgba(0,0,0,0.05))' : 'none'}
		fontSize="13px"
		fontWeight={600}
		cursor="pointer"
		transition="all 140ms ease"
		{...props}
	>
		{children}
	</Box>
);

const ActionButton = ({ onClick, children, tone = 'default', ...props }: any) => (
	<Box
		as="button"
		onClick={onClick}
		padding="7px 12px"
		borderRadius="var(--tt-radius-sm, 9px)"
		border="1px solid var(--tt-border, #ececef)"
		background="var(--tt-card, #fff)"
		color={tone === 'danger' ? 'var(--tt-danger, #d6455a)' : 'var(--tt-text, #5a5a66)'}
		fontSize="13px"
		fontWeight={600}
		cursor="pointer"
		transition="all 140ms ease"
		_hover={{ background: 'var(--tt-surface-alt, #f5f5f7)' }}
		{...props}
	>
		{children}
	</Box>
);

const COLOR_FIELDS: { key: string; label: string; hint?: string }[] = [
	{ key: 'accent', label: 'Accent', hint: 'CTAs + highlights' },
	{ key: 'accentTint', label: 'Accent tint' },
	{ key: 'ink', label: 'Ink', hint: 'headings + borders' },
	{ key: 'text', label: 'Body text' },
	{ key: 'muted', label: 'Muted text' },
	{ key: 'pageBg', label: 'Page background' },
	{ key: 'card', label: 'Cards' },
	{ key: 'surface', label: 'Surface' },
	{ key: 'surfaceAlt', label: 'Surface alt' },
	{ key: 'border', label: 'Borders' },
	{ key: 'link', label: 'Links' }
];

/**
 * The Theme Studio (/themes): live theme editing, presets, saved themes via
 * the API, shareable links (?apply=<id>), and cross-device active theme.
 */
export const ThemeStudio = () => {
	const lopu = useLopu();
	const api = useApi();
	const user = useCurrentUser();
	const navigate = useNavigate();
	const [searchParams, setSearchParams] = useSearchParams();
	const {
		theme,
		preset,
		overrides,
		hasOverrides,
		appliedThemeName,
		appliedThemeShareId,
		builtinThemes,
		setPreset,
		setColor,
		setRainbowStop,
		setFont,
		setGeneral,
		setWindows,
		resetOverrides,
		applyThemeDoc
	} = useTtTheme();

	const [myThemes, setMyThemes] = React.useState<any[]>([]);
	const [saveName, setSaveName] = React.useState('');
	const [savePublic, setSavePublic] = React.useState(true);
	const [saving, setSaving] = React.useState(false);

	const refreshMyThemes = React.useCallback(async () => {
		if (!user) return;
		try {
			const res = await api.v1.themes.list();
			setMyThemes(res?.themes || []);
		} catch (error) {
			// listing is best-effort; errors surface on explicit actions
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [user?.id]);

	React.useEffect(() => {
		refreshMyThemes();
	}, [refreshMyThemes]);

	// Apply a shared theme from ?apply=<shareId> deep links.
	const applyParam = searchParams.get('apply');
	React.useEffect(() => {
		if (!applyParam) return;
		let cancelled = false;
		(async () => {
			try {
				const res = await api.v1.themes.getShared({ id: applyParam });
				if (cancelled || !res?.theme) return;
				applyThemeDoc(res.theme.theme, { shareId: res.theme.id });
				lopu({ title: `Theme "${res.theme.name}" applied 🎨`, status: 'success', duration: 6000 });
			} catch (error) {
				if (!cancelled) {
					lopu({ title: 'Theme not found 🌧️', description: 'That share link doesn’t resolve to a public theme.', status: 'error' });
				}
			}
			if (!cancelled) {
				searchParams.delete('apply');
				setSearchParams(searchParams, { replace: true });
			}
		})();
		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [applyParam]);

	const applyPreset = (name: string) => {
		setPreset(name);
		if (user) {
			api.v1.themes.setActive({ themeId: null }).catch(() => {});
		}
	};

	const applySaved = (saved: any) => {
		applyThemeDoc(saved.theme, { shareId: saved.id });
		if (user) {
			api.v1.themes.setActive({ themeId: saved.id }).catch(() => {});
		}
		lopu({ title: `Theme "${saved.name}" applied 🎨`, status: 'success', duration: 5000 });
	};

	const shareSaved = async (saved: any) => {
		const url = `${window.location.origin}/themes?apply=${saved.id}`;
		try {
			await navigator.clipboard.writeText(url);
			lopu({ title: 'Share link copied 🔗', description: 'Anyone with the link can apply this theme.', status: 'success', duration: 6000 });
		} catch (error) {
			lopu({ title: 'Share link', description: url, status: 'info' });
		}
	};

	const deleteSaved = async (saved: any) => {
		try {
			await api.v1.themes.remove({ id: saved.id });
			lopu({ title: `Deleted "${saved.name}" 🗑️`, status: 'success', duration: 5000 });
			refreshMyThemes();
		} catch (error: any) {
			lopu({ title: 'Could not delete theme 🌧️', description: error?.error, status: 'error' });
		}
	};

	const saveCurrent = async () => {
		const name = saveName.trim() || appliedThemeName || `${theme.name} remix`;
		if (!user) {
			lopu({
				title: 'Log in to save themes ✨',
				description: 'Your theme keeps working on this device — log in to save and share it.',
				status: 'info',
				link: { label: 'Log in →', href: '/login' }
			});
			return;
		}
		setSaving(true);
		try {
			// Re-saving the currently applied saved theme (same or blank name)
			// updates it in place instead of minting a duplicate document.
			const updatingApplied =
				appliedThemeShareId && (!saveName.trim() || saveName.trim() === appliedThemeName);
			const res = await api.v1.themes.save({
				id: updatingApplied ? appliedThemeShareId : undefined,
				name,
				theme: { name, colors: theme.colors, fonts: theme.fonts, general: theme.general, windows: theme.windows },
				visibility: savePublic ? 'public' : 'private'
			});
			lopu({ title: `Theme "${name}" saved 🎨`, description: savePublic ? 'It’s shareable — copy the link from My themes.' : 'Saved privately.', status: 'success' });
			setSaveName('');
			refreshMyThemes();
			if (res?.theme?.id) {
				api.v1.themes.setActive({ themeId: res.theme.id }).catch(() => {});
			}
		} catch (error: any) {
			lopu({ title: 'Could not save theme 🌧️', description: error?.error, status: 'error' });
		} finally {
			setSaving(false);
		}
	};

	const g = theme.general;
	const thingsBadgeCustomPadding =
		typeof overrides.general?.thingsBadgeCustomPadding === 'string'
			? overrides.general.thingsBadgeCustomPadding
			: g.thingsBadgeCustomPadding;

	return (
		<Flex direction="column" alignItems="center" width="100%" paddingX="20px" paddingBottom={40}>
			<Box width="100%" maxWidth="760px" paddingTop={24}>
				<Text as="h1" fontSize="3xl" fontWeight={700} letterSpacing="-0.02em" color="var(--tt-ink, #16161a)">
					Themes 🎨
				</Text>
				<Text marginTop="6px" fontSize="md" color="var(--tt-text, #5a5a66)">
					Make Thingtime yours — tweak colours, fonts, and the general feel. Save your look as a theme and share it
					with a link — or browse everyone&rsquo;s public looks in the{' '}
					<Text as={RouterLink} to="/themes/gallery" textDecoration="underline" _hover={{ color: 'var(--tt-ink, #16161a)' }}>
						theme gallery ✨
					</Text>
					.
				</Text>

				{/* Presets */}
				<Text {...sectionHeaderStyle} marginTop={10} marginBottom={3}>
					Presets
				</Text>
				<Flex gap="12px" flexWrap="wrap">
					{builtinThemes.map((builtin) => {
						const active = preset === builtin.name && !hasOverrides && !appliedThemeShareId;
						return (
							<Box
								key={builtin.name}
								as="button"
								onClick={() => applyPreset(builtin.name)}
								textAlign="left"
								width="168px"
								cursor="pointer"
							>
								<ThemePreviewCard theme={builtin} active={active} />
								<Text marginTop="6px" fontSize="13px" fontWeight={active ? 700 : 600} color={active ? 'var(--tt-ink, #16161a)' : 'var(--tt-muted, #9a9aa6)'}>
									{builtin.name}
									{active ? ' ✓' : ''}
								</Text>
							</Box>
						);
					})}
				</Flex>

				{/* Colours */}
				<Text {...sectionHeaderStyle} marginTop={12} marginBottom={2}>
					Colours
				</Text>
				<Box borderTop="1px solid var(--tt-border-light, #f0f0f2)">
					{COLOR_FIELDS.map((field) => (
						<Row key={field.key} label={field.label} hint={field.hint} customKey={`color.${field.key}`}>
							<ColorControl
								value={(theme.colors as any)[field.key]}
								onChange={(v) => setColor(field.key, v)}
							/>
						</Row>
					))}
					<Row label="Rainbow" hint="the five brand stops" customKey="color.rainbow">
						<Flex gap="6px">
							{theme.colors.rainbow.map((stop, index) => (
								<Box key={index} position="relative" width="28px" height="28px" borderRadius="var(--tt-radius-xs, 7px)" overflow="hidden" border="1px solid var(--tt-border, #ececef)">
									<Box position="absolute" inset={0} background={stop} />
									<Input
										type="color"
										value={isHexColor(stop) ? stop : '#888888'}
										onChange={(e) => setRainbowStop(index, e.target.value)}
										position="absolute"
										inset={0}
										opacity={0}
										width="100%"
										height="100%"
										padding={0}
										cursor="pointer"
									/>
								</Box>
							))}
						</Flex>
						<Box borderRadius="var(--tt-radius-xs, 7px)" width="80px" height="16px" background={RAINBOW} />
					</Row>
				</Box>

				{/* Fonts */}
				<Text {...sectionHeaderStyle} marginTop={10} marginBottom={2}>
					Fonts
				</Text>
				<Box borderTop="1px solid var(--tt-border-light, #f0f0f2)">
					<Row label="Headings" hint="Space Grotesk by default" customKey="font.heading">
						<FontSelect value={theme.fonts.heading} onChange={(v) => setFont('heading', v)} />
					</Row>
					<Row label="Body" hint="Hanken Grotesk by default" customKey="font.body">
						<FontSelect value={theme.fonts.body} onChange={(v) => setFont('body', v)} />
					</Row>
					<Row label="Code" hint="JetBrains Mono by default" customKey="font.mono">
						<FontSelect value={theme.fonts.mono} onChange={(v) => setFont('mono', v)} />
					</Row>
					<Row label="Landing display" hint="the big landing headlines" customKey="font.display">
						<FontSelect value={theme.fonts.display} onChange={(v) => setFont('display', v)} />
					</Row>
				</Box>

				{/* General */}
				<Text {...sectionHeaderStyle} marginTop={10} marginBottom={2}>
					General
				</Text>
				<Box borderTop="1px solid var(--tt-border-light, #f0f0f2)">
					<Row label="Corner radius" hint="0 = sharp and brutal" customKey="general.radius">
						<StepControl
							value={g.radiusScale}
							onChange={(v: number) => setGeneral('radiusScale', v)}
							min={0}
							max={2.5}
							step={0.25}
							format={(v: number) => `${v}×`}
						/>
					</Row>
					<Row label="Border weight" customKey="general.borderWidth">
						<StepControl
							value={g.borderWidth}
							onChange={(v: number) => setGeneral('borderWidth', v)}
							min={1}
							max={4}
							step={1}
							format={(v: number) => `${v}px`}
						/>
					</Row>
					<Row label="Shadows" customKey="general.shadow">
						<Flex background="var(--tt-surface-alt, #f5f5f7)" borderRadius="var(--tt-radius-md, 12px)" padding="4px" gap="4px">
							<PillButton active={g.shadow === 'soft'} onClick={() => setGeneral('shadow', 'soft')}>
								Soft
							</PillButton>
							<PillButton active={g.shadow === 'hard'} onClick={() => setGeneral('shadow', 'hard')}>
								Hard 🧱
							</PillButton>
						</Flex>
					</Row>
					<Row label="Icons" hint="playful emoji or coloured line icons" customKey="general.icons">
						<Flex background="var(--tt-surface-alt, #f5f5f7)" borderRadius="var(--tt-radius-md, 12px)" padding="4px" gap="4px">
							<PillButton active={g.iconStyle !== 'lucide'} onClick={() => setGeneral('iconStyle', 'emoji')}>
								Emoji 🥳
							</PillButton>
							<PillButton active={g.iconStyle === 'lucide'} onClick={() => setGeneral('iconStyle', 'lucide')}>
								Lucide ✦
							</PillButton>
						</Flex>
					</Row>
					<Row label="Things badge padding" hint="View / Show / Arrange / Kind controls">
						<ThingsBadgePaddingControl
							value={g.thingsBadgePadding}
							customValue={thingsBadgeCustomPadding}
							onValueChange={(value) => setGeneral('thingsBadgePadding', value)}
							onCustomValueChange={(value) => setGeneral('thingsBadgeCustomPadding', value)}
						/>
					</Row>
					<Row label="Motion" hint="rainbow animations" customKey="general.motion">
						<Switch isChecked={g.motion} onChange={(e) => setGeneral('motion', e.target.checked)} />
					</Row>
					<Row label="Pet" hint="floating unicorn 🦄" customKey="general.pet">
						<Switch isChecked={g.pet} onChange={(e) => setGeneral('pet', e.target.checked)} />
					</Row>
					<Row label="Animation speed" customKey="general.animSpeed">
						<StepControl
							value={g.animSpeed}
							onChange={(v: number) => setGeneral('animSpeed', v)}
							min={0}
							max={1000}
							step={50}
							format={(v: number) => `${v}ms`}
						/>
					</Row>
					<Row label="Reset" hint="back to the preset's defaults (clears custom CSS too)">
						<ActionButton onClick={() => resetOverrides()}>Reset customisations</ActionButton>
					</Row>
				</Box>

				{/* Window buttons (editor traffic lights) */}
				<Text {...sectionHeaderStyle} marginTop={10} marginBottom={2}>
					Window buttons
				</Text>
				<Box borderTop="1px solid var(--tt-border-light, #f0f0f2)">
					{(
						[
							{ key: 'close', label: 'Close', hint: 'the red light', colorKey: 'closeColor', radiusKey: 'closeRadius', fallback: theme.colors.rainbow[0] },
							{ key: 'minimise', label: 'Minimise', hint: 'the amber light', colorKey: 'minimiseColor', radiusKey: 'minimiseRadius', fallback: theme.colors.rainbow[1] },
							{ key: 'maximise', label: 'Expand', hint: 'the green light', colorKey: 'maximiseColor', radiusKey: 'maximiseRadius', fallback: theme.colors.rainbow[2] }
						] as const
					).map((button) => (
						<Row key={button.key} label={button.label} hint={button.hint} customKey={`windows.${button.key}`}>
							<ColorControl
								value={theme.windows[button.colorKey] || button.fallback}
								onChange={(v) => setWindows(button.colorKey, v)}
							/>
							<StepControl
								value={theme.windows[button.radiusKey]}
								onChange={(v: number) => setWindows(button.radiusKey, v)}
								min={0}
								max={12}
								step={0.5}
								format={(v: number) => `${v}px`}
							/>
						</Row>
					))}
				</Box>

				{/* Save + share */}
				<Text {...sectionHeaderStyle} marginTop={10} marginBottom={2}>
					Save as a shareable theme
				</Text>
				<Flex
					border="1px solid var(--tt-border, #ececef)"
					borderRadius="var(--tt-radius-lg, 16px)"
					padding="16px"
					gap="10px"
					alignItems="center"
					flexWrap="wrap"
					background="var(--tt-card, #fff)"
					boxShadow="var(--tt-shadow-card, 0 1px 2px rgba(0,0,0,0.05))"
				>
					<Input
						value={saveName}
						onChange={(e) => setSaveName(e.target.value)}
						placeholder={`e.g. ${theme.name} remix ✨`}
						flex="1"
						minWidth="180px"
						size="sm"
						background="var(--tt-surface-alt, #f5f5f7)"
						border="1px solid var(--tt-border, #ececef)"
						borderRadius="var(--tt-radius-sm, 9px)"
					/>
					<Flex alignItems="center" gap="6px">
						<Switch size="sm" isChecked={savePublic} onChange={(e) => setSavePublic(e.target.checked)} />
						<Text fontSize="13px" color="var(--tt-text, #5a5a66)">
							Shareable
						</Text>
					</Flex>
					<ActionButton onClick={saveCurrent} fontWeight={700} color="var(--tt-ink, #16161a)">
						{saving ? 'Saving…' : 'Save theme 💾'}
					</ActionButton>
				</Flex>

				{/* My themes */}
				<Text {...sectionHeaderStyle} marginTop={10} marginBottom={2}>
					My themes
				</Text>
				{!user ? (
					<Text fontSize="sm" color="var(--tt-muted, #9a9aa6)">
						<Box as="button" onClick={() => navigate('/login')} color="var(--tt-link, #2f8fd6)" cursor="pointer" fontWeight={600}>
							Log in
						</Box>{' '}
						to save themes and share them with a link.
					</Text>
				) : myThemes.length === 0 ? (
					<Text fontSize="sm" color="var(--tt-muted, #9a9aa6)">
						No saved themes yet — customise above and hit Save. 🌈
					</Text>
				) : (
					<Flex direction="column" gap="10px">
						{myThemes.map((saved) => {
							const isActive = appliedThemeShareId === saved.id;
							const isUsersActive = user?.activeThemeId === saved.id;
							return (
								<Flex
									key={saved.id}
									alignItems="center"
									gap="12px"
									border="1px solid var(--tt-border, #ececef)"
									borderRadius="var(--tt-radius-md, 12px)"
									padding="10px 12px"
									flexWrap="wrap"
									background="var(--tt-card, #fff)"
								>
									<Box width="120px" flexShrink={0}>
										<ThemePreviewCard theme={saved.theme} active={isActive} />
									</Box>
									<Box flex="1" minWidth="120px">
										<Text fontWeight={700} fontSize="sm" color="var(--tt-ink, #16161a)">
											{saved.name} {isUsersActive ? '⭐' : ''}
										</Text>
										<Text fontSize="xs" color="var(--tt-muted, #9a9aa6)">
											{saved.visibility === 'public' ? 'shareable 🔗' : 'private 🔒'}
										</Text>
									</Box>
									<Flex gap="6px" flexWrap="wrap">
										<ActionButton onClick={() => applySaved(saved)}>Apply</ActionButton>
										{saved.visibility === 'public' ? <ActionButton onClick={() => shareSaved(saved)}>Share 🔗</ActionButton> : null}
										<ActionButton tone="danger" onClick={() => deleteSaved(saved)}>
											Delete
										</ActionButton>
									</Flex>
								</Flex>
							);
						})}
					</Flex>
				)}
			</Box>
		</Flex>
	);
};
