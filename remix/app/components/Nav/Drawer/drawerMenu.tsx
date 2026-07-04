// Default drawer menu model. Users reorder items via click-and-hold drag;
// their ordering is stored in thingtime.settings.drawer.userDrawerOrdering
// keyed by list id ('toplevel' or a top-level item id).

export interface DrawerSubItem {
	id: string;
	label: string;
	icon?: string;
	to?: string;
	// optional group name; grouped items render under an expand/collapse header
	group?: string;
	// visibility filters against the current user
	authOnly?: boolean;
	guestOnly?: boolean;
}

export interface DrawerTopItem {
	id: string;
	label: string;
	icon: string;
	to?: string;
	children: DrawerSubItem[];
}

export const drawerMenuItems: DrawerTopItem[] = [
	{
		id: 'home',
		label: 'Home',
		icon: '🦄',
		to: '/',
		children: [
			{ id: 'home-welcome', label: 'Welcome', icon: '✨', to: '/welcome' },
			{ id: 'home-ode', label: 'Ode', icon: '📖', to: '/ode' },
			{ id: 'home-branding', label: 'Branding', icon: '🌈', to: '/branding' }
		]
	},
	{
		id: 'things',
		label: 'Things',
		icon: '📦',
		to: '/things',
		children: [
			{ id: 'things-view', label: 'View', icon: '👀', to: '/things', group: 'Modes' },
			{ id: 'things-edit', label: 'Edit', icon: '🎨', to: '/edit', group: 'Modes' },
			{ id: 'things-editor', label: 'Editor', icon: '💻', to: '/editor', group: 'Modes' },
			{ id: 'things-raw', label: 'Raw results', icon: '🔍', to: '/raw' }
		]
	},
	{
		id: 'account',
		label: 'Account',
		icon: '🌈',
		to: '/profile',
		children: [
			{ id: 'account-profile', label: 'Profile', icon: '👤', to: '/profile', authOnly: true },
			{ id: 'account-welcome', label: 'Welcome', icon: '✨', to: '/welcome', authOnly: true },
			{ id: 'account-login', label: 'Log in', icon: '🗝️', to: '/login', guestOnly: true },
			{ id: 'account-register', label: 'Register', icon: '➕', to: '/register', guestOnly: true }
		]
	},
	{
		id: 'status',
		label: 'Status',
		icon: '🚀',
		to: '/status',
		children: [
			{ id: 'status-deployments', label: 'Deployments', icon: '🚀', to: '/vercel', group: 'Vercel' },
			{ id: 'status-status', label: 'Status', icon: '✅', to: '/status', group: 'Vercel' },
			{ id: 'status-mongodb', label: 'MongoDB', icon: '🌱', to: '/mongodb-status', group: 'Database' }
		]
	},
	{
		id: 'dev',
		label: 'Dev',
		icon: '💻',
		to: '/tests',
		children: [
			{ id: 'dev-tests', label: 'API tests', icon: '✅', to: '/tests' },
			{ id: 'dev-crypto', label: 'Crypto', icon: '🔒', to: '/crypto' },
			{ id: 'dev-edge', label: 'Edge', icon: '🌍', to: '/edge' },
			{
				id: 'dev-svg-displacement',
				label: 'SVG displacement',
				icon: '🖼️',
				to: '/scratchpads/svg-displacement-map',
				group: 'Scratchpads'
			}
		]
	},
	{
		id: 'branding',
		label: 'Branding',
		icon: '🎨',
		to: '/branding',
		children: [
			{ id: 'branding-current', label: 'Branding', icon: '🌈', to: '/branding' },
			{ id: 'branding-old', label: 'Branding (old)', icon: '📚', to: '/branding_old' }
		]
	}
];

// Order ids by the user's saved ordering; unknown/new ids keep their default
// position appended after the known ones, removed ids are dropped.
export const applyDrawerOrdering = (defaultIds: string[], saved?: string[]): string[] => {
	if (!saved?.length) {
		return defaultIds;
	}

	const known = saved.filter((id) => defaultIds.includes(id));
	const missing = defaultIds.filter((id) => !known.includes(id));

	return [...known, ...missing];
};

export const filterDrawerItemsByAuth = <T extends { authOnly?: boolean; guestOnly?: boolean }>(items: T[], loggedIn: boolean): T[] => {
	return items.filter((item) => {
		if (item.authOnly && !loggedIn) {
			return false;
		}
		if (item.guestOnly && loggedIn) {
			return false;
		}
		return true;
	});
};

export interface DrawerSubSection {
	group: string | null;
	items: DrawerSubItem[];
}

// Split a flat (already ordered) sub-item list into sections: ungrouped items
// and named groups, ordered by first appearance.
export const buildDrawerSubSections = (items: DrawerSubItem[]): DrawerSubSection[] => {
	const sections: DrawerSubSection[] = [];
	const sectionsByKey = new Map<string, DrawerSubSection>();

	items.forEach((item) => {
		const group = item.group || null;
		const key = group ?? '__ungrouped__';

		let section = sectionsByKey.get(key);
		if (!section) {
			section = { group, items: [] };
			sectionsByKey.set(key, section);
			sections.push(section);
		}

		section.items.push(item);
	});

	return sections;
};
