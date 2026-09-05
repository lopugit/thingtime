#!/usr/bin/env node
// Live verification of the Subspaces + up/down vote family — real API only,
// no mocks, no direct DB access (FUNDAMENTALS §2). Registers fixture users,
// founds a subspace, joins/leaves, posts with title + flair, votes up/down on
// posts and comments (flip/clear/one-per-user), reads every sort, moderates
// (remove → redaction, approve, pin, lock → 423, flair), bans (posting +
// voting blocked, ban outlives leaving), restricted/private access walls,
// the generic-things escape hatches staying closed, the capability
// manifest advertising the new contracts, (round 2, section M) the
// lifecycle: role/ban notifications, ownership transfer and deletion with
// every 4xx wall, and (section N) join requests to private subspaces +
// posting-approval requests in restricted ones — request/cancel/accept/deny,
// the mod-only queues and counts, every 4xx wall, and the S2 review fixes
// (a kicked approved poster can't post, a pending row takes only decisions,
// withdrawn requests can't be decided, access flips resolve the queues, an
// expired ban heals, the mods' bell is deduped), and (section O) user flairs:
// the settings, every self / moderator wall, template + custom + clear, the
// batched authorFlair projection on posts, fresh comments, nested replies and
// both feeds, live template renames, the mod-log rule, kicked / banned
// wearers hidden, the manifest.
//
//   node scripts/verify-subspaces.mjs [baseUrl]
//
// baseUrl defaults to TT_VERIFY_BASE or this worktree's web port.

import { randomBytes } from 'node:crypto';

const BASE = process.argv[2] || process.env.TT_VERIFY_BASE || `http://127.0.0.1:${process.env.TT_WEB_PORT || 14960}`;

let passed = 0;
const failures = [];
// Local databases that still need the admin storage-accounting migration
// answer every PATCH with this 503 (develop-wide gate, unrelated to the
// subspace family); those checks are reported as skipped instead of failed so
// the walk stays honest about what it could and couldn't exercise.
const skipped = [];
const STORAGE_MIGRATION_GATE = /storage migration/i;
const isStorageGate = (result) => result.status === 503 && STORAGE_MIGRATION_GATE.test(String(result.body?.error || ''));
const checkOrSkip = (name, result, condition, detail = '') => {
	if (isStorageGate(result)) {
		skipped.push(name);
		console.log(`  ⚠ ${name} — skipped: this database needs the admin storage migration before PATCH works`);
		return;
	}
	check(name, condition, detail);
};
const check = (name, condition, detail = '') => {
	if (condition) {
		passed += 1;
		console.log(`  ✓ ${name}`);
	} else {
		failures.push(name);
		console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
	}
};

const api = async (path, { cookie, method = 'GET', body } = {}) => {
	const response = await fetch(`${BASE}${path}`, {
		method,
		headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
		...(body !== undefined ? { body: JSON.stringify(body) } : {})
	});
	let json = null;
	try {
		json = await response.json();
	} catch {
		// non-JSON — callers assert on status
	}
	return { status: response.status, body: json };
};

const suffix = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;

