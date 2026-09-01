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
	const rows: CommanderSearchResult[] = [];

	for (const thing of things.slice(0, thingLimit)) {
		const post = posts[thing.id];
		const kind = primaryKind(thing);
		const title = firstReadable(post?.text, thing.crystal?.name, thing.crystal?.title, thing.crystal?.text) || `Untitled ${kind}`;
		const author = thing.author?.username ? `@${thing.author.username}` : 'unknown author';
		const tags = thing.tags
			.slice(0, 2)
			.map((tag) => `#${tag}`)
			.join(' ');
		rows.push({
			id: thing.id,
			resultType: 'thing',
			icon: thingIcon(thing),
			avatarUrl: null,
			title: title.slice(0, 120),
			context: [kind, author, tags].filter(Boolean).join(' · '),
			href: post ? `/post/${encodeURIComponent(thing.id)}` : thingDetailPath(thing.id)
		});
	}

	for (const person of people.slice(0, peopleLimit)) {
		const displayName = firstReadable(person.displayName, person.username) || 'Thingtime person';
		rows.push({
			id: person.id,
			resultType: 'person',
			icon: thingIcon({ thingtime: ['user'] }),
			avatarUrl: person.avatarUrl,
			title: displayName,
			context: [`@${person.username}`, person.bio ? person.bio.replace(/\s+/g, ' ').trim().slice(0, 90) : 'person'].filter(Boolean).join(' · '),
			href: `/profile/${encodeURIComponent(person.username)}`
		});
	}

	return rows;
};
