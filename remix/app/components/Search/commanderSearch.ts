import type { SearchPerson, SearchPost, SearchThing } from './searchTypes';
import { thingIcon } from '~/components/Things/thingIcon';

export type CommanderSearchResult = {
	id: string;
	resultType: 'thing' | 'person';
	// The shared /things icon resolver keeps Commander in lockstep with every
	// other Thing surface, including filename-aware attachment icons.
	icon: string;
	// People use their profile image as the primary visual, with the user icon
	// overlaid by Commander as a small type badge.
	avatarUrl: string | null;
	title: string;
	context: string;
	href: string;
};

const firstReadable = (...values: unknown[]): string => {
	for (const value of values) {
		if (typeof value === 'string' && value.trim()) return value.replace(/\s+/g, ' ').trim();
		if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	}
	return '';
};

const primaryKind = (thing: SearchThing): string => thing.thingtime.find((kind) => !['share'].includes(kind)) || thing.thingtime[0] || 'thing';

export const thingDetailPath = (id: string): string => `/thing/${encodeURIComponent(id)}`;

const normalizedQuery = (value: string | undefined): string => (value || '').trim().replace(/^@+/, '').toLowerCase();

const normalizedText = (value: unknown): string => (typeof value === 'string' ? value.trim().toLowerCase() : '');

const startsWithWord = (value: string, query: string): boolean =>
	value.split(/[^\p{L}\p{N}_-]+/u).some((word) => word.startsWith(query));

// Commander mixes two different search backends: Mongo text-ranked Things and
// regex-ranked public profiles. Their raw scores are not comparable, so fuse
// them through product intent tiers instead. Within a tier, the stable source
// order is retained (Thing text relevance or profile API ordering).
const personIntentScore = (person: SearchPerson, query: string): number => {
	if (!query) return 0;
	const username = normalizedText(person.username);
	const displayName = normalizedText(person.displayName);
	if (username === query) return 10_000;
	if (displayName === query) return 9_500;
	if (username.startsWith(query)) return 9_000;
	if (startsWithWord(displayName, query)) return 8_500;
	return 6_000;
};

const thingIntentScore = (thing: SearchThing, query: string): number => {
	if (!query) return 0;
	const title = normalizedText(firstReadable(thing.crystal?.name, thing.crystal?.title));
	if (title === query) return 8_000;
	if (title.startsWith(query) || startsWithWord(title, query)) return 7_000;
	// Mongo's textScore remains useful only within the Things backend; never
	// compare it directly to a profile match. Its API ordering is the tie-break.
	return 1_000;
};

// Enter keeps explicit setter commands ("path = value") on the command path,
// but ordinary text defaults to the pinned full-search row when no suggestion
// has been arrowed/hovered. Keeping this pure makes the keyboard contract easy
// to lock down without mounting the full Commander provider stack.
export const commanderEnterSuggestionIndex = (input: {
	hoveredSuggestion: number | null;
	showSuggestions: boolean;
	commandIsAction: boolean;
	inputValue: string;
}): number | null => {
	if (input.hoveredSuggestion !== null) return input.hoveredSuggestion;
	if (input.showSuggestions && !input.commandIsAction && input.inputValue.trim()) return 0;
	return null;
};

export const commanderSearchResults = (input: {
	query?: string;
	things?: SearchThing[];
	posts?: Record<string, SearchPost>;
	people?: SearchPerson[];
	thingLimit?: number;
	peopleLimit?: number;
}): CommanderSearchResult[] => {
	const things = input.things || [];
	const posts = input.posts || {};
	const people = input.people || [];
	const thingLimit = input.thingLimit ?? 8;
	const peopleLimit = input.peopleLimit ?? 4;
	const query = normalizedQuery(input.query);
	const ranked: Array<{ row: CommanderSearchResult; score: number; sourceOrder: number }> = [];
	let sourceOrder = 0;

	for (const thing of things.slice(0, thingLimit)) {
		const post = posts[thing.id];
		const kind = primaryKind(thing);
		const title = firstReadable(post?.text, thing.crystal?.name, thing.crystal?.title, thing.crystal?.text) || `Untitled ${kind}`;
		const author = thing.author?.username ? `@${thing.author.username}` : 'unknown author';
		const tags = thing.tags
			.slice(0, 2)
			.map((tag) => `#${tag}`)
			.join(' ');
		ranked.push({
			row: {
				id: thing.id,
				resultType: 'thing',
				icon: thingIcon(thing),
				avatarUrl: null,
				title: title.slice(0, 120),
				context: [kind, author, tags].filter(Boolean).join(' · '),
				href: post ? `/post/${encodeURIComponent(thing.id)}` : thingDetailPath(thing.id)
			},
			score: thingIntentScore(thing, query),
			sourceOrder: sourceOrder++
		});
	}

	for (const person of people.slice(0, peopleLimit)) {
		const displayName = firstReadable(person.displayName, person.username) || 'Thingtime person';
		ranked.push({
			row: {
				id: person.id,
				resultType: 'person',
				icon: thingIcon({ thingtime: ['user'] }),
				avatarUrl: person.avatarUrl,
				title: displayName,
				context: [`@${person.username}`, person.bio ? person.bio.replace(/\s+/g, ' ').trim().slice(0, 90) : 'person'].filter(Boolean).join(' · '),
				href: `/profile/${encodeURIComponent(person.username)}`
			},
			score: personIntentScore(person, query),
			sourceOrder: sourceOrder++
		});
	}

	return ranked.sort((left, right) => right.score - left.score || left.sourceOrder - right.sourceOrder).map(({ row }) => row);
};
