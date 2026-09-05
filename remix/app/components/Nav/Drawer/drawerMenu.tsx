// Default drawer menu model. Users reorder items via click-and-hold drag;
// their ordering is stored in thingtime.settings.drawer.userDrawerOrdering
// keyed by list id ('toplevel' or a top-level item id).

import type { ThingMode } from '../../Thingtime/thingRoute';

export interface DrawerItemVisibility {
	authOnly?: boolean;
	guestOnly?: boolean;
	adminOnly?: boolean;
	// hidden from non-admins until this marketing publication key is published
	// (marketing/publishingCore.ts) — admins always see the item
	publication?: string;
}

export interface DrawerSubItem extends DrawerItemVisibility {
	id: string;
	label: string;
	icon?: string;
	to?: string;
	// mode items switch the thing mode for the current thing path instead of
	// navigating to `to` (`to` stays as the selection-sync/highlight fallback)
	mode?: ThingMode;
	// optional group name; grouped items render under an expand/collapse header
	group?: string;
}

export interface DrawerTopItem extends DrawerItemVisibility {
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
		id: 'feed',
		label: 'Feed',
		icon: '📰',
		to: '/feed',
		children: [
			{ id: 'feed-home', label: 'Feed', icon: '📰', to: '/feed' },
			{ id: 'feed-explore', label: 'Explore', icon: '🔥', to: '/explore' },
			{ id: 'feed-saved', label: 'Saved', icon: '🔖', to: '/saved', authOnly: true },
			{ id: 'feed-profile', label: 'Profile', icon: '👤', to: '/profile', authOnly: true },
			{ id: 'feed-settings', label: 'Settings', icon: '⚙️', to: '/settings' }
		]
	},
	{
		id: 'messages',
		label: 'Messages',
		icon: '💬',
		to: '/messages',
		children: [
			{ id: 'messages-home', label: 'Messages', icon: '💬', to: '/messages', authOnly: true },
			{ id: 'messages-requests', label: 'Requests', icon: '💌', to: '/messages?view=requests', authOnly: true }
		]
	},
	{
		// 🦄 Lopu, the Thingtime assistant: the chat page, her conversations
		// (they live in Messenger) and her preferences
		id: 'lopu',
		label: 'Lopu',
		icon: '🦄',
		to: '/lopu',
		children: [
			{ id: 'lopu-chat', label: 'Chat', icon: '💬', to: '/lopu' },
			{ id: 'lopu-voice', label: 'Voice', icon: '🎙️', to: '/lopu/voice', authOnly: true },
			{ id: 'lopu-conversations', label: 'Conversations', icon: '🗂️', to: '/messages', authOnly: true },
			{ id: 'lopu-vault', label: 'Secure Vault', icon: '🔐', to: '/settings#secure-vault', authOnly: true },
			{ id: 'lopu-settings', label: 'Settings', icon: '⚙️', to: '/settings#lopu' }
		]
	},
	{
		id: 'search',
		label: 'Search',
		icon: '🔍',
		to: '/search',
		children: [{ id: 'search-home', label: 'Search', icon: '🔍', to: '/search' }]
	},
	{
		id: 'schemas',
		label: 'Schemas',
		icon: '💎',
		to: '/schemas',
		children: [
			{ id: 'schemas-browse', label: 'Browse', icon: '💎', to: '/schemas' },
			{ id: 'schemas-docs', label: 'Reference docs', icon: '📚', to: '/docs/schemas' }
		]
	},
	{
		id: 'components',
		label: 'Components',
		icon: '🧩',
		to: '/components',
		children: [
			{ id: 'components-browse', label: 'Browse', icon: '🧩', to: '/components' },
			{ id: 'components-schemas', label: 'Schemas', icon: '💎', to: '/schemas' }
		]
	},
	{
		id: 'actions',
		label: 'Actions',
		icon: '⚡',
		to: '/actions',
		children: [
			{ id: 'actions-browse', label: 'Browse', icon: '⚡', to: '/actions' },
			{ id: 'actions-docs', label: 'API reference', icon: '📚', to: '/docs/api/actions' }
		]
	},
	{
		id: 'builder',
		label: 'Builder',
		icon: '🧱',
		to: '/builder',
		children: [
			{ id: 'builder-pages', label: 'My pages', icon: '📄', to: '/builder' },
			{ id: 'builder-components', label: 'Components', icon: '🧩', to: '/components' },
			{ id: 'builder-actions', label: 'Actions', icon: '⚡', to: '/actions' },
			{ id: 'builder-design-system', label: 'Design system', icon: '🎨', to: '/docs/design-system' }
		]
	},
	{
		id: 'things',
		label: 'Things',
		icon: '📦',
		to: '/things',
		children: [
			{ id: 'things-browse', label: 'Browse', icon: '📦', to: '/things' },
			{ id: 'things-view', label: 'View', icon: '👀', to: '/things', mode: 'view', group: 'Modes' },
			{ id: 'things-edit', label: 'Edit', icon: '🎨', to: '/edit', mode: 'edit', group: 'Modes' },
			{ id: 'things-editor', label: 'Editor', icon: '💻', to: '/editor', mode: 'editor', group: 'Modes' },
			{ id: 'things-search', label: 'Search', icon: '🔍', to: '/search' },
			{ id: 'things-raw', label: 'MongoDB query', icon: '🔍', to: '/raw' }
		]
	},
	{
		id: 'account',
		label: 'Account',
		icon: '🌈',
		to: '/profile',
		children: [
			{ id: 'account-profile', label: 'Profile', icon: '👤', to: '/profile', authOnly: true },
			{ id: 'account-notifications', label: 'Notifications', icon: '🔔', to: '/notifications', authOnly: true },
			{ id: 'account-settings', label: 'Settings', icon: '⚙️', to: '/settings' },
			{ id: 'account-manage-apps', label: 'My apps', icon: '🧩', to: '/apps/manage', authOnly: true },
			{ id: 'account-apps', label: 'App data', icon: '📦', to: '/apps', authOnly: true },
			{ id: 'account-welcome', label: 'Welcome', icon: '✨', to: '/welcome', authOnly: true },
			{ id: 'account-themes', label: 'Themes', icon: '🎨', to: '/themes' },
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
			{ id: 'dev-admin', label: 'Admin', icon: '🛠️', to: '/admin', adminOnly: true },
			{ id: 'dev-peers', label: 'Deployment peers', icon: '🕸️', to: '/peers', adminOnly: true },
			{ id: 'dev-tests', label: 'API tests', icon: '✅', to: '/tests' },
			{ id: 'dev-crypto', label: 'Crypto', icon: '🔒', to: '/crypto' },
			{ id: 'dev-migrations', label: 'Migrations', icon: '🛠️', to: '/migrations' }
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
	},
	// the generated marketing suite is admin-only until published, one surface
	// at a time — every entry here names its publication key, and the whole
	// section stays out of a visitor's drawer until at least one child is live
	{
		id: 'marketing',
		label: 'Marketing',
		icon: '📣',
		to: '/marketing',
		publication: 'hub',
		children: [
			{ id: 'marketing-home', label: 'Marketing hub', icon: '🌈', to: '/marketing', publication: 'hub' },
			{ id: 'marketing-social', label: 'Social images', icon: '📸', to: '/marketing/social-media', publication: 'social' },
			{ id: 'marketing-landing', label: 'Feature pages', icon: '📄', to: '/marketing/landing', publication: 'category:landing' },
			{ id: 'marketing-guides', label: 'How-to guides', icon: '📘', to: '/marketing/guides', publication: 'category:guides' },
			{ id: 'marketing-walkthroughs', label: 'Walkthroughs', icon: '🖱️', to: '/marketing/walkthroughs', publication: 'category:walkthroughs' },
			{ id: 'marketing-compare', label: 'Comparisons', icon: '⚖️', to: '/marketing/compare', publication: 'category:compare' },
			{ id: 'marketing-for', label: 'For every audience', icon: '🎯', to: '/marketing/for', publication: 'category:for' }
		]
	},
	{
		id: 'docs',
		label: 'Docs',
		icon: '📚',
		to: '/docs',
		children: [
			{ id: 'docs-index', label: 'Docs home', icon: '📖', to: '/docs' },
			{ id: 'docs-design', label: 'Design mockups', icon: '🖼️', to: '/docs/design' },
			{ id: 'docs-design-system', label: 'Design system', icon: '🧩', to: '/docs/design-system' }
		]
	}
];

