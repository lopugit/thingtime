// One audience vocabulary for every Thing surface. Posts, Builder pages,
// components, folders and generic data Things all persist the same ACL
// grammar; this module keeps their quick choices and hidden-link URLs from
// drifting apart.

export type ThingAudience = 'public' | 'friends' | 'family' | 'private' | 'hidden' | 'custom';

export const THING_AUDIENCE_META: Record<ThingAudience, { label: string; emoji: string; hint: string }> = {
	public: { label: 'Public', emoji: '🌐', hint: 'Anyone on Thingtime' },
	friends: { label: 'Friends', emoji: '🤝', hint: 'Your friends circle' },
	family: { label: 'Family', emoji: '🏡', hint: 'Your family circle' },
	private: { label: 'Private', emoji: '🔒', hint: 'Only you' },
	hidden: { label: 'Anyone with the link', emoji: '🕵️', hint: 'Unlisted — anyone holding its secret link can view' },
	custom: { label: 'Custom', emoji: '🎭', hint: 'Pick people or groups and choose read, comment, or edit' }
};

export const THING_AUDIENCES = Object.keys(THING_AUDIENCE_META) as ThingAudience[];

const BASE_ACLS: Record<ThingAudience, string[]> = {
	public: ['tt:all'],
	friends: ['-tt:all', 'tt:userFriends', 'tt:user'],
	family: ['-tt:all', 'tt:userFamily', 'tt:user'],
	private: ['tt:user'],
	hidden: ['tt:hidden', 'tt:user'],
	custom: ['tt:custom', 'tt:user']
};

const isAudienceEntry = (entry: string): boolean =>
	entry === 'tt:all' ||
	entry === '-tt:all' ||
	entry === 'tt:user' ||
	entry === 'tt:userFriends' ||
	entry === 'tt:userFamily' ||
	entry === 'tt:hidden' ||
	entry === 'tt:custom' ||
	entry.startsWith('tt:user/') ||
	entry.startsWith('tt:group/');

export const preservedNonAudienceAcl = (acl: readonly string[] | undefined): string[] =>
	(acl || []).filter((entry): entry is string => typeof entry === 'string' && !isAudienceEntry(entry));

export const aclForAudience = (audience: ThingAudience, current?: readonly string[]): string[] =>
	[...BASE_ACLS[audience], ...preservedNonAudienceAcl(current)].filter((entry, index, all) => all.indexOf(entry) === index);

export const audienceOfAcl = (acl: readonly string[] | undefined): ThingAudience => {
	const list = Array.isArray(acl) ? acl : [];
	// A custom audience may intentionally have a public or hidden baseline, so
	// its marker wins over those baseline entries.
	if (list.includes('tt:custom')) return 'custom';
	if (list.includes('tt:hidden')) return 'hidden';
	if (list.includes('tt:all')) return 'public';
	if (list.includes('tt:userFriends')) return 'friends';
	if (list.includes('tt:userFamily')) return 'family';
	return 'private';
};

type LinkableThing = { id: string; thingtime: readonly string[]; acl?: readonly string[]; linkKey?: string | null };

const universalThingLink = (id: string): string => `/thing/${encodeURIComponent(id)}`;

export const thingPath = (thing: Pick<LinkableThing, 'id' | 'thingtime'>): string => {
	const id = encodeURIComponent(thing.id);
	if (thing.thingtime.includes('folder')) return `/things?folder=${id}`;
	if (thing.thingtime.includes('post')) return `/post/${id}`;
	if (thing.thingtime.includes('action')) return `/actions/${id}`;
	if (thing.thingtime.includes('webpage')) return `/p/${id}`;
	if (thing.thingtime.includes('schema')) return `/schemas/${id}`;
	return universalThingLink(thing.id);
};

// Hidden-link access is guaranteed on the post, webpage, and universal Thing
// readers. Other dedicated routes do not consume bearer keys, so their
// secret links intentionally land on the universal reader instead.
export const sharePathForThing = (thing: LinkableThing): string => {
	const hidden = !!thing.linkKey && !!thing.acl?.includes('tt:hidden');
	if (!hidden) return thingPath(thing);
	const base = thing.thingtime.includes('post')
		? `/post/${encodeURIComponent(thing.id)}`
		: thing.thingtime.includes('webpage')
		? `/p/${encodeURIComponent(thing.id)}`
		: universalThingLink(thing.id);
	return `${base}?key=${encodeURIComponent(thing.linkKey!)}`;
};
