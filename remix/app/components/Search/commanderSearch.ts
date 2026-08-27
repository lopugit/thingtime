import type { SearchPerson, SearchPost, SearchThing } from './searchTypes';

export type CommanderSearchResult = {
	id: string;
	resultType: 'thing' | 'person';
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
			title: displayName,
			context: [`@${person.username}`, person.bio ? person.bio.replace(/\s+/g, ' ').trim().slice(0, 90) : 'person'].filter(Boolean).join(' · '),
			href: `/profile/${encodeURIComponent(person.username)}`
		});
	}

	return rows;
};
