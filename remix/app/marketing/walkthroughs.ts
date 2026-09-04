import { FEATURES } from './features';
import { byKey } from './lookup';
import type { Feature, MockScreenKey, UseCase, Walkthrough, WalkthroughStep } from './types';
import { USE_CASES } from './useCases';

// Animated cursor walkthroughs. Each mock screen (components/Marketing/
// MockScreens.tsx) exposes named targets via data-wt attributes; a script is
// a list of steps that move, click, type and scroll over those targets. The
// player resolves targets to positions at runtime, so scripts stay pure data.

// Targets every mock screen guarantees. Tests assert scripts only use these.
export const SCREEN_TARGETS: Record<MockScreenKey, string[]> = {
	feed: [
		'nav-search',
		'drawer-trigger',
		'algorithm-picker',
		'composer',
		'composer-media',
		'composer-poll',
		'composer-audience',
		'composer-post',
		'post-1',
		'post-1-react',
		'post-1-comment',
		'post-1-repost',
		'post-1-menu',
		'post-2',
		'hashtag'
	],
	things: [
		'tree-root',
		'branch-car',
		'branch-repairs',
		'value-km',
		'add-input',
		'add-button',
		'mode-view',
		'mode-edit',
		'mode-editor',
		'share',
		'folder-recipes',
		'context-menu',
		'search'
	],
	builder: ['canvas', 'block-hero', 'block-text', 'block-media', 'inspector', 'inspector-padding', 'add-block', 'blocks-menu', 'publish', 'media-drop', 'preview'],
	messages: ['space-1', 'chat-1', 'requests-tab', 'composer', 'send', 'new-space', 'message-1'],
	themes: ['preset-fable', 'preset-prism', 'token-accent', 'token-radius', 'save', 'gallery', 'try-on', 'share-id'],
	components: ['search', 'card-1', 'card-2', 'args', 'docs-tab', 'install', 'demo'],
	settings: ['tokens', 'mint', 'scope-read', 'scope-write', 'passkeys', 'passkey-add', 'notifications', 'switcher', 'devices', 'apps'],
	developer: ['endpoint', 'curl', 'run', 'response', 'manifest', 'mcp', 'tests', 'status'],
	search: ['palette', 'result-1', 'result-2', 'open', 'command'],
	profile: ['header', 'gallery', 'heatmap', 'try-on', 'follow', 'post-1', 'media-1']
};

const step = (target: string, action: WalkthroughStep['action'], label: string, extra: Partial<WalkthroughStep> = {}): WalkthroughStep => ({
	target,
	action,
	label,
	...extra
});

