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
// wearers hidden, the manifest — plus the S3 review fixes: comment-as-root
// reads follow a template rename, mods may dress the owner, kick / ban /
// demotion strip the pick, and the join / leave / transfer / moderate /
// members contract bumps — and (section P) removal reasons + moderation
// modals: the removalReasons setting with every wall, moderate remove with
// reasonId → the composed stored reason the author and mods see, the
// author's subspace-post-removed bell row, approve clearing it silently, a
// mod's own post ringing nobody, edits never rewriting history, the ban
// note landing in the mod log only, and the manifest — plus the S4 review
// fixes: a second remove on a removed post is a no-op (no second mod-log row
// or bell), remove cites a rule through ruleIndex (composed + bounded
// server-side, every wall), the author's bell comes from the subspace's
// mod team with the reason's headline (never the moderator the projection
// hides), so does the ban bell, and a title with no Latin characters still
// mints a (hashed) removal-reason id — and (section Q) reports: POST
// /subspaces/report with every wall (401 / 400 / 404 never disclosing /
// 403 banned), a comment resolving to its root post, one row per (post,
// reporter) refreshed by a repeat, the mods' subspace-report bell (deduped,
// never the reporter's), the moderator-only reportCount on the post
// projection + openReportCount on the detail, the grouped Reports queue
// (open / resolved, walls 401 / 403 / 400 / 404), dismiss + its mod-log
// row, remove / approve settling open reports (detail.resolvedReports), a
// deleted post taking its reports with it, the generic-things wall and the
// manifest — and (section R) discovery: GET /things/feed?scope=subspaces
// (a member sees only their ACTIVE subspaces' posts with every fence
// intact — removed out, a private subspace's post for its member only —
// a viewer in no subspace and anonymous get an empty page, scope=all / no
// scope unchanged, an unknown scope → 400, the response echoes scope, the
// ranked path scopes too), the directory sorts (members / active / new
// orders, recentPostCount on active rows, offset paging, q + mine narrowing
// every sort, an unknown sort → 400, the response echoes sort, the /explore
// and /search queries) and the manifest — plus the S6 review fixes: a
// private subspace's activity is its ACTIVE members' business (under active
// a guest, a logged-in stranger and a pending requester see it ranked at
// zero with no recentPostCount; its member and the owner see it ranked by
// its real count), the anon=1 edge-cache contract (the public Cache-Control
// + Vary: Authorization with null viewer state, cookies ignored on the
// cacheable URL, no public header without the flag, private / no-store when
// authed, a Bearer credential answered as itself, anon=1&mine=1 → 401) and
// the directory docs naming the subspaces.list rate key + the contract —
// and (section S) the completeness sweep: GET /things?id=&commentSort=
// top|new|old (score-desc-then-older / newest / oldest orders, the default
// page unchanged, counts untouched, 400 on a typo, anonymous reads, nested
// replies + comment-as-root reads, a plain post; S7 review: a comment posted
// under a sort landing last / below every non-negative comment, the ack's
// commentCount over an earlier sorted read, the drill-down read on every
// sort beside the unchanged default read, the 400 body), deleting a post
// clearing its reports, banning a pending requester dropping the request, transfer
// refused for banned / pending / outsider targets, a pending requester's
// canPost false + the composer query excluding the pending subspace, a
// demoted mod losing every queue on the next request, private-subspace and
// removed posts never in rss / trending, the manifest + docs — and (section
// T) the final round-2 sweep, the cross-slice invariants no single slice
// owns: "the mods" a report / join request rings are the ACTIVE owner +
// moderators at emit time (a demoted mod and a moderator who left stop
// ringing at once), an ACTIVE member of a private subspace calling join is
// a no-op (never a request), the Reports queue pages by cursor, a subspace
// deletion takes every subspace-report row with it (the reporter's own
// generic read goes 200 → 404) while the posts survive, every bell of the
// family deep-links consistently (post-shaped rows postId = targetId; the
// subspace-shaped ones carry the subspace + an "s/<slug> ·" preview), and
// the docs registry ↔ both served manifests agree across the whole family
// at the round's final versions.
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

