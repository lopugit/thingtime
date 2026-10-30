import { buildLogoSvg, LOGO_DEFAULT_COLOURS, LOGO_FULL_MATRIX, LOGO_ICON_MATRIX } from '../../../components/Branding/logoMatrix';
import { RAINBOW_PALETTE, THINGTIME_THEME } from '../../../theme/tokens';

// The same source as /branding and its downloadable assets. Never draw a
// substitute mark or typeset the wordmark using a normal text font.
export const socialCardLogoSvg = (icon = false): string => buildLogoSvg({
	matrix: icon ? LOGO_ICON_MATRIX : LOGO_FULL_MATRIX,
	colourMap: LOGO_DEFAULT_COLOURS
}).svg;

export const socialCardLogo = (x: number, y: number, width: number, height: number, icon = false): string =>
	`<image data-brand-asset="${icon ? 'icon' : 'wordmark'}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMinYMid meet" href="data:image/svg+xml;base64,${Buffer.from(socialCardLogoSvg(icon)).toString('base64')}"/>`;

export const SOCIAL_CARD_BRAND = {
	ink: THINGTIME_THEME.colors.ink,
	text: THINGTIME_THEME.colors.text,
	chrome: THINGTIME_THEME.colors.darkBg,
	pink: THINGTIME_THEME.colors.accent,
	purple: LOGO_DEFAULT_COLOURS[6],
	yellow: LOGO_DEFAULT_COLOURS[9],
	green: LOGO_DEFAULT_COLOURS[7],
	blue: LOGO_DEFAULT_COLOURS[3],
	rainbow: RAINBOW_PALETTE,
	heading: THINGTIME_THEME.fonts.heading,
	body: THINGTIME_THEME.fonts.body,
	mono: THINGTIME_THEME.fonts.mono
} as const;