// Fixture accounts are stable per day (the register endpoint is rate-limited
// per IP, so repeated runs log back in instead of minting new users); the
// subspace slug stays unique per run.
const PASSWORD = 'Verify1234!pass';
const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const sessionOf = async (path, payload) => {
	const response = await fetch(`${BASE}${path}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload)
	});
	const setCookie = response.headers.get('set-cookie') || '';
	const match = /tt_auth=[^;]+/.exec(setCookie);
	const body = await response.json().catch(() => null);
	return { ok: response.ok && !!match, status: response.status, body, cookie: match?.[0] || null };
};
const register = async (name) => {
	const username = `${name}${day}`;
	const login = await sessionOf('/api/v1/login', { username, password: PASSWORD });
	if (login.ok) return { username, id: login.body.user.id, cookie: login.cookie };
	const registered = await sessionOf('/api/v1/auth/register', { username, password: PASSWORD, email: `${username}@example.com` });
	if (!registered.ok) throw new Error(`registration failed for ${username}: ${JSON.stringify(registered.body)}`);
	return { username, id: registered.body.user.id, cookie: registered.cookie };
};

const run = async () => {
	console.log(`Subspaces verification against ${BASE}\n`);

	console.log('A. fixtures + auth walls');
	const owner = await register('vs-owner-');
	const mod = await register('vs-mod-');
	const member = await register('vs-member-');
	const stranger = await register('vs-stranger-');
	const slug = `verify_${suffix}`.slice(0, 30);

	const anonCreate = await api('/api/v1/subspaces', { method: 'POST', body: { slug, name: 'x' } });
	check('anonymous create → 401', anonCreate.status === 401);
	const anonVote = await api('/api/v1/things/updown', { method: 'POST', body: { id: 'nope', direction: 'up' } });
	check('anonymous updown → 401', anonVote.status === 401);

	console.log('\nB. found a subspace');
	const badSlug = await api('/api/v1/subspaces', { method: 'POST', cookie: owner.cookie, body: { slug: 'ab', name: 'Too short' } });
	check('slug shorter than 3 chars → 400', badSlug.status === 400, JSON.stringify(badSlug.body));
	const reserved = await api('/api/v1/subspaces', { method: 'POST', cookie: owner.cookie, body: { slug: 'all', name: 'All' } });
	check('reserved slug → 400', reserved.status === 400);
	const created = await api('/api/v1/subspaces', {
		method: 'POST',
		cookie: owner.cookie,
		body: {
			slug,
			name: 'Verify Space',
			description: 'A verification subspace 🧪',
			access: 'public',
			rules: [{ title: 'Be kind', text: 'No gatekeeping.' }, 'No spam'],
			flairs: [{ label: 'Photo', emoji: '📸', color: '#7c5cff' }, { id: 'mods', label: 'Announcement', modOnly: true }],
			branding: { icon: '🧪', accent: '#22aa88' }
		}
	});
	check('create → 201 with owner viewer state', created.status === 201 && created.body?.subspace?.viewer?.role === 'owner' && created.body.subspace.viewer.canModerate === true, JSON.stringify(created.body));
	const subspace = created.body.subspace;
	check('flairs sanitized (slug ids, modOnly kept)', subspace.flairs?.[0]?.id === 'photo' && subspace.flairs?.[1]?.modOnly === true);
	check('rules accept strings + objects', subspace.rules?.length === 2 && subspace.rules[1].title === 'No spam');
	const dup = await api('/api/v1/subspaces', { method: 'POST', cookie: mod.cookie, body: { slug, name: 'Dup' } });
	check('duplicate slug → 409', dup.status === 409);
	const generic = await api('/api/v1/things', { method: 'POST', cookie: owner.cookie, body: { thingtime: ['subspace'], crystal: { slug: 'sneaky', name: 'Sneaky' } } });
	check('generic POST /things refuses the subspace kind', generic.status === 403, JSON.stringify(generic.body));
	const genericVote = await api('/api/v1/things', { method: 'POST', cookie: owner.cookie, body: { thingtime: ['updown'], crystal: { direction: 'up', updownKey: 'x~y' }, targetId: subspace.id } });
	check('generic POST /things refuses the updown kind', genericVote.status === 403);

	console.log('\nC. directory + detail + join/leave');
	const listed = await api(`/api/v1/subspaces?q=${slug.slice(0, 12)}`);
	check('directory search finds it (anonymous)', listed.status === 200 && listed.body.subspaces.some((entry) => entry.slug === slug));
	const detail = await api(`/api/v1/subspaces/get?slug=${slug}`, { cookie: member.cookie });
	check('detail carries counts + mods + non-member viewer', detail.status === 200 && detail.body.subspace.memberCount === 1 && detail.body.moderators.length === 1 && detail.body.subspace.viewer.member === false && detail.body.subspace.viewer.canPost === true);
	const joinMember = await api('/api/v1/subspaces/join', { method: 'POST', cookie: member.cookie, body: { slug } });
	check('join → member', joinMember.status === 200 && joinMember.body.joined === true && joinMember.body.subspace.viewer.role === 'member' && joinMember.body.subspace.memberCount === 2);
	const joinAgain = await api('/api/v1/subspaces/join', { method: 'POST', cookie: member.cookie, body: { slug } });
	check('join twice is a no-op', joinAgain.status === 200 && joinAgain.body.joined === false);
	await api('/api/v1/subspaces/join', { method: 'POST', cookie: mod.cookie, body: { slug } });
	const mine = await api('/api/v1/subspaces?mine=1', { cookie: member.cookie });
	check('mine=1 lists the joined subspace', mine.status === 200 && mine.body.subspaces.some((entry) => entry.slug === slug));
	const ownerLeave = await api('/api/v1/subspaces/leave', { method: 'POST', cookie: owner.cookie, body: { slug } });
	check('owner cannot leave → 409', ownerLeave.status === 409);

	console.log('\nD. roles + moderator roster');
	const promoteByMod = await api('/api/v1/subspaces/members', { method: 'POST', cookie: member.cookie, body: { slug, username: mod.username, action: 'role', role: 'moderator' } });
	check('non-mod cannot promote → 403', promoteByMod.status === 403);
	const promote = await api('/api/v1/subspaces/members', { method: 'POST', cookie: owner.cookie, body: { slug, username: mod.username, action: 'role', role: 'moderator' } });
	check('owner promotes a moderator', promote.status === 200 && promote.body.member.role === 'moderator');
	const roster = await api(`/api/v1/subspaces/members?slug=${slug}&role=moderator`);
	check('mod roster is public', roster.status === 200 && roster.body.members.some((entry) => entry.userId === mod.id));
	const fullListAnon = await api(`/api/v1/subspaces/members?slug=${slug}`);
	check('full member list is mod-only (403 anonymous)', fullListAnon.status === 403);
	const fullList = await api(`/api/v1/subspaces/members?slug=${slug}`, { cookie: mod.cookie });
	check('moderator sees the member list', fullList.status === 200 && fullList.body.members.length === 3);

	console.log('\nE. posting with title + flair');
	const badFlair = await api('/api/v1/things', { method: 'POST', cookie: member.cookie, body: { type: 'text', text: 'hi', title: 'Nope', subspaceId: subspace.id, flairId: 'missing' } });
	check('unknown flair → 400', badFlair.status === 400, JSON.stringify(badFlair.body));
	const modOnlyFlair = await api('/api/v1/things', { method: 'POST', cookie: member.cookie, body: { type: 'text', text: 'hi', title: 'Nope', subspaceId: subspace.id, flairId: 'mods' } });
	check('mod-only flair by a member → 403', modOnlyFlair.status === 403);
	const posted = await api('/api/v1/things', {
		method: 'POST',
		cookie: member.cookie,
		body: { type: 'text', text: 'First thread body', title: 'Hello subspace 👋', subspaceId: subspace.id, flairId: 'photo', visibility: 'public' }
	});
	check('member posts with title + flair', posted.status === 200 && posted.body.post?.title === 'Hello subspace 👋' && posted.body.post.flair?.id === 'photo' && posted.body.post.subspace?.slug === slug, JSON.stringify(posted.body));
	const post = posted.body.post;
	check('post carries empty votes + approved mod state', post.votes?.score === 0 && post.subspaceMod?.removed === false && post.subspaceMod.viewerCanModerate === false);
	const stray = await api('/api/v1/things', { method: 'POST', cookie: stranger.cookie, body: { type: 'text', text: 'not a member but public', title: 'Stranger post', subspaceId: subspace.id } });
	check('public subspace: non-member may post', stray.status === 200);
	const strayPost = stray.body.post;
	const second = await api('/api/v1/things', { method: 'POST', cookie: owner.cookie, body: { type: 'text', text: 'Owner post', title: 'Owner post', subspaceId: subspace.id, flairId: 'mods' } });
	check('owner uses the mod-only flair', second.status === 200 && second.body.post.flair?.id === 'mods');
	const ownerPost = second.body.post;
	const unifiedRead = await api(`/api/v1/things?id=${post.id}`, { cookie: stranger.cookie });
	check('single read projects title/subspace/votes', unifiedRead.status === 200 && unifiedRead.body.post?.title === 'Hello subspace 👋' && unifiedRead.body.post.subspace?.id === subspace.id && unifiedRead.body.post.votes);

	console.log('\nF. up/down votes on posts and comments');
	const up = await api('/api/v1/things/updown', { method: 'POST', cookie: owner.cookie, body: { id: post.id, direction: 'up' } });
	check('upvote → score 1, viewerVote up', up.status === 200 && up.body.votes.score === 1 && up.body.votes.viewerVote === 'up', JSON.stringify(up.body));
	const upAgain = await api('/api/v1/things/updown', { method: 'POST', cookie: owner.cookie, body: { id: post.id, direction: 'up' } });
	check('same direction again clears', upAgain.status === 200 && upAgain.body.votes.score === 0 && upAgain.body.votes.viewerVote === null);
	await api('/api/v1/things/updown', { method: 'POST', cookie: owner.cookie, body: { id: post.id, direction: 'up' } });
	const flip = await api('/api/v1/things/updown', { method: 'POST', cookie: owner.cookie, body: { id: post.id, direction: 'down' } });
	check('other direction flips in place (one vote per user)', flip.status === 200 && flip.body.votes.up === 0 && flip.body.votes.down === 1 && flip.body.votes.score === -1);
	await api('/api/v1/things/updown', { method: 'POST', cookie: mod.cookie, body: { id: post.id, direction: 'up' } });
	await api('/api/v1/things/updown', { method: 'POST', cookie: stranger.cookie, body: { id: post.id, direction: 'up' } });
	const cleared = await api('/api/v1/things/updown', { method: 'POST', cookie: owner.cookie, body: { id: post.id, direction: null } });
	check('null clears; tally aggregates every voter', cleared.status === 200 && cleared.body.votes.up === 2 && cleared.body.votes.down === 0 && cleared.body.votes.viewerVote === null);
	const badDirection = await api('/api/v1/things/updown', { method: 'POST', cookie: owner.cookie, body: { id: post.id, direction: 'sideways' } });
	check('bad direction → 400', badDirection.status === 400);
	const reactStill = await api('/api/v1/things/react', { method: 'POST', cookie: owner.cookie, body: { id: post.id, emoji: '🌈' } });
	check('native emoji reactions still work beside votes', reactStill.status === 200 && reactStill.body.viewerReactions?.includes('🌈'));
	const commented = await api('/api/v1/things/comment', { method: 'POST', cookie: stranger.cookie, body: { id: post.id, text: 'nice thread' } });
	check('comment carries votes', commented.status === 200 && commented.body.comment?.votes?.score === 0, JSON.stringify(commented.body));
	const comment = commented.body.comment;
	const commentUp = await api('/api/v1/things/updown', { method: 'POST', cookie: member.cookie, body: { id: comment.id, direction: 'up' } });
	check('comments are votable', commentUp.status === 200 && commentUp.body.votes.score === 1);
	const readAfter = await api(`/api/v1/things?id=${post.id}`, { cookie: member.cookie });
	check('projection carries post tally + comment tally + reactions', readAfter.body.post.votes.up === 2 && readAfter.body.post.comments?.[0]?.votes?.score === 1 && readAfter.body.post.reactionCounts?.['🌈'] === 1);
	const voteSubspace = await api('/api/v1/things/updown', { method: 'POST', cookie: owner.cookie, body: { id: subspace.id, direction: 'up' } });
	check('only posts/comments are votable', voteSubspace.status === 400 || voteSubspace.status === 404);

	console.log('\nG. feed sorts');
	for (const sort of ['hot', 'new', 'top', 'rising', 'controversial']) {
		const feed = await api(`/api/v1/subspaces/feed?slug=${slug}&sort=${sort}`);
		check(`sort=${sort} lists the posts (anonymous)`, feed.status === 200 && feed.body.sort === sort && feed.body.posts.length === 3, JSON.stringify(feed.body?.error));
	}
	const top = await api(`/api/v1/subspaces/feed?slug=${slug}&sort=top&range=day`);
	check('top ranks the most-upvoted post first', top.body.posts?.[0]?.id === post.id);
	const homeFeed = await api('/api/v1/things/feed?algorithm=latest&limit=50', { cookie: stranger.cookie });
	check('home feed carries subspace posts with their embed', homeFeed.body.posts.some((entry) => entry.id === post.id && entry.subspace?.slug === slug));

	console.log('\nH. moderation');
	const removeByMember = await api('/api/v1/subspaces/moderate', { method: 'POST', cookie: stranger.cookie, body: { id: post.id, action: 'remove' } });
	check('non-mod cannot moderate → 403', removeByMember.status === 403);
	const removed = await api('/api/v1/subspaces/moderate', { method: 'POST', cookie: mod.cookie, body: { id: strayPost.id, action: 'remove', reason: 'Rule 2' } });
	check('mod removes a post', removed.status === 200 && removed.body.post.subspaceMod.removed === true && removed.body.post.subspaceMod.reason === 'Rule 2');
	const asStranger = await api(`/api/v1/things?id=${strayPost.id}`, { cookie: member.cookie });
	check('removed post is redacted for others (no body/title, reason hidden)', asStranger.status === 200 && asStranger.body.post.text === '' && asStranger.body.post.title === null && asStranger.body.post.subspaceMod.removed === true && asStranger.body.post.subspaceMod.reason === null);
	const asAuthor = await api(`/api/v1/things?id=${strayPost.id}`, { cookie: stranger.cookie });
	check('author still sees their removed post + reason', asAuthor.body.post.text === 'not a member but public' && asAuthor.body.post.subspaceMod.reason === 'Rule 2');
	const feedAfterRemove = await api(`/api/v1/subspaces/feed?slug=${slug}&sort=new`);
	check('removed post leaves the subspace feed', !feedAfterRemove.body.posts.some((entry) => entry.id === strayPost.id));
	const homeAfterRemove = await api('/api/v1/things/feed?algorithm=latest&limit=50', { cookie: member.cookie });
	check('removed post leaves the home feed', !homeAfterRemove.body.posts.some((entry) => entry.id === strayPost.id));
	const queue = await api(`/api/v1/subspaces/feed?slug=${slug}&sort=new&includeRemoved=1`, { cookie: mod.cookie });
	check('mods can include removed posts', queue.body.posts.some((entry) => entry.id === strayPost.id && entry.text === 'not a member but public'));
	const approved = await api('/api/v1/subspaces/moderate', { method: 'POST', cookie: mod.cookie, body: { id: strayPost.id, action: 'approve' } });
	check('approve restores it', approved.status === 200 && approved.body.post.subspaceMod.removed === false && approved.body.post.text === 'not a member but public');
	const pinned = await api('/api/v1/subspaces/moderate', { method: 'POST', cookie: owner.cookie, body: { id: ownerPost.id, action: 'pin' } });
	check('pin', pinned.status === 200 && pinned.body.post.subspaceMod.pinned === true);
	const newFeed = await api(`/api/v1/subspaces/feed?slug=${slug}&sort=new`);
	check('pinned post leads sort=new', newFeed.body.posts[0]?.id === ownerPost.id);
	const locked = await api('/api/v1/subspaces/moderate', { method: 'POST', cookie: owner.cookie, body: { id: post.id, action: 'lock' } });
	check('lock', locked.status === 200 && locked.body.post.subspaceMod.locked === true);
	const lockedComment = await api('/api/v1/things/comment', { method: 'POST', cookie: stranger.cookie, body: { id: post.id, text: 'still here?' } });
	check('locked post refuses comments → 423', lockedComment.status === 423, `${lockedComment.status} ${JSON.stringify(lockedComment.body)}`);
	const lockedReply = await api('/api/v1/things/comment', { method: 'POST', cookie: stranger.cookie, body: { id: comment.id, text: 'nested?' } });
	check('lock covers nested replies too', lockedReply.status === 423);
	const modComment = await api('/api/v1/things/comment', { method: 'POST', cookie: mod.cookie, body: { id: post.id, text: 'mods may' } });
	check('moderators can still comment on a locked post', modComment.status === 200);
	const reflair = await api('/api/v1/subspaces/moderate', { method: 'POST', cookie: mod.cookie, body: { id: post.id, action: 'flair', flairId: 'mods' } });
	check('mod sets a mod-only flair on any post', reflair.status === 200 && reflair.body.post.flair?.id === 'mods');
	const ownFlair = await api('/api/v1/things', { method: 'PATCH', cookie: member.cookie, body: { id: post.id, crystal: { flairId: 'photo' } } });
	checkOrSkip('author changes their own flair via PATCH', ownFlair, ownFlair.status === 200 && ownFlair.body.post?.flair?.id === 'photo', `${ownFlair.status} ${JSON.stringify(ownFlair.body).slice(0, 300)}`);
	const ownModFlair = await api('/api/v1/things', { method: 'PATCH', cookie: member.cookie, body: { id: post.id, crystal: { flairId: 'mods' } } });
	checkOrSkip('author cannot take a mod-only flair via PATCH', ownModFlair, ownModFlair.status === 403, `${ownModFlair.status} ${JSON.stringify(ownModFlair.body).slice(0, 300)}`);
	const modlog = await api(`/api/v1/subspaces/modlog?slug=${slug}`, { cookie: mod.cookie });
	check('mod log records the actions', modlog.status === 200 && ['post.remove', 'post.approve', 'post.pin', 'post.lock', 'post.flair', 'member.role'].every((action) => modlog.body.entries.some((entry) => entry.action === action)), JSON.stringify(modlog.body.entries?.map((entry) => entry.action)));
	const modlogAnon = await api(`/api/v1/subspaces/modlog?slug=${slug}`, { cookie: member.cookie });
	check('mod log is mod-only', modlogAnon.status === 403);

	console.log('\nI. bans');
	const ban = await api('/api/v1/subspaces/members', { method: 'POST', cookie: mod.cookie, body: { slug, username: stranger.username, action: 'ban', reason: 'Rule 1', banDays: 7 } });
	check('mod bans a user (pre-emptive, never joined)', ban.status === 200 && ban.body.member.banned === true && !!ban.body.member.banUntil);
	const bannedPost = await api('/api/v1/things', { method: 'POST', cookie: stranger.cookie, body: { type: 'text', text: 'banned?', title: 'x', subspaceId: subspace.id } });
	check('banned user cannot post', bannedPost.status === 403);
	const bannedVote = await api('/api/v1/things/updown', { method: 'POST', cookie: stranger.cookie, body: { id: ownerPost.id, direction: 'up' } });
	check('banned user cannot vote in the subspace', bannedVote.status === 403);
	const bannedComment = await api('/api/v1/things/comment', { method: 'POST', cookie: stranger.cookie, body: { id: ownerPost.id, text: 'banned?' } });
	check('banned user cannot comment in the subspace', bannedComment.status === 403);
	const bannedJoin = await api('/api/v1/subspaces/join', { method: 'POST', cookie: stranger.cookie, body: { slug } });
	check('banned user cannot join', bannedJoin.status === 403);
	const banList = await api(`/api/v1/subspaces/members?slug=${slug}&banned=1`, { cookie: mod.cookie });
	check('ban list shows them', banList.status === 200 && banList.body.members.some((entry) => entry.userId === stranger.id && entry.banned));
	const banMod = await api('/api/v1/subspaces/members', { method: 'POST', cookie: mod.cookie, body: { slug, username: owner.username, action: 'ban' } });
	check('the owner cannot be banned', banMod.status === 403);
	const unban = await api('/api/v1/subspaces/members', { method: 'POST', cookie: mod.cookie, body: { slug, username: stranger.username, action: 'unban' } });
	check('unban', unban.status === 200 && unban.body.member.banned === false);
	const afterUnban = await api('/api/v1/things/updown', { method: 'POST', cookie: stranger.cookie, body: { id: ownerPost.id, direction: 'up' } });
	check('unbanned user votes again', afterUnban.status === 200);

	console.log('\nJ. restricted + private access');
	const restrict = await api('/api/v1/subspaces/update', { method: 'POST', cookie: owner.cookie, body: { slug, access: 'restricted' } });
	check('owner switches to restricted', restrict.status === 200 && restrict.body.subspace.access === 'restricted');
	const restrictByMod = await api('/api/v1/subspaces/update', { method: 'POST', cookie: mod.cookie, body: { slug, access: 'public' } });
	check('moderators cannot change access → 403', restrictByMod.status === 403);
	const unapprovedPost = await api('/api/v1/things', { method: 'POST', cookie: member.cookie, body: { type: 'text', text: 'may I?', title: 'r', subspaceId: subspace.id } });
	check('restricted: unapproved member cannot post', unapprovedPost.status === 403);
	const approveMember = await api('/api/v1/subspaces/members', { method: 'POST', cookie: mod.cookie, body: { slug, userId: member.id, action: 'approve' } });
	check('approve poster', approveMember.status === 200 && approveMember.body.member.approved === true);
	const approvedPost = await api('/api/v1/things', { method: 'POST', cookie: member.cookie, body: { type: 'text', text: 'approved now', title: 'r', subspaceId: subspace.id } });
	check('restricted: approved member posts', approvedPost.status === 200);
	const priv = await api('/api/v1/subspaces/update', { method: 'POST', cookie: owner.cookie, body: { slug, access: 'private' } });
	check('owner switches to private', priv.status === 200 && priv.body.subspace.access === 'private');
	const privFeedStranger = await api(`/api/v1/subspaces/feed?slug=${slug}&sort=new`, { cookie: stranger.cookie });
	check('private feed walls non-members → 403', privFeedStranger.status === 403);
	const privFeedMember = await api(`/api/v1/subspaces/feed?slug=${slug}&sort=new`, { cookie: member.cookie });
	check('private feed serves members', privFeedMember.status === 200 && privFeedMember.body.posts.length >= 3);
	const privRead = await api(`/api/v1/things?id=${post.id}`, { cookie: stranger.cookie });
	check('private-subspace post hidden from non-members on direct read', privRead.status === 404, String(privRead.status));
	const privHome = await api('/api/v1/things/feed?algorithm=latest&limit=50', { cookie: stranger.cookie });
	check('private-subspace posts leave the non-member home feed', !privHome.body.posts.some((entry) => entry.subspace?.id === subspace.id));
	const privHomeMember = await api('/api/v1/things/feed?algorithm=latest&limit=50', { cookie: member.cookie });
	check('members still see them on the home feed', privHomeMember.body.posts.some((entry) => entry.subspace?.id === subspace.id));
	const privJoin = await api('/api/v1/subspaces/join', { method: 'POST', cookie: stranger.cookie, body: { slug } });
	check(
		'private join files a JOIN REQUEST (200, joined false, pending true, not a member)',
		privJoin.status === 200 && privJoin.body.joined === false && privJoin.body.pending === true && privJoin.body.subspace?.viewer?.pending === true && privJoin.body.subspace.viewer.member === false,
		`${privJoin.status} ${JSON.stringify(privJoin.body).slice(0, 200)}`
	);
	const pendingFeed = await api(`/api/v1/subspaces/feed?slug=${slug}&sort=new`, { cookie: stranger.cookie });
	check('a pending request is not a membership (feed still 403)', pendingFeed.status === 403);
	const addStranger = await api('/api/v1/subspaces/members', { method: 'POST', cookie: mod.cookie, body: { slug, username: stranger.username, action: 'add' } });
	check('mod `add` on the pending row activates it', addStranger.status === 200 && addStranger.body.member.left === false && addStranger.body.member.pending === false, `${addStranger.status} ${JSON.stringify(addStranger.body).slice(0, 200)}`);
	const privReadAfter = await api(`/api/v1/things?id=${post.id}`, { cookie: stranger.cookie });
	check('added member can read the private post', privReadAfter.status === 200);
	const leaveMember = await api('/api/v1/subspaces/leave', { method: 'POST', cookie: member.cookie, body: { slug } });
	check('member leaves', leaveMember.status === 200 && leaveMember.body.subspace.viewer.member === false);
	const leftRead = await api(`/api/v1/subspaces/feed?slug=${slug}`, { cookie: member.cookie });
	check('after leaving a private subspace the feed walls again', leftRead.status === 403);

	console.log('\nK. settings + capability manifest');
	const settings = await api('/api/v1/subspaces/update', { method: 'POST', cookie: mod.cookie, body: { slug, name: 'Verify Space ✨', description: 'Updated', branding: { accent: 'hotpink' }, rules: ['One'], flairs: [{ label: 'Meta' }] } });
	check('mod edits identity/branding/rules/flairs', settings.status === 200 && settings.body.subspace.name === 'Verify Space ✨' && settings.body.subspace.branding.accent === 'hotpink' && settings.body.subspace.flairs[0].id === 'meta');
	const manifest = await api('/api/v1/capabilities');
	check('capability manifest advertises the new contracts (subspaces 1.2.0, updown 1.0.0, things-feed 1.2.0 — authorFlair)', manifest.status === 200 && manifest.body.features?.['api.subspaces'] === '1.2.0' && manifest.body.features['api.things-updown'] === '1.0.0' && manifest.body.features['api.things-feed'] === '1.2.0', JSON.stringify({ s: manifest.body?.features?.['api.subspaces'], u: manifest.body?.features?.['api.things-updown'], f: manifest.body?.features?.['api.things-feed'] }));
	const docs = await api('/api/v1/subspaces/moderate-docs');
	check('docs routes answer for the family', docs.status === 200 && docs.body.docs?.endpoint === '/api/v1/subspaces/moderate');

	console.log('\nL. cascade');
	const del = await api(`/api/v1/things?id=${ownerPost.id}`, { method: 'DELETE', cookie: owner.cookie });
	check('author deletes a voted post', del.status === 200);
	const goneVote = await api('/api/v1/things/updown', { method: 'POST', cookie: stranger.cookie, body: { id: ownerPost.id, direction: 'up' } });
	check('votes on a deleted post 404', goneVote.status === 404);

	console.log('\nM. lifecycle — notifications, transfer, delete');
	const SUBSPACE_NOTIFICATION_TYPES = ['subspace-join-request', 'subspace-join-accepted', 'subspace-post-removed', 'subspace-report', 'subspace-role', 'subspace-ban'];
	const notifsOf = async (cookie) => {
		const resp = await api('/api/v1/notifications?limit=50', { cookie });
		return { status: resp.status, items: resp.body?.notifications || [] };
	};
	const summarize = (items) => JSON.stringify(items.filter((n) => String(n.type).startsWith('subspace-')).map((n) => [n.type, n.preview]));
	// earlier sections already rang the bell: D promoted the mod, I banned + unbanned the stranger
	const modNotifs = await notifsOf(mod.cookie);
	check(
		'promotion rang subspace-role for the new mod (targetId = subspace, preview leads with s/<slug>)',
		modNotifs.status === 200 && modNotifs.items.some((n) => n.type === 'subspace-role' && n.targetId === subspace.id && String(n.preview || '').startsWith(`s/${slug} ·`) && /moderator/.test(n.preview || '')),
		summarize(modNotifs.items)
	);
	const strangerNotifs = await notifsOf(stranger.cookie);
	check(
		'ban + unban rang subspace-ban twice for the user',
		strangerNotifs.status === 200 && strangerNotifs.items.filter((n) => n.type === 'subspace-ban' && n.targetId === subspace.id).length >= 2 && strangerNotifs.items.some((n) => n.type === 'subspace-ban' && /lifted/.test(n.preview || '')),
		summarize(strangerNotifs.items)
	);
	const prefs = await api('/api/v1/notifications/settings', { cookie: owner.cookie });
	check(
		'notification settings expose the six subspace types (push on; join-request/report email opt-in)',
		prefs.status === 200 && SUBSPACE_NOTIFICATION_TYPES.every((type) => prefs.body.prefs?.push?.[type] === true) && prefs.body.prefs.email['subspace-report'] === false && prefs.body.prefs.email['subspace-join-request'] === false && prefs.body.prefs.email['subspace-role'] === true,
		JSON.stringify(prefs.body?.prefs?.push)
	);
	const muteRole = await api('/api/v1/notifications/settings', { method: 'POST', cookie: mod.cookie, body: { prefs: { push: { 'subspace-role': false } } } });
	const mutedList = await notifsOf(mod.cookie);
	check('switching subspace-role off hides existing rows immediately', muteRole.status === 200 && !mutedList.items.some((n) => n.type === 'subspace-role'));
	await api('/api/v1/notifications/settings', { method: 'POST', cookie: mod.cookie, body: { prefs: { push: { 'subspace-role': true } } } });

	// transfer walls
	const anonTransfer = await api('/api/v1/subspaces/transfer', { method: 'POST', body: { slug, username: mod.username } });
	check('anonymous transfer → 401', anonTransfer.status === 401);
	const modTransfer = await api('/api/v1/subspaces/transfer', { method: 'POST', cookie: mod.cookie, body: { slug, username: mod.username } });
	check('moderator cannot transfer → 403', modTransfer.status === 403, `${modTransfer.status} ${JSON.stringify(modTransfer.body)}`);
	const memberTransfer = await api('/api/v1/subspaces/transfer', { method: 'POST', cookie: stranger.cookie, body: { slug, username: stranger.username } });
	check('plain member cannot transfer → 403', memberTransfer.status === 403);
	const selfTransfer = await api('/api/v1/subspaces/transfer', { method: 'POST', cookie: owner.cookie, body: { slug, username: owner.username } });
	check('transfer to yourself → 400', selfTransfer.status === 400);
	const nonMemberTransfer = await api('/api/v1/subspaces/transfer', { method: 'POST', cookie: owner.cookie, body: { slug, username: member.username } });
	check('transfer to someone who left → 404', nonMemberTransfer.status === 404, `${nonMemberTransfer.status} ${JSON.stringify(nonMemberTransfer.body)}`);
	const unknownTransfer = await api('/api/v1/subspaces/transfer', { method: 'POST', cookie: owner.cookie, body: { slug, username: `nobody_${suffix}` } });
	check('transfer to an unknown username → 404', unknownTransfer.status === 404);
	const noTargetTransfer = await api('/api/v1/subspaces/transfer', { method: 'POST', cookie: owner.cookie, body: { slug } });
	check('transfer without a target → 400', noTargetTransfer.status === 400);
	const ghostTransfer = await api('/api/v1/subspaces/transfer', { method: 'POST', cookie: owner.cookie, body: { slug: `ghost_${suffix}`.slice(0, 30), username: mod.username } });
	check('transfer on an unknown subspace → 404', ghostTransfer.status === 404);
	const banForTransfer = await api('/api/v1/subspaces/members', { method: 'POST', cookie: owner.cookie, body: { slug, username: stranger.username, action: 'ban', reason: 'brb' } });
	const bannedTransfer = await api('/api/v1/subspaces/transfer', { method: 'POST', cookie: owner.cookie, body: { slug, username: stranger.username } });
	check('transfer to a banned member → 403', banForTransfer.status === 200 && bannedTransfer.status === 403, `${bannedTransfer.status} ${JSON.stringify(bannedTransfer.body)}`);
	const unbanForTransfer = await api('/api/v1/subspaces/members', { method: 'POST', cookie: owner.cookie, body: { slug, username: stranger.username, action: 'unban' } });
	check('(unban restores the member)', unbanForTransfer.status === 200 && unbanForTransfer.body.member.banned === false && unbanForTransfer.body.member.left === false);
	const untouched = await api(`/api/v1/subspaces/get?slug=${slug}`, { cookie: owner.cookie });
	check('refused transfers leave ownership alone', untouched.status === 200 && untouched.body.subspace.ownerId === owner.id && untouched.body.subspace.viewer.role === 'owner');

	// transfer success
	const transferred = await api('/api/v1/subspaces/transfer', { method: 'POST', cookie: owner.cookie, body: { slug, username: mod.username } });
	check(
		'owner transfers to a moderator → ownerId flips, caller becomes moderator, newOwner row is owner',
		transferred.status === 200 && transferred.body.subspace?.ownerId === mod.id && transferred.body.subspace.viewer.role === 'moderator' && transferred.body.subspace.viewer.canModerate === true && transferred.body.newOwner?.userId === mod.id && transferred.body.newOwner.role === 'owner' && transferred.body.newOwner.approved === true,
		`${transferred.status} ${JSON.stringify(transferred.body).slice(0, 400)}`
	);
	const asNewOwner = await api(`/api/v1/subspaces/get?slug=${slug}`, { cookie: mod.cookie });
	check(
		'new owner reads role owner; the roster has exactly one owner and the old owner as moderator',
		asNewOwner.status === 200 && asNewOwner.body.subspace.viewer.role === 'owner' && asNewOwner.body.subspace.ownerId === mod.id && asNewOwner.body.moderators.filter((entry) => entry.role === 'owner').length === 1 && asNewOwner.body.moderators.some((entry) => entry.userId === owner.id && entry.role === 'moderator')
	);
	const oldOwnerAccess = await api('/api/v1/subspaces/update', { method: 'POST', cookie: owner.cookie, body: { slug, access: 'public' } });
	check('previous owner lost the owner-only powers (access change → 403)', oldOwnerAccess.status === 403);
	const transferLog = await api(`/api/v1/subspaces/modlog?slug=${slug}`, { cookie: mod.cookie });
	check('mod log records owner.transfer against the new owner', transferLog.status === 200 && transferLog.body.entries.some((entry) => entry.action === 'owner.transfer' && entry.userId === mod.id && entry.detail?.previousOwnerId === owner.id));
	const newOwnerNotifs = await notifsOf(mod.cookie);
	check('new owner is notified (subspace-role · "now the owner")', newOwnerNotifs.items.some((n) => n.type === 'subspace-role' && n.targetId === subspace.id && /owner/.test(n.preview || '')), summarize(newOwnerNotifs.items));
	const promoteStranger = await api('/api/v1/subspaces/members', { method: 'POST', cookie: mod.cookie, body: { slug, username: stranger.username, action: 'role', role: 'moderator' } });
	check('the new owner can promote (owner powers moved with the crown)', promoteStranger.status === 200 && promoteStranger.body.member.role === 'moderator');
	const oldOwnerLeaves = await api('/api/v1/subspaces/leave', { method: 'POST', cookie: owner.cookie, body: { slug } });
	check('previous owner can now leave', oldOwnerLeaves.status === 200 && oldOwnerLeaves.body.subspace.viewer.member === false, `${oldOwnerLeaves.status} ${JSON.stringify(oldOwnerLeaves.body).slice(0, 200)}`);
	const newOwnerLeaves = await api('/api/v1/subspaces/leave', { method: 'POST', cookie: mod.cookie, body: { slug } });
	check('the new owner cannot leave → 409', newOwnerLeaves.status === 409);

	// delete walls
	const anonDelete = await api('/api/v1/subspaces/delete', { method: 'POST', body: { slug, confirmSlug: slug } });
	check('anonymous delete → 401', anonDelete.status === 401);
	const modDelete = await api('/api/v1/subspaces/delete', { method: 'POST', cookie: stranger.cookie, body: { slug, confirmSlug: slug } });
	check('moderator cannot delete → 403', modDelete.status === 403, `${modDelete.status} ${JSON.stringify(modDelete.body)}`);
	const oldOwnerDelete = await api('/api/v1/subspaces/delete', { method: 'POST', cookie: owner.cookie, body: { slug, confirmSlug: slug } });
	check('previous owner cannot delete → 403', oldOwnerDelete.status === 403);
	const wrongConfirm = await api('/api/v1/subspaces/delete', { method: 'POST', cookie: mod.cookie, body: { slug, confirmSlug: `${slug}x` } });
	check('wrong confirmSlug → 400', wrongConfirm.status === 400, `${wrongConfirm.status} ${JSON.stringify(wrongConfirm.body)}`);
	const noConfirm = await api('/api/v1/subspaces/delete', { method: 'POST', cookie: mod.cookie, body: { slug } });
	check('missing confirmSlug → 400', noConfirm.status === 400);
	const ghostDelete = await api('/api/v1/subspaces/delete', { method: 'POST', cookie: mod.cookie, body: { slug: `ghost_${suffix}`.slice(0, 30), confirmSlug: `ghost_${suffix}`.slice(0, 30) } });
	check('delete on an unknown subspace → 404', ghostDelete.status === 404);
	const stillThere = await api(`/api/v1/subspaces/get?slug=${slug}`);
	check('refused deletes leave the subspace intact', stillThere.status === 200);
	const manifest2 = await api('/api/v1/capabilities');
	check(
		'capability manifest advertises transfer (1.0.1, guarded writes) / delete (1.1.0, privatePosts + slug hold) and the bumped members (1.3.0, S2 queues + review fixes + S3 user flairs) / notifications contracts (1.1.0)',
		manifest2.status === 200 && manifest2.body.features['api.subspaces-transfer'] === '1.0.1' && manifest2.body.features['api.subspaces-delete'] === '1.1.0' && manifest2.body.features['api.subspaces-members'] === '1.3.0' && manifest2.body.features['api.notifications-list'] === '1.1.0' && manifest2.body.features['api.notifications-settings'] === '1.1.0',
		JSON.stringify({ t: manifest2.body?.features?.['api.subspaces-transfer'], d: manifest2.body?.features?.['api.subspaces-delete'], m: manifest2.body?.features?.['api.subspaces-members'], n: manifest2.body?.features?.['api.notifications-list'] })
	);
	const deleteDocs = await api('/api/v1/subspaces/delete-docs');
	const transferDocs = await api('/api/v1/subspaces/transfer-docs');
	check('docs routes answer for transfer + delete', deleteDocs.status === 200 && deleteDocs.body.docs?.endpoint === '/api/v1/subspaces/delete' && transferDocs.status === 200 && transferDocs.body.docs?.endpoint === '/api/v1/subspaces/transfer');

	// delete success — a PUBLIC subspace: plain posts go public, a post the
	// mods removed stays private to its author
	// `owner` left after the transfer and did not write `post` (member did — an
	// author always sees their own post), so they are the honest "outsider"
	const privateBefore = await api(`/api/v1/things?id=${post.id}`, { cookie: owner.cookie });
	check('(pre-check) the private fence still hides the post from a non-member non-author', privateBefore.status === 404, String(privateBefore.status));
	const backToPublic = await api('/api/v1/subspaces/update', { method: 'POST', cookie: mod.cookie, body: { slug, access: 'public' } });
	check('the new owner flips access back to public (owner-only power moved with the crown)', backToPublic.status === 200 && backToPublic.body.subspace.access === 'public', `${backToPublic.status} ${JSON.stringify(backToPublic.body).slice(0, 200)}`);
	const feedBeforeDelete = await api(`/api/v1/subspaces/feed?slug=${slug}&sort=new&limit=50`, { cookie: mod.cookie });
	const livePosts = feedBeforeDelete.body?.posts?.length || 0;
	const removedAtDeletion = approvedPost.body.post;
	const removeForDeletion = await api('/api/v1/subspaces/moderate', { method: 'POST', cookie: mod.cookie, body: { id: removedAtDeletion.id, action: 'remove', reason: 'Spam' } });
	check('(setup) a post is REMOVED at deletion time', removeForDeletion.status === 200 && removeForDeletion.body.post.subspaceMod.removed === true, `${removeForDeletion.status} ${JSON.stringify(removeForDeletion.body).slice(0, 200)}`);
	const deleted = await api('/api/v1/subspaces/delete', { method: 'POST', cookie: mod.cookie, body: { slug, confirmSlug: `s/${slug.toUpperCase()}` } });
	// livePosts was counted BEFORE the removal above, so it already includes
	// the post that leaves as a private one
	check(
		'owner deletes with the retyped slug (s/ prefix + case forgiven) → releasedPosts (incl. the removed one) + privatePosts + removedMembers',
		deleted.status === 200 && deleted.body.releasedPosts >= livePosts && livePosts >= 3 && deleted.body.privatePosts >= 1 && deleted.body.privatePosts < deleted.body.releasedPosts && deleted.body.removedMembers === 2,
		`${deleted.status} ${JSON.stringify(deleted.body)} live=${livePosts}`
	);
	const goneDetail = await api(`/api/v1/subspaces/get?slug=${slug}`, { cookie: mod.cookie });
	check('detail → 404 after deletion', goneDetail.status === 404);
	const goneFeed = await api(`/api/v1/subspaces/feed?slug=${slug}`, { cookie: mod.cookie });
	check('feed → 404 after deletion', goneFeed.status === 404);
	const goneMembers = await api(`/api/v1/subspaces/members?slug=${slug}`, { cookie: mod.cookie });
	check('members → 404 after deletion', goneMembers.status === 404);
	const goneModlog = await api(`/api/v1/subspaces/modlog?slug=${slug}`, { cookie: mod.cookie });
	check('mod log → 404 after deletion', goneModlog.status === 404);
	const released = await api(`/api/v1/things?id=${post.id}`, { cookie: owner.cookie });
	check(
		'public-subspace posts survive as plain public posts: subspace/flair/subspaceMod null, title kept, readable by a non-member non-author',
		released.status === 200 && released.body.post?.subspace === null && released.body.post.flair === null && released.body.post.subspaceMod === null && released.body.post.title === 'Hello subspace 👋' && released.body.post.text === 'First thread body' && released.body.post.visibility === 'public',
		`${released.status} ${JSON.stringify(released.body).slice(0, 300)}`
	);
	const releasedAnon = await api(`/api/v1/things?id=${strayPost.id}`);
	check('a formerly-removed-then-APPROVED post also reads plain and public', releasedAnon.status === 200 && releasedAnon.body.post?.subspace === null && releasedAnon.body.post.subspaceMod === null && releasedAnon.body.post.text === 'not a member but public');
	const removedForOutsider = await api(`/api/v1/things?id=${removedAtDeletion.id}`, { cookie: owner.cookie });
	const removedForAnon = await api(`/api/v1/things?id=${removedAtDeletion.id}`);
	check('a post REMOVED at deletion time stays hidden from non-authors (404 logged in and anonymous)', removedForOutsider.status === 404 && removedForAnon.status === 404, `${removedForOutsider.status}/${removedForAnon.status}`);
	const removedForAuthor = await api(`/api/v1/things?id=${removedAtDeletion.id}`, { cookie: member.cookie });
	check(
		'…while its author keeps it as a plain PRIVATE post (subspace/subspaceMod null, body intact, visibility private)',
		removedForAuthor.status === 200 && removedForAuthor.body.post?.subspace === null && removedForAuthor.body.post.subspaceMod === null && removedForAuthor.body.post.text === 'approved now' && removedForAuthor.body.post.visibility === 'private',
		`${removedForAuthor.status} ${JSON.stringify(removedForAuthor.body).slice(0, 300)}`
	);
	const releasedComments = released.body.post?.comments || [];
	check('comments + their votes rode along', releasedComments.some((entry) => entry.id === comment.id && entry.votes?.score === 1));
	const homeAfterDelete = await api('/api/v1/things/feed?algorithm=latest&limit=50', { cookie: owner.cookie });
	check('released posts are back on a non-member home feed without a subspace embed', homeAfterDelete.body.posts.some((entry) => entry.id === post.id && !entry.subspace));
	check('…but the removed one is not', !homeAfterDelete.body.posts.some((entry) => entry.id === removedAtDeletion.id));
	const voteReleased = await api('/api/v1/things/updown', { method: 'POST', cookie: member.cookie, body: { id: post.id, direction: 'up' } });
	check('released posts keep working (vote → 200)', voteReleased.status === 200 && voteReleased.body.votes?.viewerVote === 'up');
	const mineAfter = await api('/api/v1/subspaces?mine=1', { cookie: stranger.cookie });
	check('memberships are gone (mine=1 no longer lists it)', mineAfter.status === 200 && !mineAfter.body.subspaces.some((entry) => entry.slug === slug));
	const listAfter = await api(`/api/v1/subspaces?q=${slug.slice(0, 12)}`);
	check('directory no longer lists it', listAfter.status === 200 && !listAfter.body.subspaces.some((entry) => entry.slug === slug));
	const formerModNotifs = await notifsOf(stranger.cookie);
	check('former moderator is told the subspace was deleted (subspace-role · deleted)', formerModNotifs.items.some((n) => n.type === 'subspace-role' && n.targetId === subspace.id && /deleted/.test(n.preview || '')), summarize(formerModNotifs.items));
	// scoped to THIS run's subspace: the day-stable fixture user is a moderator
	// of the re-founded subspace deleted further down, so earlier runs leave
	// them a legitimate "deleted" row for that other id
	const actorNotifs = await notifsOf(mod.cookie);
	check('the deleting owner does not notify themselves', !actorNotifs.items.some((n) => n.type === 'subspace-role' && n.targetId === subspace.id && /deleted/.test(n.preview || '')));
	const deleteAgain = await api('/api/v1/subspaces/delete', { method: 'POST', cookie: mod.cookie, body: { slug, confirmSlug: slug } });
	check('deleting a deleted subspace → 404', deleteAgain.status === 404);

	// slug hold: the deleted slug is a tombstone — strangers can't hijack the
	// deep links, the previous owner may re-found it at once
	const hijack = await api('/api/v1/subspaces', { method: 'POST', cookie: member.cookie, body: { slug, name: 'Hijacked' } });
	check('someone else cannot take the deleted slug → 409 (held)', hijack.status === 409 && /held/.test(hijack.body?.error || ''), `${hijack.status} ${JSON.stringify(hijack.body).slice(0, 200)}`);
	const stillGone = await api(`/api/v1/subspaces/get?slug=${slug}`);
	check('a held slug still reads 404 (the tombstone is not a subspace)', stillGone.status === 404);
	const reclaim = await api('/api/v1/subspaces', { method: 'POST', cookie: mod.cookie, body: { slug, name: 'Reclaimed', access: 'private' } });
	check('the previous owner re-founds the slug at once → 201 (private this time)', reclaim.status === 201 && reclaim.body?.subspace?.access === 'private' && reclaim.body.subspace.viewer.role === 'owner', `${reclaim.status} ${JSON.stringify(reclaim.body).slice(0, 200)}`);
	if (reclaim.status === 201) {
		const reclaimed = reclaim.body.subspace;
		// deleting a PRIVATE subspace: every post stays private to its author
		const addMember = await api('/api/v1/subspaces/members', { method: 'POST', cookie: mod.cookie, body: { slug, username: member.username, action: 'add' } });
		const addStranger = await api('/api/v1/subspaces/members', { method: 'POST', cookie: mod.cookie, body: { slug, username: stranger.username, action: 'add' } });
		check('(setup) owner adds two members to the private subspace', addMember.status === 200 && addStranger.status === 200);
		const privatePosted = await api('/api/v1/things', { method: 'POST', cookie: member.cookie, body: { type: 'text', text: 'Private thread body', title: 'Private thread', subspaceId: reclaimed.id } });
		check('(setup) a member posts behind the private wall', privatePosted.status === 200 && privatePosted.body.post?.subspace?.slug === slug, `${privatePosted.status} ${JSON.stringify(privatePosted.body).slice(0, 200)}`);
		const privatePost = privatePosted.body.post;
		// a rich ["post","comment"] thing pointing at the subspace is fenced by the
		// same stamp — deletion must release it too, never strand it
		const richReply = await api('/api/v1/things', { method: 'POST', cookie: member.cookie, body: { thingtime: ['post', 'comment'], targetId: privatePost.id, crystal: { type: 'text', text: 'rich private reply', subspaceId: reclaimed.id } } });
		check('(setup) a rich post+comment thing carries the subspace pointer', richReply.status === 200 && richReply.body.post?.thingtime?.includes('comment'), `${richReply.status} ${JSON.stringify(richReply.body).slice(0, 200)}`);
		const richId = richReply.body.post?.id;
		const privateForMember = await api(`/api/v1/things?id=${privatePost.id}`, { cookie: stranger.cookie });
		const privateForOutsider = await api(`/api/v1/things?id=${privatePost.id}`, { cookie: owner.cookie });
		check('(pre-check) members read the private post, an outsider gets 404', privateForMember.status === 200 && privateForOutsider.status === 404, `${privateForMember.status}/${privateForOutsider.status}`);

		// two transfers racing from the same owner commit at most once
		const [raceA, raceB] = await Promise.all([
			api('/api/v1/subspaces/transfer', { method: 'POST', cookie: mod.cookie, body: { slug, username: member.username } }),
			api('/api/v1/subspaces/transfer', { method: 'POST', cookie: mod.cookie, body: { slug, username: stranger.username } })
		]);
		const raceWins = [raceA, raceB].filter((entry) => entry.status === 200);
		const raceLoss = [raceA, raceB].find((entry) => entry.status !== 200);
		check('concurrent transfers: exactly one commits, the other is refused (409 lost the race, or 403 once the crown had moved)', raceWins.length === 1 && !!raceLoss && [403, 409].includes(raceLoss.status), `${raceA.status}/${raceB.status} ${JSON.stringify(raceLoss?.body || raceA.body).slice(0, 200)}`);
		const winnerId = raceWins[0]?.body?.subspace?.ownerId || null;
		const winner = winnerId === member.id ? member : winnerId === stranger.id ? stranger : null;
		const afterRace = await api(`/api/v1/subspaces/get?slug=${slug}`, { cookie: mod.cookie });
		check(
			'after the race the roster has exactly ONE owner and it matches subspace.ownerId; the old owner is a moderator',
			!!winner && afterRace.status === 200 && afterRace.body.subspace.ownerId === winner.id && afterRace.body.moderators.filter((entry) => entry.role === 'owner').length === 1 && afterRace.body.moderators.some((entry) => entry.userId === winner.id && entry.role === 'owner') && afterRace.body.subspace.viewer.role === 'moderator',
			`${afterRace.status} owner=${winnerId} ${JSON.stringify(afterRace.body?.moderators?.map((entry) => [entry.userId, entry.role]))}`
		);
		const loser = winner === member ? stranger : member;
		const loserDelete = await api('/api/v1/subspaces/delete', { method: 'POST', cookie: loser.cookie, body: { slug, confirmSlug: slug } });
		check('the transfer loser holds no owner powers (delete → 403)', loserDelete.status === 403);
		const oldOwnerDeleteAfterRace = await api('/api/v1/subspaces/delete', { method: 'POST', cookie: mod.cookie, body: { slug, confirmSlug: slug } });
		check('the previous owner cannot delete after the race either → 403', oldOwnerDeleteAfterRace.status === 403);

		const deletedPrivate = winner ? await api('/api/v1/subspaces/delete', { method: 'POST', cookie: winner.cookie, body: { slug, confirmSlug: slug } }) : { status: 0, body: null };
		check(
			'the new owner deletes the PRIVATE subspace → every post left private (privatePosts === releasedPosts === 2: the post + the rich reply), 3 memberships removed',
			deletedPrivate.status === 200 && deletedPrivate.body.releasedPosts === 2 && deletedPrivate.body.privatePosts === 2 && deletedPrivate.body.removedMembers === 3,
			`${deletedPrivate.status} ${JSON.stringify(deletedPrivate.body)}`
		);
		const privateAfterForOutsider = await api(`/api/v1/things?id=${privatePost.id}`, { cookie: owner.cookie });
		const privateAfterForExMember = await api(`/api/v1/things?id=${privatePost.id}`, { cookie: stranger.cookie });
		const privateAfterAnon = await api(`/api/v1/things?id=${privatePost.id}`);
		check('a private-subspace post is NOT made public by the deletion (404 for an outsider, an ex-member and anonymous)', privateAfterForOutsider.status === 404 && privateAfterForExMember.status === 404 && privateAfterAnon.status === 404, `${privateAfterForOutsider.status}/${privateAfterForExMember.status}/${privateAfterAnon.status}`);
		const privateAfterForAuthor = await api(`/api/v1/things?id=${privatePost.id}`, { cookie: member.cookie });
		check(
			'…its author keeps it as a plain private post (subspace null, title + body intact, visibility private)',
			privateAfterForAuthor.status === 200 && privateAfterForAuthor.body.post?.subspace === null && privateAfterForAuthor.body.post.subspaceMod === null && privateAfterForAuthor.body.post.title === 'Private thread' && privateAfterForAuthor.body.post.text === 'Private thread body' && privateAfterForAuthor.body.post.visibility === 'private',
			`${privateAfterForAuthor.status} ${JSON.stringify(privateAfterForAuthor.body).slice(0, 300)}`
		);
		const richAfterForExMember = richId ? await api(`/api/v1/things?id=${richId}`, { cookie: stranger.cookie }) : { status: 0 };
		const richAfterForAuthor = richId ? await api(`/api/v1/things?id=${richId}`, { cookie: member.cookie }) : { status: 0, body: null };
		check('the rich post+comment thing was released with the same fence (404 for an ex-member, private + subspace-free for its author)', richAfterForExMember.status === 404 && richAfterForAuthor.status === 200 && richAfterForAuthor.body?.thing?.visibility === 'private' && !richAfterForAuthor.body.thing.subspace, `${richAfterForExMember.status}/${richAfterForAuthor.status} ${JSON.stringify(richAfterForAuthor.body).slice(0, 200)}`);
		const homeAfterPrivateDelete = await api('/api/v1/things/feed?algorithm=latest&limit=50', { cookie: stranger.cookie });
		check('the private post does not re-enter an ex-member’s home feed', !homeAfterPrivateDelete.body.posts.some((entry) => entry.id === privatePost.id));
		const heldAgain = await api('/api/v1/subspaces', { method: 'POST', cookie: owner.cookie, body: { slug, name: 'Nope' } });
		check('the slug is held again after the second deletion (409 for a non-owner)', heldAgain.status === 409 && /held/.test(heldAgain.body?.error || ''));
	}

	console.log('\nN. join requests (private) + posting-approval requests (restricted)');
	// a fresh subspace: M deleted the run's first one. `owner` founds it
	// private; stranger / member / mod play the requesters.
	const reqSlug = `req_${suffix}`.slice(0, 30);
	const foundedPrivate = await api('/api/v1/subspaces', { method: 'POST', cookie: owner.cookie, body: { slug: reqSlug, name: 'Request Space', access: 'private' } });
	check('(setup) owner founds a PRIVATE subspace', foundedPrivate.status === 201 && foundedPrivate.body?.subspace?.access === 'private', `${foundedPrivate.status} ${JSON.stringify(foundedPrivate.body).slice(0, 200)}`);
	const reqSpace = foundedPrivate.body.subspace;
	const memberOf = async (cookie, extra = '') => api(`/api/v1/subspaces/members?slug=${reqSlug}${extra}`, { cookie });
	const detailOf = async (cookie) => api(`/api/v1/subspaces/get?slug=${reqSlug}`, { cookie });
	const anonRequest = await api('/api/v1/subspaces/join', { method: 'POST', body: { slug: reqSlug } });
	check('anonymous join request → 401', anonRequest.status === 401);
	const strangerRequest = await api('/api/v1/subspaces/join', { method: 'POST', cookie: stranger.cookie, body: { slug: reqSlug } });
	check(
		'private join → 200 join request: joined false, pending true, viewer.pending, no role, not a member, canPost false, memberCount still 1',
		strangerRequest.status === 200 && strangerRequest.body.joined === false && strangerRequest.body.pending === true && strangerRequest.body.subspace?.viewer?.pending === true && strangerRequest.body.subspace.viewer.member === false && strangerRequest.body.subspace.viewer.role === null && strangerRequest.body.subspace.viewer.canPost === false && strangerRequest.body.subspace.memberCount === 1,
		`${strangerRequest.status} ${JSON.stringify(strangerRequest.body).slice(0, 300)}`
	);
	const strangerRequestAgain = await api('/api/v1/subspaces/join', { method: 'POST', cookie: stranger.cookie, body: { slug: reqSlug } });
	check('requesting twice is a no-op (still one pending request)', strangerRequestAgain.status === 200 && strangerRequestAgain.body.joined === false && strangerRequestAgain.body.pending === true);
	const pendingFeedN = await api(`/api/v1/subspaces/feed?slug=${reqSlug}&sort=new`, { cookie: stranger.cookie });
	const pendingMine = await api('/api/v1/subspaces?mine=1', { cookie: stranger.cookie });
	const pendingPost = await api('/api/v1/things', { method: 'POST', cookie: stranger.cookie, body: { type: 'text', text: 'not in yet', title: 'x', subspaceId: reqSpace.id } });
	check('a pending requester is not a member: feed 403, mine=1 does not list it, posting 403', pendingFeedN.status === 403 && pendingMine.status === 200 && !pendingMine.body.subspaces.some((entry) => entry.slug === reqSlug) && pendingPost.status === 403, `${pendingFeedN.status}/${pendingPost.status}`);
	const pendingTransfer = await api('/api/v1/subspaces/transfer', { method: 'POST', cookie: owner.cookie, body: { slug: reqSlug, username: stranger.username } });
	check('transfer to a pending requester → 404 (not an active member)', pendingTransfer.status === 404, `${pendingTransfer.status} ${JSON.stringify(pendingTransfer.body).slice(0, 200)}`);
	const ownerNotifsN = await notifsOf(owner.cookie);
	check(
		'the mods are notified: subspace-join-request "wants to join" (targetId = subspace, slug leads the preview)',
		ownerNotifsN.items.some((n) => n.type === 'subspace-join-request' && n.targetId === reqSpace.id && String(n.preview || '').startsWith(`s/${reqSlug} ·`) && /wants to join/.test(n.preview || '')),
		summarize(ownerNotifsN.items)
	);
	const queueAnon = await memberOf(null, '&pending=1');
	const queueRequester = await memberOf(stranger.cookie, '&pending=1');
	const queueOwner = await memberOf(owner.cookie, '&pending=1');
	check(
		'the join-request queue is mod-only (403 anonymous + requester) and lists the request (pending true)',
		queueAnon.status === 403 && queueRequester.status === 403 && queueOwner.status === 200 && queueOwner.body.members.some((entry) => entry.userId === stranger.id && entry.pending === true),
		`${queueAnon.status}/${queueRequester.status}/${queueOwner.status} ${JSON.stringify(queueOwner.body).slice(0, 200)}`
	);
	const membersDefault = await memberOf(owner.cookie);
	check('the member list excludes pending requesters', membersDefault.status === 200 && membersDefault.body.members.length === 1 && !membersDefault.body.members.some((entry) => entry.userId === stranger.id));
	const memberRequest = await api('/api/v1/subspaces/join', { method: 'POST', cookie: member.cookie, body: { slug: reqSlug } });
	const queueOrdered = await memberOf(owner.cookie, '&pending=1');
	check('a second request lists newest first', memberRequest.status === 200 && memberRequest.body.pending === true && queueOrdered.body.members.length === 2 && queueOrdered.body.members[0].userId === member.id, JSON.stringify(queueOrdered.body.members?.map((entry) => entry.userId)));
	const detailOwner = await detailOf(owner.cookie);
	const detailRequester = await detailOf(stranger.cookie);
	check(
		'detail: mods see pendingCount 2 / approvalRequestCount 0 (memberCount 1); a requester sees viewer.pending but no counts',
		detailOwner.status === 200 && detailOwner.body.subspace.pendingCount === 2 && detailOwner.body.subspace.approvalRequestCount === 0 && detailOwner.body.subspace.memberCount === 1 && detailRequester.status === 200 && detailRequester.body.subspace.viewer.pending === true && !('pendingCount' in detailRequester.body.subspace),
		`${JSON.stringify({ owner: [detailOwner.body?.subspace?.pendingCount, detailOwner.body?.subspace?.approvalRequestCount, detailOwner.body?.subspace?.memberCount], requester: detailRequester.body?.subspace?.viewer })}`
	);

	// accept
	const acceptByRequester = await api('/api/v1/subspaces/members', { method: 'POST', cookie: member.cookie, body: { slug: reqSlug, username: stranger.username, action: 'accept' } });
	const acceptNoRequest = await api('/api/v1/subspaces/members', { method: 'POST', cookie: owner.cookie, body: { slug: reqSlug, username: mod.username, action: 'accept' } });
	const acceptUnknown = await api('/api/v1/subspaces/members', { method: 'POST', cookie: owner.cookie, body: { slug: reqSlug, username: `nobody_${suffix}`, action: 'accept' } });
	check('accept walls: non-mod 403, no request 404, unknown user 404', acceptByRequester.status === 403 && acceptNoRequest.status === 404 && acceptUnknown.status === 404, `${acceptByRequester.status}/${acceptNoRequest.status}/${acceptUnknown.status}`);
	const accepted = await api('/api/v1/subspaces/members', { method: 'POST', cookie: owner.cookie, body: { slug: reqSlug, userId: stranger.id, action: 'accept' } });
	check('owner accepts the request → active member (pending false, left false, role member)', accepted.status === 200 && accepted.body.member?.pending === false && accepted.body.member.left === false && accepted.body.member.role === 'member', `${accepted.status} ${JSON.stringify(accepted.body).slice(0, 200)}`);
	const afterAccept = await detailOf(stranger.cookie);
	const acceptedFeed = await api(`/api/v1/subspaces/feed?slug=${reqSlug}&sort=new`, { cookie: stranger.cookie });
	check(
		'the accepted requester is a member: viewer.member, pending false, canPost, feed 200, memberCount 2',
		afterAccept.body.subspace.viewer.member === true && afterAccept.body.subspace.viewer.pending === false && afterAccept.body.subspace.viewer.canPost === true && acceptedFeed.status === 200 && afterAccept.body.subspace.memberCount === 2,
		`${acceptedFeed.status} ${JSON.stringify(afterAccept.body?.subspace?.viewer)}`
	);
	const strangerNotifsN = await notifsOf(stranger.cookie);
	check('the accepted user is notified (subspace-join-accepted)', strangerNotifsN.items.some((n) => n.type === 'subspace-join-accepted' && n.targetId === reqSpace.id), summarize(strangerNotifsN.items));
	const acceptAgain = await api('/api/v1/subspaces/members', { method: 'POST', cookie: owner.cookie, body: { slug: reqSlug, userId: stranger.id, action: 'accept' } });
	check('accept on an already-active member → 404', acceptAgain.status === 404);

	// cancel
	const cancel = await api('/api/v1/subspaces/leave', { method: 'POST', cookie: member.cookie, body: { slug: reqSlug } });
	const queueAfterCancel = await memberOf(owner.cookie, '&pending=1');
	const detailAfterCancel = await detailOf(owner.cookie);
	check(
		'leave cancels a pending request (viewer.pending false, queue empty, pendingCount 0)',
		cancel.status === 200 && cancel.body.subspace.viewer.pending === false && cancel.body.subspace.viewer.member === false && !queueAfterCancel.body.members.some((entry) => entry.userId === member.id) && detailAfterCancel.body.subspace.pendingCount === 0,
		`${cancel.status} ${JSON.stringify(cancel.body?.subspace?.viewer)} pending=${detailAfterCancel.body?.subspace?.pendingCount}`
	);

	// deny
	await api('/api/v1/subspaces/join', { method: 'POST', cookie: member.cookie, body: { slug: reqSlug } });
	const denyByMember = await api('/api/v1/subspaces/members', { method: 'POST', cookie: stranger.cookie, body: { slug: reqSlug, userId: member.id, action: 'deny' } });
	check('a plain member cannot deny → 403', denyByMember.status === 403);
	const denied = await api('/api/v1/subspaces/members', { method: 'POST', cookie: owner.cookie, body: { slug: reqSlug, userId: member.id, action: 'deny', reason: 'Not yet' } });
	const queueAfterDeny = await memberOf(owner.cookie, '&pending=1');
	const deniedDetail = await detailOf(member.cookie);
	const denyLog = await api(`/api/v1/subspaces/modlog?slug=${reqSlug}`, { cookie: owner.cookie });
	check(
		'owner denies a request: 200 (row dropped), viewer.pending false, queue empty, modlog member.accept + member.deny (with the reason)',
		denied.status === 200 && denied.body.member?.pending === false && denied.body.member.left === true && !queueAfterDeny.body.members.some((entry) => entry.userId === member.id) && deniedDetail.body.subspace.viewer.pending === false && deniedDetail.body.subspace.viewer.member === false && denyLog.body.entries.some((entry) => entry.action === 'member.deny' && entry.userId === member.id && entry.reason === 'Not yet') && denyLog.body.entries.some((entry) => entry.action === 'member.accept' && entry.userId === stranger.id),
		`${denied.status} ${JSON.stringify(denied.body).slice(0, 200)} log=${JSON.stringify(denyLog.body?.entries?.map((entry) => entry.action))}`
	);
	const denyNothing = await api('/api/v1/subspaces/members', { method: 'POST', cookie: owner.cookie, body: { slug: reqSlug, userId: member.id, action: 'deny' } });
	check('deny without a request → 404', denyNothing.status === 404);
	const reRequest = await api('/api/v1/subspaces/join', { method: 'POST', cookie: member.cookie, body: { slug: reqSlug } });
	const addPending = await api('/api/v1/subspaces/members', { method: 'POST', cookie: owner.cookie, body: { slug: reqSlug, userId: member.id, action: 'add' } });
	const addedFeed = await api(`/api/v1/subspaces/feed?slug=${reqSlug}&sort=new`, { cookie: member.cookie });
	const memberNotifsN = await notifsOf(member.cookie);
	check(
		'a denied user may ask again; a mod `add` on the pending row activates it (feed 200) and rings subspace-join-accepted',
		reRequest.status === 200 && reRequest.body.pending === true && addPending.status === 200 && addPending.body.member.pending === false && addPending.body.member.left === false && addedFeed.status === 200 && memberNotifsN.items.some((n) => n.type === 'subspace-join-accepted' && n.targetId === reqSpace.id),
		`${reRequest.status}/${addPending.status}/${addedFeed.status} ${summarize(memberNotifsN.items)}`
	);

	// ban a pending requester → the request goes with it
	const modRequest = await api('/api/v1/subspaces/join', { method: 'POST', cookie: mod.cookie, body: { slug: reqSlug } });
	const banPending = await api('/api/v1/subspaces/members', { method: 'POST', cookie: owner.cookie, body: { slug: reqSlug, userId: mod.id, action: 'ban', reason: 'nope' } });
	const queueAfterBan = await memberOf(owner.cookie, '&pending=1');
	const bannedRequest = await api('/api/v1/subspaces/join', { method: 'POST', cookie: mod.cookie, body: { slug: reqSlug } });
	check(
		'banning a pending requester removes the request (banned, pending false, queue empty, join → 403)',
		modRequest.status === 200 && modRequest.body.pending === true && banPending.status === 200 && banPending.body.member.banned === true && banPending.body.member.pending === false && !queueAfterBan.body.members.some((entry) => entry.userId === mod.id) && bannedRequest.status === 403,
		`${modRequest.status}/${banPending.status}/${bannedRequest.status} ${JSON.stringify(banPending.body).slice(0, 200)}`
	);
	const unbanMod = await api('/api/v1/subspaces/members', { method: 'POST', cookie: owner.cookie, body: { slug: reqSlug, userId: mod.id, action: 'unban' } });
	const modAfterUnban = await detailOf(mod.cookie);
	const modReRequest = await api('/api/v1/subspaces/join', { method: 'POST', cookie: mod.cookie, body: { slug: reqSlug } });
	const acceptMod = await api('/api/v1/subspaces/members', { method: 'POST', cookie: owner.cookie, body: { slug: reqSlug, userId: mod.id, action: 'accept' } });
	check(
		'after an unban the user is not a member (never was), can request again and be accepted',
		unbanMod.status === 200 && modAfterUnban.body.subspace.viewer.member === false && modAfterUnban.body.subspace.viewer.pending === false && modReRequest.status === 200 && modReRequest.body.pending === true && acceptMod.status === 200 && acceptMod.body.member.pending === false && acceptMod.body.member.left === false,
		`${unbanMod.status}/${modReRequest.status}/${acceptMod.status} ${JSON.stringify(modAfterUnban.body?.subspace?.viewer)}`
	);
	const countsSettled = await detailOf(owner.cookie);
	check('every request settled: pendingCount 0, memberCount 4', countsSettled.body.subspace.pendingCount === 0 && countsSettled.body.subspace.memberCount === 4, JSON.stringify([countsSettled.body?.subspace?.pendingCount, countsSettled.body?.subspace?.memberCount]));

	// restricted: posting approval
	const toRestricted = await api('/api/v1/subspaces/update', { method: 'POST', cookie: owner.cookie, body: { slug: reqSlug, access: 'restricted' } });
	check('(setup) owner switches to restricted', toRestricted.status === 200 && toRestricted.body.subspace.access === 'restricted');
	const anonApproval = await api('/api/v1/subspaces/members', { method: 'POST', body: { slug: reqSlug, action: 'request-approval' } });
	check('anonymous request-approval → 401', anonApproval.status === 401);
	const leaveForApproval = await api('/api/v1/subspaces/leave', { method: 'POST', cookie: member.cookie, body: { slug: reqSlug } });
	const outsiderApproval = await api('/api/v1/subspaces/members', { method: 'POST', cookie: member.cookie, body: { slug: reqSlug, action: 'request-approval' } });
	check('request-approval as a non-member → 403', leaveForApproval.status === 200 && outsiderApproval.status === 403, `${outsiderApproval.status} ${JSON.stringify(outsiderApproval.body).slice(0, 200)}`);
	const rejoin = await api('/api/v1/subspaces/join', { method: 'POST', cookie: member.cookie, body: { slug: reqSlug } });
	check('restricted subspaces join outright (joined true, pending false)', rejoin.status === 200 && rejoin.body.joined === true && rejoin.body.pending === false && rejoin.body.subspace.viewer.canPost === false);
	const someoneElse = await api('/api/v1/subspaces/members', { method: 'POST', cookie: member.cookie, body: { slug: reqSlug, username: stranger.username, action: 'request-approval' } });
	check('request-approval for someone else → 403', someoneElse.status === 403);
	const asked = await api('/api/v1/subspaces/members', { method: 'POST', cookie: member.cookie, body: { slug: reqSlug, action: 'request-approval' } });
	const askedAgain = await api('/api/v1/subspaces/members', { method: 'POST', cookie: member.cookie, body: { slug: reqSlug, action: 'request-approval' } });
	const askedDetail = await detailOf(member.cookie);
	const askedOwnerDetail = await detailOf(owner.cookie);
	const approvalQueueMember = await memberOf(member.cookie, '&approvalRequests=1');
	const approvalQueueOwner = await memberOf(owner.cookie, '&approvalRequests=1');
	check(
		'a member asks for posting approval: approvalRequested true (idempotent), viewer.approvalRequested + canPost false, mods see approvalRequestCount 1 and the mod-only queue',
		asked.status === 200 && asked.body.member?.approvalRequested === true && asked.body.member.approved === false && askedAgain.status === 200 && askedAgain.body.member.approvalRequested === true && askedDetail.body.subspace.viewer.approvalRequested === true && askedDetail.body.subspace.viewer.canPost === false && askedDetail.body.subspace.viewer.member === true && askedOwnerDetail.body.subspace.approvalRequestCount === 1 && askedOwnerDetail.body.subspace.pendingCount === 0 && approvalQueueMember.status === 403 && approvalQueueOwner.status === 200 && approvalQueueOwner.body.members.some((entry) => entry.userId === member.id && entry.approvalRequested === true),
		`${asked.status}/${askedAgain.status}/${approvalQueueMember.status}/${approvalQueueOwner.status} ${JSON.stringify(asked.body).slice(0, 200)} counts=${JSON.stringify([askedOwnerDetail.body?.subspace?.approvalRequestCount, askedOwnerDetail.body?.subspace?.pendingCount])}`
	);
	const ownerNotifsN2 = await notifsOf(owner.cookie);
	check('the mods are notified: subspace-join-request "wants to post"', ownerNotifsN2.items.some((n) => n.type === 'subspace-join-request' && n.targetId === reqSpace.id && /wants to post/.test(n.preview || '')), summarize(ownerNotifsN2.items));
	const stillCannotPost = await api('/api/v1/things', { method: 'POST', cookie: member.cookie, body: { type: 'text', text: 'may I?', title: 'r', subspaceId: reqSpace.id } });
	check('asking is not approval: posting still 403', stillCannotPost.status === 403);
	const denyApproval = await api('/api/v1/subspaces/members', { method: 'POST', cookie: owner.cookie, body: { slug: reqSlug, userId: member.id, action: 'deny' } });
	const approvalQueueAfterDeny = await memberOf(owner.cookie, '&approvalRequests=1');
	const deniedApprovalDetail = await detailOf(member.cookie);
	check(
		'deny clears the posting request (member stays a member; queue empty; modlog member.deny request approval)',
		denyApproval.status === 200 && denyApproval.body.member.approvalRequested === false && denyApproval.body.member.left === false && !approvalQueueAfterDeny.body.members.some((entry) => entry.userId === member.id) && deniedApprovalDetail.body.subspace.viewer.approvalRequested === false && deniedApprovalDetail.body.subspace.viewer.member === true,
		`${denyApproval.status} ${JSON.stringify(denyApproval.body).slice(0, 200)}`
	);
	const askAgain = await api('/api/v1/subspaces/members', { method: 'POST', cookie: member.cookie, body: { slug: reqSlug, action: 'request-approval' } });
	const approveIt = await api('/api/v1/subspaces/members', { method: 'POST', cookie: owner.cookie, body: { slug: reqSlug, userId: member.id, action: 'approve' } });
	const approvedPostN = await api('/api/v1/things', { method: 'POST', cookie: member.cookie, body: { type: 'text', text: 'approved now', title: 'r', subspaceId: reqSpace.id } });
	const settledOwnerDetail = await detailOf(owner.cookie);
	check(
		'approve grants posting AND clears the request; the member posts; approvalRequestCount 0',
		askAgain.status === 200 && approveIt.status === 200 && approveIt.body.member.approved === true && approveIt.body.member.approvalRequested === false && approvedPostN.status === 200 && settledOwnerDetail.body.subspace.approvalRequestCount === 0,
		`${askAgain.status}/${approveIt.status}/${approvedPostN.status} count=${settledOwnerDetail.body?.subspace?.approvalRequestCount}`
	);
	const alreadyApproved = await api('/api/v1/subspaces/members', { method: 'POST', cookie: member.cookie, body: { slug: reqSlug, action: 'request-approval' } });
	check('request-approval when already approved → 400', alreadyApproved.status === 400);
	const modApproval = await api('/api/v1/subspaces/members', { method: 'POST', cookie: owner.cookie, body: { slug: reqSlug, action: 'request-approval' } });
	check('a moderator asking for approval → 400 (can already post)', modApproval.status === 400);
	const askThenUnapprove = await api('/api/v1/subspaces/members', { method: 'POST', cookie: stranger.cookie, body: { slug: reqSlug, action: 'request-approval' } });
	const unapproveN = await api('/api/v1/subspaces/members', { method: 'POST', cookie: owner.cookie, body: { slug: reqSlug, userId: stranger.id, action: 'unapprove' } });
	check('unapprove clears an open request too', askThenUnapprove.status === 200 && askThenUnapprove.body.member.approvalRequested === true && unapproveN.status === 200 && unapproveN.body.member.approvalRequested === false && unapproveN.body.member.approved === false, `${askThenUnapprove.status}/${unapproveN.status}`);
	const toPublic = await api('/api/v1/subspaces/update', { method: 'POST', cookie: owner.cookie, body: { slug: reqSlug, access: 'public' } });
	const publicApproval = await api('/api/v1/subspaces/members', { method: 'POST', cookie: stranger.cookie, body: { slug: reqSlug, action: 'request-approval' } });
	check('request-approval in a public subspace → 400', toPublic.status === 200 && publicApproval.status === 400, `${publicApproval.status} ${JSON.stringify(publicApproval.body).slice(0, 200)}`);
	const badAction = await api('/api/v1/subspaces/members', { method: 'POST', cookie: owner.cookie, body: { slug: reqSlug, userId: stranger.id, action: 'wave' } });
	check('unknown member action → 400', badAction.status === 400);
	const manifest3 = await api('/api/v1/capabilities');
	check(
		'capability manifest advertises the request contracts (leave 1.1.0, join 1.1.1; get/list/update 1.2.0 + members 1.3.0 after the S3 user-flair bump)',
		manifest3.status === 200 && manifest3.body.features['api.subspaces-join'] === '1.1.1' && manifest3.body.features['api.subspaces-leave'] === '1.1.0' && manifest3.body.features['api.subspaces-get'] === '1.2.0' && manifest3.body.features['api.subspaces'] === '1.2.0' && manifest3.body.features['api.subspaces-members'] === '1.3.0' && manifest3.body.features['api.subspaces-update'] === '1.2.0',
		JSON.stringify({ j: manifest3.body?.features?.['api.subspaces-join'], l: manifest3.body?.features?.['api.subspaces-leave'], g: manifest3.body?.features?.['api.subspaces-get'], m: manifest3.body?.features?.['api.subspaces-members'], u: manifest3.body?.features?.['api.subspaces-update'] })
	);

	// ── S2 review fixes: one posting predicate (server = viewer.canPost), a
	// pending row takes only decisions, guarded decisions, the queues follow
	// the access mode, an expired ban heals, the mods' bell is deduped ──
	console.log('\n   N (review fixes). kicked posters, pending-row walls, queue resolution on access flips, bell dedupe');
	const postAs = (cookie, text) => api('/api/v1/things', { method: 'POST', cookie, body: { type: 'text', text, title: 'r', subspaceId: reqSpace.id } });
	const setAccess = (access) => api('/api/v1/subspaces/update', { method: 'POST', cookie: owner.cookie, body: { slug: reqSlug, access } });
	const memberAction = (userId, action, extra = {}) => api('/api/v1/subspaces/members', { method: 'POST', cookie: owner.cookie, body: { slug: reqSlug, userId, action, ...extra } });
	const modlogOf = async () => (await api(`/api/v1/subspaces/modlog?slug=${reqSlug}&limit=50`, { cookie: owner.cookie })).body?.entries || [];
	// (state: public; member is an approved poster, stranger + mod are plain members)
	const backToRestricted = await setAccess('restricted');
	const approvedPostsFirst = await postAs(member.cookie, 'still approved');
	check('(setup) restricted again; the approved member posts (200)', backToRestricted.status === 200 && approvedPostsFirst.status === 200, `${backToRestricted.status}/${approvedPostsFirst.status}`);
	const approvedPostId = approvedPostsFirst.body?.post?.id;
	const kick = await memberAction(member.id, 'remove');
	const kickedDetail = await detailOf(member.cookie);
	const kickedPost = await postAs(member.cookie, 'kicked but approved?');
	check(
		'a kicked approved poster can’t post: remove clears approved, viewer.canPost false, POST /things 403 (server and UI share canPostIn)',
		kick.status === 200 && kick.body.member?.left === true && kick.body.member.approved === false && kickedDetail.body.subspace.viewer.canPost === false && kickedDetail.body.subspace.viewer.approved === false && kickedDetail.body.subspace.viewer.member === false && kickedPost.status === 403,
		`${kick.status}/${kickedPost.status} ${JSON.stringify(kick.body?.member)} viewer=${JSON.stringify(kickedDetail.body?.subspace?.viewer)}`
	);
	const kickedCard = await api(`/api/v1/things?id=${approvedPostId}`, { cookie: member.cookie });
	const memberCard = await api(`/api/v1/things?id=${approvedPostId}`, { cookie: stranger.cookie });
	check(
		'post cards: subspace.viewerRole is null for a non-member (kicked) and "member" for an active member',
		kickedCard.status === 200 && kickedCard.body.post?.subspace?.viewerRole === null && memberCard.status === 200 && memberCard.body.post?.subspace?.viewerRole === 'member',
		`${kickedCard.status}/${memberCard.status} ${JSON.stringify([kickedCard.body?.post?.subspace?.viewerRole, memberCard.body?.post?.subspace?.viewerRole])}`
	);
	const rejoinKicked = await api('/api/v1/subspaces/join', { method: 'POST', cookie: member.cookie, body: { slug: reqSlug } });
	const rejoinedPost = await postAs(member.cookie, 'back, still not approved');
	check('rejoining after a kick does not restore posting approval (joined, canPost false, post 403)', rejoinKicked.status === 200 && rejoinKicked.body.joined === true && rejoinKicked.body.subspace.viewer.canPost === false && rejoinedPost.status === 403, `${rejoinKicked.status}/${rejoinedPost.status} ${JSON.stringify(rejoinKicked.body?.subspace?.viewer)}`);

	// an expired temporary ban must not hide a posting-approval request from the queue
	const shortBan = await memberAction(mod.id, 'ban', { reason: 'blink', banDays: 0.00002 }); // ≈1.7 s
	await new Promise((resolve) => setTimeout(resolve, 2500));
	const afterExpiry = await detailOf(mod.cookie);
	const expiredAsk = await api('/api/v1/subspaces/members', { method: 'POST', cookie: mod.cookie, body: { slug: reqSlug, action: 'request-approval' } });
	const expiredQueue = await memberOf(owner.cookie, '&approvalRequests=1');
	const expiredCounts = await detailOf(owner.cookie);
	check(
		'a member whose temporary ban expired can ask for posting approval and the request reaches the queue + count (row healed)',
		shortBan.status === 200 && afterExpiry.body.subspace.viewer.banned === false && expiredAsk.status === 200 && expiredAsk.body.member?.approvalRequested === true && expiredAsk.body.member.banned === false && expiredQueue.body.members.some((entry) => entry.userId === mod.id) && expiredCounts.body.subspace.approvalRequestCount === 1,
		`${shortBan.status}/${expiredAsk.status} banned=${afterExpiry.body?.subspace?.viewer?.banned} queue=${JSON.stringify(expiredQueue.body?.members?.map((entry) => entry.userId))} count=${expiredCounts.body?.subspace?.approvalRequestCount}`
	);

	// the queues follow the access mode: leaving restricted clears approval requests
	const openUp = await setAccess('public');
	const modAfterOpen = await detailOf(mod.cookie);
	const ownerAfterOpen = await detailOf(owner.cookie);
	check(
		'leaving restricted clears open posting-approval requests (viewer.approvalRequested false, canPost true, approvalRequestCount 0)',
		openUp.status === 200 && modAfterOpen.body.subspace.viewer.approvalRequested === false && modAfterOpen.body.subspace.viewer.canPost === true && ownerAfterOpen.body.subspace.approvalRequestCount === 0,
		`${openUp.status} ${JSON.stringify(modAfterOpen.body?.subspace?.viewer)} count=${ownerAfterOpen.body?.subspace?.approvalRequestCount}`
	);

	// private again: a kicked user files a join request; a pending row takes only decisions
	const goPrivate = await setAccess('private');
	const kickStranger = await memberAction(stranger.id, 'remove');
	const strangerAsks = await api('/api/v1/subspaces/join', { method: 'POST', cookie: stranger.cookie, body: { slug: reqSlug } });
	check('(setup) private again; a kicked user files a join request (pending, not approved)', goPrivate.status === 200 && kickStranger.status === 200 && strangerAsks.status === 200 && strangerAsks.body.pending === true && strangerAsks.body.subspace.viewer.approved === false, `${goPrivate.status}/${kickStranger.status}/${strangerAsks.status}`);
	const approvePending = await memberAction(stranger.id, 'approve');
	const unapprovePending = await memberAction(stranger.id, 'unapprove');
	const demotePending = await memberAction(stranger.id, 'role', { role: 'member' });
	const removePending = await memberAction(stranger.id, 'remove');
	const pendingStillQueued = await memberOf(owner.cookie, '&pending=1');
	const pendingStillWalled = await postAs(stranger.cookie, 'approved while pending?');
	const strangerBellsPending = await notifsOf(stranger.cookie);
	check(
		'a pending row takes only accept/deny/add/ban/promote: approve 400, unapprove 400, role member 400, remove 404 — the request stays queued, still can’t post, no stray "no longer a moderator" bell',
		approvePending.status === 400 && unapprovePending.status === 400 && demotePending.status === 400 && removePending.status === 404 && pendingStillQueued.body.members.some((entry) => entry.userId === stranger.id && entry.pending === true && entry.approved === false) && pendingStillWalled.status === 403 && !strangerBellsPending.items.some((n) => n.type === 'subspace-role' && n.targetId === reqSpace.id && /no longer/.test(n.preview || '')),
		`${approvePending.status}/${unapprovePending.status}/${demotePending.status}/${removePending.status}/${pendingStillWalled.status} ${JSON.stringify(approvePending.body)}`
	);

	// the mods' bell is deduped against their unread copy of the same request
	const joinBells = (items) => items.filter((n) => n.type === 'subspace-join-request' && n.targetId === reqSpace.id && n.actorId === stranger.id && /wants to join/.test(n.preview || ''));
	const ownerJoinBells = async () => joinBells((await notifsOf(owner.cookie)).items);
	const cancelAndReRequest = async (cookie) => {
		const cancelled = await api('/api/v1/subspaces/leave', { method: 'POST', cookie, body: { slug: reqSlug } });
		const filed = await api('/api/v1/subspaces/join', { method: 'POST', cookie, body: { slug: reqSlug } });
		return cancelled.status === 200 && filed.status === 200 && filed.body.pending === true;
	};
	const bellsBefore = await ownerJoinBells();
	const loopedOnce = await cancelAndReRequest(stranger.cookie);
	const bellsAfterLoop = await ownerJoinBells();
	check(
		'a request cancelled and filed again does not ring the mods again while their earlier bell is unread',
		loopedOnce && bellsBefore.length >= 1 && bellsBefore.some((n) => !n.readAt) && bellsAfterLoop.length === bellsBefore.length,
		`before=${bellsBefore.length} after=${bellsAfterLoop.length} unread=${bellsBefore.filter((n) => !n.readAt).length}`
	);
	const markRead = await api('/api/v1/notifications/read', { method: 'POST', cookie: owner.cookie, body: { all: true } });
	const loopedAgain = await cancelAndReRequest(stranger.cookie);
	const bellsAfterRead = await ownerJoinBells();
	check(
		'once the mod has read it, a fresh request rings again (exactly one new, unread bell)',
		markRead.status === 200 && loopedAgain && bellsAfterRead.length === bellsBefore.length + 1 && bellsAfterRead.filter((n) => !n.readAt).length === 1,
		`${markRead.status} before=${bellsBefore.length} after=${bellsAfterRead.length} unread=${bellsAfterRead.filter((n) => !n.readAt).length}`
	);

	// a decision on a withdrawn request never logs an accept or rings "welcome in"
	const acceptLogsForStranger = async () => (await modlogOf()).filter((entry) => entry.action === 'member.accept' && entry.userId === stranger.id).length;
	const welcomesFor = async (cookie) => (await notifsOf(cookie)).items.filter((n) => n.type === 'subspace-join-accepted' && n.targetId === reqSpace.id).length;
	const acceptsBefore = await acceptLogsForStranger();
	const welcomesBefore = await welcomesFor(stranger.cookie);
	const withdraw = await api('/api/v1/subspaces/leave', { method: 'POST', cookie: stranger.cookie, body: { slug: reqSlug } });
	const staleAccept = await memberAction(stranger.id, 'accept');
	const staleDeny = await memberAction(stranger.id, 'deny');
	const staleDetail = await detailOf(stranger.cookie);
	check(
		'a decision on a withdrawn request is refused (accept 404, deny 404 after the cancel; the write itself is guarded → 409 in the race) and logs / rings nothing',
		withdraw.status === 200 && staleAccept.status === 404 && staleDeny.status === 404 && staleDetail.body.subspace.viewer.member === false && (await acceptLogsForStranger()) === acceptsBefore && (await welcomesFor(stranger.cookie)) === welcomesBefore,
		`${withdraw.status}/${staleAccept.status}/${staleDeny.status} accepts=${acceptsBefore} welcomes=${welcomesBefore}`
	);

	// switching a private subspace to public resolves its join requests
	const finalRequest = await api('/api/v1/subspaces/join', { method: 'POST', cookie: stranger.cookie, body: { slug: reqSlug } });
	const ownerBeforeDoors = await detailOf(owner.cookie);
	const openDoors = await setAccess('public');
	const strangerOpened = await detailOf(stranger.cookie);
	const ownerOpened = await detailOf(owner.cookie);
	const strangerMine = await api('/api/v1/subspaces?mine=1', { cookie: stranger.cookie });
	const openedLog = (await modlogOf()).find((entry) => entry.action === 'settings.update' && entry.detail?.acceptedRequests === 1);
	check(
		'switching a private subspace to public resolves its join requests: the requester is a member (viewer.member, pending false, role member, mine=1), pendingCount 1 → 0, a subspace-join-accepted "opened up" bell, modlog detail acceptedRequests 1',
		finalRequest.status === 200 && finalRequest.body.pending === true && ownerBeforeDoors.body.subspace.pendingCount === 1 && openDoors.status === 200 && strangerOpened.body.subspace.viewer.member === true && strangerOpened.body.subspace.viewer.pending === false && strangerOpened.body.subspace.viewer.role === 'member' && ownerOpened.body.subspace.pendingCount === 0 && strangerMine.body.subspaces.some((entry) => entry.slug === reqSlug) && (await welcomesFor(stranger.cookie)) === welcomesBefore + 1 && (await notifsOf(stranger.cookie)).items.some((n) => n.type === 'subspace-join-accepted' && n.targetId === reqSpace.id && /opened up/.test(n.preview || '')) && !!openedLog,
		`${finalRequest.status}/${openDoors.status} viewer=${JSON.stringify(strangerOpened.body?.subspace?.viewer)} pending=${ownerBeforeDoors.body?.subspace?.pendingCount}→${ownerOpened.body?.subspace?.pendingCount} log=${JSON.stringify(openedLog?.detail)}`
	);
	const cleanupN = await api('/api/v1/subspaces/delete', { method: 'POST', cookie: owner.cookie, body: { slug: reqSlug, confirmSlug: reqSlug } });
	check('(cleanup) owner deletes the request subspace', cleanupN.status === 200, `${cleanupN.status} ${JSON.stringify(cleanupN.body).slice(0, 200)}`);

	console.log('\nO. user flairs');
	// a fresh PUBLIC subspace: owner founds it, mod is promoted, member and
	// stranger join later (the "not a member" walls run before they do)
	const flairSlug = `flair_${suffix}`.slice(0, 30);
	const foundedFlair = await api('/api/v1/subspaces', { method: 'POST', cookie: owner.cookie, body: { slug: flairSlug, name: 'Flair Space', access: 'public' } });
	check('(setup) owner founds a public subspace', foundedFlair.status === 201, `${foundedFlair.status} ${JSON.stringify(foundedFlair.body).slice(0, 200)}`);
	const flairSpace = foundedFlair.body.subspace;
	check(
		'defaults: userFlairs [], userFlairSelfAssign true, allowCustomUserFlair false, viewer.userFlair null',
		Array.isArray(flairSpace?.userFlairs) && flairSpace.userFlairs.length === 0 && flairSpace.userFlairSelfAssign === true && flairSpace.allowCustomUserFlair === false && flairSpace.viewer?.userFlair === null,
		JSON.stringify({ f: flairSpace?.userFlairs, s: flairSpace?.userFlairSelfAssign, c: flairSpace?.allowCustomUserFlair, v: flairSpace?.viewer?.userFlair })
	);
	const flairOf = (cookie, body) => api('/api/v1/subspaces/members', { method: 'POST', cookie, body: { slug: flairSlug, action: 'userFlair', ...body } });
	const flairDetail = (cookie) => api(`/api/v1/subspaces/get?slug=${flairSlug}`, { cookie });
	const flairUpdate = (cookie, body) => api('/api/v1/subspaces/update', { method: 'POST', cookie, body: { slug: flairSlug, ...body } });
	await api('/api/v1/subspaces/join', { method: 'POST', cookie: mod.cookie, body: { slug: flairSlug } });
	const promoteFlairMod = await api('/api/v1/subspaces/members', { method: 'POST', cookie: owner.cookie, body: { slug: flairSlug, userId: mod.id, action: 'role', role: 'moderator' } });
	check('(setup) mod joins + is promoted', promoteFlairMod.status === 200 && promoteFlairMod.body.member?.role === 'moderator');

	// walls before anyone joined / before any template exists
	const anonFlair = await api('/api/v1/subspaces/members', { method: 'POST', body: { slug: flairSlug, action: 'userFlair', flairId: 'prism' } });
	check('anonymous userFlair → 401', anonFlair.status === 401);
	const outsiderFlair = await flairOf(member.cookie, { flairId: 'prism' });
	check('a non-member setting their own flair → 403', outsiderFlair.status === 403, `${outsiderFlair.status} ${JSON.stringify(outsiderFlair.body)}`);
	const dressOutsider = await flairOf(mod.cookie, { userId: member.id, flairId: 'prism' });
	check('a mod dressing a non-member → 404', dressOutsider.status === 404, `${dressOutsider.status} ${JSON.stringify(dressOutsider.body)}`);
	const memberJoinsFlair = await api('/api/v1/subspaces/join', { method: 'POST', cookie: member.cookie, body: { slug: flairSlug } });
	const strangerJoinsFlair = await api('/api/v1/subspaces/join', { method: 'POST', cookie: stranger.cookie, body: { slug: flairSlug } });
	check('(setup) member + stranger join', memberJoinsFlair.status === 200 && memberJoinsFlair.body.joined === true && strangerJoinsFlair.status === 200 && strangerJoinsFlair.body.joined === true);
	const noTemplates = await flairOf(member.cookie, { flairId: 'prism' });
	check('picking a template before any exists → 400', noTemplates.status === 400, `${noTemplates.status} ${JSON.stringify(noTemplates.body)}`);

	// settings: a MODERATOR (not the owner) defines the templates
	const templatesByMember = await flairUpdate(member.cookie, { userFlairs: [{ label: 'Prism' }] });
	check('a plain member cannot edit user flairs → 403', templatesByMember.status === 403);
	const badSwitch = await flairUpdate(mod.cookie, { userFlairSelfAssign: 'yes' });
	check('a non-boolean switch → 400', badSwitch.status === 400, `${badSwitch.status} ${JSON.stringify(badSwitch.body)}`);
	const tooMany = await flairUpdate(mod.cookie, { userFlairs: new Array(51).fill(0).map((_, i) => ({ label: `f${i}` })) });
	check('more than 50 user-flair templates → 400', tooMany.status === 400);
	const dupTemplates = await flairUpdate(mod.cookie, { userFlairs: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }] });
	check('duplicate template ids → 400', dupTemplates.status === 400);
	const templates = await flairUpdate(mod.cookie, {
		userFlairs: [{ label: 'Prism', emoji: '🔮', color: '#7c5cff' }, { id: 'staff', label: 'Staff', emoji: '🎩', modOnly: true, color: 'javascript:alert(1)' }],
		allowCustomUserFlair: false
	});
	check(
		'a moderator saves the templates (ids minted, modOnly kept, unsafe color dropped) and the switch',
		templates.status === 200 && templates.body.subspace?.userFlairs?.[0]?.id === 'prism' && templates.body.subspace.userFlairs[0].emoji === '🔮' && templates.body.subspace.userFlairs[1]?.modOnly === true && templates.body.subspace.userFlairs[1].color === null && templates.body.subspace.allowCustomUserFlair === false && templates.body.subspace.userFlairSelfAssign === true,
		`${templates.status} ${JSON.stringify(templates.body).slice(0, 300)}`
	);
	const settingsLog = await api(`/api/v1/subspaces/modlog?slug=${flairSlug}`, { cookie: mod.cookie });
	check('the mod log records settings.update with the user-flair fields', settingsLog.body?.entries?.some((entry) => entry.action === 'settings.update' && Array.isArray(entry.detail?.fields) && entry.detail.fields.includes('userFlairs') && entry.detail.fields.includes('allowCustomUserFlair')), JSON.stringify(settingsLog.body?.entries?.map((entry) => entry.detail)));
	const listRow = await api(`/api/v1/subspaces?q=${flairSlug.slice(0, 12)}`, { cookie: member.cookie });
	check('the directory row carries the user-flair settings', listRow.status === 200 && listRow.body.subspaces.some((entry) => entry.slug === flairSlug && entry.userFlairs?.length === 2 && entry.userFlairSelfAssign === true && entry.allowCustomUserFlair === false));

	// self-service: template picks
	const pickPrism = await flairOf(member.cookie, { flairId: 'prism' });
	check('a member picks a template → 200, member.userFlair { id prism, label Prism, emoji 🔮, color }', pickPrism.status === 200 && pickPrism.body.member?.userFlair?.id === 'prism' && pickPrism.body.member.userFlair.label === 'Prism' && pickPrism.body.member.userFlair.emoji === '🔮' && pickPrism.body.member.userFlair.color === '#7c5cff', `${pickPrism.status} ${JSON.stringify(pickPrism.body).slice(0, 300)}`);
	const pickStaff = await flairOf(member.cookie, { flairId: 'staff' });
	check('a member picking a mod-only template → 403', pickStaff.status === 403, `${pickStaff.status} ${JSON.stringify(pickStaff.body)}`);
	const pickGhost = await flairOf(member.cookie, { flairId: 'ghost' });
	check('an unknown template → 400', pickGhost.status === 400);
	const customOff = await flairOf(member.cookie, { text: 'Rainbow hunter' });
	check('custom text while allowCustomUserFlair is off → 403', customOff.status === 403, `${customOff.status} ${JSON.stringify(customOff.body)}`);
	const dressAsMember = await flairOf(member.cookie, { userId: stranger.id, flairId: 'prism' });
	check('a member dressing someone else → 403', dressAsMember.status === 403);
	const memberDetail = await flairDetail(member.cookie);
	check('the subspace detail reports viewer.userFlair', memberDetail.status === 200 && memberDetail.body.subspace.viewer.userFlair?.id === 'prism', JSON.stringify(memberDetail.body?.subspace?.viewer));
	const strangerDetail = await flairDetail(stranger.cookie);
	check('…and null for a member wearing none', strangerDetail.body.subspace.viewer.userFlair === null);

	// projection: posts, fresh comments, nested replies, both feeds — one batched lookup
	const flairPosted = await api('/api/v1/things', { method: 'POST', cookie: member.cookie, body: { type: 'text', text: 'wearing my flair', title: 'Flair post', subspaceId: flairSpace.id } });
	check('a post by the wearer carries authorFlair (fresh create response)', flairPosted.status === 200 && flairPosted.body.post?.authorFlair?.id === 'prism' && flairPosted.body.post.authorFlair.label === 'Prism', `${flairPosted.status} ${JSON.stringify(flairPosted.body?.post?.authorFlair)}`);
	const flairPost = flairPosted.body.post;
	const plainPosted = await api('/api/v1/things', { method: 'POST', cookie: stranger.cookie, body: { type: 'text', text: 'no flair here', title: 'Plain post', subspaceId: flairSpace.id } });
	check('a post by a member without a flair carries authorFlair null', plainPosted.status === 200 && plainPosted.body.post?.authorFlair === null);
	const outsidePost = await api('/api/v1/things', { method: 'POST', cookie: member.cookie, body: { type: 'text', text: 'outside any subspace', visibility: 'public' } });
	check('a post outside subspaces carries authorFlair null', outsidePost.status === 200 && outsidePost.body.post?.authorFlair === null);
	const strangerComment = await api('/api/v1/things/comment', { method: 'POST', cookie: stranger.cookie, body: { id: flairPost.id, text: 'nice flair' } });
	const memberComment = await api('/api/v1/things/comment', { method: 'POST', cookie: member.cookie, body: { id: flairPost.id, text: 'thanks!' } });
	check('the fresh comment response carries authorFlair (wearer) / null (non-wearer)', strangerComment.status === 200 && strangerComment.body.comment?.authorFlair === null && memberComment.status === 200 && memberComment.body.comment?.authorFlair?.id === 'prism', `${strangerComment.status}/${memberComment.status} ${JSON.stringify([strangerComment.body?.comment?.authorFlair, memberComment.body?.comment?.authorFlair])}`);
	const nestedReply = await api('/api/v1/things/comment', { method: 'POST', cookie: member.cookie, body: { id: strangerComment.body.comment.id, text: 'nested reply, still wearing it' } });
	check('(setup) a nested reply by the wearer', nestedReply.status === 200 && nestedReply.body.comment?.authorFlair?.id === 'prism');
	const flairRead = await api(`/api/v1/things?id=${flairPost.id}`, { cookie: stranger.cookie });
	const readComments = flairRead.body?.post?.comments || [];
	const strangerRow = readComments.find((entry) => entry.id === strangerComment.body.comment.id);
	const memberRow = readComments.find((entry) => entry.id === memberComment.body.comment.id);
	const nestedRow = strangerRow?.comments?.find((entry) => entry.id === nestedReply.body.comment.id);
	check(
		'GET /things?id projects authorFlair on the post, its comments and the nested reply (one batched lookup)',
		flairRead.status === 200 && flairRead.body.post.authorFlair?.id === 'prism' && strangerRow?.authorFlair === null && memberRow?.authorFlair?.id === 'prism' && nestedRow?.authorFlair?.id === 'prism',
		JSON.stringify({ post: flairRead.body?.post?.authorFlair, stranger: strangerRow?.authorFlair, member: memberRow?.authorFlair, nested: nestedRow?.authorFlair })
	);
	// a thread drill-down reads the COMMENT as the root doc (GET ?id=<comment>):
	// its own authorFlair and its replies' still resolve through the root post
	const commentAsRoot = await api(`/api/v1/things?id=${strangerComment.body.comment.id}`, { cookie: stranger.cookie });
	const nestedUnderRoot = (commentAsRoot.body?.post?.comments || []).find((entry) => entry.id === nestedReply.body.comment.id);
	const wearerCommentAsRoot = await api(`/api/v1/things?id=${memberComment.body.comment.id}`);
	check(
		'GET /things?id=<comment> resolves the ROOT post’s subspace: the comment doc and its nested replies carry authorFlair (a thread drill-down)',
		commentAsRoot.status === 200 && commentAsRoot.body.post?.authorFlair === null && nestedUnderRoot?.authorFlair?.id === 'prism' && wearerCommentAsRoot.status === 200 && wearerCommentAsRoot.body.post?.authorFlair?.id === 'prism',
		JSON.stringify({ root: commentAsRoot.body?.post?.authorFlair, nested: nestedUnderRoot?.authorFlair, wearer: wearerCommentAsRoot.body?.post?.authorFlair })
	);
	const flairHome = await api('/api/v1/things/feed?algorithm=latest&limit=50', { cookie: stranger.cookie });
	check('the home feed carries authorFlair on the subspace post and null on the outside post', flairHome.body?.posts?.some((entry) => entry.id === flairPost.id && entry.authorFlair?.id === 'prism') && flairHome.body.posts.some((entry) => entry.id === outsidePost.body.post.id && entry.authorFlair === null), JSON.stringify(flairHome.body?.posts?.filter((entry) => [flairPost.id, outsidePost.body?.post?.id].includes(entry.id)).map((entry) => entry.authorFlair)));
	const flairFeed = await api(`/api/v1/subspaces/feed?slug=${flairSlug}&sort=new`);
	check('the subspace feed carries authorFlair (anonymous read) + the settings on its subspace block', flairFeed.status === 200 && flairFeed.body.posts.some((entry) => entry.id === flairPost.id && entry.authorFlair?.id === 'prism') && flairFeed.body.subspace.userFlairs?.length === 2);
	const flairProfile = await api(`/api/v1/things/user?username=${member.username}&limit=20`, { cookie: stranger.cookie });
	check('the profile feed carries authorFlair too', flairProfile.status === 200 && (flairProfile.body.posts || []).some((entry) => entry.id === flairPost.id && entry.authorFlair?.id === 'prism'), `${flairProfile.status} ${JSON.stringify(flairProfile.body).slice(0, 200)}`);

	// a renamed template reaches every wearer; a deleted one keeps the snapshot
	const renamed = await flairUpdate(mod.cookie, { userFlairs: [{ id: 'prism', label: 'Prism ✨', emoji: '🔮', color: 'hotpink' }, { id: 'staff', label: 'Staff', emoji: '🎩', modOnly: true }] });
	const afterRename = await api(`/api/v1/things?id=${flairPost.id}`);
	check('renaming a template updates the wearer’s chip (label + color follow)', renamed.status === 200 && afterRename.body?.post?.authorFlair?.label === 'Prism ✨' && afterRename.body.post.authorFlair.color === 'hotpink' && afterRename.body.post.authorFlair.id === 'prism', JSON.stringify(afterRename.body?.post?.authorFlair));
	const dropped = await flairUpdate(mod.cookie, { userFlairs: [{ id: 'staff', label: 'Staff', emoji: '🎩', modOnly: true }] });
	const afterDrop = await api(`/api/v1/things?id=${flairPost.id}`);
	check('deleting a template keeps the wearer’s snapshot (the last label they were given)', dropped.status === 200 && afterDrop.body?.post?.authorFlair?.id === 'prism' && afterDrop.body.post.authorFlair.label === 'Prism', JSON.stringify(afterDrop.body?.post?.authorFlair));
	await flairUpdate(mod.cookie, { userFlairs: [{ id: 'prism', label: 'Prism', emoji: '🔮', color: '#7c5cff' }, { id: 'staff', label: 'Staff', emoji: '🎩', modOnly: true }] });

	// moderators dress anyone (but the owner), bound by neither switch; only THAT logs
	const dressStaff = await flairOf(mod.cookie, { username: stranger.username, flairId: 'staff' });
	check('a mod gives a member the mod-only template → 200', dressStaff.status === 200 && dressStaff.body.member?.userFlair?.id === 'staff' && dressStaff.body.member.userId === stranger.id, `${dressStaff.status} ${JSON.stringify(dressStaff.body).slice(0, 200)}`);
	const strangerPostRead = await api(`/api/v1/things?id=${plainPosted.body.post.id}`);
	check('…and their post now wears it', strangerPostRead.body?.post?.authorFlair?.id === 'staff');
	const dressCustom = await flairOf(mod.cookie, { userId: stranger.id, text: 'Verified bee', emoji: '🐝' });
	check('a mod sets custom text while allowCustomUserFlair is off → 200 (mods are bound by neither switch)', dressCustom.status === 200 && dressCustom.body.member?.userFlair?.id === null && dressCustom.body.member.userFlair.label === 'Verified bee' && dressCustom.body.member.userFlair.emoji === '🐝', `${dressCustom.status} ${JSON.stringify(dressCustom.body).slice(0, 200)}`);
	const dressLong = await flairOf(mod.cookie, { userId: stranger.id, text: 'x'.repeat(41) });
	check('custom text over 40 chars → 400 (mods too)', dressLong.status === 400);
	const dressOwner = await flairOf(mod.cookie, { userId: owner.id, flairId: 'prism' });
	check('a mod dressing the owner → 403', dressOwner.status === 403, `${dressOwner.status} ${JSON.stringify(dressOwner.body)}`);
	const ownerSelf = await flairOf(owner.cookie, { flairId: 'staff' });
	check('the owner dresses themselves, mod-only template included → 200', ownerSelf.status === 200 && ownerSelf.body.member?.userFlair?.id === 'staff');
	const flairLog = await api(`/api/v1/subspaces/modlog?slug=${flairSlug}&limit=50`, { cookie: mod.cookie });
	const flairLogRows = (flairLog.body?.entries || []).filter((entry) => entry.action === 'member.userFlair');
	check(
		'mod log: member.userFlair only when a mod dresses someone ELSE (stranger ×2 by the mod; nothing for the member’s or the owner’s own picks)',
		flairLogRows.length === 2 && flairLogRows.every((entry) => entry.userId === stranger.id && entry.actor?.id === mod.id) && flairLogRows.some((entry) => entry.detail?.flairId === 'staff') && flairLogRows.some((entry) => entry.detail?.flairId === null && entry.detail?.text === 'Verified bee'),
		JSON.stringify(flairLogRows.map((entry) => [entry.userId, entry.detail]))
	);
	const memberRows = await api(`/api/v1/subspaces/members?slug=${flairSlug}`, { cookie: mod.cookie });
	check('the member list rows carry userFlair', memberRows.status === 200 && memberRows.body.members.some((entry) => entry.userId === member.id && entry.userFlair?.id === 'prism') && memberRows.body.members.some((entry) => entry.userId === stranger.id && entry.userFlair?.label === 'Verified bee'), JSON.stringify(memberRows.body?.members?.map((entry) => [entry.userId, entry.userFlair])));

	// custom text for members, then clearing
	const allowCustom = await flairUpdate(mod.cookie, { allowCustomUserFlair: true });
	const memberCustom = await flairOf(member.cookie, { text: '  Rainbow   hunter ', emoji: '🌈', color: 'not-a-color!' });
	check('with allowCustomUserFlair on a member types their own (whitespace collapsed, emoji kept, bad color dropped)', allowCustom.status === 200 && memberCustom.status === 200 && memberCustom.body.member?.userFlair?.id === null && memberCustom.body.member.userFlair.label === 'Rainbow hunter' && memberCustom.body.member.userFlair.emoji === '🌈' && memberCustom.body.member.userFlair.color === null, `${memberCustom.status} ${JSON.stringify(memberCustom.body).slice(0, 200)}`);
	const memberLong = await flairOf(member.cookie, { text: 'y'.repeat(41) });
	check('a member’s custom text over 40 chars → 400', memberLong.status === 400);
	const customRead = await api(`/api/v1/things?id=${flairPost.id}`);
	check('the post wears the custom text (id null)', customRead.body?.post?.authorFlair?.id === null && customRead.body.post.authorFlair.label === 'Rainbow hunter');
	const clearedFlair = await flairOf(member.cookie, { flairId: null, text: '' });
	const clearedRead = await api(`/api/v1/things?id=${flairPost.id}`);
	const clearedDetail = await flairDetail(member.cookie);
	check('flairId null + empty text clears: member.userFlair null, the post’s authorFlair null, viewer.userFlair null', clearedFlair.status === 200 && clearedFlair.body.member?.userFlair === null && clearedRead.body?.post?.authorFlair === null && clearedDetail.body.subspace.viewer.userFlair === null, `${clearedFlair.status} ${JSON.stringify([clearedFlair.body?.member?.userFlair, clearedRead.body?.post?.authorFlair])}`);

	// self-assign off: members can't pick, may still clear; mods still dress
	const selfOff = await flairUpdate(mod.cookie, { userFlairSelfAssign: false });
	const pickWhileOff = await flairOf(member.cookie, { flairId: 'prism' });
	const customWhileOff = await flairOf(member.cookie, { text: 'still?' });
	const clearWhileOff = await flairOf(member.cookie, {});
	const modWhileOff = await flairOf(mod.cookie, { userId: member.id, flairId: 'prism' });
	const modSelfWhileOff = await flairOf(mod.cookie, { flairId: 'prism' });
	check(
		'userFlairSelfAssign off: a member’s template pick 403, custom text 403, clearing 200; a mod still dresses them (200) and themselves (200)',
		selfOff.status === 200 && pickWhileOff.status === 403 && customWhileOff.status === 403 && clearWhileOff.status === 200 && clearWhileOff.body.member?.userFlair === null && modWhileOff.status === 200 && modWhileOff.body.member?.userFlair?.id === 'prism' && modSelfWhileOff.status === 200 && modSelfWhileOff.body.member?.userFlair?.id === 'prism',
		`${selfOff.status}/${pickWhileOff.status}/${customWhileOff.status}/${clearWhileOff.status}/${modWhileOff.status}/${modSelfWhileOff.status}`
	);
	const memberClearsModPick = await flairOf(member.cookie, { flairId: null });
	check('a member may take off the flair a mod gave them even while self-assign is off', memberClearsModPick.status === 200 && memberClearsModPick.body.member?.userFlair === null);
	await flairUpdate(mod.cookie, { userFlairSelfAssign: true });

	// kicked / banned wearers are hidden; a rejoin brings the flair back
	const redress = await flairOf(member.cookie, { flairId: 'prism' });
	const kickWearer = await api('/api/v1/subspaces/members', { method: 'POST', cookie: mod.cookie, body: { slug: flairSlug, userId: member.id, action: 'remove' } });
	const kickedRead = await api(`/api/v1/things?id=${flairPost.id}`);
	check('a kicked wearer’s chip disappears (authorFlair null while not a member)', redress.status === 200 && kickWearer.status === 200 && kickedRead.body?.post?.authorFlair === null, `${redress.status}/${kickWearer.status} ${JSON.stringify(kickedRead.body?.post?.authorFlair)}`);
	const kickedSelf = await flairOf(member.cookie, { flairId: 'prism' });
	check('…and they can’t set one while out → 403', kickedSelf.status === 403);
	const rejoinWearer = await api('/api/v1/subspaces/join', { method: 'POST', cookie: member.cookie, body: { slug: flairSlug } });
	const rejoinedRead = await api(`/api/v1/things?id=${flairPost.id}`);
	check('rejoining brings the flair back (the pick was kept on the row)', rejoinWearer.status === 200 && rejoinWearer.body.joined === true && rejoinWearer.body.subspace.viewer.userFlair?.id === 'prism' && rejoinedRead.body?.post?.authorFlair?.id === 'prism', JSON.stringify([rejoinWearer.body?.subspace?.viewer?.userFlair, rejoinedRead.body?.post?.authorFlair]));
	const banWearer = await api('/api/v1/subspaces/members', { method: 'POST', cookie: mod.cookie, body: { slug: flairSlug, userId: stranger.id, action: 'ban', reason: 'flair test' } });
	const bannedRead = await api(`/api/v1/things?id=${plainPosted.body.post.id}`);
	const dressBanned = await flairOf(mod.cookie, { userId: stranger.id, flairId: 'prism' });
	check('a banned wearer’s chip disappears and a mod dressing a banned user → 400', banWearer.status === 200 && bannedRead.body?.post?.authorFlair === null && dressBanned.status === 400, `${banWearer.status}/${dressBanned.status} ${JSON.stringify(bannedRead.body?.post?.authorFlair)}`);
	const bannedSelf = await flairOf(stranger.cookie, { flairId: 'prism' });
	check('a banned member setting their own → 403', bannedSelf.status === 403);
	await api('/api/v1/subspaces/members', { method: 'POST', cookie: mod.cookie, body: { slug: flairSlug, userId: stranger.id, action: 'unban' } });
	const genericFlair = await api('/api/v1/things', { method: 'PATCH', cookie: member.cookie, body: { id: flairPost.id, crystal: { authorFlair: { label: 'sneaky' } } } });
	const genericRead = await api(`/api/v1/things?id=${flairPost.id}`);
	check('authorFlair is never client-writable (a PATCH smuggling it changes nothing)', genericFlair.status !== 500 && genericRead.body?.post?.authorFlair?.id === 'prism' && genericRead.body.post.authorFlair.label === 'Prism', `${genericFlair.status} ${JSON.stringify(genericRead.body?.post?.authorFlair)}`);
	const manifestO = await api('/api/v1/capabilities');
	check(
		'capability manifest advertises the user-flair contracts (subspaces / get / update 1.2.0, members 1.3.0, subspaces-feed 1.1.0, things / things-comment / things-feed / things-user 1.2.0)',
		manifestO.status === 200 && manifestO.body.features['api.subspaces'] === '1.2.0' && manifestO.body.features['api.subspaces-get'] === '1.2.0' && manifestO.body.features['api.subspaces-update'] === '1.2.0' && manifestO.body.features['api.subspaces-members'] === '1.3.0' && manifestO.body.features['api.subspaces-feed'] === '1.1.0' && ['api.things', 'api.things-comment', 'api.things-feed', 'api.things-user'].every((feature) => manifestO.body.features[feature] === '1.2.0'),
		JSON.stringify({ s: manifestO.body?.features?.['api.subspaces'], g: manifestO.body?.features?.['api.subspaces-get'], u: manifestO.body?.features?.['api.subspaces-update'], m: manifestO.body?.features?.['api.subspaces-members'], f: manifestO.body?.features?.['api.subspaces-feed'], t: manifestO.body?.features?.['api.things'] })
	);
	const cleanupO = await api('/api/v1/subspaces/delete', { method: 'POST', cookie: owner.cookie, body: { slug: flairSlug, confirmSlug: flairSlug } });
	check('(cleanup) owner deletes the flair subspace', cleanupO.status === 200, `${cleanupO.status} ${JSON.stringify(cleanupO.body).slice(0, 200)}`);

	console.log(`\n${passed} passed, ${failures.length} failed${skipped.length ? `, ${skipped.length} skipped (storage migration pending on this database)` : ''}`);
	if (failures.length) {
		console.log('Failures:\n  - ' + failures.join('\n  - '));
		process.exit(1);
	}
};

run().catch((error) => {
	console.error('verification crashed:', error);
	process.exit(1);
});
