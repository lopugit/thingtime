import React from 'react';

import { useLopu } from '~/components/Lopu/useLopu';
import { captionFor, type HookPlatform } from '~/marketing/copy';
import { getFeature } from '~/marketing/features';
import { buildSocialSvg, socialAssetFilename, socialAssetKey, socialCaption, svgToDataUri, type SocialAssetRef } from '~/marketing/social';
import { getSocialFormat, getTrend } from '~/marketing/trends';

import { copyText, downloadPng, downloadSvg } from './marketingDownload';
import { MK } from './marketingTheme';

// One social image: previewed inline as an <img> (the SVG string as a data
// URI, so no network round-trip), downloadable as a PNG at the exact platform
// size or as the SVG itself, plus its platform caption. Deliberately pure
// React with inline styles rather than Chakra: a 120-card grid stays cheap,
// and the component renders under react-dom/server without a provider. All
// colours come from the --mk-* variables the surrounding MarketingShell sets.

// React 19 hoists a <style> with `href` + `precedence` into <head> once, so
// every card can render it and the sheet is still emitted a single time.
const STYLE_HREF = 'tt-marketing-social-image';
const STYLE_CSS = [
	'.mkSocialBtn{transition:transform 140ms ease,filter 140ms ease;}',
	'.mkSocialBtn:hover:not(:disabled){transform:translateY(-1px);filter:brightness(.96);}',
	'.mkSocialBtn:active:not(:disabled){transform:none;filter:brightness(.92);}',
	'.mkSocialBtn:focus-visible{outline:3px solid var(--mk-accent2);outline-offset:2px;}',
	'.mkSocialBtn:disabled{opacity:.6;cursor:progress;}',
	'@media (prefers-reduced-motion: reduce){.mkSocialBtn{transition:none;}.mkSocialBtn:hover:not(:disabled){transform:none;}}'
].join('');

const SocialImageStyles = () => (
	<style href={STYLE_HREF} precedence="default">
		{STYLE_CSS}
	</style>
);

const buttonStyle = (compact?: boolean, primary?: boolean): React.CSSProperties => ({
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'center',
	gap: 6,
	minHeight: 36,
	padding: compact ? '0 10px' : '0 14px',
	border: MK.border,
	borderRadius: MK.radiusSm,
	background: primary ? MK.accent : MK.cardSolid,
	color: primary ? MK.accentContrast : MK.ink,
	fontFamily: MK.font,
	fontWeight: 700,
	fontSize: compact ? 12 : 13,
	lineHeight: 1,
	whiteSpace: 'nowrap',
	cursor: 'pointer'
});

/** A themed <button> for the social suite. Real button element, keyboard reachable, colours from --mk-*. */
export const SocialButton = ({
	primary = false,
	compact = false,
	children,
	style,
	...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean; compact?: boolean }) => (
	<button type="button" className="mkSocialBtn" {...rest} style={{ ...buttonStyle(compact, primary), ...style }}>
		{children}
	</button>
);

const captionStyle: React.CSSProperties = {
	margin: 0,
	whiteSpace: 'pre-wrap',
	overflowWrap: 'anywhere',
	fontFamily: MK.mono,
	fontSize: 12,
	lineHeight: 1.55,
	color: MK.text
};

/** Download + copy actions with Lopu feedback, shared by the card, the caption panel and the page toolbar. */
export const useSocialActions = () => {
	const lopu = useLopu();

	const copy = React.useCallback(
		async (text: string, label = 'Caption') => {
			const ok = await copyText(text);
			if (ok) {
				lopu({ title: `${label} copied`, status: 'success', duration: 4000 });
			} else {
				lopu({
					title: 'Clipboard blocked',
					description: `Your browser refused the copy. Select the ${label.toLowerCase()} text and copy it by hand.`,
					status: 'error'
				});
			}
			return ok;
		},
		[lopu]
	);

	const savePng = React.useCallback(
		async (svg: string, width: number, height: number, filename: string) => {
			try {
				await downloadPng(svg, width, height, filename);
				lopu({ title: 'Downloaded', description: filename, status: 'success', duration: 5000 });
				return true;
			} catch (error) {
				lopu({ title: 'PNG export failed', description: error instanceof Error ? error.message : 'Try the SVG download instead.', status: 'error' });
				return false;
			}
		},
		[lopu]
	);

	const saveSvg = React.useCallback(
		(svg: string, filename: string) => {
			try {
				downloadSvg(svg, filename);
				lopu({ title: 'Downloaded', description: filename, status: 'success', duration: 5000 });
				return true;
			} catch (error) {
				lopu({ title: 'SVG export failed', description: error instanceof Error ? error.message : 'Please try again.', status: 'error' });
				return false;
			}
		},
		[lopu]
	);

	return { copy, savePng, saveSvg };
};

export const socialImageAlt = (asset: SocialAssetRef) =>
	`${getFeature(asset.feature).name} · ${getTrend(asset.trend).name} · ${getSocialFormat(asset.format).name}`;

