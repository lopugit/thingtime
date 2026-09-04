import type { UseCase } from './types';

// Concrete things people keep in Thingtime. Each use case renders as a
// how-to (steps), a sample tree (the shape) and a set of feature links, and
// also crosses with competitors for "X in Thingtime vs Y" pages.

export const USE_CASES: UseCase[] = [
	{
		key: 'car-maintenance-log',
		name: 'Car maintenance log',
		emoji: '🚗',
		tagline: 'Every service, tyre and receipt in one tree.',
		description: 'Keep the car as a thing: services, costs, mileage and receipts nest underneath it and add up in reader view.',
		steps: ['Create a thing called car with make, model and plate', 'Add a repairs array and log each service with date, cost and mileage', 'Attach receipts as files, they become things with pages', 'Share the branch with your mechanic or partner'],
		features: ['things-tree', 'attachments-media', 'acl-sharing', 'view-edit-editor-modes'],
		audiences: ['families', 'hobbyists', 'power-users'],
		sample: { car: { make: 'Toyota', model: 'Corolla', km: 84120, repairs: [{ date: '2026-08-02', cost: 240, what: 'Brake pads' }] } }
	},
	{
		key: 'recipe-book',
		name: 'Family recipe book',
		emoji: '🍲',
		tagline: 'Recipes that grandparents can read and kids can edit.',
		description: 'Recipes as things with ingredients, steps and photos; reader view makes them pretty, edit mode keeps them alive.',
		steps: ['Make a recipes folder', 'Add each recipe with ingredients, steps and a photo', 'Share the folder with the family audience', 'Post the Sunday roast to the family feed'],
		features: ['folders', 'custom-audiences', 'attachments-media', 'feed'],
		audiences: ['families', 'hobbyists'],
		sample: { recipe: { name: 'Nonna’s ragù', serves: 6, ingredients: ['beef', 'tomato', 'wine'], steps: ['Brown', 'Simmer 3h'] } }
	},
	{
		key: 'plant-collection',
		name: 'Plant collection',
		emoji: '🪴',
		tagline: 'Watering schedules, progress photos, a feed for the club.',
		description: 'Each plant is a thing with care notes and a photo timeline; post progress to a hashtag your plant club follows.',
		steps: ['Create a plants folder with one thing per plant', 'Log watering and repotting under each plant', 'Post progress photos with #plantclub', 'Share the folder read-only with friends'],
		features: ['folders', 'hashtags', 'inline-video', 'hidden-links'],
		audiences: ['hobbyists', 'families'],
		sample: { monstera: { light: 'bright indirect', water: 'weekly', log: [{ date: '2026-08-20', note: 'New leaf' }] } }
	},
	{
		key: 'startup-launch-page',
		name: 'Startup launch page',
		emoji: '🚀',
		tagline: 'A launch page with a waitlist, in an afternoon.',
		description: 'Build a landing page from blocks, publish it at /p/, add Login with Thingtime for early access and post updates to a feed.',
		steps: ['Fork a demo launch page in the builder', 'Edit the hero, add your logo and a waitlist block', 'Publish and share the /p/ link with rich previews', 'Post launch updates with a custom audience of backers'],
		features: ['webpage-builder', 'published-pages', 'og-link-previews', 'login-with-thingtime'],
		audiences: ['founders', 'creators', 'small-business'],
		sample: { launch: { name: 'Acme', tagline: 'Ship faster', waitlist: 148, page: '/p/acme' } }
	},
	{
		key: 'portfolio',
		name: 'Design portfolio',
		emoji: '🖼️',
		tagline: 'A portfolio that wears your own theme.',
		description: 'Projects as things with images and case notes, a themed profile and a built page with a gallery block.',
		steps: ['Create a projects folder with one thing per project', 'Drop images into each project', 'Build a portfolio page and pick or design a theme', 'Publish and put the link in your bio'],
		features: ['webpage-builder', 'themes', 'profiles', 'drop-to-upload'],
		audiences: ['designers', 'creators'],
		sample: { project: { title: 'Rebrand for Ola', year: 2026, role: 'Lead', images: 12 } }
	},
	{
		key: 'study-notes',
		name: 'Study notes',
		emoji: '📚',
		tagline: 'Notes you can search, structure and share with your group.',
		description: 'Courses, topics and flashcards as nested things; search across all of them and share a branch with your study group.',
		steps: ['Create a course thing per subject', 'Nest topics and notes underneath', 'Search across everything before an exam', 'Share the branch with your group'],
		features: ['things-tree', 'search', 'acl-sharing', 'try-without-signup'],
		audiences: ['students', 'educators'],
		sample: { biology: { week3: { topic: 'Cells', notes: 'Mitochondria…', flashcards: 24 } } }
	},
	{
		key: 'class-feed',
		name: 'Class feed',
		emoji: '🍎',
		tagline: 'A private feed for one class, with polls.',
		description: 'A custom audience per class, posts with resources, polls for quick checks and moderated uploads.',
		steps: ['Create a custom audience with the class roster', 'Post resources and reading with that audience', 'Run a poll to check understanding', 'Keep uploads on approval'],
		features: ['custom-audiences', 'polls', 'moderation', 'posts-comments'],
		audiences: ['educators', 'students'],
		sample: { class: { name: '7B Science', students: 28, posts: 41, polls: 6 } }
	},
	{
		key: 'team-wiki',
		name: 'Team wiki',
		emoji: '📖',
		tagline: 'Docs, decisions and chats about them, together.',
		description: 'Structured docs as things, folders per team, spaces for discussion and permissions per branch.',
		steps: ['Create a folder per team', 'Add decision things with context and outcome', 'Open a space for each project', 'Share branches with the people who need them'],
		features: ['folders', 'messages', 'acl-sharing', 'search'],
		audiences: ['teams', 'small-business'],
		sample: { decisions: [{ title: 'Ship weekly', date: '2026-07-01', owner: 'Nik' }] }
	},
	{
		key: 'customer-records',
		name: 'Customer records',
		emoji: '🧾',
		tagline: 'A tiny CRM you actually own.',
		description: 'Customers as things with contact details, notes and history; share a branch with staff, mint a token for your invoicing script.',
		steps: ['Define a customer schema', 'Add customers under a folder', 'Share the folder with staff', 'Mint a scoped token for your scripts'],
		features: ['schemas', 'folders', 'acl-sharing', 'personal-access-tokens'],
		audiences: ['small-business', 'founders'],
		sample: { customer: { name: 'Ada', email: 'ada@example.com', notes: ['Prefers email'], orders: 3 } }
	},
	{
		key: 'inventory',
		name: 'Shop inventory',
		emoji: '📦',
		tagline: 'Stock levels as things, with an API.',
		description: 'Products, stock and suppliers as things; read them from the API and update them with actions.',
		steps: ['Create a products folder with a product schema', 'Log stock movements as child things', 'Read stock from the API in your till', 'Automate reorder flags with an action'],
		features: ['schemas', 'open-api', 'actions', 'bulk-actions'],
		audiences: ['small-business', 'developers'],
		sample: { product: { sku: 'MUG-01', stock: 42, supplier: 'Kiln Co', reorderAt: 10 } }
	},
	{
		key: 'research-dataset',
		name: 'Research dataset',
		emoji: '🔬',
		tagline: 'Structured observations, shareable per branch.',
		description: 'Observations as schema-shaped things, queried raw or read as a document, shared with collaborators precisely.',
		steps: ['Define an observation schema', 'Enter observations as things', 'Query them raw for analysis', 'Share the dataset branch with co-authors'],
		features: ['schemas', 'raw-workbench', 'acl-sharing', 'open-api'],
		audiences: ['researchers', 'educators'],
		sample: { observation: { site: 'Reef 4', temp: 27.1, date: '2026-06-12', species: ['Acropora'] } }
	},
	{
		key: 'home-inventory',
		name: 'Home inventory',
		emoji: '🏠',
		tagline: 'What you own, where it is, what it cost.',
		description: 'Rooms and items as things with photos, receipts and warranty dates; handy for insurance and moving.',
		steps: ['Create a home thing with rooms', 'Add items with price, date and a photo', 'Attach receipts', 'Share with your insurer via a hidden link'],
		features: ['things-tree', 'attachments-media', 'hidden-links', 'search'],
		audiences: ['families', 'power-users'],
		sample: { kitchen: { fridge: { brand: 'Fisher', price: 1899, bought: '2025-11-02', warranty: '2030' } } }
	},
	{
		key: 'trip-planner',
		name: 'Trip planner',
		emoji: '🧳',
		tagline: 'Flights, stays and a shared feed for the trip.',
		description: 'An itinerary as nested things, a space for the travellers and a private feed for photos as you go.',
		steps: ['Create a trip thing with days', 'Add flights, stays and bookings under each day', 'Open a space for everyone travelling', 'Post photos to a trip-only audience'],
		features: ['things-tree', 'messages', 'custom-audiences', 'attachments-media'],
		audiences: ['families', 'hobbyists', 'teams'],
		sample: { trip: { where: 'Kyoto', days: 7, day1: { stay: 'Gion', flight: 'NH 880' } } }
	},
	{
		key: 'reading-list',
		name: 'Reading list',
		emoji: '📕',
		tagline: 'Books, notes, and a feed of what you finished.',
		description: 'Books as things with status and notes, saved articles in your library and a post whenever you finish one.',
		steps: ['Create a books folder', 'Add a book thing with status and notes', 'Save articles to your library', 'Post a finished book with #reading'],
		features: ['folders', 'saved-library', 'hashtags', 'feed'],
		audiences: ['students', 'hobbyists', 'researchers'],
		sample: { book: { title: 'Piranesi', status: 'finished', rating: 5, notes: 'Wow' } }
	},
	{
		key: 'creator-community',
		name: 'Creator community',
		emoji: '🎥',
		tagline: 'Your fans, your feed, your rules.',
		description: 'A feed with a fan audience, polls to decide the next video, reposts, and message requests keeping the inbox sane.',
		steps: ['Create a fans audience', 'Post behind-the-scenes to that audience', 'Run a poll for the next topic', 'Let fans message via requests'],
		features: ['custom-audiences', 'polls', 'reposts-quotes', 'message-requests'],
		audiences: ['creators'],
		sample: { community: { fans: 1280, polls: 4, nextVideo: 'Q&A' } }
	},
	{
		key: 'event-planning',
		name: 'Event planning',
		emoji: '🎉',
		tagline: 'Guests, tasks and a feed for the day.',
		description: 'An event as a thing with guests and tasks, a space for helpers and a page with the details to share.',
		steps: ['Create an event thing with date and venue', 'Add guests and tasks as child things', 'Build a details page and publish it', 'Open a space for helpers'],
		features: ['things-tree', 'webpage-builder', 'messages', 'bulk-actions'],
		audiences: ['families', 'small-business', 'teams'],
		sample: { event: { name: 'Lena’s 40th', date: '2026-10-10', guests: 48, tasks: ['Cake', 'Playlist'] } }
	},
	{
		key: 'fitness-log',
		name: 'Fitness log',
		emoji: '🏋️',
		tagline: 'Workouts as things, progress as a heatmap.',
		description: 'Sessions as things with sets and reps; the activity heatmap shows consistency and the feed keeps you honest.',
		steps: ['Create a workouts folder', 'Log each session with sets and reps', 'Check the heatmap on your profile', 'Post PRs to a friends audience'],
		features: ['things-tree', 'activity-heatmap', 'custom-audiences', 'search'],
		audiences: ['hobbyists', 'power-users'],
		sample: { session: { date: '2026-09-01', squat: { sets: 5, reps: 5, kg: 100 } } }
	},
	{
		key: 'api-side-project',
		name: 'API-first side project',
		emoji: '🧪',
		tagline: 'Skip the backend, keep the ownership.',
		description: 'Use things as your database, Login with Thingtime for auth and a scoped token for your worker; ship the frontend anywhere.',
		steps: ['Add Login with Thingtime to your app', 'Store app data under your app namespace', 'Mint a scoped token for your worker', 'Check the capability manifest before you persist'],
		features: ['login-with-thingtime', 'app-namespaces', 'personal-access-tokens', 'capability-manifest'],
		audiences: ['developers', 'founders'],
		sample: { app: { clientId: 'acme-todo', scopes: ['things.read', 'things.write'], users: 312 } }
	},
	{
		key: 'ai-assistant-memory',
		name: 'AI assistant memory',
		emoji: '🤖',
		tagline: 'Give Claude or ChatGPT a place to keep things.',
		description: 'Connect the MCP server and let your assistant read, search and, with confirmation, write things you can inspect.',
		steps: ['Connect Thingtime in Claude or ChatGPT', 'Grant a token with read scope first', 'Ask it to list and search your things', 'Add write scope for the tools you trust'],
		features: ['mcp-connector', 'chatgpt-app', 'personal-access-tokens', 'agent-chats'],
		audiences: ['power-users', 'developers', 'researchers'],
		sample: { memory: { project: 'Thesis', todo: ['Chapter 3'], lastAsked: '2026-09-01' } }
	},
	{
		key: 'internal-tool',
		name: 'Internal tool',
		emoji: '🛠️',
		tagline: 'Forms, records and automations for the team.',
		description: 'A schema for the record, a builder page with a form, an action to process it and a space to talk about it.',
		steps: ['Define the record schema', 'Build a page with a form block', 'Add an action that runs on new records', 'Share the page with the team'],
		features: ['schemas', 'webpage-builder', 'actions', 'acl-sharing'],
		audiences: ['teams', 'developers', 'small-business'],
		sample: { request: { kind: 'leave-request', who: 'Sam', days: 2, status: 'pending' } }
	},
	{
		key: 'photo-archive',
		name: 'Photo archive',
		emoji: '📷',
		tagline: 'Albums as folders, every photo with its own page.',
		description: 'Photos and videos as things in folders, comments on each file, custom audiences for family and a hidden link for the rest.',
		steps: ['Create an albums folder', 'Drop photos into album folders', 'Share albums with the family audience', 'Send a hidden link for one-off sharing'],
		features: ['attachments-media', 'folders', 'custom-audiences', 'hidden-links'],
		audiences: ['families', 'creators', 'hobbyists'],
		sample: { album: { name: 'Summer 2026', photos: 212, videos: 9 } }
	},
	{
		key: 'product-changelog',
		name: 'Product changelog',
		emoji: '📣',
		tagline: 'Releases as posts, with RSS for free.',
		description: 'Post each release to a public audience, tag it, and let customers subscribe via RSS or follow the profile.',
		steps: ['Post each release with #changelog', 'Attach screenshots and a video', 'Share the RSS link', 'Answer questions in the comments'],
		features: ['feed', 'rss', 'hashtags', 'posts-comments'],
		audiences: ['founders', 'developers', 'teams'],
		sample: { release: { version: '2.4.0', date: '2026-08-30', highlights: ['Polls', 'RSS'] } }
	},
	{
		key: 'club-noticeboard',
		name: 'Club noticeboard',
		emoji: '📌',
		tagline: 'Notices, polls and a members-only feed.',
		description: 'A members audience, posts for notices, polls for decisions and a published page with the essentials.',
		steps: ['Create a members audience', 'Post notices to members', 'Poll the next meetup date', 'Publish a public page with contact details'],
		features: ['custom-audiences', 'polls', 'published-pages', 'message-requests'],
		audiences: ['hobbyists', 'small-business', 'families'],
		sample: { club: { name: 'Bay Runners', members: 64, nextRun: '2026-09-07' } }
	},
	{
		key: 'design-system-hub',
		name: 'Design system hub',
		emoji: '📐',
		tagline: 'Tokens, components and themes in one live place.',
		description: 'Define tokens as a theme, document components with live stories and let people try the theme on.',
		steps: ['Create a theme with your tokens', 'Browse the component library for building blocks', 'Publish a page that demos the system', 'Share the theme id with the team'],
		features: ['themes', 'components-library', 'design-system-docs', 'theme-gallery'],
		audiences: ['designers', 'teams'],
		sample: { theme: { name: 'Acme', accent: '#ff3366', radius: 12, font: 'Inter' } }
	},
	{
		key: 'personal-dashboard',
		name: 'Personal dashboard',
		emoji: '🧭',
		tagline: 'The things you check every morning, on one page.',
		description: 'A built page that pulls from your things: today’s tasks, the plant that needs water, the book you are on.',
		steps: ['Pick the things you check daily', 'Build a page with data blocks for each', 'Add an action to roll tasks forward', 'Keep it private or share with your partner'],
		features: ['webpage-builder', 'actions', 'things-tree', 'acl-sharing'],
		audiences: ['power-users', 'families'],
		sample: { today: { tasks: 3, water: ['monstera'], reading: 'Piranesi' } }
	},
	{
		key: 'secrets-vault',
		name: 'Personal secrets vault',
		emoji: '🔐',
		tagline: 'API keys and codes that stay masked.',
		description: 'Keep keys and codes as sensitive values that render masked and require your password to reveal.',
		steps: ['Create a vault thing', 'Mark each value sensitive', 'Reveal with your password when needed', 'Never share the branch publicly'],
		features: ['sensitive-reveal', 'things-tree', 'passkeys', 'acl-sharing'],
		audiences: ['developers', 'power-users'],
		sample: { vault: { stripeKey: '••••••••', wifi: '••••••' } }
	},
	{
		key: 'podcast-episodes',
		name: 'Podcast episodes',
		emoji: '🎙️',
		tagline: 'Episodes as things, a feed for listeners, RSS out.',
		description: 'Each episode is a thing with notes and audio; post it to listeners and expose RSS.',
		steps: ['Create an episodes folder', 'Add each episode with notes and the audio file', 'Post the episode to your listeners', 'Share the RSS feed link'],
		features: ['attachments-media', 'feed', 'rss', 'published-pages'],
		audiences: ['creators'],
		sample: { episode: { number: 42, title: 'Owning your data', minutes: 51 } }
	},
	{
		key: 'open-data-project',
		name: 'Open data project',
		emoji: '🌍',
		tagline: 'Publish a dataset people can read and query.',
		description: 'A public branch of schema-shaped things with an API and RSS, readable by anyone and forkable by everyone.',
		steps: ['Define the schema', 'Make the dataset branch public', 'Share the API URL and RSS', 'Take contributions via comments'],
		features: ['schemas', 'open-api', 'acl-sharing', 'rss'],
		audiences: ['researchers', 'developers', 'educators'],
		sample: { dataset: { name: 'Bay water quality', rows: 1842, license: 'CC-BY' } }
	},
	{
		key: 'agency-client-pages',
		name: 'Agency client pages',
		emoji: '🏢',
		tagline: 'A page per client, forkable, themeable.',
		description: 'Fork one template page per client, give each its own theme and share editing with the client via a branch.',
		steps: ['Build one template page', 'Fork it per client', 'Apply a client theme', 'Share the page with the client for edits'],
		features: ['webpage-builder', 'themes', 'acl-sharing', 'published-pages'],
		audiences: ['designers', 'small-business'],
		sample: { client: { name: 'Bloom Cafe', page: '/p/bloom', theme: 'Warm' } }
	},
	{
		key: 'device-fleet',
		name: 'Device fleet',
		emoji: '📟',
		tagline: 'Approve, name and control devices from one page.',
		description: 'Paired devices as things with approval, controls and a command timeline.',
		steps: ['Pair a device', 'Approve it from the devices hub', 'Name it and set controls', 'Read the command timeline'],
		features: ['devices-hub', 'personal-access-tokens', 'notifications'],
		audiences: ['power-users', 'developers'],
		sample: { device: { name: 'Studio Mac', approved: true, lastSeen: '2026-09-02' } }
	}
];

export const USE_CASE_BY_KEY: Record<string, UseCase> = Object.fromEntries(USE_CASES.map((useCase) => [useCase.key, useCase]));

export const getUseCase = (key: string): UseCase => {
	const useCase = USE_CASE_BY_KEY[key];
	if (!useCase) throw new Error(`Unknown marketing use case: ${key}`);
	return useCase;
};