// Generic tour per screen — used when a feature has no bespoke script. The
// feature name is woven into the captions so no two walkthroughs read alike.
const GENERIC_TOURS: Record<MockScreenKey, (feature: Feature) => WalkthroughStep[]> = {
	feed: (feature) => [
		step('composer', 'click', `Open the composer to see ${feature.name} in action`),
		step('composer', 'type', 'Write a post like you would anywhere', { text: `Trying ${feature.name} in Thingtime 🌈` }),
		step('composer-audience', 'click', 'Pick exactly who sees it'),
		step('composer-post', 'click', 'Post it: it is a thing you own now'),
		step('post-1-react', 'hover', 'Long-press a reaction for the full emoji picker'),
		step('post-1-react', 'click', 'Reactions toggle instantly'),
		step('post-1-menu', 'click', `Every post carries ${feature.name.toLowerCase()} in its menu`, { hold: 900 })
	],
	things: (feature) => [
		step('tree-root', 'click', 'Open the tree: every thing you keep, nested'),
		step('branch-car', 'click', 'Fold a branch open'),
		step('value-km', 'hover', 'Values edit inline with a dashed underline'),
		step('mode-edit', 'click', 'Switch to edit mode'),
		step('add-input', 'type', `Add a thing for ${feature.name.toLowerCase()}`, { text: feature.name.toLowerCase() }),
		step('add-button', 'click', 'Confetti. It is saved.'),
		step('share', 'click', 'Share this branch with exactly the right people', { hold: 900 })
	],
	builder: (feature) => [
		step('add-block', 'click', 'Add a block to the canvas'),
		step('blocks-menu', 'click', `Pick the block ${feature.name} needs`),
		step('block-hero', 'click', 'Select the hero'),
		step('block-hero', 'type', 'Edit text right on the page', { text: feature.tagline }),
		step('inspector-padding', 'click', 'Tune spacing in the inspector'),
		step('media-drop', 'hover', 'Drop media anywhere on the canvas'),
		step('publish', 'click', 'Publish: it is live at /p/ instantly', { hold: 900 })
	],
	messages: (feature) => [
		step('space-1', 'click', 'Open a space'),
		step('message-1', 'hover', 'Every message is a thing'),
		step('composer', 'type', `Tell the team about ${feature.name}`, { text: `Have you tried ${feature.name}?` }),
		step('send', 'click', 'Send'),
		step('requests-tab', 'click', 'Strangers land in requests, not your inbox', { hold: 900 })
	],
	themes: (feature) => [
		step('preset-fable', 'click', 'Start from Fable, the brutalist landing look'),
		step('preset-prism', 'click', 'Or Prism, the refined product look'),
		step('token-accent', 'click', `Change the accent: ${feature.name} re-themes live`),
		step('token-radius', 'click', 'Radius, borders and shadows are tokens too'),
		step('save', 'click', 'Save it as a named theme'),
		step('share-id', 'click', 'Share it by id', { hold: 900 })
	],
	components: (feature) => [
		step('search', 'type', `Search the library for ${feature.name.split(' ')[0].toLowerCase()}`, { text: feature.name.split(' ')[0].toLowerCase() }),
		step('card-1', 'click', 'Open a component'),
		step('args', 'click', 'Every arg is typed and capped'),
		step('docs-tab', 'click', 'Docs are generated from the same source'),
		step('install', 'click', 'Install it into your account', { hold: 900 })
	],
	settings: (feature) => [
		step('tokens', 'click', `Open settings for ${feature.name}`),
		step('mint', 'click', 'Mint a token'),
		step('scope-read', 'click', 'Tick only the scopes you need'),
		step('passkeys', 'click', 'Add a passkey for password-free login'),
		step('notifications', 'click', 'Decide what reaches you by push or email', { hold: 900 })
	],
	developer: (feature) => [
		step('endpoint', 'click', `Find the endpoint behind ${feature.name}`),
		step('curl', 'hover', 'Copy the curl: same API the UI uses'),
		step('run', 'click', 'Run it from the docs'),
		step('response', 'hover', 'JSON in, JSON out'),
		step('manifest', 'click', 'Check the capability manifest before you persist'),
		step('mcp', 'click', 'Or let an AI assistant call it through MCP', { hold: 900 })
	],
	search: (feature) => [
		step('palette', 'click', 'Press ⌘P from anywhere'),
		step('palette', 'type', `Type what you are after`, { text: feature.name.toLowerCase() }),
		step('result-1', 'hover', 'Things and commands, together'),
		step('result-1', 'click', 'Open it'),
		step('command', 'click', 'Commands run from the same box', { hold: 900 })
	],
	profile: (feature) => [
		step('header', 'hover', 'Your profile wears your theme'),
		step('gallery', 'click', 'Every upload is a thing with a page'),
		step('heatmap', 'hover', `Your year of ${feature.name.toLowerCase()} at a glance`),
		step('try-on', 'click', 'Try a theme on'),
		step('follow', 'click', 'Follow people, not algorithms', { hold: 900 })
	]
};

