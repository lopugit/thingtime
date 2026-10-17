export type SitePageSeed = {
	key: string; // route key → shareId webpage-route-<key>, native block key
	path: string; // crystal.siteRoute
	name: string;
	// pages decomposed in the client native-section registry
	// (remix/app/components/Builder/nativeSections.tsx) seed one native block
	// PER SECTION instead of a single whole-page native — keep the two lists
	// in sync when converting a page
	sections?: string[];
};

export const SITE_PAGE_SEEDS: SitePageSeed[] = [
	{ key: 'home', path: '/', name: 'Home', sections: ['home-hero', 'home-demo', 'home-use-cases', 'home-ecosystem', 'home-developers', 'home-back', 'home-faq', 'home-footer'] },
	{ key: 'feed', path: '/feed', name: 'Feed' },
	{ key: 'messages', path: '/messages', name: 'Messages' },
	{ key: 'search', path: '/search', name: 'Search' },
	{ key: 'schemas', path: '/schemas', name: 'Schemas' },
	{ key: 'components', path: '/components', name: 'Components' },
	{ key: 'actions', path: '/actions', name: 'Actions' },
	{ key: 'things', path: '/things', name: 'Things' },
	{ key: 'settings', path: '/settings', name: 'Settings' },
	{ key: 'profile', path: '/profile', name: 'Profile' },
	{ key: 'themes', path: '/themes', name: 'Themes' },
	{ key: 'status', path: '/status', name: 'Status', sections: ['status-header', 'status-state', 'status-readout', 'status-recheck'] },
	{ key: 'vercel', path: '/vercel', name: 'Deployments' },
	{ key: 'mongodb-status', path: '/mongodb-status', name: 'MongoDB', sections: ['mongodb-status-header', 'mongodb-status-connection', 'mongodb-status-endpoint'] },
	{ key: 'migrations', path: '/migrations', name: 'Migrations' },
	{ key: 'tests', path: '/tests', name: 'API tests' },
	{ key: 'admin', path: '/admin', name: 'Admin' },
	{ key: 'apps', path: '/apps', name: 'App data' },
	{ key: 'apps-manage', path: '/apps/manage', name: 'My apps' },
	{ key: 'branding', path: '/branding', name: 'Branding' },
	{ key: 'docs', path: '/docs', name: 'Docs' },
	{ key: 'welcome', path: '/welcome', name: 'Welcome', sections: ['welcome-hero', 'welcome-card'] },
	{ key: 'crypto', path: '/crypto', name: 'Crypto' },
	{ key: 'raw', path: '/raw', name: 'MongoDB query' },
	{ key: 'ode', path: '/ode', name: 'Ode', sections: ['ode-poem'] },
	{ key: 'builder', path: '/builder', name: 'Builder' },
	{ key: 'builder-demos', path: '/builder/demos', name: 'Builder demos' }
];


/** Editable content shared by server seeding and offline Builder creation. */
export const sitePageCrystal = (seed: SitePageSeed) => ({
 name: seed.name,
 description: `Site page for ${seed.path} — personalise it with the builder's site edit mode.`,
 pageKey: `route-${seed.key}`, siteRoute: seed.path, version: 1,
 blocks: (seed.sections || [seed.key]).map(sectionKey => ({ id: `native-${sectionKey}`, type: 'native' as const, native: sectionKey }))
});
export const sitePageSeed = (path: string) => SITE_PAGE_SEEDS.find(seed => seed.path === path);

/** Editor/assistant and chrome-less routes retain their own isolated surfaces. */
export const siteBlocksExcluded = (path: string) => path === '/authorize' || path === '/builder' || path === '/lopu' || path.startsWith('/lopu/') || path === '/settings' || path.startsWith('/p/') || path.startsWith('/rainbow/');
