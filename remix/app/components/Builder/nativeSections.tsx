import React from 'react';

import type { PageShellWidth } from '../Layout/PageShell';

// The native SECTION registry — how built-in pages become pixel-identical
// block compositions. A registered page declares its shell width and an
// ordered list of standalone section components (each owns its data through
// shared per-page hooks); the route renders that same list, the site doc
// seeds it as native blocks, and the builder edits it — one source of truth,
// zero duplicated markup. Section components are React.lazy so registering a
// page here never drags its code into the root bundle (SiteBlocksHost lives
// in the entry chunk).
//
// To convert a page: (1) move its UI verbatim into
// components/<Page>/<page>Sections.tsx as exported section components with a
// shared module-cached data hook, (2) add the page below, (3) list the
// section keys in the seed table (api/utils/webpages/seed.ts). Everything
// else — route render, view mode, edit mode, unseeded auto-seed — follows.

export type NativeSectionDef = {
	// block `native` key, e.g. 'status-header' (lowercase-dashed)
	key: string;
	title: string;
	Component: React.LazyExoticComponent<React.ComponentType>;
};

export type NativePageDef = {
	// route key, e.g. 'status' — matches the seed table + native auto-seed
	key: string;
	route: string;
	// PageShell column width for the sectioned composition; 'full' = no
	// PageShell — the page's own Shell component (below) provides its chrome
	shellWidth: PageShellWidth | 'full';
	// full-bleed pages export their page-owned wrapper (background, clearance,
	// centering) so doc-driven renders keep the chrome the route has
	Shell?: React.LazyExoticComponent<React.ComponentType<{ children: React.ReactNode }>>;
	sections: NativeSectionDef[];
};

const lazySection = (
	key: string,
	title: string,
	load: () => Promise<{ default: React.ComponentType }>
): NativeSectionDef => ({ key, title, Component: React.lazy(load) });

export const NATIVE_PAGES: NativePageDef[] = [
	{
		key: 'status',
		route: '/status',
		shellWidth: 760,
		sections: [
			lazySection('status-header', 'Status header', () =>
				import('../Status/statusSections').then((m) => ({ default: m.StatusHeaderSection }))
			),
			lazySection('status-state', 'Deployment state', () =>
				import('../Status/statusSections').then((m) => ({ default: m.StatusStateSection }))
			),
			lazySection('status-readout', 'Deployment readout', () =>
				import('../Status/statusSections').then((m) => ({ default: m.StatusReadoutSection }))
			),
			lazySection('status-recheck', 'Re-check control', () =>
				import('../Status/statusSections').then((m) => ({ default: m.StatusRecheckSection }))
			)
		]
	},
	{
		key: 'home',
		route: '/',
		shellWidth: 'full',
		Shell: React.lazy(() => import('../Landing/landingSections').then((m) => ({ default: m.LandingShell }))),
		sections: [
			lazySection('home-hero', 'Nav & hero', () =>
				import('../Landing/landingSections').then((m) => ({ default: m.HomeHeroSection }))
			),
			lazySection('home-demo', 'Live demo', () =>
				import('../Landing/landingSections').then((m) => ({ default: m.HomeDemoSection }))
			),
			lazySection('home-use-cases', 'Use cases', () =>
				import('../Landing/landingSections').then((m) => ({ default: m.HomeUseCasesSection }))
			),
			lazySection('home-ecosystem', 'Ecosystem', () =>
				import('../Landing/landingSections').then((m) => ({ default: m.HomeEcosystemSection }))
			),
			lazySection('home-developers', 'Developers', () =>
				import('../Landing/landingSections').then((m) => ({ default: m.HomeDevelopersSection }))
			),
			lazySection('home-back', 'Back the launch', () =>
				import('../Landing/landingSections').then((m) => ({ default: m.HomeBackSection }))
			),
			lazySection('home-faq', 'FAQ', () =>
				import('../Landing/landingSections').then((m) => ({ default: m.HomeFaqSection }))
			),
			lazySection('home-footer', 'Footer', () =>
				import('../Landing/landingSections').then((m) => ({ default: m.HomeFooterSection }))
			)
		]
	},
	{
		key: 'welcome',
		route: '/welcome',
		shellWidth: 'full',
		Shell: React.lazy(() => import('../Welcome/welcomeSections').then((m) => ({ default: m.WelcomeShell }))),
		sections: [
			lazySection('welcome-hero', 'Welcome hero', () =>
				import('../Welcome/welcomeSections').then((m) => ({ default: m.WelcomeHeroSection }))
			),
			lazySection('welcome-card', 'Account card', () =>
				import('../Welcome/welcomeSections').then((m) => ({ default: m.WelcomeCardSection }))
			)
		]
	},
	{
		key: 'ode',
		route: '/ode',
		shellWidth: 680,
		sections: [
			lazySection('ode-poem', 'Ode to Thingtime poem', () =>
				import('../Ode/odeSections').then((m) => ({ default: m.OdePoemSection }))
			)
		]
	},
	{
		key: 'mongodb-status',
		route: '/mongodb-status',
		shellWidth: 760,
		sections: [
			lazySection('mongodb-status-header', 'MongoDB header', () =>
				import('../MongoDB/mongodbStatusSections').then((m) => ({ default: m.MongoStatusHeaderSection }))
			),
			lazySection('mongodb-status-connection', 'Connection readout', () =>
				import('../MongoDB/mongodbStatusSections').then((m) => ({ default: m.MongoStatusConnectionSection }))
			),
			lazySection('mongodb-status-endpoint', 'Data endpoint config', () =>
				import('../MongoDB/mongodbStatusSections').then((m) => ({ default: m.MongoStatusEndpointSection }))
			)
		]
	}
];

const sectionIndex = new Map<string, { page: NativePageDef; section: NativeSectionDef }>();
const pageIndex = new Map<string, NativePageDef>();
for (const page of NATIVE_PAGES) {
	pageIndex.set(page.key, page);
	for (const section of page.sections) sectionIndex.set(section.key, { page, section });
}

export const getNativeSection = (key: string) => sectionIndex.get(key) || null;
export const getNativePage = (key: string) => pageIndex.get(key) || null;
export const getNativePageByRoute = (route: string) => NATIVE_PAGES.find((page) => page.route === route) || null;

// Render one registered native section (lazy chunk; blank while loading per
// the optimistic-render rule — never a spinner).
export const NativeSectionView = ({ sectionKey }: { sectionKey: string }) => {
	const hit = getNativeSection(sectionKey);
	if (!hit) return null;
	const Section = hit.section.Component;
	return (
		<React.Suspense fallback={null}>
			<Section />
		</React.Suspense>
	);
};

// Does every native block in this list resolve to a registered section?
// (Legacy whole-page docs — e.g. a native key equal to the route key — fail
// this and take the children-passthrough path.)
export const blocksAreFullySectioned = (blocks: Array<{ type?: string; native?: string }>): boolean => {
	const natives = blocks.filter((block) => block?.type === 'native');
	return natives.length > 0 && natives.every((block) => !!block.native && sectionIndex.has(block.native));
};