// Bespoke scripts for the features people ask about most.
const FEATURE_TOURS: Record<string, WalkthroughStep[]> = {
	feed: [
		step('composer', 'click', 'Tap the composer'),
		step('composer', 'type', 'Say something', { text: 'First post in Thingtime 🌈' }),
		step('composer-media', 'click', 'Attach a photo or a video'),
		step('composer-poll', 'click', 'Or add a poll'),
		step('composer-audience', 'click', 'Choose the audience: public, people, groups'),
		step('composer-post', 'click', 'Post'),
		step('algorithm-picker', 'click', 'Pick how your feed ranks things', { hold: 900 })
	],
	reactions: [
		step('post-1', 'hover', 'Find a post you love'),
		step('post-1-react', 'click', 'Tap to react'),
		step('post-1-react', 'hover', 'Long-press for every emoji'),
		step('post-1-react', 'click', 'Toggle it off just as fast', { hold: 800 })
	],
	polls: [
		step('composer', 'click', 'Open the composer'),
		step('composer-poll', 'click', 'Add a poll'),
		step('composer', 'type', 'Ask the question', { text: 'Next video: Q&A or tutorial?' }),
		step('composer-audience', 'click', 'Send it to the right audience'),
		step('composer-post', 'click', 'Post: every vote is its own thing', { hold: 900 })
	],
	'reposts-quotes': [
		step('post-1', 'hover', 'A post worth sharing'),
		step('post-1-repost', 'click', 'Repost instantly'),
		step('post-1-repost', 'click', 'Or quote it with a caption'),
		step('composer', 'type', 'Add your take', { text: 'This. 👇' }),
		step('composer-post', 'click', 'Post the quote', { hold: 800 })
	],
	'custom-audiences': [
		step('composer', 'click', 'Open the composer'),
		step('composer-audience', 'click', 'Open the audience picker'),
		step('composer-audience', 'type', 'Search people to add', { text: 'ada' }),
		step('composer-audience', 'click', 'Give comment-only or write access'),
		step('composer-post', 'click', 'Post to exactly those people', { hold: 900 })
	],
	'things-tree': [
		step('tree-root', 'click', 'Open your tree'),
		step('branch-car', 'click', 'Fold the car open'),
		step('branch-repairs', 'click', 'Repairs is an array of things'),
		step('value-km', 'click', 'Click a value to edit it inline'),
		step('add-input', 'type', 'Add a new thing', { text: 'insurance' }),
		step('add-button', 'click', 'Saved, with confetti', { hold: 900 })
	],
	'view-edit-editor-modes': [
		step('mode-view', 'click', 'View: a document anyone can read'),
		step('mode-edit', 'click', 'Edit: dashed underlines, inline changes'),
		step('value-km', 'click', 'Change a value'),
		step('mode-editor', 'click', 'Editor: the raw shape for developers', { hold: 900 })
	],
	folders: [
		step('folder-recipes', 'click', 'Open a folder'),
		step('branch-car', 'click', 'Select a thing'),
		step('folder-recipes', 'click', 'Drag it into the folder'),
		step('context-menu', 'click', 'Right-click for move, copy, share, delete', { hold: 900 })
	],
	'acl-sharing': [
		step('branch-car', 'click', 'Pick the branch to share'),
		step('share', 'click', 'Open sharing'),
		step('share', 'type', 'Add a person, group or app', { text: 'mechanic' }),
		step('share', 'click', 'Children inherit from the parent chain', { hold: 900 })
	],
	'hidden-links': [
		step('branch-car', 'click', 'Pick a thing'),
		step('share', 'click', 'Mark it hidden'),
		step('share', 'hover', 'Copy the rotating link key'),
		step('share', 'click', 'Rotate it to revoke old links', { hold: 900 })
	],
	'webpage-builder': [
		step('add-block', 'click', 'Add a block'),
		step('blocks-menu', 'click', 'Hero, text, media, grid, form…'),
		step('block-hero', 'click', 'Select the hero'),
		step('block-hero', 'type', 'Type straight onto the page', { text: 'Hello, internet' }),
		step('block-media', 'click', 'Select the media block'),
		step('media-drop', 'hover', 'Drop an image, it uploads'),
		step('inspector-padding', 'click', 'Adjust spacing in the inspector'),
		step('preview', 'click', 'Preview is pixel-identical'),
		step('publish', 'click', 'Publish to /p/', { hold: 900 })
	],
	'published-pages': [
		step('block-hero', 'click', 'Finish the page'),
		step('publish', 'click', 'Publish'),
		step('preview', 'click', 'Visitors need no account'),
		step('preview', 'hover', 'Media serves anonymously through inherited permissions', { hold: 900 })
	],
	messages: [
		step('new-space', 'click', 'Create a space for the team'),
		step('space-1', 'click', 'Open it'),
		step('composer', 'type', 'Say hi', { text: 'Welcome to the space 👋' }),
		step('send', 'click', 'Send'),
		step('chat-1', 'click', 'Chats are one-to-one'),
		step('requests-tab', 'click', 'Strangers wait in requests', { hold: 900 })
	],
	themes: [
		step('preset-fable', 'click', 'Fable: radius 0, hard shadows, hotpink'),
		step('preset-prism', 'click', 'Prism: soft radii, refined'),
		step('token-accent', 'click', 'Edit the accent token'),
		step('token-radius', 'click', 'Edit the radius'),
		step('save', 'click', 'Save as a named theme'),
		step('gallery', 'click', 'Browse the gallery'),
		step('try-on', 'click', 'Try one on', { hold: 900 })
	],
	'personal-access-tokens': [
		step('tokens', 'click', 'Open tokens in settings'),
		step('mint', 'click', 'Mint a new token'),
		step('scope-read', 'click', 'Tick things.read'),
		step('scope-write', 'click', 'Add things.write only if the script needs it'),
		step('mint', 'click', 'Copy it once; revoke any time', { hold: 900 })
	],
	passkeys: [
		step('passkeys', 'click', 'Open passkeys'),
		step('passkey-add', 'click', 'Add a passkey'),
		step('passkey-add', 'hover', 'Face, touch or a security key'),
		step('passkeys', 'click', 'Sign in without a password next time', { hold: 900 })
	],
	'mcp-connector': [
		step('mcp', 'click', 'Open the MCP docs'),
		step('mcp', 'hover', 'Copy the server URL into Claude or ChatGPT'),
		step('endpoint', 'click', 'OAuth with PKCE, no pasted tokens'),
		step('run', 'click', 'Reads work right away'),
		step('response', 'hover', 'Writes ask you to confirm', { hold: 900 })
	],
	'open-api': [
		step('endpoint', 'click', 'Pick an endpoint'),
		step('curl', 'hover', 'The curl is the same call the UI makes'),
		step('run', 'click', 'Run it'),
		step('response', 'hover', 'JSON back'),
		step('manifest', 'click', 'Negotiate features by semver', { hold: 900 })
	],
	'command-palette': [
		step('palette', 'click', 'Press ⌘P'),
		step('palette', 'type', 'Imagine…', { text: 'car repairs' }),
		step('result-1', 'hover', 'Mono path, emoji, preview'),
		step('result-1', 'click', 'Open the thing', { hold: 900 })
	],
	search: [
		step('palette', 'click', 'Open search'),
		step('palette', 'type', 'Search things, posts and people', { text: '🌈 rainbow' }),
		step('result-1', 'hover', 'Emoji search works'),
		step('result-2', 'click', 'Deep-link into the branch', { hold: 900 })
	],
	'activity-heatmap': [
		step('header', 'hover', 'Open a profile'),
		step('heatmap', 'hover', 'Every day you posted or edited'),
		step('heatmap', 'click', 'Rainbow intensity', { hold: 900 })
	],
	profiles: [
		step('header', 'hover', 'Your profile, your theme'),
		step('gallery', 'click', 'Media gallery of every upload'),
		step('media-1', 'click', 'Each file has a page'),
		step('try-on', 'click', 'Try a theme on the profile', { hold: 900 })
	],
	'components-library': [
		step('search', 'type', 'Search 1000+ components', { text: 'card' }),
		step('card-1', 'click', 'Open one'),
		step('demo', 'hover', 'Live demo'),
		step('args', 'click', 'Typed args with caps'),
		step('docs-tab', 'click', 'Docs twin, same source', { hold: 900 })
	],
	'app-suites': [
		step('search', 'type', 'Find a suite', { text: 'pokeworld' }),
		step('card-2', 'click', 'Open the suite'),
		step('install', 'click', 'Install: pages, schemas and actions'),
		step('demo', 'click', 'Your copy resolves under your keys', { hold: 900 })
	],
	notifications: [
		step('notifications', 'click', 'Open notifications'),
		step('notifications', 'hover', 'A matrix of events by push and email'),
		step('notifications', 'click', 'Flip only what you want', { hold: 900 })
	],
	'account-switcher': [
		step('switcher', 'click', 'Open the switcher'),
		step('switcher', 'hover', 'Roster paints from cache, no spinner'),
		step('switcher', 'click', 'Switch instantly', { hold: 900 })
	],
	'devices-hub': [
		step('devices', 'click', 'Open devices'),
		step('devices', 'hover', 'Approve a new device'),
		step('devices', 'click', 'Power, network and audio controls', { hold: 900 })
	]
};

