import { isFolderThing } from '../../schemas/folderThing';
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
	hidden: { label: 'Anyone with the link', emoji: '🕵️', hint: 'Unlisted — anyone with its URL can view' },
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

export type ResolvedAudience = { sourceId: string; acl: string[]; linkKey?: string };

type LinkableThing = { audience?: ResolvedAudience; id: string; thingtime: readonly string[]; crystal?: Record<string, unknown>; acl?: readonly string[]; linkKey?: string | null };

const universalThingLink = (id: string): string => `/thing/${encodeURIComponent(id)}`;

export const thingPath = (thing: Pick<LinkableThing, 'id' | 'thingtime' | 'crystal'>): string => {
	const id = encodeURIComponent(thing.id);
	if (thing.thingtime.includes('attachment')) return `/media/${id}`;
	if (thing.thingtime.includes('comment')) return `/post/${id}`;
	if (isFolderThing(thing)) return `/things?folder=${id}`;
	if (thing.thingtime.includes('post')) return `/post/${id}`;
	if (thing.thingtime.includes('action')) return `/actions/${id}`;
	if (thing.thingtime.includes('webpage')) return `/p/${id}`;
	if (thing.thingtime.includes('schema')) return `/schemas/${id}`;
	if (thing.thingtime.length === 1 && thing.thingtime[0] === 'chat-archive') return `${universalThingLink(thing.id)}?archive=true`;
	return universalThingLink(thing.id);
};

// Unlisted Things use canonical exact-id readers, without secret query parameters.
// Other kind browsers may be listing-oriented, so use the universal reader there.
export const sharePathForThing = (thing: LinkableThing): string => {
	const hidden = !!(thing.audience?.acl || thing.acl)?.includes('tt:hidden');
	if (!hidden) return thingPath(thing);
	const base = thing.thingtime.includes('attachment')
		? `/media/${encodeURIComponent(thing.id)}`
		: thing.thingtime.includes('post') || thing.thingtime.includes('comment')
		? `/post/${encodeURIComponent(thing.id)}`
		: thing.thingtime.includes('webpage')
		? `/p/${encodeURIComponent(thing.id)}`
		: universalThingLink(thing.id);
	return base;
};

// Never enumerate a group's private roster just to explain its audience.
export const audienceDescription = (acl: readonly string[] | undefined, noun = 'post', inherited = false): string => {
  const entries = acl || [];
  if (entries.includes('tt:inherit')) return 'follows the parent’s audience';
  const excluded = entries.some(entry => entry.startsWith('-tt:') && entry !== '-tt:all');
  if (excluded) return `selected people can see this ${noun} · exclusions apply`;
  if (entries.includes('tt:all') && !entries.includes('-tt:all')) return `anyone can see this ${noun}`;
  const people = [...new Set(entries.filter(entry => entry.startsWith('tt:user/')).map(entry =>
    '@' + entry.slice(8).replace(/\/(?:read|comment|write)$/, '')))];
  const groups = entries.filter(entry => entry.startsWith('tt:group/')).length;
  const audiences = [...people];
  if (groups) audiences.push(groups === 1 ? 'members of the selected group' : `members of ${groups} selected groups`);
  if (entries.includes('tt:userFriends')) audiences.push(inherited ? 'the parent’s friends circle' : 'the author’s friends');
  if (entries.includes('tt:userFamily')) audiences.push(inherited ? 'the parent’s family circle' : 'the author’s family');
  if (entries.includes('tt:hidden')) audiences.push('people with the link');
  if (audiences.length === 1 && audiences[0] === 'people with the link') return 'only people with the link';
  if (!audiences.length) return `only ${inherited ? 'the parent’s owner' : 'the author'} can see this ${noun}`;
  return `only ${audiences.join(', ')} can see this ${noun}`;
};
