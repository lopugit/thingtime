import { byKey } from './lookup';
import type { Competitor } from './types';

// Comparison subjects. Every line about a competitor is deliberately
// conservative and phrased as a difference in model, not an attack: the
// "strengths" are real, and the table rows describe Thingtime precisely and
// the other product generally. Keep it fair — these pages are public.

export const COMPETITORS: Competitor[] = [
	{
		key: 'notion',
		name: 'Notion',
		emoji: '📓',
		knownFor: 'all-in-one docs, wikis and databases',
		differences: [
			'Thingtime stores everything as things in one tree with one API, rather than pages and database rows',
			'Posts, comments, chats and pages share one permission model instead of workspace-level sharing',
			'Thingtime is open source and self-hostable with your own database'
		],
		strengths: ['Mature templates and a huge community', 'Polished docs editing with many block types'],
		relevantFeatures: ['things-tree', 'open-api', 'acl-sharing', 'webpage-builder', 'schemas', 'themes', 'self-hosting', 'mcp-connector'],
		table: [
			['Data model', 'Everything is a thing in one tree', 'Pages and databases'],
			['API', 'Same /api/v1 the UI uses', 'Separate public API'],
			['Social layer', 'Feed, reactions, polls, messages built in', 'Comments on pages'],
			['Theming', 'Every token editable, themes shareable', 'Light/dark, fonts'],
			['Self-hosting', 'Fork and deploy with your MongoDB', 'Hosted only'],
			['AI access', 'MCP server with OAuth and scoped tools', 'Built-in AI features']
		]
	},
	{
		key: 'airtable',
		name: 'Airtable',
		emoji: '🗂️',
		knownFor: 'spreadsheet-style relational databases',
		differences: [
			'Things nest to any depth instead of flat tables with links',
			'Schemas describe kinds and compose, without seat-based pricing per editor',
			'A social feed and pages live on the same records'
		],
		strengths: ['Excellent grid, kanban and calendar views', 'Rich automations and integrations marketplace'],
		relevantFeatures: ['schemas', 'things-tree', 'open-api', 'acl-sharing', 'actions', 'folders'],
		table: [
			['Shape', 'Nested things of any depth', 'Tables, fields and links'],
			['Schemas', 'Composable kinds with projections', 'Field types per table'],
			['Automation', 'Actions with hard budgets', 'Automations and scripts'],
			['Sharing', 'Per-thing, inheritable permissions', 'Base and workspace sharing'],
			['Publishing', 'Builder pages at /p/', 'Interfaces and shared views'],
			['Ownership', 'Open source, exportable', 'Hosted only']
		]
	},
	{
		key: 'google-sheets',
		name: 'Google Sheets',
		emoji: '📊',
		knownFor: 'collaborative spreadsheets',
		differences: [
			'Things carry structure and kinds instead of cells you must keep in shape',
			'Every branch can be shared or hidden separately',
			'Reader view renders data as a document, not a grid'
		],
		strengths: ['Formulas everyone knows', 'Real-time collaboration at scale'],
		relevantFeatures: ['things-tree', 'view-edit-editor-modes', 'acl-sharing', 'schemas', 'raw-workbench'],
		table: [
			['Structure', 'Nested keys and kinds', 'Rows and columns'],
			['Sharing', 'Per branch', 'Per file or range'],
			['Reading', 'Document-style reader view', 'Grid'],
			['API', 'REST with bearer tokens', 'Sheets API'],
			['Social', 'Feed, comments, reactions', 'Cell comments']
		]
	},
	{
		key: 'obsidian',
		name: 'Obsidian',
		emoji: '🪨',
		knownFor: 'local-first markdown knowledge bases',
		differences: [
			'Things are structured data with kinds, not markdown files',
			'Sharing and social features are built in rather than plugins',
			'Available on the web with an open API, not only local vaults'
		],
		strengths: ['Local files you fully control', 'A vast plugin ecosystem and graph view'],
		relevantFeatures: ['things-tree', 'search', 'acl-sharing', 'themes', 'open-api', 'published-pages'],
		table: [
			['Storage', 'Your MongoDB, one tree', 'Local markdown vault'],
			['Structure', 'Kinds and schemas', 'Frontmatter and links'],
			['Sharing', 'Per-thing audiences', 'Publish add-on'],
			['Theming', 'Token themes by id', 'Community themes'],
			['API', 'Open REST + MCP', 'Plugin API']
		]
	},
	{
		key: 'evernote',
		name: 'Evernote',
		emoji: '🐘',
		knownFor: 'note capture and web clipping',
		differences: ['Notes are things in a tree with schemas', 'A feed and audiences instead of shared notebooks', 'Open API and self-hosting'],
		strengths: ['Great capture and search across scans', 'Long track record'],
		relevantFeatures: ['things-tree', 'search', 'saved-library', 'attachments-media', 'acl-sharing'],
		table: [
			['Notes', 'Things with structure', 'Rich notes'],
			['Files', 'Every file is a thing with a page', 'Attachments in notes'],
			['Sharing', 'Audiences and hidden links', 'Shared notebooks'],
			['Social', 'Feed and reactions', 'None'],
			['Ownership', 'Open source', 'Hosted']
		]
	},
	{
		key: 'trello',
		name: 'Trello',
		emoji: '📋',
		knownFor: 'kanban boards',
		differences: ['Things and folders instead of boards and cards', 'Actions can automate over your data with budgets', 'Chats and spaces on the same records'],
		strengths: ['Simple, visual boards', 'Power-ups for every workflow'],
		relevantFeatures: ['folders', 'bulk-actions', 'actions', 'messages', 'acl-sharing'],
		table: [
			['Model', 'Things, folders, kinds', 'Boards, lists, cards'],
			['Automation', 'Actions', 'Butler'],
			['Chat', 'Spaces and chats built in', 'Card comments'],
			['Bulk', 'Move, copy, share, delete many', 'Per card'],
			['API', 'Open REST', 'REST']
		]
	},
	{
		key: 'linktree',
		name: 'Linktree',
		emoji: '🌴',
		knownFor: 'link-in-bio pages',
		differences: ['A full block builder, not a list of links', 'Your page is a thing you own and can fork', 'Profiles, feed and messages come with it'],
		strengths: ['Fast setup', 'Analytics and integrations for creators'],
		relevantFeatures: ['webpage-builder', 'published-pages', 'profiles', 'og-link-previews', 'themes'],
		table: [
			['Page', 'Block builder with media', 'Link list'],
			['URL', '/p/<id> or your profile', 'linktr.ee/name'],
			['Theming', 'Any token, any theme', 'Preset themes'],
			['Social', 'Feed, comments, reactions', 'None'],
			['Ownership', 'Exportable things', 'Hosted']
		]
	},
	{
		key: 'carrd',
		name: 'Carrd',
		emoji: '🃏',
		knownFor: 'one-page sites',
		differences: ['Pages are made of blocks and component things', 'Media inherits page permissions automatically', 'Fork any public page as a starting point'],
		strengths: ['Very cheap and quick', 'Lovely templates'],
		relevantFeatures: ['webpage-builder', 'published-pages', 'demo-library', 'figma-layer', 'drop-to-upload'],
		table: [
			['Builder', 'Blocks, components, inspector', 'Elements on a canvas'],
			['Starting points', '300+ demo pages to fork', 'Templates'],
			['Media', 'Drop, paste, reorder', 'Upload'],
			['Data', 'Pages are things with an API', 'Static'],
			['Community', 'Feed and profiles', 'None']
		]
	},
	{
		key: 'webflow',
		name: 'Webflow',
		emoji: '🌊',
		knownFor: 'visual web design and CMS',
		differences: ['Simpler blocks aimed at people, not agencies', 'The CMS is the same thing tree as everything else', 'Open source with self-hosting'],
		strengths: ['Pixel-level design control', 'Professional CMS and hosting'],
		relevantFeatures: ['webpage-builder', 'figma-layer', 'components-library', 'site-edit-mode', 'self-hosting'],
		table: [
			['Design control', 'Figma-style inspector', 'Full CSS designer'],
			['CMS', 'Things with schemas', 'Collections'],
			['Components', '1000+ component things', 'Symbols'],
			['Learning curve', 'Minutes', 'Days'],
			['Ownership', 'Open source', 'Hosted']
		]
	},
	{
		key: 'wordpress',
		name: 'WordPress',
		emoji: '🅦',
		knownFor: 'the web’s most used CMS',
		differences: ['Block pages without plugins or themes to maintain', 'One data model for posts, pages and users', 'A social feed and messages built in'],
		strengths: ['Enormous plugin ecosystem', 'Runs anywhere'],
		relevantFeatures: ['webpage-builder', 'published-pages', 'rss', 'feed', 'self-hosting'],
		table: [
			['Pages', 'Block builder', 'Gutenberg + themes'],
			['Data', 'Things with kinds', 'Posts, pages, custom post types'],
			['Social', 'Feed, reactions, messages', 'Comments + plugins'],
			['Maintenance', 'One app', 'Plugins and updates'],
			['RSS', 'Yes', 'Yes']
		]
	},
	{
		key: 'twitter',
		name: 'X',
		emoji: '🐦',
		knownFor: 'public short posts',
		differences: ['You own your posts as exportable things', 'Pick or train your own feed algorithm', 'Audiences per post, not just public or private'],
		strengths: ['Reach and real-time news', 'Massive network'],
		relevantFeatures: ['feed', 'feed-algorithms', 'reposts-quotes', 'custom-audiences', 'polls', 'rss'],
		table: [
			['Ownership', 'Your things, your export', 'Platform owned'],
			['Algorithm', 'Choose or train it', 'Fixed'],
			['Audience', 'Per post', 'Public or circle'],
			['Reposts', 'Repost or quote', 'Repost or quote'],
			['Ads', 'None', 'Yes']
		]
	},
	{
		key: 'instagram',
		name: 'Instagram',
		emoji: '📸',
		knownFor: 'photo and video sharing',
		differences: ['Photos and videos are things with their own pages', 'Custom audiences and hidden links per post', 'No ads and an exportable archive'],
		strengths: ['Best-in-class camera and editing', 'Discovery at scale'],
		relevantFeatures: ['attachments-media', 'inline-video', 'custom-audiences', 'profiles', 'explore-trending'],
		table: [
			['Media', 'Files are things with pages', 'Posts and reels'],
			['Audience', 'Custom per post', 'Public, close friends'],
			['Profile', 'Themeable', 'Fixed layout'],
			['Ads', 'None', 'Yes'],
			['Export', 'Always', 'Request archive']
		]
	},
	{
		key: 'facebook',
		name: 'Facebook',
		emoji: '📘',
		knownFor: 'social networking for everyone',
		differences: ['A private feed for the people you pick', 'Reactions with any emoji', 'No ads, open data'],
		strengths: ['Everyone is already there', 'Groups and events at scale'],
		relevantFeatures: ['custom-audiences', 'reactions', 'feed', 'messages', 'polls'],
		table: [
			['Audience', 'Custom per post', 'Friends, public, lists'],
			['Reactions', 'Any emoji', 'Six'],
			['Messaging', 'Spaces and chats', 'Messenger'],
			['Ads', 'None', 'Yes'],
			['Ownership', 'Exportable things', 'Platform']
		]
	},
	{
		key: 'slack',
		name: 'Slack',
		emoji: '💼',
		knownFor: 'team chat',
		differences: ['Chats live next to the things they are about', 'Message requests keep strangers out', 'Every message is a thing you can search and export'],
		strengths: ['Integrations for everything', 'Huddles and workflows'],
		relevantFeatures: ['messages', 'message-requests', 'reactions', 'search', 'acl-sharing'],
		table: [
			['Spaces', 'Spaces and chats', 'Channels and DMs'],
			['Records', 'Chat next to things', 'Links to other tools'],
			['Reactions', 'Any emoji', 'Any emoji'],
			['Requests', 'Strangers ask first', 'Workspace invites'],
			['Ownership', 'Exportable', 'Plan dependent']
		]
	},
	{
		key: 'discord',
		name: 'Discord',
		emoji: '🎮',
		knownFor: 'community chat',
		differences: ['Spaces on top of shared things', 'A feed and pages beside the chat', 'Message requests instead of open DMs'],
		strengths: ['Voice and community tooling', 'Bots and roles'],
		relevantFeatures: ['messages', 'message-requests', 'feed', 'published-pages', 'custom-audiences'],
		table: [
			['Chat', 'Spaces and chats', 'Servers and channels'],
			['Content', 'Feed and pages built in', 'Chat only'],
			['DMs', 'Requests first', 'Open by default'],
			['Data', 'Things you own', 'Platform'],
			['Voice', 'No', 'Yes']
		]
	},
	{
		key: 'zapier',
		name: 'Zapier',
		emoji: '🔁',
		knownFor: 'no-code automation',
		differences: ['Actions run over your own data with hard budgets', 'No arbitrary code, a closed vocabulary you can audit', 'Run records live as things'],
		strengths: ['Thousands of app connectors', 'Mature triggers and schedules'],
		relevantFeatures: ['actions', 'open-api', 'personal-access-tokens', 'mcp-connector'],
		table: [
			['Scope', 'Your things', 'Any app'],
			['Safety', 'Closed vocabulary, budgets', 'Scripts and steps'],
			['Records', 'Run history as things', 'Task history'],
			['Cost', 'Included', 'Per task'],
			['Connectors', 'API, MCP, embed', 'Thousands']
		]
	},
	{
		key: 'firebase',
		name: 'Firebase',
		emoji: '🔥',
		knownFor: 'backend-as-a-service',
		differences: ['A GUI for every record, not only a console', 'Login with Thingtime and scoped tokens without SDK setup', 'Social features you do not have to build'],
		strengths: ['Realtime sync and generous SDKs', 'Deep Google Cloud integration'],
		relevantFeatures: ['open-api', 'login-with-thingtime', 'app-namespaces', 'embed-sdk', 'self-hosting'],
		table: [
			['Records', 'Things with a GUI', 'Documents in a console'],
			['Auth', 'OAuth popup + tokens', 'Auth SDK'],
			['App data', 'Per-app namespaces', 'Per-project'],
			['Social', 'Built in', 'Build it'],
			['Hosting model', 'Open source', 'Google Cloud']
		]
	},
	{
		key: 'supabase',
		name: 'Supabase',
		emoji: '⚡',
		knownFor: 'open source Postgres backend',
		differences: ['Documents in a tree instead of tables', 'A product UI ships with the backend', 'MCP tools for AI access out of the box'],
		strengths: ['Postgres with row-level security', 'Great developer experience'],
		relevantFeatures: ['open-api', 'acl-sharing', 'mcp-connector', 'self-hosting', 'schemas'],
		table: [
			['Store', 'MongoDB things', 'Postgres tables'],
			['Permissions', 'Per-thing ACL chains', 'Row-level security'],
			['UI', 'Ships with the product', 'Studio for admins'],
			['AI', 'MCP server', 'Vectors'],
			['Open source', 'Yes', 'Yes']
		]
	},
	{
		key: 'substack',
		name: 'Substack',
		emoji: '📬',
		knownFor: 'newsletters',
		differences: ['Posts are things with RSS and pages', 'Owned email delivery for notifications', 'A feed with audiences instead of a mailing list'],
		strengths: ['Paid subscriptions built in', 'Writers’ network'],
		relevantFeatures: ['rss', 'feed', 'published-pages', 'notifications', 'custom-audiences'],
		table: [
			['Distribution', 'Feed, RSS, pages', 'Email and app'],
			['Audience', 'Custom per post', 'Subscribers'],
			['Payments', 'Tiers for the instance', 'Paid newsletters'],
			['Ownership', 'Exportable things', 'Exportable list'],
			['Comments', 'Comments are posts', 'Comments']
		]
	},
	{
		key: 'github',
		name: 'GitHub',
		emoji: '🐙',
		knownFor: 'code hosting',
		differences: ['Scoped tokens for data, not repos', 'Activity heatmap for your things', 'For everyone, not only engineers'],
		strengths: ['The home of open source', 'Actions and code review'],
		relevantFeatures: ['personal-access-tokens', 'activity-heatmap', 'open-api', 'self-hosting'],
		table: [
			['Tokens', 'Exact scopes, default deny', 'Fine-grained tokens'],
			['Activity', 'Heatmap of things', 'Contribution graph'],
			['Audience', 'Everyone', 'Developers'],
			['Social', 'Feed and messages', 'Discussions'],
			['Open source', 'Yes', 'Hosted platform']
		]
	},
	{
		key: 'google-drive',
		name: 'Google Drive',
		emoji: '🗄️',
		knownFor: 'cloud file storage and sharing',
		differences: ['Files are things with their own pages, comments and reactions', 'Folders hold things of any kind, not only files', 'Share by branch with inherited permissions and hidden links'],
		strengths: ['Huge free storage and ubiquity', 'Docs, Sheets and Slides built in'],
		relevantFeatures: ['folders', 'attachments-media', 'acl-sharing', 'hidden-links', 'bulk-actions'],
		table: [
			['Files', 'Things with pages and comments', 'Files in folders'],
			['Folders', 'Any kind of thing', 'Files only'],
			['Sharing', 'Per branch, inheritable, rotating hidden links', 'Per file or folder links'],
			['Social', 'Feed and reactions', 'Comments in docs'],
			['API', 'Open REST', 'Drive API']
		]
	},
	{
		key: 'dropbox',
		name: 'Dropbox',
		emoji: '📦',
		knownFor: 'file sync and sharing',
		differences: ['Every file is a thing with a page, comments and permissions', 'Video plays inline in a feed', 'Open source with self-hosting'],
		strengths: ['Rock-solid sync', 'Great sharing links'],
		relevantFeatures: ['attachments-media', 'inline-video', 'folders', 'hidden-links'],
		table: [
			['Files', 'Things with pages', 'Synced files'],
			['Video', 'Inline in the feed', 'Preview'],
			['Links', 'Rotating hidden links', 'Share links'],
			['Social', 'Feed, comments, reactions', 'Comments'],
			['Ownership', 'Open source', 'Hosted']
		]
	},
	{
		key: 'mastodon',
		name: 'Mastodon',
		emoji: '🐘',
		knownFor: 'federated open source microblogging',
		differences: ['Posts are structured things you can also use as data', 'Audiences per post beyond public, unlisted and followers', 'A page builder, messages and an API for things, not only statuses'],
		strengths: ['Federation with the fediverse', 'Community-run instances'],
		relevantFeatures: ['feed', 'reposts-quotes', 'custom-audiences', 'rss', 'self-hosting'],
		table: [
			['Posts', 'Things with structure', 'Statuses'],
			['Audience', 'Custom per post', 'Public, unlisted, followers, direct'],
			['Federation', 'Deployment peers', 'ActivityPub'],
			['Pages', 'Block builder', 'Profile only'],
			['Open source', 'Yes', 'Yes']
		]
	},
	{
		key: 'reddit',
		name: 'Reddit',
		emoji: '👽',
		knownFor: 'community forums and threads',
		differences: ['Comments are full posts with their own permalinks', 'Audiences you define, not public subreddits', 'No ads and exportable things'],
		strengths: ['Deep threaded discussion', 'Communities for everything'],
		relevantFeatures: ['posts-comments', 'reactions', 'custom-audiences', 'explore-trending'],
		table: [
			['Threads', 'Comments are posts', 'Nested comments'],
			['Votes', 'Any emoji reaction', 'Up and down'],
			['Audience', 'Custom per post', 'Subreddit'],
			['Ads', 'None', 'Yes'],
			['Ownership', 'Exportable', 'Platform']
		]
	},
	{
		key: 'whatsapp',
		name: 'WhatsApp',
		emoji: '💚',
		knownFor: 'mobile messaging',
		differences: ['Chats sit next to the things they are about', 'Message requests keep strangers out', 'Messages are searchable things you own'],
		strengths: ['Everyone has it', 'End-to-end encryption by default'],
		relevantFeatures: ['messages', 'message-requests', 'attachments-media', 'search'],
		table: [
			['Chats', 'Spaces and chats', 'Groups and chats'],
			['Context', 'Chat next to things', 'Chat only'],
			['Requests', 'Strangers ask first', 'Anyone with your number'],
			['Search', 'Across things and messages', 'Within chats'],
			['Web', 'First-class', 'Companion']
		]
	},
	{
		key: 'squarespace',
		name: 'Squarespace',
		emoji: '⬛',
		knownFor: 'polished website templates',
		differences: ['Pages are things you can fork and share, not a subscription', 'Media inherits page permissions', 'A feed and messages come with the site'],
		strengths: ['Beautiful templates', 'Commerce built in'],
		relevantFeatures: ['webpage-builder', 'published-pages', 'demo-library', 'themes'],
		table: [
			['Builder', 'Blocks and components', 'Templates and sections'],
			['Starting points', '300+ demo pages', 'Templates'],
			['Theming', 'Every token', 'Site styles'],
			['Pricing', 'Free in beta', 'Subscription'],
			['Ownership', 'Open source', 'Hosted']
		]
	},
	{
		key: 'storybook',
		name: 'Storybook',
		emoji: '📕',
		knownFor: 'UI component documentation',
		differences: ['Components are things with typed args and a page', 'Docs and demos ship inside the product, not a separate build', 'Anyone can install a component into their account'],
		strengths: ['Framework-agnostic stories', 'Rich addon ecosystem'],
		relevantFeatures: ['components-library', 'design-system-docs', 'app-suites'],
		table: [
			['Components', 'Things with pages', 'Stories'],
			['Docs', 'Generated twins', 'MDX docs'],
			['Install', 'One click into your account', 'Copy code'],
			['Audience', 'Everyone', 'Developers'],
			['Runtime', 'The app itself', 'Separate build']
		]
	},
	{
		key: 'figma',
		name: 'Figma',
		emoji: '🎯',
		knownFor: 'collaborative interface design',
		differences: ['The controls edit real pages, not mockups', 'Themes are tokens you can share by id', 'Publishing is one click to /p/'],
		strengths: ['The best design canvas', 'Prototyping and dev mode'],
		relevantFeatures: ['figma-layer', 'themes', 'webpage-builder', 'design-system-docs'],
		table: [
			['Canvas', 'Real page, WYSIWYG', 'Design canvas'],
			['Output', 'Published page', 'Design file'],
			['Tokens', 'Live themes', 'Variables'],
			['Handoff', 'None needed', 'Dev mode'],
			['Audience', 'Everyone', 'Designers']
		]
	},
	{
		key: 'pinterest',
		name: 'Pinterest',
		emoji: '📌',
		knownFor: 'visual bookmarking',
		differences: ['Saved things stay private and structured', 'Boards are folders of any kind', 'No ads'],
		strengths: ['Visual discovery', 'Shopping integration'],
		relevantFeatures: ['saved-library', 'folders', 'attachments-media', 'explore-trending'],
		table: [
			['Saving', 'Any thing, private by default', 'Pins to boards'],
			['Boards', 'Folders of any kind', 'Image boards'],
			['Discovery', 'Explore', 'Home feed'],
			['Ads', 'None', 'Yes'],
			['Export', 'Always', 'Limited']
		]
	},
	{
		key: 'tiktok',
		name: 'TikTok',
		emoji: '🎵',
		knownFor: 'short vertical video',
		differences: ['You pick or train the algorithm', 'Videos are things with pages and permissions', 'No ads and an exportable archive'],
		strengths: ['Unmatched discovery', 'Creative tools'],
		relevantFeatures: ['feed-algorithms', 'inline-video', 'custom-audiences', 'explore-trending'],
		table: [
			['Algorithm', 'Yours to choose', 'Fixed'],
			['Video', 'Things with pages', 'Posts'],
			['Audience', 'Custom per post', 'Public, friends, private'],
			['Ads', 'None', 'Yes'],
			['Ownership', 'Exportable', 'Platform']
		]
	}
];

export const COMPETITOR_BY_KEY: Record<string, Competitor> = byKey(COMPETITORS, (competitor) => competitor.key);

export const getCompetitor = (key: string): Competitor => {
	const competitor = COMPETITOR_BY_KEY[key];
	if (!competitor) throw new Error(`Unknown marketing competitor: ${key}`);
	return competitor;
};
