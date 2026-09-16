// Public route labels only. Never derive a title from arbitrary path segments,
// query strings, invitation tokens, or authenticated account data.
export const DEFAULT_PAGE_TITLE = 'Thingtime - Your Home for Everything';

export const pageTitle = (pathname: string, prefix = ''): string => {
	const base = prefix ? `${prefix} Thingtime` : 'Thingtime';
	const path = pathname.split(/[?#]/)[0].replace(/\/$/, '') || '/';
	if (path === '/docs/design' || path.startsWith('/docs/design/')) return `${base} docs - Design mockups`;
	if (path === '/docs') return `${base} docs`;
	const exact: Record<string, string> = {
		'/feed': 'Feed',
		'/messages': 'Messages',
		'/settings': 'Settings',
		'/admin': 'Admin',
		'/things': 'Things',
		'/lopu/voice': 'Lopu voice',
		'/branding': 'Brand resources'
	};
	const families: Record<string, string> = {
		'/profile': 'Profile',
		'/lopu': 'Lopu',
		'/builder': 'Builder',
		'/actions': 'Actions',
		'/components': 'Components'
	};
	const label = exact[path] || Object.entries(families).find(([route]) => path === route || path.startsWith(`${route}/`))?.[1];
	return label ? `${base} - ${label}` : prefix ? `${prefix} ${DEFAULT_PAGE_TITLE}` : DEFAULT_PAGE_TITLE;
};