export const SocialImageCard = ({
	asset,
	showCaption = false,
	compact = false
}: {
	asset: SocialAssetRef;
	showCaption?: boolean;
	compact?: boolean;
}) => {
	const { feature: featureKey, trend: trendKey, format: formatKey } = asset;
	const feature = getFeature(featureKey);
	const trend = getTrend(trendKey);
	const format = getSocialFormat(formatKey);
	// Memoised on the three parts of the asset key: a re-render with the same
	// asset never rebuilds the SVG string or re-encodes the data URI.
	const svg = React.useMemo(() => buildSocialSvg({ feature: featureKey, trend: trendKey, format: formatKey }), [featureKey, trendKey, formatKey]);
	const src = React.useMemo(() => svgToDataUri(svg), [svg]);
	const caption = React.useMemo(() => socialCaption({ feature: featureKey, trend: trendKey, format: formatKey }), [featureKey, trendKey, formatKey]);
	const { copy, savePng, saveSvg } = useSocialActions();
	const [busy, setBusy] = React.useState(false);
	const key = socialAssetKey(asset);
	const alt = `${feature.name} · ${trend.name} · ${format.name}`;

	const onPng = async () => {
		if (busy) return;
		setBusy(true);
		try {
			await savePng(svg, format.width, format.height, socialAssetFilename(asset, 'png'));
		} finally {
			setBusy(false);
		}
	};

	return (
		<article
			data-testid="social-image-card"
			data-asset={key}
			aria-label={alt}
			style={{
				border: MK.border,
				borderRadius: MK.radius,
				overflow: 'hidden',
				boxShadow: MK.shadow,
				background: MK.cardSolid,
				color: MK.ink,
				fontFamily: MK.font,
				minWidth: 0
			}}
		>
			<SocialImageStyles />
			<img
				src={src}
				alt={alt}
				loading="lazy"
				decoding="async"
				width={format.width}
				height={format.height}
				style={{ width: '100%', height: 'auto', display: 'block', background: MK.bg2 }}
			/>
			<div style={{ padding: compact ? 10 : 12, display: 'grid', gap: compact ? 8 : 10 }}>
				<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
					<span style={{ fontWeight: 700, fontSize: compact ? 12 : 13, color: MK.ink, minWidth: 0 }}>
						<span aria-hidden="true">{format.emoji}</span> {format.name}
					</span>
					<span style={{ fontFamily: MK.mono, fontSize: 11, color: MK.muted, whiteSpace: 'nowrap' }}>{format.label}</span>
				</div>
				<div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
					<SocialButton
						primary
						compact={compact}
						onClick={onPng}
						disabled={busy}
						aria-busy={busy}
						aria-label={`PNG — download ${alt} at ${format.label}`}
						data-testid="social-download-png"
					>
						PNG
					</SocialButton>
					<SocialButton
						compact={compact}
						onClick={() => saveSvg(svg, socialAssetFilename(asset, 'svg'))}
						aria-label={`SVG — download ${alt} as vector`}
					>
						SVG
					</SocialButton>
					<SocialButton
						compact={compact}
						onClick={() => copy(caption, 'Caption')}
						aria-label={`Caption — copy the ${format.platform} caption for ${feature.name}`}
					>
						Caption
					</SocialButton>
				</div>
			</div>
			{showCaption && !compact ? (
				<div style={{ borderTop: `1px solid ${MK.hairline}`, background: MK.bg2, padding: 12, display: 'grid', gap: 10 }}>
					<pre style={captionStyle} data-testid="social-caption">
						{caption}
					</pre>
					<div>
						<SocialButton onClick={() => copy(caption, 'Caption')}>Copy caption</SocialButton>
					</div>
				</div>
			) : null}
		</article>
	);
};

export const CAPTION_PLATFORMS: { key: HookPlatform; name: string; emoji: string }[] = [
	{ key: 'tiktok', name: 'TikTok', emoji: '🎬' },
	{ key: 'youtube', name: 'YouTube', emoji: '▶️' },
	{ key: 'instagram', name: 'Instagram', emoji: '📸' },
	{ key: 'x', name: 'X', emoji: '🐦' },
	{ key: 'facebook', name: 'Facebook', emoji: '📘' },
	{ key: 'linkedin', name: 'LinkedIn', emoji: '💼' },
	{ key: 'pinterest', name: 'Pinterest', emoji: '📌' }
];

/** One caption per platform for a feature, seeded `caption:<feature>:<platform>` so the copy is stable across visits. */
export const SocialCaptionPanel = ({ feature }: { feature: string }) => {
	const { copy } = useSocialActions();
	const captions = React.useMemo(() => {
		const entry = getFeature(feature);
		return CAPTION_PLATFORMS.map((platform) => ({ ...platform, caption: captionFor(platform.key, entry, `caption:${feature}:${platform.key}`) }));
	}, [feature]);

	return (
		<section
			data-testid="social-caption-panel"
			aria-label="Captions per platform"
			style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px, 100%), 1fr))', fontFamily: MK.font }}
		>
			<SocialImageStyles />
			{captions.map((entry) => (
				<article
					key={entry.key}
					style={{
						border: MK.border,
						borderRadius: MK.radius,
						background: MK.cardSolid,
						boxShadow: MK.shadow,
						padding: 14,
						display: 'grid',
						gap: 10,
						minWidth: 0
					}}
				>
					<header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
						<h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: MK.ink }}>
							<span aria-hidden="true">{entry.emoji}</span> {entry.name}
						</h3>
						<SocialButton compact onClick={() => copy(entry.caption, `${entry.name} caption`)} aria-label={`Copy the ${entry.name} caption`}>
							Copy
						</SocialButton>
					</header>
					<pre style={captionStyle}>{entry.caption}</pre>
				</article>
			))}
		</section>
	);
};
