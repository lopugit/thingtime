import type { Concept, Template } from './types';

// Glossary concepts: the vocabulary Thingtime uses, explained for people who
// have never opened FUNDAMENTALS.md. Each becomes an explainer page.

export const CONCEPTS: Concept[] = [
	{ key: 'thing', name: 'Thing', emoji: '📦', definition: 'The unit of everything in Thingtime: a document with a kind, a shape and an access list.', why: 'One unit means one API, one permission model and one UI for notes, posts, pages and app data alike.', related: ['kind', 'tree', 'acl'] },
	{ key: 'kind', name: 'Kind', emoji: '🏷️', definition: 'The label that says what a thing is: post, comment, webpage, theme, schema, attachment and so on.', why: 'Kinds let one collection hold everything while each renderer, index and permission rule knows what it is looking at.', related: ['thing', 'schema', 'projection'] },
	{ key: 'tree', name: 'The tree', emoji: '🌳', definition: 'The nested view of things: keys, arrays and values you can fold, edit and share by branch.', why: 'People think in nested structure; the tree shows the real shape of data without a grid or a form.', related: ['thing', 'branch', 'reader-view'] },
	{ key: 'branch', name: 'Branch', emoji: '🌿', definition: 'Any sub-tree under a key, like user.car.repairs, addressable by its dot path.', why: 'Sharing, hiding and linking work per branch, so you can open exactly one part of your data.', related: ['tree', 'dot-path', 'acl'] },
	{ key: 'dot-path', name: 'Dot path', emoji: '🧭', definition: 'The address of a branch, written like user.car.repairs.', why: 'A path is a stable, human-readable link into structured data for URLs, the palette and the API.', related: ['branch', 'permalink'] },
	{ key: 'acl', name: 'Access list', emoji: '🔐', definition: 'The list of who can see or change a thing: people, groups, apps, the public, or inherit from the parent.', why: 'Private by default, shared precisely: a list per thing beats workspace-wide switches.', related: ['inherit', 'audience', 'hidden-link'] },
	{ key: 'inherit', name: 'Inherit', emoji: '🪜', definition: 'A permission entry that says: use whatever the parent allows, walking up the chain with a depth cap.', why: 'Share a folder once and everything inside follows, without copying rules to every child.', related: ['acl', 'branch'] },
	{ key: 'audience', name: 'Audience', emoji: '🎭', definition: 'A named set of people, groups and capability levels you can attach to a post or thing.', why: 'You decide who sees each post, and reuse the same audience next time.', related: ['acl', 'capability'] },
	{ key: 'capability', name: 'Capability', emoji: '🎟️', definition: 'What a grant allows: read, comment or write, per person or group.', why: 'Comment-only access lets someone join the conversation without touching the data.', related: ['acl', 'audience', 'scope'] },
	{ key: 'hidden-link', name: 'Hidden link', emoji: '🫥', definition: 'An unlisted thing shared through a rotating owner-only link key.', why: 'Share with people who do not have accounts, and revoke by rotating the key.', related: ['acl', 'permalink'] },
	{ key: 'permalink', name: 'Permalink', emoji: '🔗', definition: 'The stable URL of a thing, post, comment or file: /thing/:id, /post/:id, /media/:id.', why: 'Everything is linkable, so conversations and pages can point at exactly one thing.', related: ['dot-path', 'thing'] },
	{ key: 'schema', name: 'Schema', emoji: '💎', definition: 'A reusable description of a kind’s shape that can compose other schemas.', why: 'Describe the shape once and get validation, rendering and docs everywhere.', related: ['kind', 'projection', 'template'] },
	{ key: 'projection', name: 'Projection', emoji: '🔦', definition: 'A public shape of a thing that whitelists fields for a given audience or renderer.', why: 'Projections are how a thing can be public without leaking private fields.', related: ['schema', 'kind'] },
	{ key: 'reader-view', name: 'Reader view', emoji: '📖', definition: 'The document-like rendering of a thing: keys as headings, values as text, booleans as Yes/No.', why: 'Anyone can read structured data without knowing what JSON is.', related: ['tree', 'developer-view'] },
	{ key: 'developer-view', name: 'Developer view', emoji: '💻', definition: 'The raw-structure rendering with type chips, count pills and the wizard menu.', why: 'Developers see the exact shape the API returns, in the same UI.', related: ['reader-view', 'tree'] },
	{ key: 'feed-algorithm', name: 'Feed algorithm', emoji: '🧮', definition: 'A pluggable ranking for the feed that can learn from how you scroll.', why: 'You choose how your feed thinks, and you can switch when it stops serving you.', related: ['thing', 'post'] },
	{ key: 'post', name: 'Post', emoji: '📰', definition: 'A thing of kind post with text, attachments, a poll and an audience; comments are posts too.', why: 'Because posts are things, they are exportable, linkable and owned by you.', related: ['comment', 'audience', 'attachment'] },
	{ key: 'comment', name: 'Comment', emoji: '💬', definition: 'A post whose parent is another post, with its own permalink and reactions.', why: 'Threads never lose context, and any reply can be shared on its own.', related: ['post', 'permalink'] },
	{ key: 'reaction', name: 'Reaction', emoji: '❤️', definition: 'A child thing that records one person’s emoji on a post, aggregated on read.', why: 'Stored relationally, so counts stay right and any emoji is allowed.', related: ['post', 'relational-child'] },
	{ key: 'relational-child', name: 'Relational child', emoji: '🧬', definition: 'Appended data such as reactions, comments or votes, stored as its own thing linked by parentId.', why: 'Parents never grow unbounded arrays, and aggregation is one query per kind.', related: ['reaction', 'comment', 'poll'] },
	{ key: 'poll', name: 'Poll', emoji: '📊', definition: 'A post with a question and options; each vote is a relational child thing.', why: 'Live tallies without fragile counters.', related: ['post', 'relational-child'] },
	{ key: 'attachment', name: 'Attachment', emoji: '🖼️', definition: 'A file stored as a thing with a detected content type and its own /media page.', why: 'Files get comments, reactions, permissions and links like everything else.', related: ['post', 'crystal'] },
	{ key: 'crystal', name: 'Crystal', emoji: '🔮', definition: 'The stored representation of a file or secure blob inside a thing, with unique keys.', why: 'Uploads and secrets sit safely inside the same model without special tables.', related: ['attachment', 'secure-blob'] },
	{ key: 'secure-blob', name: 'Secure blob', emoji: '🔒', definition: 'An encrypted value stored inside a thing, used for passkeys, tokens and handoffs.', why: 'Secrets live in the same tree, but never in plain text.', related: ['crystal', 'passkey'] },
	{ key: 'passkey', name: 'Passkey', emoji: '🔏', definition: 'A WebAuthn credential that signs you in with your device’s biometrics.', why: 'No password to phish, and it works across Thingtime deployments.', related: ['secure-blob', 'session'] },
	{ key: 'session', name: 'Session', emoji: '🍪', definition: 'A signed cookie plus a database record that can be revoked at any time.', why: 'Log out everywhere, really.', related: ['passkey', 'pat'] },
	{ key: 'pat', name: 'Personal access token', emoji: '🗝️', definition: 'A bearer token minted with exact scopes for scripts, apps and assistants.', why: 'Default deny means a token can only do what you ticked.', related: ['scope', 'session'] },
	{ key: 'scope', name: 'Scope', emoji: '🎯', definition: 'A named permission such as things.read or things.write attached to a token or app grant.', why: 'Exact scopes never cover ancestors, so grants stay narrow.', related: ['pat', 'app-grant'] },
	{ key: 'app-grant', name: 'App grant', emoji: '🧩', definition: 'The consent a user gives an app through Login with Thingtime, bound to the app’s origin.', why: 'An app can only act from where it said it lives.', related: ['scope', 'app-namespace'] },
	{ key: 'app-namespace', name: 'App namespace', emoji: '📦', definition: 'The shelf where an app stores data for a user, visible at /apps.', why: 'Apps cannot read each other’s data, and you can revoke a shelf whole.', related: ['app-grant', 'scope'] },
	{ key: 'webpage', name: 'Webpage', emoji: '🧱', definition: 'A thing that holds a bounded tree of blocks, rendered at /p/<id>.', why: 'Pages are data, so they are forkable, shareable and versioned like everything else.', related: ['block', 'component'] },
	{ key: 'block', name: 'Block', emoji: '🟦', definition: 'One node of a webpage: text, media, grid, form, component or html, with inspector controls.', why: 'A small vocabulary of blocks keeps pages safe and editable in place.', related: ['webpage', 'component'] },
	{ key: 'component', name: 'Component', emoji: '🧩', definition: 'A reusable template thing with typed args, capped when it resolves.', why: 'Build once, drop everywhere, and never blow up a page with a runaway repeat.', related: ['block', 'action'] },
	{ key: 'action', name: 'Action', emoji: '⚡', definition: 'A declarative program with a closed vocabulary, a shared budget and run records.', why: 'Automation you can read, audit and stop.', related: ['component', 'run-record'] },
	{ key: 'run-record', name: 'Run record', emoji: '🧾', definition: 'The thing an executor mints for each action run, with inputs, effects and outcome.', why: 'Every automation leaves a receipt.', related: ['action'] },
	{ key: 'app-suite', name: 'App suite', emoji: '📲', definition: 'A bundle of pages, schemas, components and actions installable into your account.', why: 'Whole apps as things, forked into your own keys.', related: ['webpage', 'action', 'schema'] },
	{ key: 'theme', name: 'Theme', emoji: '🎨', definition: 'A JSON document of colour, font, radius, border and shadow tokens applied as CSS variables.', why: 'Every surface re-themes live, and themes are shareable by id.', related: ['token', 'preset'] },
	{ key: 'token', name: 'Design token', emoji: '🎚️', definition: 'A named visual value like --tt-accent or --tt-radius that components read instead of hard-coding.', why: 'Change a token, change the app.', related: ['theme'] },
	{ key: 'preset', name: 'Preset', emoji: '🌈', definition: 'A built-in theme: Fable (neo-brutalist landing look) or Prism (refined product look).', why: 'Two starting points that already feel finished.', related: ['theme'] },
	{ key: 'lopu', name: 'Lopu', emoji: '🦄', definition: 'The unicorn toast and assistant every notification and AI musing flows through.', why: 'One consistent voice for everything the app says to you.', related: ['thing'] },
	{ key: 'mcp', name: 'MCP', emoji: '🤖', definition: 'Model Context Protocol, the standard Thingtime’s AI connector speaks so Claude and ChatGPT can use tools.', why: 'Assistants get real tools with real scopes instead of copy-paste.', related: ['pat', 'scope'] },
	{ key: 'capability-manifest', name: 'Capability manifest', emoji: '🧾', definition: 'A machine-readable list of every API feature with a semver version.', why: 'Clients negotiate compatibility before persisting anything.', related: ['scope'] },
	{ key: 'deployment', name: 'Deployment', emoji: '🚀', definition: 'One running Thingtime: production, a branch preview or your own fork, each with its own database.', why: 'Previews are real, isolated apps, and federated login moves you between them.', related: ['peer', 'session'] },
	{ key: 'peer', name: 'Deployment peer', emoji: '🕸️', definition: 'Another deployment linked with secure tokens for cross-deployment sync.', why: 'Move things between preview and production safely.', related: ['deployment'] },
	{ key: 'optimistic-ui', name: 'Optimistic UI', emoji: '⚡', definition: 'The house rule that the app paints the last known state instantly and reconciles in the background.', why: 'No spinners when there is something to show.', related: ['thing'] },
	{ key: 'template', name: 'Template', emoji: '🧬', definition: 'A starting shape for a thing or page you can fork and fill in.', why: 'Start from something real instead of an empty box.', related: ['schema', 'webpage'] }
];