// Top-level hubs whose click KEEPS the drawer open by default, so their
// submenu stays browsable (they're all multi-destination sections). An
// explicit per-item "close after click" setting always wins over this
// default, in either direction.
export const DRAWER_KEEP_OPEN_DEFAULT_IDS: string[] = ['dev', 'status', 'branding', 'marketing', 'docs'];

// The one resolver for "does clicking this item close the drawer?" — shared
// by the click handlers (useDrawer.closesOnClick) and the settings toggles so
// the checkboxes always show the behavior that will actually happen.
export const drawerItemClosesOnClick = (closeOnClick: Record<string, boolean> | undefined, itemId: string): boolean => {
	const saved = closeOnClick?.[itemId];
	if (typeof saved === 'boolean') {
		return saved;
	}
	return !DRAWER_KEEP_OPEN_DEFAULT_IDS.includes(itemId);
};

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

// `isPublished` answers marketing publication keys (marketing/publishingCore
// isKeyPublished over the shared store). Publication-gated items fail closed
// for non-admins when it is omitted or the state is still unknown.
export const filterDrawerItemsByAuth = <T extends DrawerItemVisibility>(
	items: T[],
	loggedIn: boolean,
	isAdmin = false,
	isPublished?: (key: string) => boolean
): T[] => {
	return items.filter((item) => {
		if (item.authOnly && !loggedIn) {
			return false;
		}
		if (item.guestOnly && loggedIn) {
			return false;
		}
		if (item.adminOnly && !isAdmin) {
			return false;
		}
		if (item.publication && !isAdmin && !(isPublished?.(item.publication) ?? false)) {
			return false;
		}
		return true;
	});
};

// A publication-gated top-level section stays listed for admins, and for
// visitors as soon as ANY of its children is visible (a published category
// index is reachable even while the hub itself is still unpublished).
export const filterDrawerTopItems = (
	items: DrawerTopItem[],
	loggedIn: boolean,
	isAdmin = false,
	isPublished?: (key: string) => boolean
): DrawerTopItem[] => {
	return items.filter((item) => {
		if (!item.publication || isAdmin) {
			return true;
		}
		return filterDrawerItemsByAuth(item.children, loggedIn, isAdmin, isPublished).length > 0;
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