// The per-user write budget (`subspaces.write`, 60 / min — a sliding window
// kept in Mongo, so it outlives a stack restart) is a product limit, not a
// subject of this walk: the owner fires a long burst of writes across
// sections M → O and can legitimately reach it. A 429 is PACED — wait out
// Retry-After (bounded) and retry, a few times at most — so the walk stays
// honest about behaviour while never reporting the budget itself as a
// failure. No check in this file asserts a 429.
const MAX_429_RETRIES = 3;
const api = async (path, { cookie, method = 'GET', body, headers } = {}) => {
	for (let attempt = 0; ; attempt++) {
		const response = await fetch(`${BASE}${path}`, {
			method,
			headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(headers || {}) },
			...(body !== undefined ? { body: JSON.stringify(body) } : {})
		});
		let json = null;
		try {
			json = await response.json();
		} catch {
			// non-JSON — callers assert on status
		}
		if (response.status === 429 && attempt < MAX_429_RETRIES) {
			const retryAfter = Number(response.headers.get('retry-after'));
			const waitMs = Math.min(65_000, Math.max(1_000, (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 5) * 1000));
			console.log(`  ⏳ ${method} ${path} → 429 (per-user write budget) — pacing ${Math.ceil(waitMs / 1000)}s, then retrying`);
			await new Promise((resolve) => setTimeout(resolve, waitMs));
			continue;
		}
		return { status: response.status, body: json, headers: response.headers };
	}
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
	check('capability manifest advertises the new contracts (subspaces 1.2.0 → 1.3.0 with S4 removalReasons, updown 1.0.0, things-feed 1.2.0 → 1.4.0 with S5 reportCount + S6 scope; subspaces 1.5.0 after the S6 sort + the S6 review anon=1 / rate key / private-activity fence)', manifest.status === 200 && manifest.body.features?.['api.subspaces'] === '1.5.0' && manifest.body.features['api.things-updown'] === '1.0.0' && manifest.body.features['api.things-feed'] === '1.4.0', JSON.stringify({ s: manifest.body?.features?.['api.subspaces'], u: manifest.body?.features?.['api.things-updown'], f: manifest.body?.features?.['api.things-feed'] }));
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
		'capability manifest advertises transfer (1.2.0, guarded writes + newOwner.userFlair + removalReasons) / delete (1.1.0, privatePosts + slug hold) and the bumped members (1.4.1, S2 queues + review fixes + S3 user flairs + S3 review + S4 ban note + S4 review mod-team ban bell) / notifications contracts (list 1.2.0 — mod-team actor rows; settings 1.1.0)',
		manifest2.status === 200 && manifest2.body.features['api.subspaces-transfer'] === '1.2.0' && manifest2.body.features['api.subspaces-delete'] === '1.1.0' && manifest2.body.features['api.subspaces-members'] === '1.4.1' && manifest2.body.features['api.notifications-list'] === '1.2.0' && manifest2.body.features['api.notifications-settings'] === '1.1.0',
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
		'capability manifest advertises the request contracts (leave / join 1.2.0 → 1.3.0 after the S3 review + S4 removalReasons bumps; list 1.5.0 after the S6 sort + review / update 1.3.0, get 1.4.0 after the S5 openReportCount bump, members 1.4.1 after the S3 user-flair bump + review + the S4 ban note + the S4 review mod-team ban bell)',
		manifest3.status === 200 && manifest3.body.features['api.subspaces-join'] === '1.3.0' && manifest3.body.features['api.subspaces-leave'] === '1.3.0' && manifest3.body.features['api.subspaces-get'] === '1.4.0' && manifest3.body.features['api.subspaces'] === '1.5.0' && manifest3.body.features['api.subspaces-members'] === '1.4.1' && manifest3.body.features['api.subspaces-update'] === '1.3.0',
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
	// S3 review: the rename reaches the comment-as-root read too — the embed is
	// loaded for the ROOT subspace, not only for docs carrying their own pointer
	const renamedCommentRoot = await api(`/api/v1/things?id=${memberComment.body.comment.id}`);
	const renamedThread = await api(`/api/v1/things?id=${strangerComment.body.comment.id}`);
	const renamedNested = (renamedThread.body?.post?.comments || []).find((entry) => entry.id === nestedReply.body.comment.id);
	check(
		'GET /things?id=<comment> follows the rename too: the wearer’s comment as root and the nested reply under a stranger’s comment read the live label + color',
		renamedCommentRoot.status === 200 && renamedCommentRoot.body.post?.authorFlair?.label === 'Prism ✨' && renamedCommentRoot.body.post.authorFlair.color === 'hotpink' && renamedNested?.authorFlair?.label === 'Prism ✨' && renamedNested.authorFlair.color === 'hotpink',
		JSON.stringify({ root: renamedCommentRoot.body?.post?.authorFlair, nested: renamedNested?.authorFlair })
	);
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
	// S3 review: the spec says moderators dress ANYONE — the owner included
	// (who can always override their own pick)
	const dressOwner = await flairOf(mod.cookie, { userId: owner.id, flairId: 'prism' });
	check('a mod dressing the owner → 200 (the owner’s row wears it)', dressOwner.status === 200 && dressOwner.body.member?.role === 'owner' && dressOwner.body.member.userFlair?.id === 'prism', `${dressOwner.status} ${JSON.stringify(dressOwner.body).slice(0, 200)}`);
	const ownerSelf = await flairOf(owner.cookie, { flairId: 'staff' });
	check('…and the owner overrides it themselves, mod-only template included → 200', ownerSelf.status === 200 && ownerSelf.body.member?.userFlair?.id === 'staff');
	const flairLog = await api(`/api/v1/subspaces/modlog?slug=${flairSlug}&limit=50`, { cookie: mod.cookie });
	const flairLogRows = (flairLog.body?.entries || []).filter((entry) => entry.action === 'member.userFlair');
	const strangerLogRows = flairLogRows.filter((entry) => entry.userId === stranger.id);
	check(
		'mod log: member.userFlair only when a mod dresses someone ELSE (stranger ×2 + the owner ×1, all by the mod; nothing for the member’s or the owner’s own picks)',
		flairLogRows.length === 3 && flairLogRows.every((entry) => entry.actor?.id === mod.id) && strangerLogRows.length === 2 && strangerLogRows.some((entry) => entry.detail?.flairId === 'staff') && strangerLogRows.some((entry) => entry.detail?.flairId === null && entry.detail?.text === 'Verified bee') && flairLogRows.some((entry) => entry.userId === owner.id && entry.detail?.flairId === 'prism'),
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
	// S3 review: a kick STRIPS the pick (as it revokes approval) — a rejoin
	// wears nothing until they pick again; the mod log says so
	const kickLog = await api(`/api/v1/subspaces/modlog?slug=${flairSlug}&limit=50`, { cookie: mod.cookie });
	check('the member.remove mod-log entry records userFlairCleared', (kickLog.body?.entries || []).some((entry) => entry.action === 'member.remove' && entry.userId === member.id && entry.detail?.userFlairCleared === true), JSON.stringify((kickLog.body?.entries || []).filter((entry) => entry.action === 'member.remove').map((entry) => entry.detail)));
	const rejoinWearer = await api('/api/v1/subspaces/join', { method: 'POST', cookie: member.cookie, body: { slug: flairSlug } });
	const rejoinedRead = await api(`/api/v1/things?id=${flairPost.id}`);
	check('rejoining after a kick wears NO flair (the kick stripped the pick): viewer.userFlair null, authorFlair null', rejoinWearer.status === 200 && rejoinWearer.body.joined === true && rejoinWearer.body.subspace.viewer.userFlair === null && rejoinedRead.body?.post?.authorFlair === null, JSON.stringify([rejoinWearer.body?.subspace?.viewer?.userFlair, rejoinedRead.body?.post?.authorFlair]));
	const repick = await flairOf(member.cookie, { flairId: 'prism' });
	const repickedRead = await api(`/api/v1/things?id=${flairPost.id}`);
	check('…and picking again works (the post wears it again)', repick.status === 200 && repick.body.member?.userFlair?.id === 'prism' && repickedRead.body?.post?.authorFlair?.id === 'prism', `${repick.status} ${JSON.stringify(repickedRead.body?.post?.authorFlair)}`);
	const banWearer = await api('/api/v1/subspaces/members', { method: 'POST', cookie: mod.cookie, body: { slug: flairSlug, userId: stranger.id, action: 'ban', reason: 'flair test' } });
	const bannedRead = await api(`/api/v1/things?id=${plainPosted.body.post.id}`);
	const dressBanned = await flairOf(mod.cookie, { userId: stranger.id, flairId: 'prism' });
	check('a banned wearer’s chip disappears and a mod dressing a banned user → 400', banWearer.status === 200 && bannedRead.body?.post?.authorFlair === null && dressBanned.status === 400, `${banWearer.status}/${dressBanned.status} ${JSON.stringify(bannedRead.body?.post?.authorFlair)}`);
	const bannedSelf = await flairOf(stranger.cookie, { flairId: 'prism' });
	check('a banned member setting their own → 403', bannedSelf.status === 403);
	// S3 review: the ban stripped the pick — lifting it restores the
	// membership, not the badge
	const unbanWearer = await api('/api/v1/subspaces/members', { method: 'POST', cookie: mod.cookie, body: { slug: flairSlug, userId: stranger.id, action: 'unban' } });
	const unbannedRead = await api(`/api/v1/things?id=${plainPosted.body.post.id}`);
	check('unban brings the membership back without the flair (the ban stripped it: member.userFlair null, authorFlair null)', unbanWearer.status === 200 && unbanWearer.body.member?.banned === false && unbanWearer.body.member.userFlair === null && unbannedRead.body?.post?.authorFlair === null, `${unbanWearer.status} ${JSON.stringify([unbanWearer.body?.member?.userFlair, unbannedRead.body?.post?.authorFlair])}`);
	// S3 review: a demotion takes a MOD-ONLY flair off with the hat; an
	// ordinary pick stays (the mod wears prism from the self-assign-off run)
	const demoteKeeps = await api('/api/v1/subspaces/members', { method: 'POST', cookie: owner.cookie, body: { slug: flairSlug, userId: mod.id, action: 'role', role: 'member' } });
	check('demoting a moderator who wears an ordinary template keeps it', demoteKeeps.status === 200 && demoteKeeps.body.member?.role === 'member' && demoteKeeps.body.member.userFlair?.id === 'prism', `${demoteKeeps.status} ${JSON.stringify(demoteKeeps.body?.member?.userFlair)}`);
	const repromote = await api('/api/v1/subspaces/members', { method: 'POST', cookie: owner.cookie, body: { slug: flairSlug, userId: mod.id, action: 'role', role: 'moderator' } });
	const modWearsStaff = await flairOf(mod.cookie, { flairId: 'staff' });
	const demoteStrips = await api('/api/v1/subspaces/members', { method: 'POST', cookie: owner.cookie, body: { slug: flairSlug, userId: mod.id, action: 'role', role: 'member' } });
	check(
		'demoting a moderator who wears a MOD-ONLY template strips it (member.userFlair null)',
		repromote.status === 200 && modWearsStaff.status === 200 && modWearsStaff.body.member?.userFlair?.id === 'staff' && demoteStrips.status === 200 && demoteStrips.body.member?.role === 'member' && demoteStrips.body.member.userFlair === null,
		`${repromote.status}/${modWearsStaff.status}/${demoteStrips.status} ${JSON.stringify(demoteStrips.body?.member?.userFlair)}`
	);
	const repromote2 = await api('/api/v1/subspaces/members', { method: 'POST', cookie: owner.cookie, body: { slug: flairSlug, userId: mod.id, action: 'role', role: 'moderator' } });
	check('(setup) the mod hat is back', repromote2.status === 200 && repromote2.body.member?.role === 'moderator');
	const stripLog = await api(`/api/v1/subspaces/modlog?slug=${flairSlug}&limit=50`, { cookie: mod.cookie });
	const stripRows = stripLog.body?.entries || [];
	check(
		'mod log: member.ban and the stripping member.role entry carry userFlairCleared: true; the demotion that kept the pick does not',
		stripRows.some((entry) => entry.action === 'member.ban' && entry.userId === stranger.id && entry.detail?.userFlairCleared === true) &&
			stripRows
				.filter((entry) => entry.action === 'member.role' && entry.userId === mod.id && entry.detail?.role === 'member')
				.map((entry) => entry.detail?.userFlairCleared === true)
				.sort()
				.join() === 'false,true',
		JSON.stringify(stripRows.filter((entry) => entry.action === 'member.role' || entry.action === 'member.ban').map((entry) => [entry.action, entry.userId, entry.detail]))
	);
	const genericFlair = await api('/api/v1/things', { method: 'PATCH', cookie: member.cookie, body: { id: flairPost.id, crystal: { authorFlair: { label: 'sneaky' } } } });
	const genericRead = await api(`/api/v1/things?id=${flairPost.id}`);
	check('authorFlair is never client-writable (a PATCH smuggling it changes nothing)', genericFlair.status !== 500 && genericRead.body?.post?.authorFlair?.id === 'prism' && genericRead.body.post.authorFlair.label === 'Prism', `${genericFlair.status} ${JSON.stringify(genericRead.body?.post?.authorFlair)}`);
	const manifestO = await api('/api/v1/capabilities');
	check(
		'capability manifest advertises the user-flair contracts (subspaces 1.2.0 → 1.3.0 with S4 removalReasons → 1.4.0 with S6 sort → 1.5.0 after the S6 review / update 1.3.0, get → 1.4.0 with S5 openReportCount, members 1.3.1 → 1.4.1 with the S4 ban note + S4 review, subspaces-feed 1.1.0 → 1.3.0 with S4 + S5 reportCount, things / things-comment / things-feed / things-user 1.2.0 → 1.3.0 with S5 reportCount)',
		manifestO.status === 200 && manifestO.body.features['api.subspaces'] === '1.5.0' && manifestO.body.features['api.subspaces-get'] === '1.4.0' && manifestO.body.features['api.subspaces-update'] === '1.3.0' && manifestO.body.features['api.subspaces-members'] === '1.4.1' && manifestO.body.features['api.subspaces-feed'] === '1.3.0' && ['api.things-comment', 'api.things-user'].every((feature) => manifestO.body.features[feature] === '1.3.0') && manifestO.body.features['api.things'] === '1.4.0' /* S7: the single read moved on to 1.4.0 — commentSort — see section S */ && manifestO.body.features['api.things-feed'] === '1.4.0',
		JSON.stringify({ s: manifestO.body?.features?.['api.subspaces'], g: manifestO.body?.features?.['api.subspaces-get'], u: manifestO.body?.features?.['api.subspaces-update'], m: manifestO.body?.features?.['api.subspaces-members'], f: manifestO.body?.features?.['api.subspaces-feed'], t: manifestO.body?.features?.['api.things'] })
	);
	check(
		'S3 review: every other contract whose shape grew user flairs is bumped (join / leave 1.2.0 → 1.3.0 with S4 removalReasons — subspace block + viewer.userFlair; transfer 1.1.0 → 1.2.0 — newOwner.userFlair; moderate 1.1.0 → 1.4.0 — post.authorFlair + S4 reasonId + S4 review ruleIndex + S5 report settlement; members 1.3.1 → 1.4.1 — kick / ban / demotion strip + the owner dressable + S4 ban note + S4 review)',
		manifestO.body?.features?.['api.subspaces-join'] === '1.3.0' && manifestO.body.features['api.subspaces-leave'] === '1.3.0' && manifestO.body.features['api.subspaces-transfer'] === '1.2.0' && manifestO.body.features['api.subspaces-moderate'] === '1.4.0' && manifestO.body.features['api.subspaces-members'] === '1.4.1',
		JSON.stringify({ j: manifestO.body?.features?.['api.subspaces-join'], l: manifestO.body?.features?.['api.subspaces-leave'], t: manifestO.body?.features?.['api.subspaces-transfer'], mo: manifestO.body?.features?.['api.subspaces-moderate'], m: manifestO.body?.features?.['api.subspaces-members'] })
	);
	const cleanupO = await api('/api/v1/subspaces/delete', { method: 'POST', cookie: owner.cookie, body: { slug: flairSlug, confirmSlug: flairSlug } });
	check('(cleanup) owner deletes the flair subspace', cleanupO.status === 200, `${cleanupO.status} ${JSON.stringify(cleanupO.body).slice(0, 200)}`);

	console.log('\nP. removal reasons + moderation modals');
	// a fresh PUBLIC subspace with two rules: owner founds it, mod is
	// promoted, member and stranger join
	const rrSlug = `rr_${suffix}`.slice(0, 30);
	const foundedRR = await api('/api/v1/subspaces', { method: 'POST', cookie: owner.cookie, body: { slug: rrSlug, name: 'Removal Reasons', access: 'public', rules: [{ title: 'Be kind' }, { title: 'No spam', text: 'Ads go elsewhere.' }] } });
	check('(setup) owner founds a public subspace with two rules', foundedRR.status === 201 && foundedRR.body.subspace?.rules?.length === 2, `${foundedRR.status} ${JSON.stringify(foundedRR.body).slice(0, 200)}`);
	const rrSpace = foundedRR.body.subspace;
	check('defaults: removalReasons [] on the create response', Array.isArray(rrSpace?.removalReasons) && rrSpace.removalReasons.length === 0, JSON.stringify(rrSpace?.removalReasons));
	const rrUpdate = (cookie, body) => api('/api/v1/subspaces/update', { method: 'POST', cookie, body: { slug: rrSlug, ...body } });
	const rrModerate = (cookie, body) => api('/api/v1/subspaces/moderate', { method: 'POST', cookie, body });
	const rrMembers = (cookie, body) => api('/api/v1/subspaces/members', { method: 'POST', cookie, body: { slug: rrSlug, ...body } });
	const rrLog = async (cookie) => (await api(`/api/v1/subspaces/modlog?slug=${rrSlug}&limit=50`, { cookie })).body?.entries || [];
	const removedNotifsOf = async (cookie, postId) => (await notifsOf(cookie)).items.filter((n) => n.type === 'subspace-post-removed' && n.postId === postId);
	await api('/api/v1/subspaces/join', { method: 'POST', cookie: mod.cookie, body: { slug: rrSlug } });
	const promoteRRMod = await rrMembers(owner.cookie, { userId: mod.id, action: 'role', role: 'moderator' });
	const memberJoinsRR = await api('/api/v1/subspaces/join', { method: 'POST', cookie: member.cookie, body: { slug: rrSlug } });
	const strangerJoinsRR = await api('/api/v1/subspaces/join', { method: 'POST', cookie: stranger.cookie, body: { slug: rrSlug } });
	check('(setup) mod promoted, member + stranger joined', promoteRRMod.status === 200 && promoteRRMod.body.member?.role === 'moderator' && memberJoinsRR.status === 200 && strangerJoinsRR.status === 200, `${promoteRRMod.status}/${memberJoinsRR.status}/${strangerJoinsRR.status}`);

	// settings walls
	const rrByMember = await rrUpdate(member.cookie, { removalReasons: [{ title: 'No spam' }] });
	check('a plain member cannot edit removal reasons → 403', rrByMember.status === 403, `${rrByMember.status} ${JSON.stringify(rrByMember.body)}`);
	const rrNotList = await rrUpdate(mod.cookie, { removalReasons: 'nope' });
	check('removalReasons that is not a list → 400', rrNotList.status === 400, `${rrNotList.status} ${JSON.stringify(rrNotList.body)}`);
	const rrTooMany = await rrUpdate(mod.cookie, { removalReasons: new Array(21).fill(0).map((_, i) => ({ title: `r${i}` })) });
	check('more than 20 removal reasons → 400', rrTooMany.status === 400, `${rrTooMany.status} ${JSON.stringify(rrTooMany.body)}`);
	const rrNoTitle = await rrUpdate(mod.cookie, { removalReasons: [{ message: 'no title' }] });
	check('a removal reason without a title → 400', rrNoTitle.status === 400);
	const rrLongMessage = await rrUpdate(mod.cookie, { removalReasons: [{ title: 'ok', message: 'm'.repeat(501) }] });
	check('a 501-char message → 400', rrLongMessage.status === 400, `${rrLongMessage.status} ${JSON.stringify(rrLongMessage.body)}`);
	const rrDup = await rrUpdate(mod.cookie, { removalReasons: [{ id: 'a', title: 'A' }, { id: 'a', title: 'B' }] });
	check('duplicate removal reason ids → 400', rrDup.status === 400);
	const rrBadId = await rrUpdate(mod.cookie, { removalReasons: [{ id: 'Not Valid!', title: 'x' }] });
	check('an id outside the slug grammar → 400', rrBadId.status === 400);

	// a MODERATOR (not the owner) saves the list
	const rrSaved = await rrUpdate(mod.cookie, { removalReasons: [{ title: 'No Spam!', message: '  Posts that   only advertise are removed. ' }, { id: 'off-topic', title: 'Off topic' }, { title: 'x'.repeat(81), message: 'm'.repeat(500) }] });
	const rrList = rrSaved.body?.subspace?.removalReasons || [];
	check(
		'a moderator saves the removal reasons (ids minted from titles, whitespace collapsed, an explicit id kept, an 81-char title sliced to 80, a 500-char message kept)',
		rrSaved.status === 200 && rrList.length === 3 && rrList[0].id === 'no-spam' && rrList[0].title === 'No Spam!' && rrList[0].message === 'Posts that only advertise are removed.' && rrList[1].id === 'off-topic' && rrList[1].message === '' && rrList[2].title.length === 80 && rrList[2].message.length === 500,
		`${rrSaved.status} ${JSON.stringify(rrList).slice(0, 300)}`
	);
	const rrSettingsLog = await rrLog(mod.cookie);
	check('the mod log records settings.update with removalReasons', rrSettingsLog.some((entry) => entry.action === 'settings.update' && Array.isArray(entry.detail?.fields) && entry.detail.fields.includes('removalReasons')), JSON.stringify(rrSettingsLog.map((entry) => entry.detail)));
	const rrStrangerGet = await api(`/api/v1/subspaces/get?slug=${rrSlug}`, { cookie: stranger.cookie });
	const rrAnonGet = await api(`/api/v1/subspaces/get?slug=${rrSlug}`);
	check('removal reasons are public like the rules (a member’s and an anonymous detail read carry all three)', rrStrangerGet.status === 200 && rrStrangerGet.body.subspace.removalReasons?.length === 3 && rrAnonGet.status === 200 && rrAnonGet.body.subspace.removalReasons?.length === 3 && rrAnonGet.body.subspace.removalReasons[0].id === 'no-spam', JSON.stringify([rrStrangerGet.body?.subspace?.removalReasons?.length, rrAnonGet.body?.subspace?.removalReasons?.length]));
	const rrRow = await api(`/api/v1/subspaces?q=${rrSlug.slice(0, 12)}`);
	check('the directory row carries removalReasons', rrRow.status === 200 && rrRow.body.subspaces.some((entry) => entry.slug === rrSlug && entry.removalReasons?.length === 3));

	// posts to moderate
	const rrPosted = await api('/api/v1/things', { method: 'POST', cookie: member.cookie, body: { type: 'text', text: 'is this spam?', title: 'Member post', subspaceId: rrSpace.id } });
	check('(setup) the member posts', rrPosted.status === 200 && rrPosted.body.post?.subspaceMod?.removed === false, `${rrPosted.status} ${JSON.stringify(rrPosted.body).slice(0, 200)}`);
	const rrPost = rrPosted.body.post;
	const beforeRemoved = (await removedNotifsOf(member.cookie, rrPost.id)).length;

	// moderate walls
	const rrAnonRemove = await api('/api/v1/subspaces/moderate', { method: 'POST', body: { id: rrPost.id, action: 'remove', reasonId: 'no-spam' } });
	check('anonymous remove → 401', rrAnonRemove.status === 401);
	const rrStrangerRemove = await rrModerate(stranger.cookie, { id: rrPost.id, action: 'remove', reasonId: 'no-spam' });
	check('a plain member removing with a reasonId → 403', rrStrangerRemove.status === 403, `${rrStrangerRemove.status} ${JSON.stringify(rrStrangerRemove.body)}`);
	const rrGhostReason = await rrModerate(mod.cookie, { id: rrPost.id, action: 'remove', reasonId: 'ghost' });
	const rrAfterGhost = await api(`/api/v1/things?id=${rrPost.id}`, { cookie: mod.cookie });
	check('an unknown reasonId → 400 and the post stays up (no removal, no bell)', rrGhostReason.status === 400 && rrAfterGhost.body?.post?.subspaceMod?.removed === false && (await removedNotifsOf(member.cookie, rrPost.id)).length === beforeRemoved, `${rrGhostReason.status} ${JSON.stringify(rrGhostReason.body)} removed=${rrAfterGhost.body?.post?.subspaceMod?.removed}`);
	const rrOutside = await rrModerate(mod.cookie, { id: outsidePost.body.post.id, action: 'remove', reasonId: 'no-spam' });
	check('a post outside any subspace → 404', rrOutside.status === 404, `${rrOutside.status} ${JSON.stringify(rrOutside.body)}`);

	// happy path: a canned reason + a note
	const rrRemoved = await rrModerate(mod.cookie, { id: rrPost.id, action: 'remove', reasonId: ' NO-SPAM ', reason: '  third   time ' });
	const COMPOSED = 'No Spam! — Posts that only advertise are removed. · third time';
	check('remove with reasonId (trimmed, case-insensitive) + a note → 200, subspaceMod.reason = "title — message · note"', rrRemoved.status === 200 && rrRemoved.body.post?.subspaceMod?.removed === true && rrRemoved.body.post.subspaceMod.reason === COMPOSED, `${rrRemoved.status} ${JSON.stringify(rrRemoved.body?.post?.subspaceMod)}`);
	const rrAuthorRead = await api(`/api/v1/things?id=${rrPost.id}`, { cookie: member.cookie });
	const rrStrangerRead = await api(`/api/v1/things?id=${rrPost.id}`, { cookie: stranger.cookie });
	const rrModRead = await api(`/api/v1/things?id=${rrPost.id}`, { cookie: mod.cookie });
	check('the author and the mods see the composed reason; a stranger sees the redacted post with reason null', rrAuthorRead.body?.post?.subspaceMod?.reason === COMPOSED && rrModRead.body?.post?.subspaceMod?.reason === COMPOSED && rrStrangerRead.body?.post?.subspaceMod?.removed === true && rrStrangerRead.body.post.subspaceMod.reason === null, JSON.stringify([rrAuthorRead.body?.post?.subspaceMod?.reason, rrStrangerRead.body?.post?.subspaceMod?.reason]));
	const rrRemoveLog = (await rrLog(mod.cookie)).filter((entry) => entry.action === 'post.remove' && entry.postId === rrPost.id);
	check('the post.remove mod-log entry carries the composed reason and detail.reasonId', rrRemoveLog.length === 1 && rrRemoveLog[0].reason === COMPOSED && rrRemoveLog[0].detail?.reasonId === 'no-spam' && rrRemoveLog[0].actor?.id === mod.id, JSON.stringify(rrRemoveLog));
	const rrAuthorBell = await removedNotifsOf(member.cookie, rrPost.id);
	const MOD_TEAM = `s/${rrSlug} mods`;
	// S4 review: the row comes from the subspace's mod team (actorId = the
	// subspace, actorName "s/<slug> mods", no username → no profile link) and
	// carries the reason's HEADLINE (the canned title; previews clamp at 140)
	check(
		'the author’s bell has a subspace-post-removed row (postId + targetId = the post; actor = the subspace’s mod team, never the moderator; preview "s/<slug> · <title>")',
		rrAuthorBell.length === beforeRemoved + 1 && rrAuthorBell.some((n) => n.targetId === rrPost.id && n.actorId === rrSpace.id && n.actorName === MOD_TEAM && n.actorUsername === null && n.preview === `s/${rrSlug} · No Spam!`),
		JSON.stringify(rrAuthorBell.map((n) => [n.postId, n.targetId, n.actorId === rrSpace.id, n.actorName, n.actorUsername, n.preview]))
	);
	check('…the bell never names the moderator (no row carries the mod’s id or username)', !rrAuthorBell.some((n) => n.actorId === mod.id || n.actorUsername === mod.username), JSON.stringify(rrAuthorBell.map((n) => [n.actorId, n.actorUsername])));
	const rrModBell = await notifsOf(mod.cookie);
	check('…and nobody else hears about it (no subspace-post-removed row for the mod)', !rrModBell.items.some((n) => n.type === 'subspace-post-removed' && n.postId === rrPost.id));

	// S4 review: a second remove on a removed post is a no-op — a retried
	// request or two mods racing must not rewrite the removal, write another
	// mod-log row or ring the author again (approve first to re-remove)
	const rrRemovedAt = rrRemoved.body?.post?.subspaceMod?.removedAt;
	const rrAgain = await rrModerate(mod.cookie, { id: rrPost.id, action: 'remove', reasonId: 'no-spam', reason: 'third time' });
	const rrAgainOther = await rrModerate(owner.cookie, { id: rrPost.id, action: 'remove', reason: 'a different reason entirely' });
	check(
		'removing an already-removed post again (same reason, then a different mod with a different reason) → 200 with the post exactly as it was (reason + removedAt untouched)',
		rrAgain.status === 200 && rrAgain.body.post?.subspaceMod?.removed === true && rrAgain.body.post.subspaceMod.reason === COMPOSED && rrAgain.body.post.subspaceMod.removedAt === rrRemovedAt && rrAgainOther.status === 200 && rrAgainOther.body.post?.subspaceMod?.reason === COMPOSED && rrAgainOther.body.post.subspaceMod.removedAt === rrRemovedAt,
		`${rrAgain.status}/${rrAgainOther.status} ${JSON.stringify([rrAgain.body?.post?.subspaceMod, rrAgainOther.body?.post?.subspaceMod])}`
	);
	const rrRemoveLogAgain = (await rrLog(mod.cookie)).filter((entry) => entry.action === 'post.remove' && entry.postId === rrPost.id);
	check('…no second post.remove mod-log row and no second bell for the author', rrRemoveLogAgain.length === 1 && (await removedNotifsOf(member.cookie, rrPost.id)).length === beforeRemoved + 1, JSON.stringify([rrRemoveLogAgain.length, (await removedNotifsOf(member.cookie, rrPost.id)).length - beforeRemoved]));
	const rrAgainBadId = await rrModerate(mod.cookie, { id: rrPost.id, action: 'remove', reasonId: 'ghost' });
	check('…but bad input on a removed post is still refused (unknown reasonId → 400, validated before the no-op)', rrAgainBadId.status === 400, `${rrAgainBadId.status}`);

	// approve clears the reason and rings nobody
	const rrApproved = await rrModerate(mod.cookie, { id: rrPost.id, action: 'approve' });
	check('approve → removed false, reason null', rrApproved.status === 200 && rrApproved.body.post?.subspaceMod?.removed === false && rrApproved.body.post.subspaceMod.reason === null, `${rrApproved.status} ${JSON.stringify(rrApproved.body?.post?.subspaceMod)}`);
	check('…and no new bell row for the author', (await removedNotifsOf(member.cookie, rrPost.id)).length === beforeRemoved + 1);

	// free text alone, then no reason at all
	const rrFree = await rrModerate(owner.cookie, { id: rrPost.id, action: 'remove', reason: 'Rule 1: Be kind' });
	const rrFreeLog = (await rrLog(mod.cookie)).filter((entry) => entry.action === 'post.remove' && entry.postId === rrPost.id && entry.actor?.id === owner.id);
	check('remove with free text alone → the text is the reason (mod log detail carries no reasonId)', rrFree.status === 200 && rrFree.body.post?.subspaceMod?.reason === 'Rule 1: Be kind' && rrFreeLog.length === 1 && rrFreeLog[0].reason === 'Rule 1: Be kind' && !rrFreeLog[0].detail?.reasonId, `${rrFree.status} ${JSON.stringify([rrFree.body?.post?.subspaceMod?.reason, rrFreeLog.map((entry) => entry.detail)])}`);
	const rrFreeBell = await removedNotifsOf(member.cookie, rrPost.id);
	check('…the author’s second bell row (the owner’s removal) still comes from the mod team and carries the free-text reason whole', rrFreeBell.length === beforeRemoved + 2 && rrFreeBell.some((n) => n.actorId === rrSpace.id && n.actorName === MOD_TEAM && n.preview === `s/${rrSlug} · Rule 1: Be kind`) && !rrFreeBell.some((n) => n.actorId === owner.id), JSON.stringify(rrFreeBell.map((n) => [n.actorName, n.preview])));
	await rrModerate(mod.cookie, { id: rrPost.id, action: 'approve' });
	const rrBare = await rrModerate(mod.cookie, { id: rrPost.id, action: 'remove' });
	const rrBareBell = await removedNotifsOf(member.cookie, rrPost.id);
	check('remove with no reason at all → reason null; the bell row still says "s/<slug> · removed by the moderators 🧹"', rrBare.status === 200 && rrBare.body.post?.subspaceMod?.reason === null && rrBareBell.length === beforeRemoved + 3 && rrBareBell.some((n) => n.preview === `s/${rrSlug} · removed by the moderators 🧹`), `${rrBare.status} ${JSON.stringify(rrBareBell.map((n) => n.preview))}`);
	await rrModerate(mod.cookie, { id: rrPost.id, action: 'approve' });

	// S4 review: citing a rule (ruleIndex) — composed and bounded server-side
	// like a canned reason, so the client never guesses the stored text
	const rrRuleTooFar = await rrModerate(mod.cookie, { id: rrPost.id, action: 'remove', ruleIndex: 5 });
	const rrRuleNegative = await rrModerate(mod.cookie, { id: rrPost.id, action: 'remove', ruleIndex: -1 });
	const rrRuleGarbage = await rrModerate(mod.cookie, { id: rrPost.id, action: 'remove', ruleIndex: 'two' });
	const rrRuleAndReason = await rrModerate(mod.cookie, { id: rrPost.id, action: 'remove', ruleIndex: 0, reasonId: 'no-spam' });
	const rrAfterRuleWalls = await api(`/api/v1/things?id=${rrPost.id}`, { cookie: mod.cookie });
	check(
		'ruleIndex walls: out of range / negative / not a number / together with reasonId → 400, the post stays up',
		rrRuleTooFar.status === 400 && /2 rules/.test(rrRuleTooFar.body?.error || '') && rrRuleNegative.status === 400 && rrRuleGarbage.status === 400 && rrRuleAndReason.status === 400 && rrAfterRuleWalls.body?.post?.subspaceMod?.removed === false,
		JSON.stringify([rrRuleTooFar.status, rrRuleTooFar.body?.error, rrRuleNegative.status, rrRuleGarbage.status, rrRuleAndReason.status, rrRuleAndReason.body?.error, rrAfterRuleWalls.body?.post?.subspaceMod?.removed])
	);
	const rrRuled = await rrModerate(mod.cookie, { id: rrPost.id, action: 'remove', ruleIndex: '1', reason: '  duplicate   thread ' });
	const RULED = 'Rule 2: No spam — Ads go elsewhere. · duplicate thread';
	check('remove with ruleIndex (0-based, a numeric string accepted) + a note → 200, subspaceMod.reason = "Rule N: title — text · note"', rrRuled.status === 200 && rrRuled.body.post?.subspaceMod?.removed === true && rrRuled.body.post.subspaceMod.reason === RULED, `${rrRuled.status} ${JSON.stringify(rrRuled.body?.post?.subspaceMod)}`);
	const rrRuledLog = (await rrLog(mod.cookie)).filter((entry) => entry.action === 'post.remove' && entry.postId === rrPost.id && entry.reason === RULED);
	check('the post.remove mod-log entry carries the composed citation and detail.ruleIndex (no reasonId)', rrRuledLog.length === 1 && rrRuledLog[0].detail?.ruleIndex === 1 && !rrRuledLog[0].detail?.reasonId, JSON.stringify(rrRuledLog.map((entry) => entry.detail)));
	const rrRuledBell = await removedNotifsOf(member.cookie, rrPost.id);
	check('…the author’s bell headline is the rule citation alone ("s/<slug> · Rule 2: No spam"), from the mod team', rrRuledBell.length === beforeRemoved + 4 && rrRuledBell.some((n) => n.preview === `s/${rrSlug} · Rule 2: No spam` && n.actorId === rrSpace.id), JSON.stringify(rrRuledBell.map((n) => n.preview)));
	const rrRuledAuthorRead = await api(`/api/v1/things?id=${rrPost.id}`, { cookie: member.cookie });
	check('…the author reads the full citation on the post', rrRuledAuthorRead.body?.post?.subspaceMod?.reason === RULED, JSON.stringify(rrRuledAuthorRead.body?.post?.subspaceMod?.reason));
	const rrRuledApproved = await rrModerate(mod.cookie, { id: rrPost.id, action: 'approve' });
	check('approve after a rule citation → removed false, reason null', rrRuledApproved.status === 200 && rrRuledApproved.body.post?.subspaceMod?.removed === false && rrRuledApproved.body.post.subspaceMod.reason === null);
	const rrNoRulesSpace = await api('/api/v1/subspaces/update', { method: 'POST', cookie: owner.cookie, body: { slug: rrSlug, rules: [] } });
	const rrRuleNone = await rrModerate(mod.cookie, { id: rrPost.id, action: 'remove', ruleIndex: 0 });
	const rrRulesBack = await api('/api/v1/subspaces/update', { method: 'POST', cookie: owner.cookie, body: { slug: rrSlug, rules: [{ title: 'Be kind' }, { title: 'No spam', text: 'Ads go elsewhere.' }] } });
	check('ruleIndex on a subspace with no rules → 400 ("no rules to cite")', rrNoRulesSpace.status === 200 && rrRuleNone.status === 400 && /no rules/i.test(rrRuleNone.body?.error || '') && rrRulesBack.status === 200, `${rrNoRulesSpace.status}/${rrRuleNone.status}/${rrRulesBack.status} ${JSON.stringify(rrRuleNone.body)}`);

	// a mod removing their OWN post tells nobody
	const rrModPosted = await api('/api/v1/things', { method: 'POST', cookie: mod.cookie, body: { type: 'text', text: 'oops, wrong subspace', title: 'Mod post', subspaceId: rrSpace.id } });
	const rrSelfRemove = await rrModerate(mod.cookie, { id: rrModPosted.body?.post?.id, action: 'remove', reasonId: 'off-topic' });
	check('a mod removing their own post → 200 with the canned reason and NO bell row for themselves (the skip is explicit now that the actor is the mod team, not the mod)', rrModPosted.status === 200 && rrSelfRemove.status === 200 && rrSelfRemove.body.post?.subspaceMod?.reason === 'Off topic' && (await removedNotifsOf(mod.cookie, rrModPosted.body.post.id)).length === 0, `${rrModPosted.status}/${rrSelfRemove.status} ${JSON.stringify(rrSelfRemove.body?.post?.subspaceMod?.reason)}`);

	// editing the list never rewrites history; a deleted id can't be used
	const rrRenamed = await rrUpdate(mod.cookie, { removalReasons: [{ id: 'no-spam', title: 'No spam' }, { id: 'off-topic', title: 'Off-topic posts', message: 'Take it to the right subspace.' }] });
	const rrAfterRename = await api(`/api/v1/things?id=${rrModPosted.body.post.id}`, { cookie: mod.cookie });
	check('renaming a removal reason leaves an already-removed post’s stored reason untouched', rrRenamed.status === 200 && rrAfterRename.body?.post?.subspaceMod?.reason === 'Off topic', `${rrRenamed.status} ${JSON.stringify(rrAfterRename.body?.post?.subspaceMod?.reason)}`);
	const rrDropped = await rrUpdate(mod.cookie, { removalReasons: [{ id: 'no-spam', title: 'No spam' }] });
	const rrUseDropped = await rrModerate(mod.cookie, { id: rrPost.id, action: 'remove', reasonId: 'off-topic' });
	check('using a removal reason that was deleted since → 400', rrDropped.status === 200 && rrDropped.body.subspace?.removalReasons?.length === 1 && rrUseDropped.status === 400, `${rrDropped.status}/${rrUseDropped.status} ${JSON.stringify(rrUseDropped.body)}`);
	const rrCleared = await rrUpdate(mod.cookie, { removalReasons: [] });
	check('an empty list clears the removal reasons', rrCleared.status === 200 && Array.isArray(rrCleared.body.subspace?.removalReasons) && rrCleared.body.subspace.removalReasons.length === 0);

	// S4 review: a title with no Latin letters / digits (CJK here) used to
	// slug to '' and be refused — it mints a stable hashed reason-… id now
	const rrCjk = await rrUpdate(mod.cookie, { removalReasons: [{ title: '宣伝禁止', message: '広告は禁止です。' }, { title: '荒らし禁止' }] });
	const rrCjkList = rrCjk.body?.subspace?.removalReasons || [];
	check('a removal reason titled in Japanese saves with a minted reason-<hash> id (distinct per title)', rrCjk.status === 200 && rrCjkList.length === 2 && /^reason-[0-9a-z]{1,7}$/.test(rrCjkList[0]?.id || '') && /^reason-[0-9a-z]{1,7}$/.test(rrCjkList[1]?.id || '') && rrCjkList[0].id !== rrCjkList[1].id && rrCjkList[0].title === '宣伝禁止', `${rrCjk.status} ${JSON.stringify(rrCjk.body?.error || rrCjkList)}`);
	const rrCjkAgain = await rrUpdate(mod.cookie, { removalReasons: [{ title: '宣伝禁止', message: '広告は禁止です。' }] });
	check('…re-saving the same title without an id mints the same id (stable)', rrCjkAgain.status === 200 && rrCjkAgain.body.subspace?.removalReasons?.[0]?.id === rrCjkList[0]?.id, JSON.stringify([rrCjkList[0]?.id, rrCjkAgain.body?.subspace?.removalReasons?.[0]?.id]));
	const rrCjkRemove = await rrModerate(mod.cookie, { id: rrPost.id, action: 'remove', reasonId: rrCjkList[0]?.id });
	const rrCjkBell = await removedNotifsOf(member.cookie, rrPost.id);
	check('…and the minted id works as a reasonId (reason "宣伝禁止 — 広告は禁止です。", bell headline "s/<slug> · 宣伝禁止")', rrCjkRemove.status === 200 && rrCjkRemove.body.post?.subspaceMod?.reason === '宣伝禁止 — 広告は禁止です。' && rrCjkBell.some((n) => n.preview === `s/${rrSlug} · 宣伝禁止`), `${rrCjkRemove.status} ${JSON.stringify([rrCjkRemove.body?.post?.subspaceMod?.reason, rrCjkBell.map((n) => n.preview)])}`);
	await rrModerate(mod.cookie, { id: rrPost.id, action: 'approve' });
	await rrUpdate(mod.cookie, { removalReasons: [] });

	// the ban note: mod log only
	const rrBan = await rrMembers(mod.cookie, { userId: stranger.id, action: 'ban', reason: 'Rule 2', banDays: 7, note: '  second   strike — next one is permanent ' });
	check('ban with reason + days + a private note → 200; the row’s banReason is the reason alone, banUntil ~7 days out', rrBan.status === 200 && rrBan.body.member?.banned === true && rrBan.body.member.banReason === 'Rule 2' && !!rrBan.body.member.banUntil && Math.abs(new Date(rrBan.body.member.banUntil).getTime() - Date.now() - 7 * 86_400_000) < 60_000, `${rrBan.status} ${JSON.stringify(rrBan.body?.member)}`);
	const rrBanLog = (await rrLog(mod.cookie)).filter((entry) => entry.action === 'member.ban' && entry.userId === stranger.id);
	check('the member.ban mod-log entry carries detail.note (collapsed) beside banUntil', rrBanLog.length === 1 && rrBanLog[0].detail?.note === 'second strike — next one is permanent' && typeof rrBanLog[0].detail.banUntil === 'string' && rrBanLog[0].reason === 'Rule 2', JSON.stringify(rrBanLog.map((entry) => [entry.reason, entry.detail])));
	const rrStrangerBell = (await notifsOf(stranger.cookie)).items.filter((n) => n.type === 'subspace-ban' && String(n.preview || '').startsWith(`s/${rrSlug}`));
	check('the banned user’s bell carries the reason, never the note', rrStrangerBell.length >= 1 && rrStrangerBell.some((n) => /Rule 2/.test(n.preview || '')) && rrStrangerBell.every((n) => !/second strike/.test(n.preview || '')), JSON.stringify(rrStrangerBell.map((n) => n.preview)));
	// S4 review: the ban bell comes from the mod team too (family-wide: the
	// punitive pair never names the individual moderator)
	check('…and comes from the subspace’s mod team (actorId = the subspace, actorName "s/<slug> mods", no username), never the moderator', rrStrangerBell.every((n) => n.actorId === rrSpace.id && n.actorName === MOD_TEAM && n.actorUsername === null) && !rrStrangerBell.some((n) => n.actorId === mod.id), JSON.stringify(rrStrangerBell.map((n) => [n.actorId === rrSpace.id, n.actorName, n.actorUsername])));
	const rrBanRow = await api(`/api/v1/subspaces/members?slug=${rrSlug}&banned=1`, { cookie: mod.cookie });
	check('the ban list row never leaks the note', rrBanRow.status === 200 && rrBanRow.body.members.some((entry) => entry.userId === stranger.id && entry.banReason === 'Rule 2') && !JSON.stringify(rrBanRow.body).includes('second strike'));
	const rrUnban = await rrMembers(mod.cookie, { userId: stranger.id, action: 'unban' });
	check('(cleanup) unban', rrUnban.status === 200 && rrUnban.body.member?.banned === false);
	const rrUnbanBell = (await notifsOf(stranger.cookie)).items.filter((n) => n.type === 'subspace-ban' && String(n.preview || '').startsWith(`s/${rrSlug}`) && /lifted/.test(n.preview || ''));
	check('…the lifted-ban row comes from the mod team as well', rrUnbanBell.length >= 1 && rrUnbanBell.every((n) => n.actorId === rrSpace.id && n.actorName === MOD_TEAM), JSON.stringify(rrUnbanBell.map((n) => [n.actorName, n.preview])));

	// the manifest
	const manifestP = await api('/api/v1/capabilities');
	check(
		'capability manifest advertises the S4 contracts (update / join / leave 1.3.0 — removalReasons; subspaces 1.5.0 after the S6 sort + review; get 1.4.0 with S5 openReportCount; transfer 1.2.0; feed 1.3.0 with S5 reportCount; moderate 1.4.0 — reasonId + ruleIndex + idempotent remove + the mod-team author notification + S5 report settlement; members 1.4.1 — ban note + mod-team ban bell; notifications-list 1.2.0 — mod-team actor rows)',
		manifestP.status === 200 && ['api.subspaces-update', 'api.subspaces-join', 'api.subspaces-leave'].every((feature) => manifestP.body.features[feature] === '1.3.0') && manifestP.body.features['api.subspaces'] === '1.5.0' && manifestP.body.features['api.subspaces-get'] === '1.4.0' && manifestP.body.features['api.subspaces-transfer'] === '1.2.0' && manifestP.body.features['api.subspaces-feed'] === '1.3.0' && manifestP.body.features['api.subspaces-moderate'] === '1.4.0' && manifestP.body.features['api.subspaces-members'] === '1.4.1' && manifestP.body.features['api.notifications-list'] === '1.2.0',
		JSON.stringify({ s: manifestP.body?.features?.['api.subspaces'], u: manifestP.body?.features?.['api.subspaces-update'], mo: manifestP.body?.features?.['api.subspaces-moderate'], m: manifestP.body?.features?.['api.subspaces-members'], f: manifestP.body?.features?.['api.subspaces-feed'], t: manifestP.body?.features?.['api.subspaces-transfer'], n: manifestP.body?.features?.['api.notifications-list'] })
	);
	const cleanupP = await api('/api/v1/subspaces/delete', { method: 'POST', cookie: owner.cookie, body: { slug: rrSlug, confirmSlug: rrSlug } });
	check('(cleanup) owner deletes the removal-reasons subspace', cleanupP.status === 200, `${cleanupP.status} ${JSON.stringify(cleanupP.body).slice(0, 200)}`);

	console.log('\nQ. reports + the Reports queue');
	// a fresh PUBLIC subspace with two rules: owner founds it, mod is
	// promoted, member and stranger join
	const rpSlug = `rp_${suffix}`.slice(0, 30);
	const foundedRP = await api('/api/v1/subspaces', { method: 'POST', cookie: owner.cookie, body: { slug: rpSlug, name: 'Report Park', access: 'public', rules: [{ title: 'Be kind' }, { title: 'No spam', text: 'Ads go elsewhere.' }] } });
	check('(setup) owner founds a public subspace with two rules', foundedRP.status === 201 && foundedRP.body.subspace?.rules?.length === 2, `${foundedRP.status} ${JSON.stringify(foundedRP.body).slice(0, 200)}`);
	const rpSpace = foundedRP.body.subspace;
	const rpReport = (cookie, body) => api('/api/v1/subspaces/report', { method: 'POST', cookie, body });
	const rpQueue = async (cookie, extra = '') => api(`/api/v1/subspaces/reports?slug=${rpSlug}${extra}`, { cookie });
	const rpDismiss = (cookie, body) => api('/api/v1/subspaces/reports', { method: 'POST', cookie, body });
	const rpModerate = (cookie, body) => api('/api/v1/subspaces/moderate', { method: 'POST', cookie, body });
	const rpMembers = (cookie, body) => api('/api/v1/subspaces/members', { method: 'POST', cookie, body: { slug: rpSlug, ...body } });
	const rpLog = async (cookie) => (await api(`/api/v1/subspaces/modlog?slug=${rpSlug}&limit=50`, { cookie })).body?.entries || [];
	const rpDetail = (cookie) => api(`/api/v1/subspaces/get?slug=${rpSlug}`, { cookie });
	const reportNotifsOf = async (cookie, postId) => (await notifsOf(cookie)).items.filter((n) => n.type === 'subspace-report' && n.postId === postId);
	await api('/api/v1/subspaces/join', { method: 'POST', cookie: mod.cookie, body: { slug: rpSlug } });
	const promoteRPMod = await rpMembers(owner.cookie, { userId: mod.id, action: 'role', role: 'moderator' });
	const memberJoinsRP = await api('/api/v1/subspaces/join', { method: 'POST', cookie: member.cookie, body: { slug: rpSlug } });
	const strangerJoinsRP = await api('/api/v1/subspaces/join', { method: 'POST', cookie: stranger.cookie, body: { slug: rpSlug } });
	check('(setup) mod promoted, member + stranger joined', promoteRPMod.status === 200 && promoteRPMod.body.member?.role === 'moderator' && memberJoinsRP.status === 200 && strangerJoinsRP.status === 200, `${promoteRPMod.status}/${memberJoinsRP.status}/${strangerJoinsRP.status}`);
	const rpPosted = await api('/api/v1/things', { method: 'POST', cookie: member.cookie, body: { type: 'text', text: 'buy my thing', title: 'Member post', subspaceId: rpSpace.id } });
	const rpPost = rpPosted.body?.post;
	const rpCommented = await api('/api/v1/things/comment', { method: 'POST', cookie: stranger.cookie, body: { id: rpPost?.id, text: 'no thanks' } });
	const rpComment = rpCommented.body?.comment;
	const rpReplied = await api('/api/v1/things/comment', { method: 'POST', cookie: member.cookie, body: { id: rpComment?.id, text: 'rude!' } });
	const rpReply = rpReplied.body?.comment;
	check('(setup) a post, a comment and a nested reply', rpPosted.status === 200 && !!rpPost?.id && rpCommented.status === 200 && !!rpComment?.id && rpReplied.status === 200 && !!rpReply?.id, `${rpPosted.status}/${rpCommented.status}/${rpReplied.status}`);
	const privateOutside = await api('/api/v1/things', { method: 'POST', cookie: member.cookie, body: { type: 'text', text: 'my private note', visibility: 'private' } });
	check('(setup) a private post outside any subspace', privateOutside.status === 200 && !!privateOutside.body?.post?.id, `${privateOutside.status}`);

	// defaults
	const rpModRead0 = await api(`/api/v1/things?id=${rpPost.id}`, { cookie: mod.cookie });
	const rpMemberRead0 = await api(`/api/v1/things?id=${rpPost.id}`, { cookie: stranger.cookie });
	const rpOwnerDetail0 = await rpDetail(owner.cookie);
	const rpMemberDetail0 = await rpDetail(stranger.cookie);
	check(
		'defaults: a mod reads subspaceMod.reportCount 0, a member gets no reportCount key; the owner’s detail says openReportCount 0, a member’s detail has no such key',
		rpModRead0.body?.post?.subspaceMod?.reportCount === 0 && rpMemberRead0.status === 200 && !('reportCount' in (rpMemberRead0.body?.post?.subspaceMod || {})) && rpOwnerDetail0.body?.subspace?.openReportCount === 0 && !('openReportCount' in (rpMemberDetail0.body?.subspace || {})),
		JSON.stringify([rpModRead0.body?.post?.subspaceMod, rpMemberRead0.body?.post?.subspaceMod, rpOwnerDetail0.body?.subspace?.openReportCount, rpMemberDetail0.body?.subspace?.openReportCount])
	);
	const modReportBells0 = (await reportNotifsOf(mod.cookie, rpPost.id)).length;
	const ownerReportBells0 = (await reportNotifsOf(owner.cookie, rpPost.id)).length;

	// report walls
	const rpAnon = await rpReport(null, { id: rpPost.id, reason: 'Spam' });
	check('anonymous report → 401', rpAnon.status === 401);
	const rpNoReason = await rpReport(stranger.cookie, { id: rpPost.id });
	const rpBlankReason = await rpReport(stranger.cookie, { id: rpPost.id, reason: '   ' });
	check('report without a reason (missing / blank) → 400', rpNoReason.status === 400 && rpBlankReason.status === 400, `${rpNoReason.status}/${rpBlankReason.status} ${JSON.stringify(rpNoReason.body)}`);
	const rpLongNote = await rpReport(stranger.cookie, { id: rpPost.id, reason: 'Spam', note: 'n'.repeat(501) });
	check('a 501-char note → 400', rpLongNote.status === 400, `${rpLongNote.status} ${JSON.stringify(rpLongNote.body)}`);
	const rpNoId = await rpReport(stranger.cookie, { reason: 'Spam' });
	check('report without an id → 400', rpNoId.status === 400);
	const rpUnknown = await rpReport(stranger.cookie, { id: 'no-such-post', reason: 'Spam' });
	check('report of an unknown id → 404', rpUnknown.status === 404, `${rpUnknown.status}`);
	const rpInvisible = await rpReport(stranger.cookie, { id: privateOutside.body.post.id, reason: 'Spam' });
	check('report of a post the reporter cannot see → 404 (never 400 — existence is not disclosed)', rpInvisible.status === 404, `${rpInvisible.status} ${JSON.stringify(rpInvisible.body)}`);
	const rpOutside = await rpReport(stranger.cookie, { id: outsidePost.body.post.id, reason: 'Spam' });
	check('report of a visible post outside any subspace → 400', rpOutside.status === 400, `${rpOutside.status} ${JSON.stringify(rpOutside.body)}`);

	// S5 review — the PRIVATE-subspace fence on /report: a stranger, a pending
	// requester and a banned member can't SEE a private post, so the post and
	// a comment under it both answer 404 (existence never disclosed); an
	// active member may report either. The report row itself is the
	// reporter's own private thing (owner acl).
	const rppSlug = `rpp_${suffix}`.slice(0, 30);
	const foundedRPP = await api('/api/v1/subspaces', { method: 'POST', cookie: owner.cookie, body: { slug: rppSlug, name: 'Private Report Park', access: 'private', rules: [{ title: 'Be kind' }] } });
	const rppSpace = foundedRPP.body?.subspace;
	const rppMembers = (cookie, body) => api('/api/v1/subspaces/members', { method: 'POST', cookie, body: { slug: rppSlug, ...body } });
	const rppJoin = (cookie) => api('/api/v1/subspaces/join', { method: 'POST', cookie, body: { slug: rppSlug } });
	await rppJoin(member.cookie);
	const rppAcceptMember = await rppMembers(owner.cookie, { userId: member.id, action: 'accept' });
	const rppPosted = await api('/api/v1/things', { method: 'POST', cookie: member.cookie, body: { type: 'text', text: 'members only', title: 'Private post', subspaceId: rppSpace?.id } });
	const rppPost = rppPosted.body?.post;
	const rppCommented = await api('/api/v1/things/comment', { method: 'POST', cookie: owner.cookie, body: { id: rppPost?.id, text: 'quiet in here' } });
	const rppComment = rppCommented.body?.comment;
	check('(setup) a private subspace with an accepted member, their post and a comment under it', foundedRPP.status === 201 && rppAcceptMember.status === 200 && rppPosted.status === 200 && !!rppPost?.id && rppCommented.status === 200 && !!rppComment?.id, `${foundedRPP.status}/${rppAcceptMember.status}/${rppPosted.status}/${rppCommented.status}`);
	const rppStrangerPost = await rpReport(stranger.cookie, { id: rppPost.id, reason: 'Spam' });
	const rppStrangerComment = await rpReport(stranger.cookie, { id: rppComment.id, reason: 'Spam' });
	check('a stranger reporting a private-subspace post / a comment under it → 404 both (invisible — never 400 or 403)', rppStrangerPost.status === 404 && rppStrangerComment.status === 404, `${rppStrangerPost.status}/${rppStrangerComment.status} ${JSON.stringify(rppStrangerPost.body)}`);
	const rppRequest = await rppJoin(stranger.cookie);
	const rppPendingPost = await rpReport(stranger.cookie, { id: rppPost.id, reason: 'Spam' });
	const rppPendingComment = await rpReport(stranger.cookie, { id: rppComment.id, reason: 'Spam' });
	const rppCancel = await api('/api/v1/subspaces/leave', { method: 'POST', cookie: stranger.cookie, body: { slug: rppSlug } });
	check('a pending requester is no member either: post / comment report → 404 (the request is cancelled after)', rppRequest.status === 200 && rppRequest.body.pending === true && rppPendingPost.status === 404 && rppPendingComment.status === 404 && rppCancel.status === 200, `${rppRequest.status}/${rppPendingPost.status}/${rppPendingComment.status}/${rppCancel.status}`);
	await rppJoin(mod.cookie);
	const rppAcceptMod = await rppMembers(owner.cookie, { userId: mod.id, action: 'accept' });
	const rppBanMod = await rppMembers(owner.cookie, { userId: mod.id, action: 'ban', reason: 'timeout' });
	const rppBannedPost = await rpReport(mod.cookie, { id: rppPost.id, reason: 'Spam' });
	const rppBannedComment = await rpReport(mod.cookie, { id: rppComment.id, reason: 'Spam' });
	const rppUnbanMod = await rppMembers(owner.cookie, { userId: mod.id, action: 'unban' });
	check('a member banned in a PRIVATE subspace → 404 for the post and the comment (invisible to them — unlike the public 403)', rppAcceptMod.status === 200 && rppBanMod.status === 200 && rppBannedPost.status === 404 && rppBannedComment.status === 404 && rppUnbanMod.status === 200, `${rppAcceptMod.status}/${rppBanMod.status}/${rppBannedPost.status}/${rppBannedComment.status}/${rppUnbanMod.status}`);
	const rppMemberPost = await rpReport(mod.cookie, { id: rppPost.id, reason: 'Rule 1: Be kind', note: 'seen it' });
	const rppMemberComment = await rpReport(mod.cookie, { id: rppComment.id, reason: 'Harassment' });
	const rppQueue = await api(`/api/v1/subspaces/reports?slug=${rppSlug}`, { cookie: owner.cookie });
	check(
		'an active member of the private subspace reports the post (200) and then the comment (200, updated — same root post): the owner’s queue lists one group, reportCount 1, the post projected, the row naming the comment',
		rppMemberPost.status === 200 && rppMemberPost.body.updated === false && rppMemberComment.status === 200 && rppMemberComment.body.updated === true && rppMemberComment.body.report?.commentId === rppComment.id && rppQueue.status === 200 && rppQueue.body.reports?.length === 1 && rppQueue.body.reports[0].reportCount === 1 && rppQueue.body.reports[0].post?.id === rppPost.id && rppQueue.body.reports[0].reporters?.[0]?.commentId === rppComment.id,
		`${rppMemberPost.status}/${rppMemberComment.status}/${rppQueue.status} ${JSON.stringify([rppMemberComment.body, rppQueue.body?.reports?.[0]?.reporters]).slice(0, 300)}`
	);
	const rppRowSelf = await api(`/api/v1/things?id=${rppMemberPost.body.report?.id}`, { cookie: mod.cookie });
	const rppRowOther = await api(`/api/v1/things?id=${rppMemberPost.body.report?.id}`, { cookie: member.cookie });
	const rppRowOwner = await api(`/api/v1/things?id=${rppMemberPost.body.report?.id}`, { cookie: owner.cookie });
	check(
		'a report row is the reporter’s own private thing (acl tt:user = owner): the generic GET /things?id= answers the reporter 200 and every other user — the subspace owner included — 404',
		rppRowSelf.status === 200 && rppRowSelf.body.thing?.thingtime?.includes('subspace-report') && rppRowOther.status === 404 && rppRowOwner.status === 404,
		`${rppRowSelf.status}/${rppRowOther.status}/${rppRowOwner.status}`
	);
	const cleanupRPP = await api('/api/v1/subspaces/delete', { method: 'POST', cookie: owner.cookie, body: { slug: rppSlug, confirmSlug: rppSlug } });
	check('(cleanup) owner deletes the private report subspace', cleanupRPP.status === 200, `${cleanupRPP.status} ${JSON.stringify(cleanupRPP.body).slice(0, 200)}`);

	const rpBanStranger = await rpMembers(mod.cookie, { userId: stranger.id, action: 'ban', reason: 'timeout' });
	const rpBannedReport = await rpReport(stranger.cookie, { id: rpPost.id, reason: 'Spam' });
	const rpUnbanStranger = await rpMembers(mod.cookie, { userId: stranger.id, action: 'unban' });
	check('a user banned in the subspace reporting there → 403 (unban → allowed again)', rpBanStranger.status === 200 && rpBannedReport.status === 403 && rpUnbanStranger.status === 200, `${rpBanStranger.status}/${rpBannedReport.status}/${rpUnbanStranger.status} ${JSON.stringify(rpBannedReport.body)}`);
	const rpQueueBefore = await rpQueue(mod.cookie);
	check('nothing reached the queue through the walls (open queue empty, openReportCount 0)', rpQueueBefore.status === 200 && rpQueueBefore.body.reports?.length === 0 && rpQueueBefore.body.openReportCount === 0 && rpQueueBefore.body.status === 'open', `${rpQueueBefore.status} ${JSON.stringify(rpQueueBefore.body).slice(0, 200)}`);

	// queue walls
	const rpQueueAnon = await rpQueue(null);
	check('anonymous GET /reports → 401', rpQueueAnon.status === 401);
	const rpQueueMember = await rpQueue(stranger.cookie);
	check('a plain member’s GET /reports → 403', rpQueueMember.status === 403, `${rpQueueMember.status}`);
	const rpQueueMissing = await api('/api/v1/subspaces/reports?slug=no_such_space_here', { cookie: mod.cookie });
	check('GET /reports for an unknown subspace → 404', rpQueueMissing.status === 404);
	const rpDismissAnon = await rpDismiss(null, { postId: rpPost.id, action: 'dismiss' });
	check('anonymous dismiss → 401', rpDismissAnon.status === 401);
	const rpDismissMember = await rpDismiss(stranger.cookie, { postId: rpPost.id, action: 'dismiss' });
	check('a plain member’s dismiss → 403', rpDismissMember.status === 403, `${rpDismissMember.status} ${JSON.stringify(rpDismissMember.body)}`);
	const rpDismissNoPost = await rpDismiss(mod.cookie, { action: 'dismiss' });
	const rpDismissBadAction = await rpDismiss(mod.cookie, { postId: rpPost.id, action: 'ignore' });
	check('dismiss without a postId / with an unknown action → 400', rpDismissNoPost.status === 400 && rpDismissBadAction.status === 400, `${rpDismissNoPost.status}/${rpDismissBadAction.status}`);
	const rpDismissNothing = await rpDismiss(mod.cookie, { postId: rpPost.id, action: 'dismiss' });
	check('dismiss with nothing open on the post → 404', rpDismissNothing.status === 404, `${rpDismissNothing.status} ${JSON.stringify(rpDismissNothing.body)}`);

	// happy path: the stranger reports the post
	const rpFirst = await rpReport(stranger.cookie, { id: rpPost.id, reason: '  Rule 2:   No spam ', note: '  third   ad   this week ' });
	check(
		'stranger reports the post → 200, updated false; the row is open on the post with the collapsed reason + note and no commentId',
		rpFirst.status === 200 && rpFirst.body.updated === false && rpFirst.body.report?.postId === rpPost.id && rpFirst.body.report.commentId === null && rpFirst.body.report.subspaceId === rpSpace.id && rpFirst.body.report.reason === 'Rule 2: No spam' && rpFirst.body.report.note === 'third ad this week' && rpFirst.body.report.status === 'open' && rpFirst.body.report.resolution === null,
		`${rpFirst.status} ${JSON.stringify(rpFirst.body)}`
	);
	const modReportBells1 = await reportNotifsOf(mod.cookie, rpPost.id);
	const ownerReportBells1 = await reportNotifsOf(owner.cookie, rpPost.id);
	check(
		'the mods (mod + owner) each get a subspace-report bell row: actor = the reporter, targetId + postId = the post, preview "s/<slug> · <reason>"',
		modReportBells1.length === modReportBells0 + 1 && ownerReportBells1.length === ownerReportBells0 + 1 && [...modReportBells1, ...ownerReportBells1].every((n) => n.actorId === stranger.id && n.targetId === rpPost.id && n.postId === rpPost.id) && modReportBells1.some((n) => n.preview === `s/${rpSlug} · Rule 2: No spam`),
		JSON.stringify([modReportBells1.map((n) => [n.actorId === stranger.id, n.targetId, n.preview]), ownerReportBells1.length - ownerReportBells0])
	);
	check('…the reporter and the author hear nothing (no subspace-report rows for them)', (await reportNotifsOf(stranger.cookie, rpPost.id)).length === 0 && (await reportNotifsOf(member.cookie, rpPost.id)).length === 0);
	const rpAgain = await rpReport(stranger.cookie, { id: rpPost.id, reason: 'Spam, again' });
	const rpQueueAfterAgain = await rpQueue(mod.cookie);
	check(
		'reporting the same post again → 200 updated true: still ONE row, the reason refreshed, the note cleared, and no second bell for the mods',
		rpAgain.status === 200 && rpAgain.body.updated === true && rpAgain.body.report?.id === rpFirst.body.report.id && rpAgain.body.report.reason === 'Spam, again' && rpAgain.body.report.note === null && rpQueueAfterAgain.body.reports?.length === 1 && rpQueueAfterAgain.body.reports[0].reportCount === 1 && rpQueueAfterAgain.body.reports[0].reasons?.[0]?.reason === 'Spam, again' && (await reportNotifsOf(mod.cookie, rpPost.id)).length === modReportBells0 + 1,
		`${rpAgain.status} ${JSON.stringify([rpAgain.body, rpQueueAfterAgain.body?.reports?.[0]?.reasons])}`
	);

	// a comment (nested reply, even) resolves to the root post
	const rpOwnerReportsReply = await rpReport(owner.cookie, { id: rpReply.id, reason: 'Rule 1: Be kind', note: 'name-calling' });
	check(
		'reporting a nested reply → 200: the report lands on the ROOT post (postId = the post, commentId = the reply)',
		rpOwnerReportsReply.status === 200 && rpOwnerReportsReply.body.updated === false && rpOwnerReportsReply.body.report?.postId === rpPost.id && rpOwnerReportsReply.body.report.commentId === rpReply.id,
		`${rpOwnerReportsReply.status} ${JSON.stringify(rpOwnerReportsReply.body)}`
	);
	const rpQueue2 = await rpQueue(mod.cookie);
	const rpGroup = rpQueue2.body?.reports?.find((group) => group.postId === rpPost.id);
	check(
		'the queue groups both by post: reportCount 2, reasons tally (each ×1, alphabetical), reporters newest first with the reply’s commentId + note, latestAt set, the post projected with subspaceMod.reportCount 2 + viewerCanModerate; openReportCount 2',
		rpQueue2.status === 200 && rpQueue2.body.reports.length === 1 && rpGroup?.reportCount === 2 && JSON.stringify(rpGroup.reasons) === JSON.stringify([{ reason: 'Rule 1: Be kind', count: 1 }, { reason: 'Spam, again', count: 1 }]) && rpGroup.reporters?.length === 2 && rpGroup.reporters[0].userId === owner.id && rpGroup.reporters[0].commentId === rpReply.id && rpGroup.reporters[0].note === 'name-calling' && rpGroup.reporters[0].profile?.username === owner.username && rpGroup.reporters[1].userId === stranger.id && typeof rpGroup.latestAt === 'string' && rpGroup.post?.id === rpPost.id && rpGroup.post.subspaceMod?.reportCount === 2 && rpGroup.post.subspaceMod.viewerCanModerate === true && rpGroup.status === 'open' && rpQueue2.body.openReportCount === 2,
		JSON.stringify({ n: rpQueue2.body?.reports?.length, group: rpGroup && { ...rpGroup, post: rpGroup.post && { id: rpGroup.post.id, subspaceMod: rpGroup.post.subspaceMod } } })
	);
	const rpOwnerQueue = await rpQueue(owner.cookie, '&limit=1');
	check('the owner reads the same queue (limit honoured, no next page for one group)', rpOwnerQueue.status === 200 && rpOwnerQueue.body.reports?.length === 1 && rpOwnerQueue.body.nextCursor === null, `${rpOwnerQueue.status} ${JSON.stringify(rpOwnerQueue.body?.nextCursor)}`);

	// projection: reportCount is the mods' business only
	const rpModRead = await api(`/api/v1/things?id=${rpPost.id}`, { cookie: mod.cookie });
	const rpModFeed = await api(`/api/v1/subspaces/feed?slug=${rpSlug}&sort=new`, { cookie: mod.cookie });
	const rpModHome = await api('/api/v1/things/feed?algorithm=latest&limit=20', { cookie: mod.cookie });
	const rpStrangerRead = await api(`/api/v1/things?id=${rpPost.id}`, { cookie: stranger.cookie });
	const rpAuthorRead = await api(`/api/v1/things?id=${rpPost.id}`, { cookie: member.cookie });
	const rpAnonRead = await api(`/api/v1/things?id=${rpPost.id}`);
	check(
		'a moderator sees subspaceMod.reportCount 2 on the post read, the subspace feed and the home feed; the reporter, the author and an anonymous reader get no reportCount key at all',
		rpModRead.body?.post?.subspaceMod?.reportCount === 2 && rpModFeed.body?.posts?.find((entry) => entry.id === rpPost.id)?.subspaceMod?.reportCount === 2 && (rpModHome.body?.posts?.find((entry) => entry.id === rpPost.id)?.subspaceMod?.reportCount ?? 2) === 2 && !('reportCount' in (rpStrangerRead.body?.post?.subspaceMod || {})) && !('reportCount' in (rpAuthorRead.body?.post?.subspaceMod || {})) && !('reportCount' in (rpAnonRead.body?.post?.subspaceMod || {})),
		JSON.stringify([rpModRead.body?.post?.subspaceMod?.reportCount, rpModFeed.body?.posts?.find((entry) => entry.id === rpPost.id)?.subspaceMod?.reportCount, rpStrangerRead.body?.post?.subspaceMod, rpAnonRead.body?.post?.subspaceMod])
	);
	const rpOwnerDetail = await rpDetail(owner.cookie);
	const rpStrangerDetail = await rpDetail(stranger.cookie);
	check('detail: the owner sees openReportCount 2; a member still has no such key', rpOwnerDetail.body?.subspace?.openReportCount === 2 && !('openReportCount' in (rpStrangerDetail.body?.subspace || {})), JSON.stringify([rpOwnerDetail.body?.subspace?.openReportCount, rpStrangerDetail.body?.subspace?.openReportCount]));

	// dismiss
	const rpDismissed = await rpDismiss(mod.cookie, { postId: rpPost.id, action: 'dismiss' });
	const rpQueueAfterDismiss = await rpQueue(mod.cookie);
	const rpResolvedQueue = await rpQueue(mod.cookie, '&status=resolved');
	const rpResolvedGroup = rpResolvedQueue.body?.reports?.find((group) => group.postId === rpPost.id);
	const rpModReadAfterDismiss = await api(`/api/v1/things?id=${rpPost.id}`, { cookie: mod.cookie });
	check(
		'dismiss → 200 { dismissed 2, openReportCount 0 }: the open queue empties, the resolved queue lists the post with resolution dismissed + reportCount 2, the post’s reportCount reads 0 and the post stays up',
		rpDismissed.status === 200 && rpDismissed.body.dismissed === 2 && rpDismissed.body.openReportCount === 0 && rpDismissed.body.postId === rpPost.id && rpQueueAfterDismiss.body?.reports?.length === 0 && rpQueueAfterDismiss.body.openReportCount === 0 && rpResolvedQueue.status === 200 && rpResolvedQueue.body.status === 'resolved' && rpResolvedGroup?.reportCount === 2 && rpResolvedGroup.resolution === 'dismissed' && rpResolvedGroup.status === 'resolved' && rpModReadAfterDismiss.body?.post?.subspaceMod?.reportCount === 0 && rpModReadAfterDismiss.body.post.subspaceMod.removed === false,
		JSON.stringify([rpDismissed.body, rpQueueAfterDismiss.body?.reports?.length, rpResolvedGroup && { c: rpResolvedGroup.reportCount, r: rpResolvedGroup.resolution }, rpModReadAfterDismiss.body?.post?.subspaceMod])
	);
	const rpDismissLog = (await rpLog(mod.cookie)).filter((entry) => entry.action === 'report.dismiss');
	check('the mod log has a report.dismiss entry (postId, detail.count 2, the acting mod)', rpDismissLog.length === 1 && rpDismissLog[0].postId === rpPost.id && rpDismissLog[0].detail?.count === 2 && rpDismissLog[0].actor?.id === mod.id, JSON.stringify(rpDismissLog));
	const rpDismissAgain = await rpDismiss(mod.cookie, { postId: rpPost.id, action: 'dismiss' });
	check('dismissing again → 404 (nothing open)', rpDismissAgain.status === 404);

	// re-report after a dismissal re-opens the reporter's row and rings again
	const modReportBells2 = (await reportNotifsOf(mod.cookie, rpPost.id)).length;
	const rpReopen = await rpReport(stranger.cookie, { id: rpPost.id, reason: 'Still spam' });
	const rpQueueReopened = await rpQueue(mod.cookie);
	check(
		'reporting again after the dismissal → 200 updated true: the row re-opens (status open, resolution null), the open queue shows the post with reportCount 1 and the mods ring again',
		rpReopen.status === 200 && rpReopen.body.updated === true && rpReopen.body.report?.status === 'open' && rpReopen.body.report.resolution === null && rpReopen.body.report.reason === 'Still spam' && rpQueueReopened.body?.reports?.length === 1 && rpQueueReopened.body.reports[0].reportCount === 1 && rpQueueReopened.body.openReportCount === 1 && (await reportNotifsOf(mod.cookie, rpPost.id)).length === modReportBells2 + 1,
		`${rpReopen.status} ${JSON.stringify([rpReopen.body?.report, rpQueueReopened.body?.reports?.[0]?.reportCount])}`
	);

	// remove settles the open reports (resolution removed)
	const rpRemoved = await rpModerate(mod.cookie, { id: rpPost.id, action: 'remove', reason: 'Spam' });
	const rpQueueAfterRemove = await rpQueue(mod.cookie);
	const rpResolvedAfterRemove = (await rpQueue(mod.cookie, '&status=resolved')).body?.reports?.find((group) => group.postId === rpPost.id);
	check(
		'moderate remove → 200 with reportCount 0: the open reports are settled with resolution removed (queue empty, openReportCount 0; the resolved queue’s newest resolution reads removed)',
		rpRemoved.status === 200 && rpRemoved.body.post?.subspaceMod?.removed === true && rpRemoved.body.post.subspaceMod.reportCount === 0 && rpQueueAfterRemove.body?.reports?.length === 0 && rpQueueAfterRemove.body.openReportCount === 0 && rpResolvedAfterRemove?.resolution === 'removed' && rpResolvedAfterRemove.reportCount === 2,
		JSON.stringify([rpRemoved.body?.post?.subspaceMod, rpQueueAfterRemove.body?.reports?.length, rpResolvedAfterRemove && { c: rpResolvedAfterRemove.reportCount, r: rpResolvedAfterRemove.resolution }])
	);
	const rpRemoveLog = (await rpLog(mod.cookie)).filter((entry) => entry.action === 'post.remove' && entry.postId === rpPost.id);
	check('the post.remove mod-log entry carries detail.resolvedReports 1', rpRemoveLog.length === 1 && rpRemoveLog[0].detail?.resolvedReports === 1, JSON.stringify(rpRemoveLog.map((entry) => entry.detail)));
	// S5 review: a post the mods took down is not reportable — 409, no row
	// re-opened, nobody rings (a comment under it neither)
	const modReportBellsRemoved = (await reportNotifsOf(mod.cookie, rpPost.id)).length;
	const rpReportRemoved = await rpReport(owner.cookie, { id: rpPost.id, reason: 'Spam' });
	const rpReportRemovedComment = await rpReport(stranger.cookie, { id: rpReply.id, reason: 'Spam' });
	const rpQueueStillEmpty = await rpQueue(mod.cookie);
	check(
		'reporting a post the moderators already removed → 409 (a comment under it too): the open queue stays empty (openReportCount 0) and the mods do not ring',
		rpReportRemoved.status === 409 && rpReportRemovedComment.status === 409 && rpQueueStillEmpty.body?.reports?.length === 0 && rpQueueStillEmpty.body.openReportCount === 0 && (await reportNotifsOf(mod.cookie, rpPost.id)).length === modReportBellsRemoved,
		`${rpReportRemoved.status}/${rpReportRemovedComment.status} ${JSON.stringify([rpReportRemoved.body, rpQueueStillEmpty.body?.openReportCount])}`
	);
	// approve settles them too (resolution approved)
	const rpApproved = await rpModerate(mod.cookie, { id: rpPost.id, action: 'approve' });
	const rpReopen2 = await rpReport(stranger.cookie, { id: rpPost.id, reason: 'Spam' });
	const rpApproved2 = await rpModerate(mod.cookie, { id: rpPost.id, action: 'approve' });
	const rpResolvedAfterApprove = (await rpQueue(mod.cookie, '&status=resolved')).body?.reports?.find((group) => group.postId === rpPost.id);
	const rpApproveLog = (await rpLog(mod.cookie)).filter((entry) => entry.action === 'post.approve' && entry.postId === rpPost.id);
	check(
		'approve settles open reports with resolution approved (a fresh report → approve → queue empty, resolved queue reads approved, post.approve detail.resolvedReports 1; the earlier approve with nothing open carries no such detail)',
		rpApproved.status === 200 && rpReopen2.status === 200 && rpReopen2.body.report?.status === 'open' && rpApproved2.status === 200 && rpApproved2.body.post?.subspaceMod?.reportCount === 0 && (await rpQueue(mod.cookie)).body?.reports?.length === 0 && rpResolvedAfterApprove?.resolution === 'approved' && rpApproveLog.length === 2 && rpApproveLog.some((entry) => entry.detail?.resolvedReports === 1) && rpApproveLog.some((entry) => !entry.detail?.resolvedReports),
		JSON.stringify([rpApproved.status, rpReopen2.body?.report?.status, rpApproved2.body?.post?.subspaceMod, rpResolvedAfterApprove?.resolution, rpApproveLog.map((entry) => entry.detail)])
	);
	// the reports' own subspace targetId: dismiss is refused for a mod of ANOTHER subspace
	const rpReopen3 = await rpReport(stranger.cookie, { id: rpPost.id, reason: 'Spam' });
	const rpForeignDismiss = await rpDismiss(mod.cookie, { postId: rpPost.id, action: 'dismiss', slug });
	check('dismiss naming a different subspace than the post’s (slug in the body wins) → 404 there, the report stays open here', rpReopen3.status === 200 && rpForeignDismiss.status === 404 && (await rpQueue(mod.cookie)).body?.openReportCount === 1, `${rpReopen3.status}/${rpForeignDismiss.status} ${JSON.stringify(rpForeignDismiss.body)}`);

	// S5 review — a post that MOVES to another subspace after it was reported:
	// its open rows stay in the old queue (listed with post null, dismissable
	// there WITHOUT a slug — the rows' own targetId names the queue), and the
	// reporter's next report re-files in the new subspace and rings ITS mods.
	// The move is a PATCH, so a database still waiting for the storage
	// migration skips the three moved-post checks instead of failing them.
	const rp2Slug = `rp2_${suffix}`.slice(0, 30);
	const foundedRP2 = await api('/api/v1/subspaces', { method: 'POST', cookie: owner.cookie, body: { slug: rp2Slug, name: 'Report Park II', access: 'public' } });
	const rp2Space = foundedRP2.body?.subspace;
	await api('/api/v1/subspaces/join', { method: 'POST', cookie: member.cookie, body: { slug: rp2Slug } });
	const rpMovingPosted = await api('/api/v1/things', { method: 'POST', cookie: member.cookie, body: { type: 'text', text: 'wanderer', title: 'Moving post', subspaceId: rpSpace.id } });
	const rpMoving = rpMovingPosted.body?.post;
	const rpMovingReport = await rpReport(stranger.cookie, { id: rpMoving?.id, reason: 'Spam' });
	check('(setup) a second public subspace (owner mods it alone) and a fresh post in the first one, reported once there', foundedRP2.status === 201 && rpMovingPosted.status === 200 && !!rpMoving?.id && rpMovingReport.status === 200 && rpMovingReport.body.report?.subspaceId === rpSpace.id, `${foundedRP2.status}/${rpMovingPosted.status}/${rpMovingReport.status}`);
	const rpMoved = await api('/api/v1/things', { method: 'PATCH', cookie: member.cookie, body: { id: rpMoving.id, crystal: { subspaceId: rp2Space.id } } });
	if (isStorageGate(rpMoved)) {
		checkOrSkip('the author moves the reported post to the second subspace', rpMoved, false);
		checkOrSkip('dismiss without a slug reaches the moved post’s reports where they sit (the old queue)', rpMoved, false);
		checkOrSkip('re-reporting the moved post re-files the row in the NEW subspace and rings its mods', rpMoved, false);
	} else {
		check('the author moves the reported post to the second subspace', rpMoved.status === 200 && rpMoved.body.post?.subspace?.id === rp2Space.id, `${rpMoved.status} ${JSON.stringify(rpMoved.body).slice(0, 200)}`);
		const rpOldQueue = await rpQueue(mod.cookie);
		const rpOldGroup = rpOldQueue.body?.reports?.find((group) => group.postId === rpMoving.id);
		const rpDismissMoved = await rpDismiss(mod.cookie, { postId: rpMoving.id, action: 'dismiss' });
		check(
			'dismiss without a slug reaches the moved post’s reports where they sit: the old queue listed the group with post null, a mod of the OLD subspace only dismisses 1 (no 403 / 404) and the group leaves that queue',
			!!rpOldGroup && rpOldGroup.post === null && rpOldGroup.reportCount === 1 && rpDismissMoved.status === 200 && rpDismissMoved.body.dismissed === 1 && !(await rpQueue(mod.cookie)).body?.reports?.some((group) => group.postId === rpMoving.id),
			`${rpDismissMoved.status} ${JSON.stringify([rpOldGroup && { post: rpOldGroup.post, c: rpOldGroup.reportCount }, rpDismissMoved.body])}`
		);
		const ownerBellsRP2 = (await reportNotifsOf(owner.cookie, rpMoving.id)).length;
		const rpReportMoved = await rpReport(stranger.cookie, { id: rpMoving.id, reason: 'Spam again' });
		const rp2Queue = await api(`/api/v1/subspaces/reports?slug=${rp2Slug}`, { cookie: owner.cookie });
		check(
			're-reporting the moved post → 200 updated true: the row now names the NEW subspace, whose queue lists the post (reportCount 1, projected) while the old queue does not, and the new subspace’s mods ring',
			rpReportMoved.status === 200 && rpReportMoved.body.updated === true && rpReportMoved.body.report?.subspaceId === rp2Space.id && rpReportMoved.body.report.status === 'open' && rp2Queue.status === 200 && rp2Queue.body.reports?.length === 1 && rp2Queue.body.reports[0].postId === rpMoving.id && rp2Queue.body.reports[0].reportCount === 1 && rp2Queue.body.reports[0].post?.id === rpMoving.id && rp2Queue.body.openReportCount === 1 && !(await rpQueue(mod.cookie)).body?.reports?.some((group) => group.postId === rpMoving.id) && (await reportNotifsOf(owner.cookie, rpMoving.id)).length === ownerBellsRP2 + 1,
			`${rpReportMoved.status} ${JSON.stringify([rpReportMoved.body?.report, rp2Queue.body?.reports?.map((group) => [group.postId, group.reportCount, !!group.post]), rp2Queue.body?.openReportCount])}`
		);
	}
	// the wanderer goes (its rows with it, wherever they sit) before the second subspace does
	const rpMovingDeleted = await api(`/api/v1/things?id=${rpMoving.id}`, { method: 'DELETE', cookie: member.cookie });
	const cleanupRP2 = await api('/api/v1/subspaces/delete', { method: 'POST', cookie: owner.cookie, body: { slug: rp2Slug, confirmSlug: rp2Slug } });
	check('(cleanup) the moving post is deleted and the owner deletes the second subspace; the first queue is back to its one open report', rpMovingDeleted.status === 200 && cleanupRP2.status === 200 && (await rpQueue(mod.cookie)).body?.openReportCount === 1, `${rpMovingDeleted.status}/${cleanupRP2.status} ${JSON.stringify((await rpQueue(mod.cookie)).body?.openReportCount)}`);

	// S5 review — deleting a reported COMMENT takes the rows that flagged it
	// (the queue must not keep asking the mods about a comment that is gone)
	const rpFlaggedCommented = await api('/api/v1/things/comment', { method: 'POST', cookie: stranger.cookie, body: { id: rpPost.id, text: 'one more' } });
	const rpFlaggedComment = rpFlaggedCommented.body?.comment;
	const rpOwnerFlagsComment = await rpReport(owner.cookie, { id: rpFlaggedComment?.id, reason: 'Rule 1: Be kind' });
	const rpQueueWithComment = await rpQueue(mod.cookie);
	const rpCommentDeleted = await api(`/api/v1/things?id=${rpFlaggedComment?.id}`, { method: 'DELETE', cookie: stranger.cookie });
	const rpQueueAfterCommentDelete = await rpQueue(mod.cookie);
	const rpGroupAfterCommentDelete = rpQueueAfterCommentDelete.body?.reports?.find((group) => group.postId === rpPost.id);
	check(
		'the owner flags a fresh comment (2 open on the post); its author deleting the comment removes THAT row only: reportCount 1, openReportCount 1, no reporter names the comment, the post’s own report stays, and reporting the deleted comment → 404',
		rpFlaggedCommented.status === 200 && rpOwnerFlagsComment.status === 200 && rpOwnerFlagsComment.body.report?.commentId === rpFlaggedComment.id && rpQueueWithComment.body?.openReportCount === 2 && rpCommentDeleted.status === 200 && rpQueueAfterCommentDelete.body?.openReportCount === 1 && rpGroupAfterCommentDelete?.reportCount === 1 && rpGroupAfterCommentDelete.reporters.length === 1 && rpGroupAfterCommentDelete.reporters[0].userId === stranger.id && rpGroupAfterCommentDelete.reporters.every((reporter) => reporter.commentId !== rpFlaggedComment.id) && (await rpReport(owner.cookie, { id: rpFlaggedComment.id, reason: 'Spam' })).status === 404,
		`${rpFlaggedCommented.status}/${rpOwnerFlagsComment.status}/${rpCommentDeleted.status} ${JSON.stringify([rpQueueWithComment.body?.openReportCount, rpQueueAfterCommentDelete.body?.openReportCount, rpGroupAfterCommentDelete && { c: rpGroupAfterCommentDelete.reportCount, r: rpGroupAfterCommentDelete.reporters.map((reporter) => [reporter.userId === stranger.id, reporter.commentId]) }])}`
	);

	// deleting the post takes its reports with it
	const rpDeleted = await api(`/api/v1/things?id=${rpPost.id}`, { method: 'DELETE', cookie: member.cookie });
	const rpQueueAfterDelete = await rpQueue(mod.cookie);
	const rpDetailAfterDelete = await rpDetail(owner.cookie);
	check(
		'the author deleting the post clears its reports: open queue empty, openReportCount 0 on the queue and the detail, the resolved queue no longer lists it',
		rpDeleted.status === 200 && rpQueueAfterDelete.body?.reports?.length === 0 && rpQueueAfterDelete.body.openReportCount === 0 && rpDetailAfterDelete.body?.subspace?.openReportCount === 0 && !(await rpQueue(mod.cookie, '&status=resolved')).body?.reports?.some((group) => group.postId === rpPost.id),
		JSON.stringify([rpDeleted.status, rpQueueAfterDelete.body?.reports?.length, rpDetailAfterDelete.body?.subspace?.openReportCount])
	);
	const rpReportGone = await rpReport(stranger.cookie, { id: rpPost.id, reason: 'Spam' });
	check('reporting the deleted post → 404', rpReportGone.status === 404);

	// generic escape hatches stay closed
	const rpGeneric = await api('/api/v1/things', { method: 'POST', cookie: stranger.cookie, body: { thingtime: ['subspace-report'], crystal: { postId: 'x', reason: 'forged', status: 'open', reportKey: 'x:y' }, targetId: rpSpace.id } });
	check('generic POST /things refuses the subspace-report kind', rpGeneric.status === 403, `${rpGeneric.status} ${JSON.stringify(rpGeneric.body)}`);
	const rpDocs = await api('/api/v1/subspaces/report-docs');
	const rpDocs2 = await api('/api/v1/subspaces/reports-docs');
	check('docs routes answer for the report endpoints', rpDocs.status === 200 && rpDocs.body.docs?.endpoint === '/api/v1/subspaces/report' && rpDocs2.status === 200 && rpDocs2.body.docs?.endpoint === '/api/v1/subspaces/reports');

	// the manifest
	const manifestQ = await api('/api/v1/capabilities');
	check(
		'capability manifest advertises the S5 contracts (subspaces-report + subspaces-reports 1.0.1 after the S5 review — a removed post → 409, a repeat after a move re-files, a deleted comment takes its rows, dismiss follows the open rows’ targetId; get 1.4.0 — openReportCount; moderate 1.4.0 — report settlement; feed 1.3.0 and things / things-comment / things-user 1.3.0 — subspaceMod.reportCount; things-feed moved on to 1.4.0 in S6 — see section R)',
		manifestQ.status === 200 && manifestQ.body.features['api.subspaces-report'] === '1.0.1' && manifestQ.body.features['api.subspaces-reports'] === '1.0.1' && manifestQ.body.features['api.subspaces-get'] === '1.4.0' && manifestQ.body.features['api.subspaces-moderate'] === '1.4.0' && manifestQ.body.features['api.subspaces-feed'] === '1.3.0' && ['api.things-comment', 'api.things-user'].every((feature) => manifestQ.body.features[feature] === '1.3.0') && manifestQ.body.features['api.things'] === '1.4.0' /* S7: the single read moved on to 1.4.0 — commentSort — see section S */ && manifestQ.body.features['api.things-feed'] === '1.4.0',
		JSON.stringify({ r: manifestQ.body?.features?.['api.subspaces-report'], rs: manifestQ.body?.features?.['api.subspaces-reports'], g: manifestQ.body?.features?.['api.subspaces-get'], mo: manifestQ.body?.features?.['api.subspaces-moderate'], f: manifestQ.body?.features?.['api.subspaces-feed'], t: manifestQ.body?.features?.['api.things'] })
	);
	const cleanupQ = await api('/api/v1/subspaces/delete', { method: 'POST', cookie: owner.cookie, body: { slug: rpSlug, confirmSlug: rpSlug } });
	check('(cleanup) owner deletes the report subspace', cleanupQ.status === 200, `${cleanupQ.status} ${JSON.stringify(cleanupQ.body).slice(0, 200)}`);

	console.log('\nR. discovery — feed scope=subspaces, directory sorts, the explore / search queries');
	// Fixtures: A (public; owner + member + mod = 3 members; 2 live posts + 1
	// removed), B (public; owner only; 1 post; founded second), P (private;
	// owner + member = 2; 1 post; founded last), a plain post outside any
	// subspace, and `nobody` — a fixture user who is in no subspace at all
	// (the stranger may carry memberships from earlier sections).
	const rsSlug = `rsa_${suffix}`.slice(0, 30);
	const rs2Slug = `rsb_${suffix}`.slice(0, 30);
	const rsPrivSlug = `rsp_${suffix}`.slice(0, 30);
	const rsName = `Disco ${suffix}`;
	const nobody = await register('vs-nobody-');
	const rsCreated = await api('/api/v1/subspaces', { method: 'POST', cookie: owner.cookie, body: { slug: rsSlug, name: `${rsName} A`, access: 'public' } });
	const rs2Created = await api('/api/v1/subspaces', { method: 'POST', cookie: owner.cookie, body: { slug: rs2Slug, name: `${rsName} B`, access: 'public' } });
	const rsPrivCreated = await api('/api/v1/subspaces', { method: 'POST', cookie: owner.cookie, body: { slug: rsPrivSlug, name: `${rsName} P`, access: 'private' } });
	const rsSpace = rsCreated.body?.subspace;
	const rs2Space = rs2Created.body?.subspace;
	const rsPriv = rsPrivCreated.body?.subspace;
	check('(fixtures) three discovery subspaces founded (public A, public B, private P)', rsCreated.status === 201 && rs2Created.status === 201 && rsPrivCreated.status === 201, `${rsCreated.status}/${rs2Created.status}/${rsPrivCreated.status}`);
	const rsJoinMember = await api('/api/v1/subspaces/join', { method: 'POST', cookie: member.cookie, body: { slug: rsSlug } });
	const rsJoinMod = await api('/api/v1/subspaces/join', { method: 'POST', cookie: mod.cookie, body: { slug: rsSlug } });
	const rsPrivAdd = await api('/api/v1/subspaces/members', { method: 'POST', cookie: owner.cookie, body: { slug: rsPrivSlug, username: member.username, action: 'add' } });
	check('(fixtures) member + mod join A (3 members); the owner adds the member to private P (2 members)', rsJoinMember.status === 200 && rsJoinMod.status === 200 && rsPrivAdd.status === 200, `${rsJoinMember.status}/${rsJoinMod.status}/${rsPrivAdd.status} ${JSON.stringify(rsPrivAdd.body).slice(0, 200)}`);
	const rsPost = (cookie, subspaceId, title) =>
		api('/api/v1/things', { method: 'POST', cookie, body: { type: 'text', text: `${title} body`, title, ...(subspaceId ? { subspaceId } : {}), visibility: 'public' } });
	const rsA1 = (await rsPost(owner.cookie, rsSpace.id, 'Disco A1')).body?.post;
	const rsA2 = (await rsPost(member.cookie, rsSpace.id, 'Disco A2')).body?.post;
	const rsA3 = (await rsPost(mod.cookie, rsSpace.id, 'Disco A3 (to be removed)')).body?.post;
	const rsB1 = (await rsPost(owner.cookie, rs2Space.id, 'Disco B1')).body?.post;
	const rsP1 = (await rsPost(owner.cookie, rsPriv.id, 'Disco P1')).body?.post;
	const rsPlain = (await rsPost(owner.cookie, null, 'Disco plain (no subspace)')).body?.post;
	const rsRemoveA3 = await api('/api/v1/subspaces/moderate', { method: 'POST', cookie: owner.cookie, body: { id: rsA3?.id, action: 'remove', reason: 'Section R fixture' } });
	check('(fixtures) A1 / A2 / A3 in A, B1 in B, P1 in P (private), a plain post; the owner removes A3', !!rsA1 && !!rsA2 && !!rsA3 && !!rsB1 && rsP1?.subspace?.id === rsPriv.id && !!rsPlain && !rsPlain.subspace && rsRemoveA3.status === 200, `${JSON.stringify([!!rsA1, !!rsA2, !!rsA3, !!rsB1, rsP1?.subspace?.id === rsPriv?.id, !!rsPlain, rsRemoveA3.status])}`);
	const rsIds = new Set([rsA1?.id, rsA2?.id, rsA3?.id, rsB1?.id, rsP1?.id, rsPlain?.id]);
	const rsFixtureSubspaces = new Set([rsSpace?.id, rs2Space?.id, rsPriv?.id]);
	const feedIds = (feed) => new Set((feed.body?.posts || []).map((entry) => entry.id));

	// --- scope=subspaces: the member (A + P) ---
	const rsMemberScoped = await api('/api/v1/things/feed?scope=subspaces&algorithm=latest&limit=50', { cookie: member.cookie });
	const rsMemberScopedIds = feedIds(rsMemberScoped);
	check(
		'member feed scope=subspaces → 200, echoes scope, lists A1 + A2 + P1 (their subspaces, private P included), not B1 (not a member), not the removed A3, not the plain post',
		rsMemberScoped.status === 200 && rsMemberScoped.body.scope === 'subspaces' && rsMemberScopedIds.has(rsA1.id) && rsMemberScopedIds.has(rsA2.id) && rsMemberScopedIds.has(rsP1.id) && !rsMemberScopedIds.has(rsB1.id) && !rsMemberScopedIds.has(rsA3.id) && !rsMemberScopedIds.has(rsPlain.id),
		`${rsMemberScoped.status} ${JSON.stringify({ scope: rsMemberScoped.body?.scope, a1: rsMemberScopedIds.has(rsA1?.id), a2: rsMemberScopedIds.has(rsA2?.id), p1: rsMemberScopedIds.has(rsP1?.id), b1: rsMemberScopedIds.has(rsB1?.id), a3: rsMemberScopedIds.has(rsA3?.id), plain: rsMemberScopedIds.has(rsPlain?.id), error: rsMemberScoped.body?.error })}`
	);
	const rsMemberRoles = new Set(['owner', 'moderator', 'member']);
	check(
		'every post on the member’s scoped page carries a subspace embed they hold a role in (nothing outside their subspaces leaks in)',
		rsMemberScoped.status === 200 && rsMemberScoped.body.posts.length > 0 && rsMemberScoped.body.posts.every((entry) => entry.subspace?.id && rsMemberRoles.has(entry.subspace.viewerRole)),
		JSON.stringify((rsMemberScoped.body?.posts || []).filter((entry) => !entry.subspace?.id || !rsMemberRoles.has(entry.subspace.viewerRole)).map((entry) => [entry.id, entry.subspace?.slug, entry.subspace?.viewerRole]).slice(0, 5))
	);
	// the owner: A + B + P (and every other subspace they still own) — B1 shows, the plain post still doesn't
	const rsOwnerScoped = await api('/api/v1/things/feed?scope=subspaces&algorithm=latest&limit=50', { cookie: owner.cookie });
	const rsOwnerScopedIds = feedIds(rsOwnerScoped);
	// the removed-post fence is a feed-level fence for EVERYONE (the mod Queue
	// is where removed posts live) — scope narrows on top of it, never past it
	check('owner feed scope=subspaces lists A1 / A2 / B1 / P1 (all three are theirs), never the plain post, and not the removed A3 either (the removed fence holds for moderators on feeds — the Queue lists it)', rsOwnerScoped.status === 200 && rsOwnerScopedIds.has(rsA1.id) && rsOwnerScopedIds.has(rsA2.id) && rsOwnerScopedIds.has(rsB1.id) && rsOwnerScopedIds.has(rsP1.id) && !rsOwnerScopedIds.has(rsPlain.id) && !rsOwnerScopedIds.has(rsA3.id) && rsOwnerScoped.body.posts.every((entry) => !!entry.subspace?.id), JSON.stringify({ b1: rsOwnerScopedIds.has(rsB1?.id), plain: rsOwnerScopedIds.has(rsPlain?.id), a3: rsOwnerScopedIds.has(rsA3?.id) }));
	// the stranger: whatever they belong to from earlier sections, none of these three
	const rsStrangerScoped = await api('/api/v1/things/feed?scope=subspaces&algorithm=latest&limit=50', { cookie: stranger.cookie });
	check('stranger feed scope=subspaces → 200 with none of the fixture subspaces’ posts (not a member of any of them)', rsStrangerScoped.status === 200 && rsStrangerScoped.body.scope === 'subspaces' && rsStrangerScoped.body.posts.every((entry) => !rsIds.has(entry.id) && !rsFixtureSubspaces.has(entry.subspace?.id)), `${rsStrangerScoped.status} ${JSON.stringify((rsStrangerScoped.body?.posts || []).filter((entry) => rsIds.has(entry.id)).map((entry) => entry.id))}`);
	const rsNobodyScoped = await api('/api/v1/things/feed?scope=subspaces&algorithm=latest&limit=50', { cookie: nobody.cookie });
	check('a viewer in no subspace: scope=subspaces → 200 and an EMPTY page (never the whole feed)', rsNobodyScoped.status === 200 && rsNobodyScoped.body.scope === 'subspaces' && rsNobodyScoped.body.posts.length === 0 && rsNobodyScoped.body.nextCursor === null, `${rsNobodyScoped.status} ${rsNobodyScoped.body?.posts?.length}`);
	const rsAnonScoped = await api('/api/v1/things/feed?scope=subspaces&algorithm=latest&limit=50');
	check('anonymous scope=subspaces → 200 and an empty page', rsAnonScoped.status === 200 && rsAnonScoped.body.scope === 'subspaces' && rsAnonScoped.body.posts.length === 0, `${rsAnonScoped.status} ${rsAnonScoped.body?.posts?.length}`);
	const rsAnonCached = await api('/api/v1/things/feed?scope=subspaces&anon=1&algorithm=latest');
	check('the edge-cacheable anon=1 form with scope=subspaces is an empty page too', rsAnonCached.status === 200 && rsAnonCached.body.posts.length === 0);
	const rsBogusScope = await api('/api/v1/things/feed?scope=bogus', { cookie: member.cookie });
	check('scope=bogus → 400 (an unknown scope never silently widens)', rsBogusScope.status === 400, `${rsBogusScope.status} ${JSON.stringify(rsBogusScope.body)}`);
	const rsMemberAll = await api('/api/v1/things/feed?scope=all&algorithm=latest&limit=50', { cookie: member.cookie });
	const rsMemberAllIds = feedIds(rsMemberAll);
	const rsMemberDefault = await api('/api/v1/things/feed?algorithm=latest&limit=50', { cookie: member.cookie });
	check('scope=all and no scope are the whole feed (A1, B1, P1 and the plain post; the removed A3 still hidden) and both echo scope all', rsMemberAll.status === 200 && rsMemberAll.body.scope === 'all' && rsMemberAllIds.has(rsA1.id) && rsMemberAllIds.has(rsB1.id) && rsMemberAllIds.has(rsP1.id) && rsMemberAllIds.has(rsPlain.id) && !rsMemberAllIds.has(rsA3.id) && rsMemberDefault.status === 200 && rsMemberDefault.body.scope === 'all' && feedIds(rsMemberDefault).has(rsB1.id), JSON.stringify({ scope: rsMemberAll.body?.scope, b1: rsMemberAllIds.has(rsB1?.id), plain: rsMemberAllIds.has(rsPlain?.id), a3: rsMemberAllIds.has(rsA3?.id), def: rsMemberDefault.body?.scope }));
	const rsStrangerAll = await api('/api/v1/things/feed?scope=all&algorithm=latest&limit=50', { cookie: stranger.cookie });
	check('the private fence still holds under scope=all: the stranger’s whole feed carries A1 + B1 but never P1', rsStrangerAll.status === 200 && feedIds(rsStrangerAll).has(rsA1.id) && feedIds(rsStrangerAll).has(rsB1.id) && !feedIds(rsStrangerAll).has(rsP1.id), JSON.stringify({ a1: feedIds(rsStrangerAll).has(rsA1?.id), p1: feedIds(rsStrangerAll).has(rsP1?.id) }));
	// the ranked path scopes too: a fresh algorithm ranks the same scoped set
	const rsBrain = await api('/api/v1/algorithms', { method: 'POST', cookie: member.cookie, body: { name: `Disco brain ${suffix}`, emoji: '🪐' } });
	const rsBrainId = rsBrain.body?.algorithm?.id;
	if (rsBrainId) {
		const rsRanked = await api(`/api/v1/things/feed?scope=subspaces&algorithm=${encodeURIComponent(rsBrainId)}&limit=50`, { cookie: member.cookie });
		const rsRankedIds = feedIds(rsRanked);
		check('ranked + scoped (algorithm=<id>) → ranked true, scope subspaces, the same posts as the chronological scoped page (A1 + A2 + P1, no B1 / A3 / plain)', rsRanked.status === 200 && rsRanked.body.ranked === true && rsRanked.body.scope === 'subspaces' && rsRankedIds.has(rsA1.id) && rsRankedIds.has(rsA2.id) && rsRankedIds.has(rsP1.id) && !rsRankedIds.has(rsB1.id) && !rsRankedIds.has(rsA3.id) && !rsRankedIds.has(rsPlain.id) && rsRanked.body.posts.every((entry) => !!entry.subspace?.id), `${rsRanked.status} ${JSON.stringify({ ranked: rsRanked.body?.ranked, scope: rsRanked.body?.scope, error: rsRanked.body?.error })}`);
		await api('/api/v1/algorithms/delete', { method: 'POST', cookie: member.cookie, body: { id: rsBrainId } });
	} else {
		check('(fixtures) the member mints a feed algorithm for the ranked + scoped check', false, `${rsBrain.status} ${JSON.stringify(rsBrain.body).slice(0, 200)}`);
	}

	// --- directory sorts ---
	const rsDir = async (extra, cookie = null, headers = undefined) => api(`/api/v1/subspaces?q=${encodeURIComponent(rsName)}${extra}`, { ...(cookie ? { cookie } : {}), ...(headers ? { headers } : {}) });
	const rsSlugsOf = (resp) => (resp.body?.subspaces || []).map((entry) => entry.slug);
	const rsByMembers = await rsDir('&sort=members');
	check('sort=members orders A (3) → P (2) → B (1) and echoes sort', rsByMembers.status === 200 && rsByMembers.body.sort === 'members' && JSON.stringify(rsSlugsOf(rsByMembers)) === JSON.stringify([rsSlug, rsPrivSlug, rs2Slug]) && rsByMembers.body.subspaces[0].memberCount === 3 && rsByMembers.body.subspaces[1].memberCount === 2 && rsByMembers.body.subspaces[2].memberCount === 1, `${rsByMembers.status} ${JSON.stringify(rsSlugsOf(rsByMembers))} ${JSON.stringify((rsByMembers.body?.subspaces || []).map((entry) => entry.memberCount))}`);
	// sort=active: a private subspace's activity is its ACTIVE members'
	// business (S6 review) — P (private, 1 post) ranks by its real count only
	// for its members / mods; a guest and any logged-in non-member see it
	// ranked at zero with no recentPostCount (member counts stay public)
	const rsRecentOf = (resp) => (resp.body?.subspaces || []).map((entry) => entry.recentPostCount);
	const rsByActive = await rsDir('&sort=active');
	check('anonymous sort=active orders A (2 live posts — the removed A3 does not count) → B (1) → P (private: ranked at zero for a guest); A and B carry recentPostCount, P carries none (its memberCount 2 stays public)', rsByActive.status === 200 && rsByActive.body.sort === 'active' && JSON.stringify(rsSlugsOf(rsByActive)) === JSON.stringify([rsSlug, rs2Slug, rsPrivSlug]) && rsByActive.body.subspaces[0].recentPostCount === 2 && rsByActive.body.subspaces[1].recentPostCount === 1 && rsByActive.body.subspaces[2].recentPostCount === undefined && rsByActive.body.subspaces[2].memberCount === 2, `${rsByActive.status} ${JSON.stringify(rsSlugsOf(rsByActive))} ${JSON.stringify(rsRecentOf(rsByActive))}`);
	const rsByActiveMember = await rsDir('&sort=active', member.cookie);
	check('the member’s sort=active (they are in P) orders A (2) → P (1, newer) → B (1) and P’s row carries recentPostCount 1', rsByActiveMember.status === 200 && JSON.stringify(rsSlugsOf(rsByActiveMember)) === JSON.stringify([rsSlug, rsPrivSlug, rs2Slug]) && JSON.stringify(rsRecentOf(rsByActiveMember)) === JSON.stringify([2, 1, 1]), `${rsByActiveMember.status} ${JSON.stringify(rsSlugsOf(rsByActiveMember))} ${JSON.stringify(rsRecentOf(rsByActiveMember))}`);
	const rsByActiveOwner = await rsDir('&sort=active', owner.cookie);
	check('the owner’s sort=active agrees with the member’s (A → P → B, counts 2 / 1 / 1)', rsByActiveOwner.status === 200 && JSON.stringify(rsSlugsOf(rsByActiveOwner)) === JSON.stringify([rsSlug, rsPrivSlug, rs2Slug]) && JSON.stringify(rsRecentOf(rsByActiveOwner)) === JSON.stringify([2, 1, 1]), `${rsByActiveOwner.status} ${JSON.stringify(rsSlugsOf(rsByActiveOwner))} ${JSON.stringify(rsRecentOf(rsByActiveOwner))}`);
	const rsByActiveNobody = await rsDir('&sort=active', nobody.cookie);
	check('a logged-in stranger’s sort=active ranks P last with no recentPostCount (the private fence holds for every non-member, not just guests)', rsByActiveNobody.status === 200 && JSON.stringify(rsSlugsOf(rsByActiveNobody)) === JSON.stringify([rsSlug, rs2Slug, rsPrivSlug]) && rsByActiveNobody.body.subspaces[2].recentPostCount === undefined && rsByActiveNobody.body.subspaces[2].access === 'private', `${rsByActiveNobody.status} ${JSON.stringify(rsSlugsOf(rsByActiveNobody))} ${JSON.stringify(rsRecentOf(rsByActiveNobody))}`);
	const rsNobodyRequest = await api('/api/v1/subspaces/join', { method: 'POST', cookie: nobody.cookie, body: { slug: rsPrivSlug } });
	const rsByActivePending = await rsDir('&sort=active', nobody.cookie);
	const rsNobodyCancel = await api('/api/v1/subspaces/leave', { method: 'POST', cookie: nobody.cookie, body: { slug: rsPrivSlug } });
	check('a PENDING requester of P (request filed, then cancelled) is not a member: P still ranks last for them with no recentPostCount while their row reads viewer.pending', rsNobodyRequest.status === 200 && rsNobodyRequest.body.pending === true && rsByActivePending.status === 200 && rsSlugsOf(rsByActivePending)[2] === rsPrivSlug && rsByActivePending.body.subspaces[2].recentPostCount === undefined && rsByActivePending.body.subspaces[2].viewer.pending === true && rsNobodyCancel.status === 200, `${rsNobodyRequest.status} ${JSON.stringify(rsNobodyRequest.body).slice(0, 120)} / ${rsByActivePending.status} ${JSON.stringify(rsSlugsOf(rsByActivePending))} ${JSON.stringify(rsRecentOf(rsByActivePending))} / ${rsNobodyCancel.status}`);
	const rsByNew = await rsDir('&sort=new');
	const rsByDefault = await rsDir('');
	check('sort=new (and no sort) orders newest first — P → B → A — echoes sort new and carries no recentPostCount', rsByNew.status === 200 && rsByNew.body.sort === 'new' && JSON.stringify(rsSlugsOf(rsByNew)) === JSON.stringify([rsPrivSlug, rs2Slug, rsSlug]) && rsByDefault.status === 200 && rsByDefault.body.sort === 'new' && JSON.stringify(rsSlugsOf(rsByDefault)) === JSON.stringify([rsPrivSlug, rs2Slug, rsSlug]) && rsByNew.body.subspaces.every((entry) => entry.recentPostCount === undefined), `${rsByNew.status} ${JSON.stringify(rsSlugsOf(rsByNew))} / ${JSON.stringify(rsSlugsOf(rsByDefault))}`);
	const rsBogusSort = await rsDir('&sort=bogus');
	check('sort=bogus → 400 (a typo never silently reorders the directory)', rsBogusSort.status === 400, `${rsBogusSort.status} ${JSON.stringify(rsBogusSort.body)}`);
	// offset paging through a ranked sort
	const rsPage1 = await rsDir('&sort=members&limit=1');
	const rsPage2 = rsPage1.body?.nextCursor ? await rsDir(`&sort=members&limit=1&cursor=${rsPage1.body.nextCursor}`) : { status: 0, body: null };
	const rsPage3 = rsPage2.body?.nextCursor ? await rsDir(`&sort=members&limit=1&cursor=${rsPage2.body.nextCursor}`) : { status: 0, body: null };
	check('sort=members pages by offset: limit=1 → A + cursor 1 → P + cursor 2 → B + no cursor', rsPage1.status === 200 && rsSlugsOf(rsPage1)[0] === rsSlug && rsPage1.body.nextCursor === '1' && rsPage2.status === 200 && rsSlugsOf(rsPage2)[0] === rsPrivSlug && rsPage2.body.nextCursor === '2' && rsPage3.status === 200 && rsSlugsOf(rsPage3)[0] === rs2Slug && rsPage3.body.nextCursor === null, JSON.stringify([rsSlugsOf(rsPage1), rsPage1.body?.nextCursor, rsSlugsOf(rsPage2), rsPage2.body?.nextCursor, rsSlugsOf(rsPage3), rsPage3.body?.nextCursor]));
	// mine + sort, per viewer
	const rsMineMembers = await rsDir('&sort=members&mine=1', member.cookie);
	check('mine=1&sort=members (member) lists A then P — never B — with the member’s viewer state', rsMineMembers.status === 200 && JSON.stringify(rsSlugsOf(rsMineMembers)) === JSON.stringify([rsSlug, rsPrivSlug]) && rsMineMembers.body.subspaces.every((entry) => entry.viewer.member === true), `${rsMineMembers.status} ${JSON.stringify(rsSlugsOf(rsMineMembers))}`);
	const rsMineActiveNobody = await rsDir('&sort=active&mine=1', nobody.cookie);
	check('mine=1&sort=active for a viewer in no subspace → 200, empty, sort echoed', rsMineActiveNobody.status === 200 && rsMineActiveNobody.body.subspaces.length === 0 && rsMineActiveNobody.body.sort === 'active');
	const rsMineAnon = await api('/api/v1/subspaces?mine=1&sort=members');
	check('anonymous mine=1&sort=members → 401', rsMineAnon.status === 401);
	// the anon=1 edge-cache contract (S6 review — the feed's): the logged-out
	// view regardless of cookies, cacheable at the edge by URL, never shared
	// with an authenticated reading of the same URL
	const PUBLIC_CACHE = 'public, s-maxage=60, stale-while-revalidate=300';
	const rsDirAnon = await rsDir('&sort=members&anon=1');
	check('anon=1 (no Authorization) answers the logged-out directory with Cache-Control: public, s-maxage=60, stale-while-revalidate=300 + Vary: Authorization and null viewer state on every row', rsDirAnon.status === 200 && rsDirAnon.headers.get('cache-control') === PUBLIC_CACHE && /authorization/i.test(rsDirAnon.headers.get('vary') || '') && rsDirAnon.body.subspaces.length === 3 && rsDirAnon.body.subspaces.every((entry) => entry.viewer.member === false && entry.viewer.role === null), `${rsDirAnon.status} cc=${rsDirAnon.headers.get('cache-control')} vary=${rsDirAnon.headers.get('vary')}`);
	const rsDirAnonActive = await rsDir('&sort=active&anon=1');
	check('anon=1&sort=active ranks P at zero with no recentPostCount — the cacheable body never carries a private subspace’s activity', rsDirAnonActive.status === 200 && rsDirAnonActive.headers.get('cache-control') === PUBLIC_CACHE && JSON.stringify(rsSlugsOf(rsDirAnonActive)) === JSON.stringify([rsSlug, rs2Slug, rsPrivSlug]) && rsDirAnonActive.body.subspaces[2].recentPostCount === undefined, `${rsDirAnonActive.status} ${JSON.stringify(rsSlugsOf(rsDirAnonActive))} ${JSON.stringify(rsRecentOf(rsDirAnonActive))}`);
	const rsAnonCookieIgnored = await rsDir('&sort=members&anon=1', member.cookie);
	check('anon=1 with a session cookie still answers the logged-out view (cookies are ignored on the cacheable URL — clients send anon=1 only when no viewer is present): null viewer state, the public cache header', rsAnonCookieIgnored.status === 200 && rsAnonCookieIgnored.headers.get('cache-control') === PUBLIC_CACHE && rsAnonCookieIgnored.body.subspaces.every((entry) => entry.viewer.member === false), `${rsAnonCookieIgnored.status} cc=${rsAnonCookieIgnored.headers.get('cache-control')} ${JSON.stringify((rsAnonCookieIgnored.body?.subspaces || []).map((entry) => entry.viewer.member))}`);
	const rsAnonBearer = await rsDir('&sort=members&anon=1', null, { Authorization: 'Bearer not-a-real-token' });
	check('anon=1 beside an Authorization header is answered as itself (an unknown credential degrades to the logged-out view) and carries NO public cache header — a fenced credential can never be handed a cached anon body', rsAnonBearer.status === 200 && !/public/.test(rsAnonBearer.headers.get('cache-control') || '') && rsAnonBearer.body.subspaces.length === 3, `${rsAnonBearer.status} cc=${rsAnonBearer.headers.get('cache-control')}`);
	const rsAnonNoFlag = await rsDir('&sort=members');
	check('a cookie-less read WITHOUT anon=1 carries no public cache header (only the URL-marked form is edge-cacheable)', rsAnonNoFlag.status === 200 && !/public/.test(rsAnonNoFlag.headers.get('cache-control') || ''), `cc=${rsAnonNoFlag.headers.get('cache-control')}`);
	const rsAuthedHeaders = await rsDir('&sort=members', member.cookie);
	check('an authenticated directory read answers Cache-Control: private, no-store with the member’s own viewer state', rsAuthedHeaders.status === 200 && rsAuthedHeaders.headers.get('cache-control') === 'private, no-store' && rsAuthedHeaders.body.subspaces.some((entry) => entry.viewer.member === true), `cc=${rsAuthedHeaders.headers.get('cache-control')}`);
	const rsAnonMine = await api('/api/v1/subspaces?mine=1&anon=1');
	check('anon=1&mine=1 → 401 (there is no caller to narrow to)', rsAnonMine.status === 401);
	// the /explore strip's query and the /search section's query
	const rsExplore = await api('/api/v1/subspaces?sort=members&limit=8');
	const rsExploreCounts = (rsExplore.body?.subspaces || []).map((entry) => entry.memberCount);
	check('the /explore query (sort=members&limit=8, anonymous) answers ≤ 8 rows in non-increasing member count, A among them', rsExplore.status === 200 && rsExplore.body.subspaces.length <= 8 && rsExplore.body.subspaces.length > 0 && rsExploreCounts.every((count, index) => index === 0 || count <= rsExploreCounts[index - 1]) && rsExplore.body.subspaces.some((entry) => entry.slug === rsSlug), `${rsExplore.status} ${JSON.stringify(rsExploreCounts)} ${JSON.stringify(rsSlugsOf(rsExplore))}`);
	const rsSearch = await api(`/api/v1/subspaces?q=${encodeURIComponent(rsName)}&limit=6`, { cookie: nobody.cookie });
	check('the /search query (q=<text>&limit=6) answers the three matching subspaces by name, newest first', rsSearch.status === 200 && JSON.stringify(rsSlugsOf(rsSearch)) === JSON.stringify([rsPrivSlug, rs2Slug, rsSlug]) && rsSearch.body.subspaces.every((entry) => entry.name.includes(rsName)), `${rsSearch.status} ${JSON.stringify(rsSlugsOf(rsSearch))}`);
	const rsSearchMiss = await api(`/api/v1/subspaces?q=${encodeURIComponent(`nothing-${suffix}-here`)}&limit=6`);
	check('a query matching no subspace answers an empty list (the section simply stays away)', rsSearchMiss.status === 200 && rsSearchMiss.body.subspaces.length === 0);
	// the manifest
	const manifestR = await api('/api/v1/capabilities');
	check('capability manifest advertises the S6 contracts (subspaces 1.5.0 — sort, then the review’s anon=1 / subspaces.list rate key / private-activity fence; things-feed 1.4.0 — scope) with the rest of the family untouched', manifestR.status === 200 && manifestR.body.features['api.subspaces'] === '1.5.0' && manifestR.body.features['api.things-feed'] === '1.4.0' && manifestR.body.features['api.subspaces-update'] === '1.3.0' && manifestR.body.features['api.things'] === '1.4.0' /* S7: commentSort — see section S */, JSON.stringify({ s: manifestR.body?.features?.['api.subspaces'], f: manifestR.body?.features?.['api.things-feed'] }));
	const rsDocs = await api('/api/v1/subspaces-docs');
	const rsFeedDocs = await api('/api/v1/things/feed-docs');
	check('docs routes answer for the two extended endpoints', rsDocs.status === 200 && rsDocs.body.docs?.endpoint === '/api/v1/subspaces' && rsFeedDocs.status === 200 && rsFeedDocs.body.docs?.endpoint === '/api/v1/things/feed');
	check('the directory docs name the read’s rate key (subspaces.list, 120/min), the anon=1 cache contract and the private-activity fence, at contract 1.5.0', /subspaces\.list, 120\/min/.test(rsDocs.body?.docs?.detail || '') && JSON.stringify(rsDocs.body?.docs?.notes || []).includes('s-maxage=60') && /ACTIVE members only/.test(rsDocs.body?.docs?.detail || '') && rsDocs.body?.docs?.contractVersion === '1.5.0', JSON.stringify({ cv: rsDocs.body?.docs?.contractVersion, notes: (rsDocs.body?.docs?.notes || []).length }));
	// cleanup: the plain post, then the three subspaces (their posts survive as plain / private posts)
	const rsPlainDeleted = await api(`/api/v1/things?id=${rsPlain.id}`, { method: 'DELETE', cookie: owner.cookie });
	const cleanupR = await Promise.all([rsSlug, rs2Slug, rsPrivSlug].map((slugToDelete) => api('/api/v1/subspaces/delete', { method: 'POST', cookie: owner.cookie, body: { slug: slugToDelete, confirmSlug: slugToDelete } })));
	const rsAfterCleanup = await rsDir('&sort=members');
	check('(cleanup) the plain post is deleted and the owner deletes the three discovery subspaces; the directory query no longer lists them', rsPlainDeleted.status === 200 && cleanupR.every((result) => result.status === 200) && rsAfterCleanup.status === 200 && rsAfterCleanup.body.subspaces.length === 0, `${rsPlainDeleted.status} ${JSON.stringify(cleanupR.map((result) => result.status))} ${JSON.stringify(rsSlugsOf(rsAfterCleanup))}`);

	console.log('\nS. completeness sweep — comment sort, edge cases, truthful docs');
	// Fixtures: S (public; owner + member + mod-as-moderator + stranger), P
	// (private; owner + member added by the owner). `nobody` (section R) is in
	// no subspace and plays the pending requester.
	const ssSlug = `sss_${suffix}`.slice(0, 30);
	const ssPrivSlug = `ssp_${suffix}`.slice(0, 30);
	const ssCreated = await api('/api/v1/subspaces', { method: 'POST', cookie: owner.cookie, body: { slug: ssSlug, name: `Sweep ${suffix}`, access: 'public', rules: [{ title: 'Be kind', text: 'No gatekeeping.' }] } });
	const ssPrivCreated = await api('/api/v1/subspaces', { method: 'POST', cookie: owner.cookie, body: { slug: ssPrivSlug, name: `Sweep private ${suffix}`, access: 'private' } });
	const ssSpace = ssCreated.body?.subspace;
	const ssPriv = ssPrivCreated.body?.subspace;
	const ssJoins = await Promise.all([member, mod, stranger].map((who) => api('/api/v1/subspaces/join', { method: 'POST', cookie: who.cookie, body: { slug: ssSlug } })));
	const ssPromote = await api('/api/v1/subspaces/members', { method: 'POST', cookie: owner.cookie, body: { slug: ssSlug, username: mod.username, action: 'role', role: 'moderator' } });
	const ssPrivAdd = await api('/api/v1/subspaces/members', { method: 'POST', cookie: owner.cookie, body: { slug: ssPrivSlug, username: member.username, action: 'add' } });
	check('(fixtures) S public + P private founded; member / mod / stranger join S, the mod is promoted, the owner adds the member to P', ssCreated.status === 201 && ssPrivCreated.status === 201 && ssJoins.every((result) => result.status === 200) && ssPromote.status === 200 && ssPrivAdd.status === 200, `${ssCreated.status}/${ssPrivCreated.status} ${JSON.stringify(ssJoins.map((result) => result.status))} ${ssPromote.status} ${ssPrivAdd.status}`);
	const ssPostIn = (cookie, subspaceId, title) => api('/api/v1/things', { method: 'POST', cookie, body: { type: 'text', text: `${title} body`, title, ...(subspaceId ? { subspaceId } : {}), visibility: 'public' } });
	const ssComment = (cookie, id, text) => api('/api/v1/things/comment', { method: 'POST', cookie, body: { id, text } });
	const ssVote = (cookie, id, direction) => api('/api/v1/things/updown', { method: 'POST', cookie, body: { id, direction } });
	const ssRead = (id, cookie, extra = '') => api(`/api/v1/things?id=${id}${extra}`, cookie ? { cookie } : {});
	const ssIdsOf = (comments) => (comments || []).map((entry) => entry.id);

	// --- comment sort: GET /api/v1/things?id=&commentSort=top|new|old ---
	const ssPost = (await ssPostIn(owner.cookie, ssSpace.id, 'Sweep sort post')).body?.post;
	// four direct comments in this order (sequential → ascending createdAt)
	const ssC1 = (await ssComment(member.cookie, ssPost.id, 'first')).body?.comment;
	const ssC2 = (await ssComment(stranger.cookie, ssPost.id, 'second')).body?.comment;
	const ssC3 = (await ssComment(mod.cookie, ssPost.id, 'third')).body?.comment;
	const ssC4 = (await ssComment(member.cookie, ssPost.id, 'fourth')).body?.comment;
	check('(fixtures) a subspace post with four direct comments', !!ssPost?.id && !!ssC1?.id && !!ssC2?.id && !!ssC3?.id && !!ssC4?.id, JSON.stringify([ssPost?.id, ssC1?.id, ssC2?.id, ssC3?.id, ssC4?.id]));
	// scores: c1 −1, c2 +2, c3 +1, c4 +1 (a tie with the older c3)
	const ssVotes = await Promise.all([
		ssVote(owner.cookie, ssC1.id, 'down'),
		ssVote(owner.cookie, ssC2.id, 'up'),
		ssVote(member.cookie, ssC2.id, 'up'),
		ssVote(owner.cookie, ssC3.id, 'up'),
		ssVote(owner.cookie, ssC4.id, 'up')
	]);
	check('(fixtures) votes land: c1 −1, c2 +2, c3 +1, c4 +1', ssVotes.every((result) => result.status === 200), JSON.stringify(ssVotes.map((result) => result.status)));
	const ssDefault = await ssRead(ssPost.id, member.cookie);
	check('default read (no commentSort) is unchanged: the comments ship oldest → newest and the response echoes commentSort null', ssDefault.status === 200 && JSON.stringify(ssIdsOf(ssDefault.body.post?.comments)) === JSON.stringify([ssC1.id, ssC2.id, ssC3.id, ssC4.id]) && ssDefault.body.commentSort === null, `${ssDefault.status} ${JSON.stringify(ssIdsOf(ssDefault.body?.post?.comments))} echo=${ssDefault.body?.commentSort}`);
	const ssTop = await ssRead(ssPost.id, member.cookie, '&commentSort=top');
	check('commentSort=top orders by net score desc, a tie older-first: c2 (+2), c3 (+1, older), c4 (+1), c1 (−1); echoed', ssTop.status === 200 && JSON.stringify(ssIdsOf(ssTop.body.post?.comments)) === JSON.stringify([ssC2.id, ssC3.id, ssC4.id, ssC1.id]) && ssTop.body.commentSort === 'top', `${ssTop.status} ${JSON.stringify(ssIdsOf(ssTop.body?.post?.comments))} scores=${JSON.stringify((ssTop.body?.post?.comments || []).map((entry) => entry.votes?.score))}`);
	const ssNew = await ssRead(ssPost.id, member.cookie, '&commentSort=new');
	check('commentSort=new ships newest first', ssNew.status === 200 && JSON.stringify(ssIdsOf(ssNew.body.post?.comments)) === JSON.stringify([ssC4.id, ssC3.id, ssC2.id, ssC1.id]) && ssNew.body.commentSort === 'new', `${ssNew.status} ${JSON.stringify(ssIdsOf(ssNew.body?.post?.comments))}`);
	const ssOld = await ssRead(ssPost.id, member.cookie, '&commentSort=old');
	check('commentSort=old ships oldest first', ssOld.status === 200 && JSON.stringify(ssIdsOf(ssOld.body.post?.comments)) === JSON.stringify([ssC1.id, ssC2.id, ssC3.id, ssC4.id]) && ssOld.body.commentSort === 'old', `${ssOld.status} ${JSON.stringify(ssIdsOf(ssOld.body?.post?.comments))}`);
	check('a sort never changes the counts: commentCount / commentCounts.direct / loaded agree between the default and the top read', ssTop.body?.post?.commentCount === ssDefault.body?.post?.commentCount && ssTop.body?.post?.commentCounts?.direct === 4 && ssTop.body?.post?.commentCounts?.loaded === 4 && ssDefault.body?.post?.commentCounts?.loaded === 4, JSON.stringify([ssDefault.body?.post?.commentCounts, ssTop.body?.post?.commentCounts]));
	const ssBogus = await ssRead(ssPost.id, member.cookie, '&commentSort=bogus');
	check('commentSort=bogus → 400 (a typo never silently reorders a thread)', ssBogus.status === 400 && /commentSort/.test(ssBogus.body?.error || ''), `${ssBogus.status} ${JSON.stringify(ssBogus.body)}`);
	const ssUpper = await ssRead(ssPost.id, member.cookie, '&commentSort=TOP');
	check('commentSort is case-sensitive: TOP → 400', ssUpper.status === 400);
	const ssAnonTop = await ssRead(ssPost.id, null, '&commentSort=top');
	check('anonymous commentSort=top on a public subspace post → 200 in the same order, no viewer vote', ssAnonTop.status === 200 && JSON.stringify(ssIdsOf(ssAnonTop.body.post?.comments)) === JSON.stringify([ssC2.id, ssC3.id, ssC4.id, ssC1.id]) && ssAnonTop.body.post.comments.every((entry) => entry.votes?.viewerVote === null) && ssAnonTop.body.commentSort === 'top', `${ssAnonTop.status} ${JSON.stringify(ssIdsOf(ssAnonTop.body?.post?.comments))}`);
	// nested replies re-order among the replies that ship (the newest 5 per parent)
	const ssR1 = (await ssComment(member.cookie, ssC1.id, 'reply one')).body?.comment;
	const ssR2 = (await ssComment(stranger.cookie, ssC1.id, 'reply two')).body?.comment;
	const ssReplyVotes = await Promise.all([ssVote(owner.cookie, ssR2.id, 'up'), ssVote(member.cookie, ssR2.id, 'up')]);
	check('(fixtures) two replies under c1, the newer one at +2', !!ssR1?.id && !!ssR2?.id && ssReplyVotes.every((result) => result.status === 200));
	const ssTopNested = await ssRead(ssPost.id, member.cookie, '&commentSort=top');
	const ssDefaultNested = await ssRead(ssPost.id, member.cookie);
	const ssC1Top = (ssTopNested.body?.post?.comments || []).find((entry) => entry.id === ssC1.id);
	const ssC1Default = (ssDefaultNested.body?.post?.comments || []).find((entry) => entry.id === ssC1.id);
	check('under top the shipped replies re-order too (r2 +2 before r1 0); the default page keeps them oldest → newest; both replies still ship', JSON.stringify(ssIdsOf(ssC1Top?.comments)) === JSON.stringify([ssR2.id, ssR1.id]) && JSON.stringify(ssIdsOf(ssC1Default?.comments)) === JSON.stringify([ssR1.id, ssR2.id]), JSON.stringify([ssIdsOf(ssC1Top?.comments), ssIdsOf(ssC1Default?.comments)]));
	const ssCommentRoot = await ssRead(ssC1.id, member.cookie, '&commentSort=top');
	check('a comment-as-root read (GET ?id=<comment>&commentSort=top) sorts ITS replies and the root post’s comments the same way', ssCommentRoot.status === 200 && JSON.stringify(ssIdsOf(ssCommentRoot.body.post?.comments)) === JSON.stringify([ssR2.id, ssR1.id]) && JSON.stringify(ssIdsOf(ssCommentRoot.body.root?.comments)) === JSON.stringify([ssC2.id, ssC3.id, ssC4.id, ssC1.id]) && ssCommentRoot.body.commentSort === 'top', `${ssCommentRoot.status} ${JSON.stringify([ssIdsOf(ssCommentRoot.body?.post?.comments), ssIdsOf(ssCommentRoot.body?.root?.comments)])}`);
	// the parameter is a things-level read option — a plain post takes it too
	const ssPlain = (await ssPostIn(owner.cookie, null, 'Sweep plain post')).body?.post;
	const ssPlainC1 = (await ssComment(member.cookie, ssPlain.id, 'plain one')).body?.comment;
	const ssPlainC2 = (await ssComment(stranger.cookie, ssPlain.id, 'plain two')).body?.comment;
	const ssPlainNew = await ssRead(ssPlain.id, null, '&commentSort=new');
	check('commentSort=new on a post outside any subspace → newest first (the option is a read option of the single read, not a subspace feature)', ssPlainNew.status === 200 && JSON.stringify(ssIdsOf(ssPlainNew.body.post?.comments)) === JSON.stringify([ssPlainC2.id, ssPlainC1.id]), `${ssPlainNew.status} ${JSON.stringify(ssIdsOf(ssPlainNew.body?.post?.comments))}`);

	// --- S7 review: the contracts the card's comment-sort fixes lean on ---
	// A comment posted under a sort scores 0 and is the newest, so it sorts
	// LAST under old and below every non-negative comment under top — the
	// page order the card's fresh-comment pin (windowCommentPage) exists for:
	// the sender always sees the comment they just posted, right above the
	// composer, whatever the sort put below the window.
	const ssTopBefore = await ssRead(ssPost.id, member.cookie, '&commentSort=top');
	const ssC5Ack = await ssComment(member.cookie, ssPost.id, 'fifth, posted under a sort');
	const ssC5 = ssC5Ack.body?.comment;
	const [ssTopAfter, ssOldAfter] = await Promise.all([ssRead(ssPost.id, member.cookie, '&commentSort=top'), ssRead(ssPost.id, member.cookie, '&commentSort=old')]);
	check('a comment posted under a sort (score 0, the newest) sorts last under old and below every non-negative comment under top (c2, c3, c4, c5, c1) — the order the card pins the sender’s fresh comment against', ssC5Ack.status === 200 && !!ssC5?.id && ssC5.votes?.score === 0 && JSON.stringify(ssIdsOf(ssOldAfter.body?.post?.comments)) === JSON.stringify([ssC1.id, ssC2.id, ssC3.id, ssC4.id, ssC5.id]) && JSON.stringify(ssIdsOf(ssTopAfter.body?.post?.comments)) === JSON.stringify([ssC2.id, ssC3.id, ssC4.id, ssC5.id, ssC1.id]), `${ssC5Ack.status} old=${JSON.stringify(ssIdsOf(ssOldAfter.body?.post?.comments))} top=${JSON.stringify(ssIdsOf(ssTopAfter.body?.post?.comments))}`);
	// A sorted page read BEFORE a write cannot count it; the write's ack can —
	// the card keeps a pending row the page does not carry (mergeCommentPage),
	// counts it as unseen (page total + 1), and an authoritative count takes
	// over when it lands. The ack's commentCount is the level's DIRECT count
	// (countCommentsOf the target — the documented "use it to update the
	// card" value); the post projection's commentCount is the thread total.
	check('the comment ack’s commentCount is the level’s direct count after the write (the earlier sorted read’s commentCounts.direct + 1) and the next sorted read’s total grew by exactly one (the card counts a kept pending row as unseen until an authoritative count lands)', ssC5Ack.body?.commentCount === ssTopBefore.body?.post?.commentCounts?.direct + 1 && ssTopAfter.body?.post?.commentCounts?.direct === ssC5Ack.body?.commentCount && ssTopAfter.body?.post?.commentCount === ssTopBefore.body?.post?.commentCount + 1, JSON.stringify({ beforeDirect: ssTopBefore.body?.post?.commentCounts?.direct, beforeTotal: ssTopBefore.body?.post?.commentCount, ack: ssC5Ack.body?.commentCount, afterDirect: ssTopAfter.body?.post?.commentCounts?.direct, afterTotal: ssTopAfter.body?.post?.commentCount }));
	// The thread drill-down: the card reads a thread in ITS order through the
	// comment's own read (threadCache keys a sorted read apart from the
	// default one), so every sort must work on a comment-as-root and the
	// default read of the same comment must stay what it was.
	const [ssC1New, ssC1Old, ssC1DefaultRead] = await Promise.all([ssRead(ssC1.id, member.cookie, '&commentSort=new'), ssRead(ssC1.id, member.cookie, '&commentSort=old'), ssRead(ssC1.id, member.cookie)]);
	check('the thread drill-down read (GET ?id=<comment>&commentSort=new|old) orders the replies newest / oldest first and echoes the sort, while the default read of the same comment is unchanged (r1, r2; echoed null)', ssC1New.status === 200 && JSON.stringify(ssIdsOf(ssC1New.body.post?.comments)) === JSON.stringify([ssR2.id, ssR1.id]) && ssC1New.body.commentSort === 'new' && ssC1Old.status === 200 && JSON.stringify(ssIdsOf(ssC1Old.body.post?.comments)) === JSON.stringify([ssR1.id, ssR2.id]) && ssC1Old.body.commentSort === 'old' && ssC1DefaultRead.status === 200 && JSON.stringify(ssIdsOf(ssC1DefaultRead.body.post?.comments)) === JSON.stringify([ssR1.id, ssR2.id]) && ssC1DefaultRead.body.commentSort === null, JSON.stringify({ new: ssIdsOf(ssC1New.body?.post?.comments), old: ssIdsOf(ssC1Old.body?.post?.comments), def: ssIdsOf(ssC1DefaultRead.body?.post?.comments), echo: [ssC1New.body?.commentSort, ssC1Old.body?.commentSort, ssC1DefaultRead.body?.commentSort] }));
	// A refused sort read is a clean refusal the card can act on: it toasts
	// the reason and REVERTS the menu to the previous pick, never leaving a
	// "▲ Top" label over a page the server never delivered.
	check('a refused sort read answers ok:false + an error naming commentSort (the card toasts it and reverts the menu to the previous pick)', ssBogus.status === 400 && ssBogus.body?.ok === false && /commentSort/.test(ssBogus.body?.error || ''), `${ssBogus.status} ${JSON.stringify(ssBogus.body)}`);

	// --- edge case: deleting a post clears its reports ---
	const ssReported = (await ssPostIn(owner.cookie, ssSpace.id, 'Sweep reported post')).body?.post;
	const ssReport = await api('/api/v1/subspaces/report', { method: 'POST', cookie: member.cookie, body: { id: ssReported.id, reason: 'Rule 1: Be kind', note: 'sweep' } });
	const ssQueueBefore = await api(`/api/v1/subspaces/reports?slug=${ssSlug}`, { cookie: owner.cookie });
	check('(fixtures) the member reports a post; the owner’s open queue groups it', ssReport.status === 200 && ssQueueBefore.status === 200 && ssQueueBefore.body.reports?.some((group) => group.postId === ssReported.id) && ssQueueBefore.body.openReportCount === 1, `${ssReport.status} ${ssQueueBefore.status} ${JSON.stringify(ssQueueBefore.body?.reports?.map((group) => group.postId))} open=${ssQueueBefore.body?.openReportCount}`);
	const ssDeleteReported = await api(`/api/v1/things?id=${ssReported.id}`, { method: 'DELETE', cookie: owner.cookie });
	const ssQueueAfter = await api(`/api/v1/subspaces/reports?slug=${ssSlug}`, { cookie: owner.cookie });
	const ssQueueResolved = await api(`/api/v1/subspaces/reports?slug=${ssSlug}&status=resolved`, { cookie: owner.cookie });
	const ssDetailAfterDelete = await api(`/api/v1/subspaces/get?slug=${ssSlug}`, { cookie: owner.cookie });
	check('deleting the post clears its reports: gone from the open AND the resolved queue, openReportCount 0 on the queue and the detail', ssDeleteReported.status === 200 && ssQueueAfter.status === 200 && !ssQueueAfter.body.reports?.some((group) => group.postId === ssReported.id) && ssQueueAfter.body.openReportCount === 0 && !ssQueueResolved.body?.reports?.some((group) => group.postId === ssReported.id) && ssDetailAfterDelete.body?.subspace?.openReportCount === 0, `${ssDeleteReported.status} open=${JSON.stringify(ssQueueAfter.body?.reports?.map((group) => group.postId))} resolved=${JSON.stringify(ssQueueResolved.body?.reports?.map((group) => group.postId))} detail=${ssDetailAfterDelete.body?.subspace?.openReportCount}`);

	// --- edge case: banning a pending requester removes the request ---
	const ssPendingJoin = await api('/api/v1/subspaces/join', { method: 'POST', cookie: stranger.cookie, body: { slug: ssPrivSlug } });
	const ssPendingQueue = await api(`/api/v1/subspaces/members?slug=${ssPrivSlug}&pending=1`, { cookie: owner.cookie });
	const ssPendingNames = (resp) => (resp.body?.members || []).filter((entry) => entry.pending === true).map((entry) => entry.userId);
	check('(fixtures) the stranger requests to join private P; the request sits in the owner’s queue', ssPendingJoin.status === 200 && ssPendingJoin.body.pending === true && ssPendingJoin.body.joined === false && ssPendingQueue.status === 200 && ssPendingNames(ssPendingQueue).includes(stranger.id), `${ssPendingJoin.status} ${JSON.stringify(ssPendingJoin.body).slice(0, 120)} queue=${JSON.stringify(ssPendingNames(ssPendingQueue))}`);
	const ssBanPending = await api('/api/v1/subspaces/members', { method: 'POST', cookie: owner.cookie, body: { slug: ssPrivSlug, username: stranger.username, action: 'ban', reason: 'sweep' } });
	const ssPendingQueueAfter = await api(`/api/v1/subspaces/members?slug=${ssPrivSlug}&pending=1`, { cookie: owner.cookie });
	const ssPrivDetailOwner = await api(`/api/v1/subspaces/get?slug=${ssPrivSlug}`, { cookie: owner.cookie });
	const ssPrivDetailStranger = await api(`/api/v1/subspaces/get?slug=${ssPrivSlug}`, { cookie: stranger.cookie });
	const ssRejoinBanned = await api('/api/v1/subspaces/join', { method: 'POST', cookie: stranger.cookie, body: { slug: ssPrivSlug } });
	check('banning the pending requester removes the request: queue empty, pendingCount 0, the stranger reads banned + not pending, a re-request → 403', ssBanPending.status === 200 && ssPendingQueueAfter.status === 200 && !ssPendingNames(ssPendingQueueAfter).includes(stranger.id) && ssPrivDetailOwner.body?.subspace?.pendingCount === 0 && ssPrivDetailStranger.body?.subspace?.viewer?.banned === true && ssPrivDetailStranger.body.subspace.viewer.pending === false && ssPrivDetailStranger.body.subspace.viewer.member === false && ssRejoinBanned.status === 403, `${ssBanPending.status} queue=${JSON.stringify(ssPendingNames(ssPendingQueueAfter))} pendingCount=${ssPrivDetailOwner.body?.subspace?.pendingCount} viewer=${JSON.stringify(ssPrivDetailStranger.body?.subspace?.viewer)} rejoin=${ssRejoinBanned.status}`);

	// --- edge case: transferring ownership to a banned / pending / non-member user is refused ---
	const ssNobodyJoin = await api('/api/v1/subspaces/join', { method: 'POST', cookie: nobody.cookie, body: { slug: ssPrivSlug } });
	const ssTransferBanned = await api('/api/v1/subspaces/transfer', { method: 'POST', cookie: owner.cookie, body: { slug: ssPrivSlug, username: stranger.username } });
	const ssTransferPending = await api('/api/v1/subspaces/transfer', { method: 'POST', cookie: owner.cookie, body: { slug: ssPrivSlug, username: nobody.username } });
	const ssTransferOutsider = await api('/api/v1/subspaces/transfer', { method: 'POST', cookie: owner.cookie, body: { slug: ssPrivSlug, username: mod.username } });
	const ssPrivAfterTransfers = await api(`/api/v1/subspaces/get?slug=${ssPrivSlug}`, { cookie: owner.cookie });
	check('transfer to a banned user → 403, to a pending requester → 404, to a non-member → 404; the owner keeps the crown', ssNobodyJoin.status === 200 && ssNobodyJoin.body.pending === true && ssTransferBanned.status === 403 && ssTransferPending.status === 404 && ssTransferOutsider.status === 404 && ssPrivAfterTransfers.body?.subspace?.viewer?.role === 'owner', `${ssNobodyJoin.status} ${ssTransferBanned.status}/${ssTransferPending.status}/${ssTransferOutsider.status} role=${ssPrivAfterTransfers.body?.subspace?.viewer?.role}`);

	// --- edge case: viewer.canPost is false for a pending member; the composer's select excludes pending memberships ---
	const ssNobodyDetail = await api(`/api/v1/subspaces/get?slug=${ssPrivSlug}`, { cookie: nobody.cookie });
	const ssNobodyPost = await ssPostIn(nobody.cookie, ssPriv.id, 'Sweep pending post');
	check('a pending requester reads viewer.pending true, member false, canPost false — and posting → 403', ssNobodyDetail.status === 200 && ssNobodyDetail.body.subspace.viewer.pending === true && ssNobodyDetail.body.subspace.viewer.member === false && ssNobodyDetail.body.subspace.viewer.canPost === false && ssNobodyPost.status === 403, `${ssNobodyDetail.status} ${JSON.stringify(ssNobodyDetail.body?.subspace?.viewer)} post=${ssNobodyPost.status}`);
	const ssNobodyJoinS = await api('/api/v1/subspaces/join', { method: 'POST', cookie: nobody.cookie, body: { slug: ssSlug } });
	const ssNobodyMine = await api('/api/v1/subspaces?mine=1&limit=50', { cookie: nobody.cookie });
	const ssNobodyMineSlugs = (ssNobodyMine.body?.subspaces || []).map((entry) => entry.slug);
	const ssMemberMine = await api('/api/v1/subspaces?mine=1&limit=50', { cookie: member.cookie });
	const ssMemberPriv = (ssMemberMine.body?.subspaces || []).find((entry) => entry.slug === ssPrivSlug);
	check('the composer’s query (mine=1&limit=50) lists S (canPost true) and NOT the pending P for the requester; the member added to P gets P with canPost true', ssNobodyJoinS.status === 200 && ssNobodyMine.status === 200 && ssNobodyMineSlugs.includes(ssSlug) && !ssNobodyMineSlugs.includes(ssPrivSlug) && ssNobodyMine.body.subspaces.find((entry) => entry.slug === ssSlug)?.viewer?.canPost === true && ssMemberMine.status === 200 && ssMemberPriv?.viewer?.canPost === true && ssMemberPriv.viewer.member === true, `${ssNobodyJoinS.status} nobody=${JSON.stringify(ssNobodyMineSlugs)} memberP=${JSON.stringify(ssMemberPriv?.viewer)}`);

	// --- edge case: a demoted mod loses queue access on the next request ---
	const ssModQueues = async (cookie) =>
		Promise.all([
			api(`/api/v1/subspaces/members?slug=${ssSlug}&pending=1`, { cookie }),
			api(`/api/v1/subspaces/members?slug=${ssSlug}&approvalRequests=1`, { cookie }),
			api(`/api/v1/subspaces/reports?slug=${ssSlug}`, { cookie }),
			api(`/api/v1/subspaces/modlog?slug=${ssSlug}`, { cookie })
		]);
	const ssModBefore = await ssModQueues(mod.cookie);
	check('(fixtures) the moderator reads the join-request, approval-request, report queues and the mod log (200 ×4)', ssModBefore.every((result) => result.status === 200), JSON.stringify(ssModBefore.map((result) => result.status)));
	const ssDemote = await api('/api/v1/subspaces/members', { method: 'POST', cookie: owner.cookie, body: { slug: ssSlug, username: mod.username, action: 'role', role: 'member' } });
	const ssModAfter = await ssModQueues(mod.cookie);
	const ssDemotedModerate = await api('/api/v1/subspaces/moderate', { method: 'POST', cookie: mod.cookie, body: { id: ssPost.id, action: 'pin' } });
	const ssDemotedDismiss = await api('/api/v1/subspaces/reports', { method: 'POST', cookie: mod.cookie, body: { slug: ssSlug, postId: ssPost.id, action: 'dismiss' } });
	const ssDemotedRead = await ssRead(ssPost.id, mod.cookie);
	check('demoted → every queue answers 403 on the very next request (pending / approvalRequests / reports / modlog), moderate → 403, dismiss → 403, and the post projection drops viewerCanModerate', ssDemote.status === 200 && ssModAfter.every((result) => result.status === 403) && ssDemotedModerate.status === 403 && ssDemotedDismiss.status === 403 && ssDemotedRead.status === 200 && ssDemotedRead.body.post?.subspaceMod?.viewerCanModerate === false && ssDemotedRead.body.post.subspaceMod.reportCount === undefined, `${ssDemote.status} ${JSON.stringify(ssModAfter.map((result) => result.status))} moderate=${ssDemotedModerate.status} dismiss=${ssDemotedDismiss.status} mod=${JSON.stringify(ssDemotedRead.body?.post?.subspaceMod)}`);

	// --- edge case: subspacePrivate posts (and removed posts) never syndicate or trend ---
	const ssPrivPost = (await ssPostIn(owner.cookie, ssPriv.id, 'Sweep private post')).body?.post;
	const ssRemovedPost = (await ssPostIn(owner.cookie, ssSpace.id, 'Sweep removed post')).body?.post;
	const ssRemoveIt = await api('/api/v1/subspaces/moderate', { method: 'POST', cookie: owner.cookie, body: { id: ssRemovedPost?.id, action: 'remove', reason: 'sweep' } });
	const ssRssResponse = await fetch(`${BASE}/api/v1/things/rss`);
	const ssRss = await ssRssResponse.text();
	const ssTrending = await api('/api/v1/things/trending');
	const ssTrendingIds = (ssTrending.body?.posts || []).map((entry) => entry.id);
	check('(fixtures) a private-subspace post and a mod-removed public post exist', !!ssPrivPost?.id && !!ssRemovedPost?.id && ssRemoveIt.status === 200, `${ssRemoveIt.status}`);
	check('GET /api/v1/things/rss (atom) syndicates the public subspace post and NEVER the private-subspace post or the removed post', ssRssResponse.status === 200 && /atom\+xml/.test(ssRssResponse.headers.get('content-type') || '') && ssRss.includes(`/post/${ssPost.id}`) && !ssRss.includes(`/post/${ssPrivPost.id}`) && !ssRss.includes(`/post/${ssRemovedPost.id}`), `${ssRssResponse.status} ct=${ssRssResponse.headers.get('content-type')} pub=${ssRss.includes(`/post/${ssPost.id}`)} priv=${ssRss.includes(`/post/${ssPrivPost.id}`)} removed=${ssRss.includes(`/post/${ssRemovedPost.id}`)}`);
	check('GET /api/v1/things/trending never lists the private-subspace post or the removed post', ssTrending.status === 200 && Array.isArray(ssTrending.body.posts) && !ssTrendingIds.includes(ssPrivPost.id) && !ssTrendingIds.includes(ssRemovedPost.id), `${ssTrending.status} ${JSON.stringify(ssTrendingIds.slice(0, 5))}`);
	const ssTrendingMember = await api('/api/v1/things/trending', { cookie: member.cookie });
	check('…even for a member of the private subspace (trending is the public board)', ssTrendingMember.status === 200 && !(ssTrendingMember.body?.posts || []).some((entry) => entry.id === ssPrivPost.id));

	// --- the manifest + docs ---
	const manifestS = await api('/api/v1/capabilities');
	check('capability manifest: api.things 1.4.0 (commentSort) while things-comment / things-user stay 1.3.0 and things-feed 1.4.0 — only the single read grew', manifestS.status === 200 && manifestS.body.features['api.things'] === '1.4.0' && manifestS.body.features['api.things-comment'] === '1.3.0' && manifestS.body.features['api.things-user'] === '1.3.0' && manifestS.body.features['api.things-feed'] === '1.4.0', JSON.stringify({ t: manifestS.body?.features?.['api.things'], c: manifestS.body?.features?.['api.things-comment'], f: manifestS.body?.features?.['api.things-feed'] }));
	const ssDocs = await api('/api/v1/things-docs');
	check('the things docs name commentSort (top / new / old, the default page, the 400) at contract 1.4.0 / feature 1.5.0', ssDocs.status === 200 && ssDocs.body.docs?.contractVersion === '1.4.0' && ssDocs.body.docs?.featureVersion === '1.5.0' && (ssDocs.body.docs?.steps || []).some((step) => /commentSort=top\|new\|old/.test(step)) && (ssDocs.body.docs?.requestExamples || []).some((example) => example.query?.commentSort === 'top'), JSON.stringify({ cv: ssDocs.body?.docs?.contractVersion, fv: ssDocs.body?.docs?.featureVersion }));
	// cleanup: the plain post, then both subspaces
	const ssPlainDeleted = await api(`/api/v1/things?id=${ssPlain.id}`, { method: 'DELETE', cookie: owner.cookie });
	const cleanupS = await Promise.all([ssSlug, ssPrivSlug].map((slugToDelete) => api('/api/v1/subspaces/delete', { method: 'POST', cookie: owner.cookie, body: { slug: slugToDelete, confirmSlug: slugToDelete } })));
	const ssGone = await api(`/api/v1/subspaces/get?slug=${ssSlug}`);
	check('(cleanup) the plain post is deleted and the owner deletes S and P (get → 404)', ssPlainDeleted.status === 200 && cleanupS.every((result) => result.status === 200) && ssGone.status === 404, `${ssPlainDeleted.status} ${JSON.stringify(cleanupS.map((result) => result.status))} ${ssGone.status}`);

	console.log('\nT. final round-2 sweep — mod recipients, the report cascade, bell deep links, docs ↔ manifest');
	// The cross-slice invariants no single slice section owns: who exactly a
	// "notify the mods" emit reaches once the roster moves (a demoted mod and
	// a moderator who left stop ringing at once — recipients are resolved at
	// emit time), a private subspace's ACTIVE member calling join (a no-op,
	// never downgraded to a request), the Reports queue's cursor paging, a
	// subspace deletion taking every subspace-report row with it, every bell
	// of the family deep-linking consistently (post-shaped rows carry postId =
	// targetId = the post; subspace-shaped rows carry the subspace and an
	// "s/<slug> ·" preview), and the docs registry ↔ the two served manifests
	// agreeing across the whole family at the round's final versions.
	const tSlug = `tfs_${suffix}`.slice(0, 30);
	const tPrivSlug = `tfp_${suffix}`.slice(0, 30);
	const tCreated = await api('/api/v1/subspaces', { method: 'POST', cookie: owner.cookie, body: { slug: tSlug, name: `Final ${suffix}`, access: 'public', rules: [{ title: 'Be kind', text: 'No gatekeeping.' }] } });
	const tPrivCreated = await api('/api/v1/subspaces', { method: 'POST', cookie: owner.cookie, body: { slug: tPrivSlug, name: `Final private ${suffix}`, access: 'private' } });
	const tSpace = tCreated.body?.subspace;
	const tPriv = tPrivCreated.body?.subspace;
	const tJoins = await Promise.all([mod, member, stranger].map((who) => api('/api/v1/subspaces/join', { method: 'POST', cookie: who.cookie, body: { slug: tSlug } })));
	const tMembers = (slugOf, body) => api('/api/v1/subspaces/members', { method: 'POST', cookie: owner.cookie, body: { slug: slugOf, ...body } });
	const tPromote = await tMembers(tSlug, { username: mod.username, action: 'role', role: 'moderator' });
	const tPrivAdds = await Promise.all([mod, member].map((who) => tMembers(tPrivSlug, { username: who.username, action: 'add' })));
	const tPrivPromote = await tMembers(tPrivSlug, { username: mod.username, action: 'role', role: 'moderator' });
	check(
		'(fixtures) T public + TP private founded; mod / member / stranger join T, the mod moderates both, the member is added to TP',
		tCreated.status === 201 && tPrivCreated.status === 201 && tJoins.every((result) => result.status === 200) && tPromote.status === 200 && tPrivAdds.every((result) => result.status === 200) && tPrivPromote.status === 200,
		`${tCreated.status}/${tPrivCreated.status} ${JSON.stringify(tJoins.map((result) => result.status))} ${tPromote.status} ${JSON.stringify(tPrivAdds.map((result) => result.status))} ${tPrivPromote.status}`
	);

	// --- an ACTIVE member of a private subspace calling join is a no-op ---
	const tPrivRejoin = await api('/api/v1/subspaces/join', { method: 'POST', cookie: member.cookie, body: { slug: tPrivSlug } });
	const tPrivQueue = await api(`/api/v1/subspaces/members?slug=${tPrivSlug}&pending=1`, { cookie: owner.cookie });
	check(
		'an ACTIVE member of a private subspace calling join is a no-op: 200 joined false / pending false, still a member (viewer.member, memberCount 3) and no request lands in the queue',
		tPrivRejoin.status === 200 && tPrivRejoin.body.joined === false && tPrivRejoin.body.pending === false && tPrivRejoin.body.subspace?.viewer?.member === true && tPrivRejoin.body.subspace.viewer.pending === false && tPrivRejoin.body.subspace.memberCount === 3 && tPrivQueue.status === 200 && (tPrivQueue.body.members || []).length === 0,
		`${tPrivRejoin.status} ${JSON.stringify({ joined: tPrivRejoin.body?.joined, pending: tPrivRejoin.body?.pending, viewer: tPrivRejoin.body?.subspace?.viewer, memberCount: tPrivRejoin.body?.subspace?.memberCount })} queue=${tPrivQueue.body?.members?.length}`
	);

	// --- the Reports queue pages by cursor; every ACTIVE mod rings once per report ---
	const tPostIn = (cookie, subspaceId, title) => api('/api/v1/things', { method: 'POST', cookie, body: { type: 'text', text: `${title} body`, title, subspaceId, visibility: 'public' } });
	const tReport = (cookie, id, reason) => api('/api/v1/subspaces/report', { method: 'POST', cookie, body: { id, reason } });
	const tPost1 = (await tPostIn(member.cookie, tSpace.id, 'Final one')).body?.post;
	const tPost2 = (await tPostIn(member.cookie, tSpace.id, 'Final two')).body?.post;
	const tReport1 = await tReport(stranger.cookie, tPost1?.id, 'Rule 1: Be kind');
	const tReport2 = await tReport(stranger.cookie, tPost2?.id, 'Spam');
	check(
		'(fixtures) the member posts twice in T; the stranger reports both (two fresh open rows)',
		!!tPost1?.id && !!tPost2?.id && tReport1.status === 200 && tReport1.body.updated === false && !!tReport1.body.report?.id && tReport2.status === 200 && tReport2.body.updated === false && !!tReport2.body.report?.id,
		`${tReport1.status}/${tReport2.status} ${JSON.stringify([tReport1.body?.updated, tReport2.body?.updated])}`
	);
	const tPage1 = await api(`/api/v1/subspaces/reports?slug=${tSlug}&limit=1`, { cookie: owner.cookie });
	const tPage2 = typeof tPage1.body?.nextCursor === 'string' ? await api(`/api/v1/subspaces/reports?slug=${tSlug}&limit=1&cursor=${encodeURIComponent(tPage1.body.nextCursor)}`, { cookie: owner.cookie }) : { status: 0, body: null };
	const tPagedIds = [...(tPage1.body?.reports || []), ...(tPage2.body?.reports || [])].map((group) => group.postId).sort();
	check(
		'the Reports queue pages by cursor: limit=1 → one group + nextCursor, the cursor → the other group + no cursor; the two pages cover both posts exactly once and each carries openReportCount 2',
		tPage1.status === 200 && tPage1.body.reports?.length === 1 && typeof tPage1.body.nextCursor === 'string' && tPage2.status === 200 && tPage2.body.reports?.length === 1 && tPage2.body.nextCursor === null && JSON.stringify(tPagedIds) === JSON.stringify([tPost1.id, tPost2.id].sort()) && tPage1.body.openReportCount === 2 && tPage2.body.openReportCount === 2,
		`${tPage1.status}/${tPage2.status} cursor=${tPage1.body?.nextCursor} ids=${JSON.stringify(tPagedIds)} open=${tPage1.body?.openReportCount}/${tPage2.body?.openReportCount}`
	);
	const tRowsOf = async (who, type, key, id) => (await notifsOf(who.cookie)).items.filter((n) => n.type === type && n[key] === id);
	const tReportRows1 = await Promise.all([owner, mod, member, stranger].map((who) => tRowsOf(who, 'subspace-report', 'postId', tPost1.id)));
	check(
		'a report rings every ACTIVE moderator exactly once (owner + mod: one subspace-report row each for the post) and nobody else (the author and the reporter hear nothing)',
		tReportRows1[0].length === 1 && tReportRows1[1].length === 1 && tReportRows1[2].length === 0 && tReportRows1[3].length === 0,
		JSON.stringify(tReportRows1.map((rows) => rows.length))
	);

	// --- "the mods" = the ACTIVE owner + moderators, resolved at emit time ---
	const tDemote = await tMembers(tSlug, { username: mod.username, action: 'role', role: 'member' });
	const tPromoteMember = await tMembers(tSlug, { username: member.username, action: 'role', role: 'moderator' });
	const tMemberLeaves = await api('/api/v1/subspaces/leave', { method: 'POST', cookie: member.cookie, body: { slug: tSlug } });
	const tPost3 = (await tPostIn(stranger.cookie, tSpace.id, 'Final three')).body?.post;
	const tReport3 = await tReport(nobody.cookie, tPost3?.id, 'Rule 1: Be kind');
	check(
		'(fixtures) the mod is demoted, the member is promoted and then LEAVES; the stranger posts and an outsider reports it',
		tDemote.status === 200 && tPromoteMember.status === 200 && tMemberLeaves.status === 200 && !!tPost3?.id && tReport3.status === 200 && !!tReport3.body.report?.id,
		`${tDemote.status} ${tPromoteMember.status} ${tMemberLeaves.status} post=${!!tPost3?.id} report=${tReport3.status}`
	);
	const tReportRows3 = await Promise.all([owner, mod, member, stranger, nobody].map((who) => tRowsOf(who, 'subspace-report', 'postId', tPost3.id)));
	check(
		'a report filed after the roster moved reaches the owner only: the demoted mod and the moderator who left get NO subspace-report row (recipients are the ACTIVE owner + moderators at emit time), nor do the author / reporter',
		tReportRows3[0].length === 1 && tReportRows3.slice(1).every((rows) => rows.length === 0),
		JSON.stringify(tReportRows3.map((rows) => rows.length))
	);
	const tPrivDemote = await tMembers(tPrivSlug, { username: mod.username, action: 'role', role: 'member' });
	const tNobodyRequest = await api('/api/v1/subspaces/join', { method: 'POST', cookie: nobody.cookie, body: { slug: tPrivSlug } });
	const tJoinRows = await Promise.all([owner, mod, member, nobody].map((who) => tRowsOf(who, 'subspace-join-request', 'targetId', tPriv.id)));
	check(
		'a join request filed after a demotion rings the owner only: the demoted TP moderator (still an active member) and a plain member get NO subspace-join-request row, nor does the requester',
		tPrivDemote.status === 200 && tNobodyRequest.status === 200 && tNobodyRequest.body.pending === true && tJoinRows[0].length === 1 && tJoinRows.slice(1).every((rows) => rows.length === 0),
		`${tPrivDemote.status} ${tNobodyRequest.status} ${JSON.stringify(tJoinRows.map((rows) => rows.length))}`
	);

	// --- every bell of the family deep-links consistently ---
	const tAccept = await tMembers(tPrivSlug, { username: nobody.username, action: 'accept' });
	const tRemove = await api('/api/v1/subspaces/moderate', { method: 'POST', cookie: owner.cookie, body: { id: tPost2.id, action: 'remove', reason: 'Final sweep' } });
	const tBan = await tMembers(tSlug, { username: stranger.username, action: 'ban', reason: 'Final sweep' });
	check('(fixtures) the owner accepts the request, removes a reported post and bans the stranger', tAccept.status === 200 && tRemove.status === 200 && tBan.status === 200, `${tAccept.status} ${tRemove.status} ${tBan.status}`);
	const POST_SHAPED = new Set(['subspace-post-removed', 'subspace-report']);
	const SUBSPACE_SHAPED = new Set(['subspace-role', 'subspace-ban', 'subspace-join-request', 'subspace-join-accepted']);
	const tPostIds = new Set([tPost1.id, tPost2.id, tPost3.id]);
	const tSlugById = new Map([[tSpace.id, tSlug], [tPriv.id, tPrivSlug]]);
	const tAllRows = (await Promise.all([owner, mod, member, stranger, nobody].map((who) => notifsOf(who.cookie)))).flatMap((resp) => resp.items);
	// this section's rows, picked structurally (never by clock): anything
	// whose targetId is one of its posts or one of its subspaces
	const tFamilyRows = tAllRows.filter((n) => String(n.type).startsWith('subspace-') && (tPostIds.has(n.targetId) || tSlugById.has(n.targetId)));
	const tBadRows = tFamilyRows.filter((n) => {
		if (tPostIds.has(n.targetId)) return !POST_SHAPED.has(n.type) || n.postId !== n.targetId;
		return !SUBSPACE_SHAPED.has(n.type) || n.postId !== null || !String(n.preview || '').startsWith(`s/${tSlugById.get(n.targetId)} ·`);
	});
	const tTypesSeen = new Set(tFamilyRows.map((n) => n.type));
	const tExpectedRows = [
		['member', 'subspace-post-removed', tPost2.id, tAllRows.some((n) => n.type === 'subspace-post-removed' && n.postId === tPost2.id)],
		['stranger', 'subspace-ban', tSpace.id, (await tRowsOf(stranger, 'subspace-ban', 'targetId', tSpace.id)).length === 1],
		['nobody', 'subspace-join-accepted', tPriv.id, (await tRowsOf(nobody, 'subspace-join-accepted', 'targetId', tPriv.id)).length === 1],
		['mod', 'subspace-role', tSpace.id, (await tRowsOf(mod, 'subspace-role', 'targetId', tSpace.id)).length === 2]
	];
	check(
		'every bell about this section’s things deep-links consistently across all six types: post-shaped rows (post removed / report) carry postId = targetId = the post; subspace-shaped rows (role / ban / join request / join accepted) carry the subspace as targetId, no postId and an "s/<slug> ·" preview — and the expected rows exist (the author’s removal, the stranger’s ban, the requester’s acceptance, the mod’s promotion + demotion)',
		tFamilyRows.length >= 8 && tBadRows.length === 0 && SUBSPACE_NOTIFICATION_TYPES.every((type) => tTypesSeen.has(type)) && tExpectedRows.every((row) => row[3] === true),
		JSON.stringify({ rows: tFamilyRows.length, bad: tBadRows.map((n) => [n.type, n.targetId, n.postId, n.preview]), seen: [...tTypesSeen], expected: tExpectedRows.map((row) => row.slice(0, 2).concat(row[3])) })
	);

	// --- deleting the subspace takes every subspace-report row with it ---
	const tReportReads = () => Promise.all([
		api(`/api/v1/things?id=${tReport1.body.report.id}`, { cookie: stranger.cookie }),
		api(`/api/v1/things?id=${tReport2.body.report.id}`, { cookie: stranger.cookie }),
		api(`/api/v1/things?id=${tReport3.body.report.id}`, { cookie: nobody.cookie })
	]);
	const tRowsBefore = await tReportReads();
	const tDelete = await api('/api/v1/subspaces/delete', { method: 'POST', cookie: owner.cookie, body: { slug: tSlug, confirmSlug: tSlug } });
	const tRowsAfter = await tReportReads();
	const tPost1After = await api(`/api/v1/things?id=${tPost1.id}`);
	const tModMine = await api('/api/v1/subspaces?mine=1&limit=50', { cookie: mod.cookie });
	check(
		'deleting the subspace takes every subspace-report row with it: the reporters read their own rows 200 before (three rows) and 404 after; the never-removed reported post survives as a plain public post (subspace / subspaceMod null, anonymous read); three member rows (owner, demoted mod, the banned one — an active member who leaves takes their row with them) are removed and the mod’s mine=1 no longer lists it',
		tRowsBefore.every((result) => result.status === 200) && tDelete.status === 200 && tDelete.body.removedMembers === 3 && tRowsAfter.every((result) => result.status === 404) && tPost1After.status === 200 && tPost1After.body.post?.subspace === null && tPost1After.body.post.subspaceMod === null && tModMine.status === 200 && !(tModMine.body.subspaces || []).some((entry) => entry.slug === tSlug),
		`before=${JSON.stringify(tRowsBefore.map((result) => result.status))} delete=${tDelete.status} ${JSON.stringify(tDelete.body)} after=${JSON.stringify(tRowsAfter.map((result) => result.status))} post=${tPost1After.status} sub=${JSON.stringify(tPost1After.body?.post?.subspace)} mod=${JSON.stringify(tPost1After.body?.post?.subspaceMod)}`
	);

	// --- the docs registry ↔ the served manifests, whole family, final round-2 numbers ---
	// /api/v1/capabilities is generated from the docs' contractVersion (plus a
	// route.v1.* key per executable route); /.well-known/thingtime-capabilities
	// .json from the docs' featureVersion. Both must agree with the registry.
	const FAMILY = {
		'/api/v1/subspaces': ['api.subspaces', '1.5.0'],
		'/api/v1/subspaces/get': ['api.subspaces-get', '1.4.0'],
		'/api/v1/subspaces/join': ['api.subspaces-join', '1.3.0'],
		'/api/v1/subspaces/leave': ['api.subspaces-leave', '1.3.0'],
		'/api/v1/subspaces/members': ['api.subspaces-members', '1.4.1'],
		'/api/v1/subspaces/moderate': ['api.subspaces-moderate', '1.4.0'],
		'/api/v1/subspaces/modlog': ['api.subspaces-modlog', '1.0.0'],
		'/api/v1/subspaces/update': ['api.subspaces-update', '1.3.0'],
		'/api/v1/subspaces/feed': ['api.subspaces-feed', '1.3.0'],
		'/api/v1/subspaces/transfer': ['api.subspaces-transfer', '1.2.0'],
		'/api/v1/subspaces/delete': ['api.subspaces-delete', '1.1.0'],
		'/api/v1/subspaces/report': ['api.subspaces-report', '1.0.1'],
		'/api/v1/subspaces/reports': ['api.subspaces-reports', '1.0.1'],
		'/api/v1/things': ['api.things', '1.4.0'],
		'/api/v1/things/feed': ['api.things-feed', '1.4.0'],
		'/api/v1/things/comment': ['api.things-comment', '1.3.0'],
		'/api/v1/things/user': ['api.things-user', '1.3.0'],
		'/api/v1/things/updown': ['api.things-updown', '1.0.0'],
		'/api/v1/notifications': ['api.notifications-list', '1.2.0'],
		'/api/v1/notifications/settings': ['api.notifications-settings', '1.1.0']
	};
	const tFamilyEndpoints = Object.keys(FAMILY);
	const [tManifest, tWellKnown, ...tDocs] = await Promise.all([api('/api/v1/capabilities'), api('/.well-known/thingtime-capabilities.json'), ...tFamilyEndpoints.map((endpoint) => api(`${endpoint}-docs`))]);
	const tDrift = tFamilyEndpoints.flatMap((endpoint, index) => {
		const [feature, expected] = FAMILY[endpoint];
		const doc = tDocs[index].body?.docs;
		const advertised = tManifest.body?.features?.[feature];
		const wellKnown = tWellKnown.body?.features?.[feature]?.version;
		const routeKey = `route.${endpoint.replace('/api/', '').replace(/\//g, '.')}`;
		const problems = [];
		if (tDocs[index].status !== 200 || doc?.endpoint !== endpoint) problems.push(`docs ${tDocs[index].status}`);
		if (doc && `api.${doc.id}` !== feature) problems.push(`id api.${doc.id}`);
		if (doc && doc.contractVersion !== advertised) problems.push(`contract ${doc.contractVersion} ≠ /capabilities ${advertised}`);
		if (doc && (doc.featureVersion || '1.0.0') !== wellKnown) problems.push(`feature ${doc.featureVersion} ≠ well-known ${wellKnown}`);
		if (advertised !== expected) problems.push(`/capabilities ${advertised} ≠ expected ${expected}`);
		if (tManifest.body?.features?.[routeKey] !== '1.0.0') problems.push(`${routeKey} missing`);
		return problems.length ? [`${endpoint}: ${problems.join(', ')}`] : [];
	});
	check(
		'docs ↔ manifests, whole family: every endpoint answers its -docs route under api.<id>; /api/v1/capabilities advertises exactly the docs’ contractVersion at the round’s final numbers (subspaces 1.5.0 · get 1.4.0 · join / leave / update 1.3.0 · members 1.4.1 · moderate 1.4.0 · feed 1.3.0 · transfer 1.2.0 · delete 1.1.0 · report / reports 1.0.1 · modlog 1.0.0 · things 1.4.0 · things-feed 1.4.0 · things-comment / things-user 1.3.0 · updown 1.0.0 · notifications-list 1.2.0 · notifications-settings 1.1.0) plus a route.v1.* key each, and /.well-known/thingtime-capabilities.json advertises the docs’ featureVersion',
		tManifest.status === 200 && tWellKnown.status === 200 && tDrift.length === 0,
		`${tManifest.status}/${tWellKnown.status} ${tDrift.join(' | ')}`
	);
	const tReportDocs = tDocs[tFamilyEndpoints.indexOf('/api/v1/subspaces/report')];
	const tJoinDocs = tDocs[tFamilyEndpoints.indexOf('/api/v1/subspaces/join')];
	check(
		'the report and join docs name their own rate keys (subspaces.report 30 / min, subspaces.join 20/min) — the fan-out emits carry tighter windows than the shared write budget',
		/subspaces\.report, 30 \/ min/.test(String(tReportDocs.body?.docs?.detail || '')) && /subspaces\.join, 20\/min/.test(JSON.stringify(tJoinDocs.body?.docs || {})),
		`report=${/subspaces\.report/.test(String(tReportDocs.body?.docs?.detail || ''))} join=${/subspaces\.join/.test(JSON.stringify(tJoinDocs.body?.docs || {}))}`
	);

	// cleanup: TP (T went in the cascade check above)
	const tPrivDeleted = await api('/api/v1/subspaces/delete', { method: 'POST', cookie: owner.cookie, body: { slug: tPrivSlug, confirmSlug: tPrivSlug } });
	const tGone = await Promise.all([tSlug, tPrivSlug].map((slugToDelete) => api(`/api/v1/subspaces/get?slug=${slugToDelete}`)));
	check('(cleanup) the owner deletes TP; both get → 404', tPrivDeleted.status === 200 && tGone.every((result) => result.status === 404), `${tPrivDeleted.status} ${JSON.stringify(tGone.map((result) => result.status))}`);

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
