// Shared vocabulary for the picker, directory and server. No inferred location or politics.
export const DEFAULT_ALGORITHMS = [
	{ id: 'hot', name: 'Hot', emoji: '🔥', description: 'Popular posts balanced with freshness.' },
	{ id: 'new', name: 'New', emoji: '✨', description: 'Newest posts first.' },
	{ id: 'top', name: 'Top', emoji: '🏆', description: 'Highest net votes among the latest 400 posts.' },
	{ id: 'rising', name: 'Rising', emoji: '📈', description: 'Fresh posts gaining votes in the last day.' },
	{ id: 'controversial', name: 'Controversial', emoji: '⚡', description: 'Posts with both upvotes and downvotes.' },
	{ id: 'local', name: 'Local', emoji: '📍', description: 'Nearby posts using your location, or a location tag you choose.' },
	{ id: 'global', name: 'Global', emoji: '🌍', description: 'Hot posts from the public feed worldwide.' },
	{ id: 'political', name: 'Political', emoji: '🏛️', description: 'Hot posts tagged politics or political.' }
] as const;
export type DefaultAlgorithmId = (typeof DEFAULT_ALGORITHMS)[number]['id'];
export const isDefaultAlgorithm = (id: unknown): id is DefaultAlgorithmId => DEFAULT_ALGORITHMS.some((item) => item.id === id);
export const defaultAlgorithm = (id: unknown) => DEFAULT_ALGORITHMS.find((item) => item.id === id);