export const walkthroughForFeature = (feature: Feature): Walkthrough => {
	const steps = FEATURE_TOURS[feature.key] ?? GENERIC_TOURS[feature.screen](feature);
	return {
		key: `feature-${feature.key}`,
		title: `${feature.name} walkthrough`,
		screen: feature.screen,
		feature: feature.key,
		intro: `Watch the cursor: ${feature.tagline.replace(/\.$/, '')}, in ${steps.length} moves.`,
		steps
	};
};

export const walkthroughForUseCase = (useCase: UseCase): Walkthrough => {
	const rootKey = Object.keys(useCase.sample)[0] ?? useCase.key;
	const steps: WalkthroughStep[] = [
		step('tree-root', 'click', 'Open your tree'),
		step('add-input', 'type', useCase.steps[0], { text: rootKey }),
		step('add-button', 'click', 'It is a thing now'),
		step('branch-car', 'click', useCase.steps[1]),
		step('value-km', 'click', 'Edit values inline'),
		step('share', 'click', useCase.steps[3], { hold: 900 })
	];
	return {
		key: `use-case-${useCase.key}`,
		title: `${useCase.name}: guided tour`,
		screen: 'things',
		feature: useCase.features[0],
		intro: `${useCase.tagline} Follow the cursor through ${steps.length} moves.`,
		steps
	};
};

export const WALKTHROUGHS: Walkthrough[] = [...FEATURES.map(walkthroughForFeature), ...USE_CASES.map(walkthroughForUseCase)];

export const WALKTHROUGH_BY_KEY: Record<string, Walkthrough> = byKey(WALKTHROUGHS, (walkthrough) => walkthrough.key);

export const getWalkthrough = (key: string): Walkthrough => {
	const walkthrough = WALKTHROUGH_BY_KEY[key];
	if (!walkthrough) throw new Error(`Unknown walkthrough: ${key}`);
	return walkthrough;
};
