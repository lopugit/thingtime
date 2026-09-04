import { byKey } from './lookup';
import type { Persona, PersonaKey } from './types';

// Audience personas. Pains and gains are written to be true of the audience
// in general, and the lead features are the ones Thingtime genuinely serves
// them with. Persona pages + persona×feature pages fan out from this list.

export const PERSONAS: Persona[] = [
	{
		key: 'creators',
		name: 'Creators',
		emoji: '🎥',
		label: 'for creators',
		pains: ['Your audience is scattered across five apps', 'Every platform owns your posts, not you', 'Link-in-bio tools are one more subscription'],
		gains: ['Post once, own it forever, share anywhere', 'Build a real page for your work in minutes', 'Reactions, polls and comments without the algorithm tax'],
		leadFeatures: ['feed', 'webpage-builder', 'published-pages', 'polls', 'profiles', 'rss']
	},
	{
		key: 'developers',
		name: 'Developers',
		emoji: '👩‍💻',
		label: 'for developers',
		pains: ['Every SaaS API is a different shape', 'Auth is a week of work per side project', 'Docs drift from the routes they describe'],
		gains: ['One REST API where everything is a thing', 'Login with Thingtime and scoped tokens in an afternoon', 'Docs and tests generated from the route registry'],
		leadFeatures: ['open-api', 'login-with-thingtime', 'personal-access-tokens', 'mcp-connector', 'actions', 'capability-manifest']
	},
	{
		key: 'teams',
		name: 'Teams',
		emoji: '🤝',
		label: 'for teams',
		pains: ['Knowledge lives in chat scrollback', 'Permissions are all-or-nothing', 'Every tool has its own inbox'],
		gains: ['Spaces, chats and things in one place', 'Per-person, per-branch permissions', 'One notification matrix you control'],
		leadFeatures: ['messages', 'acl-sharing', 'folders', 'bulk-actions', 'notifications', 'custom-audiences']
	},
	{
		key: 'families',
		name: 'Families',
		emoji: '🏡',
		label: 'for families',
		pains: ['Photos, lists and plans are spread everywhere', 'Sharing means a public post or nothing', 'Kids and grandparents need it simple'],
		gains: ['A private feed just for the people you pick', 'Lists, recipes and plans as living things', 'Reader view that anyone can use'],
		leadFeatures: ['custom-audiences', 'feed', 'attachments-media', 'messages', 'folders', 'hidden-links']
	},
	{
		key: 'students',
		name: 'Students',
		emoji: '🎓',
		label: 'for students',
		pains: ['Notes in one app, files in another, deadlines in a third', 'Free tiers vanish when you need them', 'Group projects need a shared brain'],
		gains: ['Structure notes as things you can search', 'Try it without signing up', 'Share a branch with your group, keep the rest private'],
		leadFeatures: ['things-tree', 'search', 'try-without-signup', 'saved-library', 'acl-sharing', 'schemas']
	},
	{
		key: 'founders',
		name: 'Founders',
		emoji: '🚀',
		label: 'for founders',
		pains: ['A landing page, a waitlist and a community are three vendors', 'You do not own the audience you are building', 'Every integration is a new bill'],
		gains: ['Launch a page, a feed and a login in one product', 'Open data and an open API from day one', 'Self-host or fork if you ever need to'],
		leadFeatures: ['webpage-builder', 'login-with-thingtime', 'embed-sdk', 'self-hosting', 'og-link-previews', 'quotas-and-tiers']
	},
	{
		key: 'designers',
		name: 'Designers',
		emoji: '🎨',
		label: 'for designers',
		pains: ['Handoff loses the details', 'Design systems live in a file nobody opens', 'Themes are a code change'],
		gains: ['A live design system with real stories', 'Themes as editable tokens, shared by id', 'Figma-style controls on real pages'],
		leadFeatures: ['themes', 'design-system-docs', 'figma-layer', 'components-library', 'theme-gallery', 'branding-kit']
	},
	{
		key: 'power-users',
		name: 'Power users',
		emoji: '⚡',
		label: 'for power users',
		pains: ['Apps hide your data behind their UI', 'Keyboard support is an afterthought', 'Automation needs a separate tool'],
		gains: ['Every thing in a tree, queryable and exportable', '⌘P palette, shortcuts and Raycast', 'Actions with hard budgets, right on your data'],
		leadFeatures: ['things-tree', 'command-palette', 'keyboard-shortcuts', 'actions', 'raw-workbench', 'raycast-extension']
	},
	{
		key: 'hobbyists',
		name: 'Hobbyists',
		emoji: '🧶',
		label: 'for hobbyists',
		pains: ['Collections outgrow spreadsheets', 'Community sites are noisy and ad-heavy', 'Progress photos get lost in the camera roll'],
		gains: ['A tree for your collection, a feed for your progress', 'Share with your club, not the whole internet', 'Videos and photos as first-class things'],
		leadFeatures: ['things-tree', 'feed', 'inline-video', 'hashtags', 'explore-trending', 'saved-library']
	},
	{
		key: 'small-business',
		name: 'Small business',
		emoji: '🏪',
		label: 'for small business',
		pains: ['A website builder, a CRM and a chat app add up', 'Staff need access to some things, not all', 'Customers want a page and a way to reach you'],
		gains: ['Pages, messages and records in one login', 'Share the branch a teammate needs', 'Message requests keep the inbox tidy'],
		leadFeatures: ['webpage-builder', 'acl-sharing', 'messages', 'folders', 'personal-access-tokens', 'message-requests']
	},
	{
		key: 'researchers',
		name: 'Researchers',
		emoji: '🔬',
		label: 'for researchers',
		pains: ['Data ends up in unversioned spreadsheets', 'Sharing raw data safely is hard', 'Every tool exports a different format'],
		gains: ['Structured things with schemas and an API', 'Share exactly the branch a collaborator needs', 'Query it raw or read it as a document'],
		leadFeatures: ['schemas', 'open-api', 'raw-workbench', 'acl-sharing', 'saved-library', 'rss']
	},
	{
		key: 'educators',
		name: 'Educators',
		emoji: '🍎',
		label: 'for educators',
		pains: ['Class resources scatter across drives and chats', 'Student privacy rules out most social tools', 'Polls and discussions need yet another app'],
		gains: ['A private feed per class with polls and comments', 'Moderated uploads and clear audiences', 'Resources as things students can search'],
		leadFeatures: ['custom-audiences', 'polls', 'moderation', 'posts-comments', 'hashtags', 'rich-text']
	}
];

export const PERSONA_BY_KEY: Record<PersonaKey, Persona> = byKey(PERSONAS, (persona) => persona.key);

export const getPersona = (key: PersonaKey): Persona => {
	const persona = PERSONA_BY_KEY[key];
	if (!persona) throw new Error(`Unknown marketing persona: ${key}`);
	return persona;
};