export const CONCEPT_BY_KEY: Record<string, Concept> = Object.fromEntries(CONCEPTS.map((concept) => [concept.key, concept]));

// Starter templates: shapes people can copy on day one. Each is a small
// "kind of thing" with fields and a use case it belongs to.
export const TEMPLATES: Template[] = [
	{ key: 'car', name: 'Car', emoji: '🚗', summary: 'Make, model, plate, mileage, repairs.', useCase: 'car-maintenance-log', fields: ['make', 'model', 'plate', 'km', 'repairs[]'] },
	{ key: 'recipe', name: 'Recipe', emoji: '🍲', summary: 'Ingredients, steps, serves, photo.', useCase: 'recipe-book', fields: ['name', 'serves', 'ingredients[]', 'steps[]', 'photo'] },
	{ key: 'plant', name: 'Plant', emoji: '🪴', summary: 'Light, water, log of care.', useCase: 'plant-collection', fields: ['name', 'light', 'water', 'log[]'] },
	{ key: 'launch', name: 'Launch page', emoji: '🚀', summary: 'Hero, features, waitlist, footer.', useCase: 'startup-launch-page', fields: ['hero', 'features[]', 'waitlist', 'footer'] },
	{ key: 'project', name: 'Portfolio project', emoji: '🖼️', summary: 'Title, year, role, images, notes.', useCase: 'portfolio', fields: ['title', 'year', 'role', 'images[]', 'notes'] },
	{ key: 'course', name: 'Course', emoji: '📚', summary: 'Weeks, topics, notes, flashcards.', useCase: 'study-notes', fields: ['name', 'weeks[]', 'notes', 'flashcards[]'] },
	{ key: 'class', name: 'Class', emoji: '🍎', summary: 'Roster, resources, polls.', useCase: 'class-feed', fields: ['name', 'roster[]', 'resources[]'] },
	{ key: 'decision', name: 'Decision record', emoji: '📖', summary: 'Context, options, outcome, owner.', useCase: 'team-wiki', fields: ['title', 'context', 'options[]', 'outcome', 'owner'] },
	{ key: 'customer', name: 'Customer', emoji: '🧾', summary: 'Contact, notes, orders.', useCase: 'customer-records', fields: ['name', 'email', 'phone', 'notes[]', 'orders[]'] },
	{ key: 'product', name: 'Product', emoji: '📦', summary: 'SKU, stock, supplier, reorder point.', useCase: 'inventory', fields: ['sku', 'name', 'stock', 'supplier', 'reorderAt'] },
	{ key: 'observation', name: 'Observation', emoji: '🔬', summary: 'Site, date, measurements, species.', useCase: 'research-dataset', fields: ['site', 'date', 'measurements', 'species[]'] },
	{ key: 'room', name: 'Room inventory', emoji: '🏠', summary: 'Items with price, date, warranty.', useCase: 'home-inventory', fields: ['name', 'items[]'] },
	{ key: 'trip', name: 'Trip', emoji: '🧳', summary: 'Days, flights, stays, bookings.', useCase: 'trip-planner', fields: ['where', 'from', 'to', 'days[]'] },
	{ key: 'book', name: 'Book', emoji: '📕', summary: 'Title, author, status, rating, notes.', useCase: 'reading-list', fields: ['title', 'author', 'status', 'rating', 'notes'] },
	{ key: 'event', name: 'Event', emoji: '🎉', summary: 'Date, venue, guests, tasks.', useCase: 'event-planning', fields: ['name', 'date', 'venue', 'guests[]', 'tasks[]'] },
	{ key: 'workout', name: 'Workout', emoji: '🏋️', summary: 'Date, exercises, sets, reps, weight.', useCase: 'fitness-log', fields: ['date', 'exercises[]'] },
	{ key: 'app-record', name: 'App record', emoji: '🧪', summary: 'Client id, scopes, users, notes.', useCase: 'api-side-project', fields: ['clientId', 'scopes[]', 'users', 'notes'] },
	{ key: 'memory', name: 'Assistant memory', emoji: '🤖', summary: 'Project, todo, facts, last asked.', useCase: 'ai-assistant-memory', fields: ['project', 'todo[]', 'facts[]', 'lastAsked'] },
	{ key: 'request', name: 'Request form', emoji: '🛠️', summary: 'Kind, who, details, status.', useCase: 'internal-tool', fields: ['kind', 'who', 'details', 'status'] },
	{ key: 'album', name: 'Album', emoji: '📷', summary: 'Name, date, photos, videos.', useCase: 'photo-archive', fields: ['name', 'date', 'photos[]', 'videos[]'] },
	{ key: 'release', name: 'Release', emoji: '📣', summary: 'Version, date, highlights, links.', useCase: 'product-changelog', fields: ['version', 'date', 'highlights[]', 'links[]'] },
	{ key: 'club', name: 'Club', emoji: '📌', summary: 'Members, notices, next meetup.', useCase: 'club-noticeboard', fields: ['name', 'members[]', 'notices[]', 'nextMeetup'] },
	{ key: 'theme-spec', name: 'Theme spec', emoji: '📐', summary: 'Accent, radius, fonts, shadows.', useCase: 'design-system-hub', fields: ['name', 'accent', 'radius', 'fonts', 'shadow'] },
	{ key: 'today', name: 'Today', emoji: '🧭', summary: 'Tasks, water, reading, notes.', useCase: 'personal-dashboard', fields: ['tasks[]', 'water[]', 'reading', 'notes'] },
	{ key: 'vault', name: 'Vault', emoji: '🔐', summary: 'Masked keys and codes.', useCase: 'secrets-vault', fields: ['keys{}', 'codes{}'] },
	{ key: 'episode', name: 'Episode', emoji: '🎙️', summary: 'Number, title, notes, audio.', useCase: 'podcast-episodes', fields: ['number', 'title', 'notes', 'audio'] },
	{ key: 'dataset', name: 'Dataset', emoji: '🌍', summary: 'Name, license, rows, schema.', useCase: 'open-data-project', fields: ['name', 'license', 'rows[]', 'schema'] },
	{ key: 'client', name: 'Client', emoji: '🏢', summary: 'Name, page, theme, contacts.', useCase: 'agency-client-pages', fields: ['name', 'page', 'theme', 'contacts[]'] },
	{ key: 'device', name: 'Device', emoji: '📟', summary: 'Name, approved, last seen, controls.', useCase: 'device-fleet', fields: ['name', 'approved', 'lastSeen', 'controls'] },
	{ key: 'community', name: 'Community', emoji: '🎥', summary: 'Fans, polls, next video.', useCase: 'creator-community', fields: ['fans', 'polls[]', 'nextVideo'] }
];

export const TEMPLATE_BY_KEY: Record<string, Template> = Object.fromEntries(TEMPLATES.map((template) => [template.key, template]));
