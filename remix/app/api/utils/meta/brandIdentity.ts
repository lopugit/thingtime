// Thingtime's public brand identity for search engines and social crawlers.
//
// Everything here is public marketing identity — logo file paths committed
// under remix/public/branding (npm run branding-assets) and the official
// off-site profiles — never configuration, credentials or account data.
// Forks: change these constants (and re-run branding-assets) to advertise
// your own organisation; nothing in the vault or Vercel is involved.
//
// Google's brand logo comes from `Organization.logo` in JSON-LD (a square,
// crawlable image of at least 112×112 px). The wordmark rides along as
// `Organization.image` so image search can associate both marks with the site.

export const SITE_NAME = 'Thingtime';

export const ORGANIZATION_LEGAL_NAME = 'Thingtime';

// Square icon — the five-voxel tree — 1024×1024, transparent background.
export const ORGANIZATION_LOGO_PATH = '/branding/generated/icon/thingtime-icon-1024x1024.png';
export const ORGANIZATION_LOGO_WIDTH = 1024;
export const ORGANIZATION_LOGO_HEIGHT = 1024;

// Horizontal wordmark — nine voxel glyphs spelling Thingtime — 1024×190.
export const ORGANIZATION_WORDMARK_PATH = '/branding/generated/logo/thingtime-logo-1024x190.png';
export const ORGANIZATION_WORDMARK_WIDTH = 1024;
export const ORGANIZATION_WORDMARK_HEIGHT = 190;

// Official off-site presences (schema.org `sameAs`). Keep to accounts the
// organisation actually controls: these tell search engines which profiles
// belong to the same entity as the website.
export const ORGANIZATION_SAME_AS: readonly string[] = [
	'https://www.instagram.com/thingtime.ig/',
	'https://thingtime.dashery.com/',
	'https://merch.thingtime.com/'
];

export const organizationId = (origin: string): string => `${origin}/#organization`;

export const organizationLogoId = (origin: string): string => `${origin}/#logo`;

export type OrganizationStructuredData = {
	'@type': 'Organization';
	'@id': string;
	name: string;
	legalName: string;
	url: string;
	logo: { '@type': 'ImageObject'; '@id': string; url: string; contentUrl: string; width: number; height: number; caption: string };
	image: Array<{ '@type': 'ImageObject'; url: string; contentUrl: string; width: number; height: number; caption: string }>;
	sameAs: string[];
};

// The Organization node every public shell publishes. `origin` must already be
// the request's normalised origin (getRequestOrigin) so preview deployments
// describe themselves and never point crawlers at another host's assets.
export const organizationStructuredData = (origin: string): OrganizationStructuredData => ({
	'@type': 'Organization',
	'@id': organizationId(origin),
	name: SITE_NAME,
	legalName: ORGANIZATION_LEGAL_NAME,
	url: `${origin}/`,
	logo: {
		'@type': 'ImageObject',
		'@id': organizationLogoId(origin),
		url: `${origin}${ORGANIZATION_LOGO_PATH}`,
		contentUrl: `${origin}${ORGANIZATION_LOGO_PATH}`,
		width: ORGANIZATION_LOGO_WIDTH,
		height: ORGANIZATION_LOGO_HEIGHT,
		caption: 'Thingtime icon — a leafy five-voxel tree'
	},
	image: [
		{
			'@type': 'ImageObject',
			url: `${origin}${ORGANIZATION_WORDMARK_PATH}`,
			contentUrl: `${origin}${ORGANIZATION_WORDMARK_PATH}`,
			width: ORGANIZATION_WORDMARK_WIDTH,
			height: ORGANIZATION_WORDMARK_HEIGHT,
			caption: 'Thingtime wordmark — nine colourful voxel glyphs'
		}
	],
	sameAs: [...ORGANIZATION_SAME_AS]
});
