#!/usr/bin/env node
// Live verification of the Subspaces + up/down vote family — real API only,
// no mocks, no direct DB access (FUNDAMENTALS §2). Registers fixture users,
// founds a subspace, joins/leaves, posts with title + flair, votes up/down on
// posts and comments (flip/clear/one-per-user), reads every sort, moderates
// (remove → redaction, approve, pin, lock → 423, flair), bans (posting +
// voting blocked, ban outlives leaving), restricted/private access walls,
// the generic-things escape hatches staying closed, the capability
// manifest advertising the new contracts, and (round 2, section M) the
// lifecycle: role/ban notifications, ownership transfer and deletion with
// every 4xx wall.
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
	check('private join needs a moderator → 403', privJoin.status === 403, `${privJoin.status} ${JSON.stringify(privJoin.body).slice(0, 200)}`);
	const addStranger = await api('/api/v1/subspaces/members', { method: 'POST', cookie: mod.cookie, body: { slug, username: stranger.username, action: 'add' } });
	check('mod adds a member to a private subspace', addStranger.status === 200 && addStranger.body.member.left === false);
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
	check('capability manifest advertises the new contracts', manifest.status === 200 && manifest.body.features?.['api.subspaces'] === '1.0.0' && manifest.body.features['api.things-updown'] === '1.0.0' && manifest.body.features['api.things-feed'] === '1.1.0', JSON.stringify({ s: manifest.body?.features?.['api.subspaces'], u: manifest.body?.features?.['api.things-updown'], f: manifest.body?.features?.['api.things-feed'] }));
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
		'capability manifest advertises transfer (1.0.1, guarded writes) / delete (1.1.0, privatePosts + slug hold) and the bumped members/notifications contracts (1.1.0)',
		manifest2.status === 200 && manifest2.body.features['api.subspaces-transfer'] === '1.0.1' && manifest2.body.features['api.subspaces-delete'] === '1.1.0' && manifest2.body.features['api.subspaces-members'] === '1.1.0' && manifest2.body.features['api.notifications-list'] === '1.1.0' && manifest2.body.features['api.notifications-settings'] === '1.1.0',
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
