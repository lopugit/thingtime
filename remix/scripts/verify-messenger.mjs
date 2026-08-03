#!/usr/bin/env node
// Live verification of the Thingtime Messenger family — real API only, no
// mocks, no direct DB access (FUNDAMENTALS §2). Covers communities/invites/
// sections/roles, channels (public/private, join, rename permissions),
// messages (paging, threads, edit/delete, system events), reactions (unicode
// + custom emoji tokens), DMs with request classification (follower/unknown,
// accept/decline/implicit accept), groups (rename-by-anyone, nicknames,
// admin promote/remove, owner-leave succession), read receipts (+ privacy
// parity setting), unread counts, and the generic-things escape hatches
// staying closed.
//
//   node scripts/verify-messenger.mjs [baseUrl]
//
// baseUrl defaults to TT_VERIFY_BASE or this worktree's nitro port.

import { randomBytes } from 'node:crypto';

const BASE = process.argv[2] || process.env.TT_VERIFY_BASE || 'http://127.0.0.1:19332';

let passed = 0;
const failures = [];
const check = (name, condition, detail = '') => {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const api = async (path, { cookie, method = 'GET', body, headers = {} } = {}) => {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers
    },
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

// crypto-random suffix: these are throwaway fixture accounts, but the ids
// should still be unguessable (and CodeQL rightly dislikes Math.random here)
const suffix = `${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;

const register = async (name) => {
  const username = `${name}${suffix}`;
  const response = await fetch(`${BASE}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'Verify1234!pass', email: `${username}@example.com` })
  });
  const setCookie = response.headers.get('set-cookie') || '';
  const match = /tt_auth=[^;]+/.exec(setCookie);
  const body = await response.json();
  if (!response.ok || !match) throw new Error(`registration failed for ${username}: ${JSON.stringify(body)}`);
  return { username, id: body.user.id, cookie: match[0] };
};

// 1×1 transparent gif + png (tiny, valid base64)
const GIF_URI = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';
const PNG_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const run = async () => {
  console.log(`Messenger verification against ${BASE}\n`);

  console.log('A. registration + auth walls');
  const anna = await register('vm-anna-');
  const ben = await register('vm-ben-');
  const cleo = await register('vm-cleo-');
  check('three users registered through the real path', !!(anna.id && ben.id && cleo.id));
  const wall = await api('/api/v1/chats');
  check('GET /chats without auth is 401', wall.status === 401);
  const wallDocs = await api('/api/v1/chats-docs');
  check('docs endpoint is public and shaped', wallDocs.status === 200 && wallDocs.body?.docs?.endpoint === '/api/v1/chats');

  console.log('\nB. follow graph');
  const followRes = await api('/api/v1/users/follow', { cookie: ben.cookie, method: 'POST', body: { username: anna.username, follow: true } });
  check('ben follows anna', followRes.status === 200 && followRes.body?.following === true);
  const followStatus = await api(`/api/v1/users/follow?username=${ben.username}`, { cookie: anna.cookie });
  check('anna sees ben followsYou', followStatus.status === 200 && followStatus.body?.followsYou === true && followStatus.body?.following === false);
  const selfFollow = await api('/api/v1/users/follow', { cookie: ben.cookie, method: 'POST', body: { username: ben.username, follow: true } });
  check('self-follow is refused', selfFollow.status === 400);

  console.log('\nC. communities, invites, sections, roles');
  const community = await api('/api/v1/communities', { cookie: anna.cookie, method: 'POST', body: { name: `Verify Space ${suffix}`, description: 'test space' } });
  check('community created, creator is owner', community.status === 200 && community.body?.community?.myRole === 'owner');
  const communityId = community.body?.community?.id;
  const invite = await api('/api/v1/communities/invites', { cookie: anna.cookie, method: 'POST', body: { communityId, expiresInDays: 7 } });
  check('invite minted by owner', invite.status === 200 && typeof invite.body?.invite?.code === 'string');
  const joinBen = await api('/api/v1/communities/join', { cookie: ben.cookie, method: 'POST', body: { code: invite.body.invite.code } });
  const joinCleo = await api('/api/v1/communities/join', { cookie: cleo.cookie, method: 'POST', body: { code: invite.body.invite.code } });
  check('ben + cleo joined via code', joinBen.status === 200 && joinCleo.status === 200 && joinCleo.body?.community?.myRole === 'member');
  const rejoin = await api('/api/v1/communities/join', { cookie: ben.cookie, method: 'POST', body: { code: invite.body.invite.code } });
  check('re-joining is a friendly no-op', rejoin.status === 200);
  const badCode = await api('/api/v1/communities/join', { cookie: ben.cookie, method: 'POST', body: { code: 'tt-not-a-real-code' } });
  check('bad invite code is 404', badCode.status === 404);
  const memberInvite = await api('/api/v1/communities/invites', { cookie: cleo.cookie, method: 'POST', body: { communityId } });
  check('plain member cannot mint invites', memberInvite.status === 403);
  const promote = await api('/api/v1/communities/members', { cookie: anna.cookie, method: 'POST', body: { communityId, userId: ben.id, role: 'admin' } });
  check('owner promotes ben to community admin', promote.status === 200);
  const ownerDemote = await api('/api/v1/communities/members', { cookie: ben.cookie, method: 'POST', body: { communityId, userId: anna.id, role: 'member' } });
  check('the owner cannot be demoted', ownerDemote.status === 403);
  const section = await api('/api/v1/communities/sections', { cookie: anna.cookie, method: 'POST', body: { communityId, create: { name: 'Fun stuff' } } });
  check('section created', section.status === 200 && section.body?.sections?.length === 1);
  const sectionId = section.body?.sections?.[0]?.id;
  const sectionRename = await api('/api/v1/communities/sections', { cookie: ben.cookie, method: 'POST', body: { communityId, rename: { id: sectionId, name: 'Serious stuff' } } });
  check('admin renames section', sectionRename.status === 200 && sectionRename.body?.sections?.[0]?.name === 'Serious stuff');
  const communityDetail = await api(`/api/v1/communities/get?id=${communityId}`, { cookie: cleo.cookie });
  check('community detail lists 3 members + sections', communityDetail.status === 200 && communityDetail.body?.memberCount === 3 && communityDetail.body?.community?.sections?.length === 1);

  console.log('\nD. channels: create, join, permissions');
  const general = await api('/api/v1/chats', { cookie: anna.cookie, method: 'POST', body: { chatType: 'channel', communityId, name: 'General Fun', sectionId, topic: 'all the things' } });
  check('public channel created with slugged name', general.status === 200 && general.body?.chat?.name === 'general-fun' && general.body?.chat?.sectionId === sectionId);
  const generalId = general.body?.chat?.id;
  const secret = await api('/api/v1/chats', { cookie: anna.cookie, method: 'POST', body: { chatType: 'channel', communityId, name: 'secret', channelVisibility: 'private' } });
  check('private channel created', secret.status === 200 && secret.body?.chat?.channelVisibility === 'private');
  const secretId = secret.body?.chat?.id;
  const cleoJoin = await api('/api/v1/chats/members', { cookie: cleo.cookie, method: 'POST', body: { chatId: generalId, join: true } });
  check('community member joins public channel', cleoJoin.status === 200);
  const cleoJoinSecret = await api('/api/v1/chats/members', { cookie: cleo.cookie, method: 'POST', body: { chatId: secretId, join: true } });
  check('private channel refuses self-join', cleoJoinSecret.status === 403);
  const addToSecret = await api('/api/v1/chats/members', { cookie: anna.cookie, method: 'POST', body: { chatId: secretId, add: [cleo.id] } });
  check('admin adds cleo to private channel', addToSecret.status === 200 && addToSecret.body?.members?.some((m) => m.userId === cleo.id));
  const cleoRename = await api('/api/v1/chats/update', { cookie: cleo.cookie, method: 'POST', body: { id: generalId, name: 'hijacked' } });
  check('plain member cannot rename a channel', cleoRename.status === 403);
  const annaRename = await api('/api/v1/chats/update', { cookie: anna.cookie, method: 'POST', body: { id: generalId, topic: 'now with topic' } });
  check('admin updates the topic', annaRename.status === 200 && annaRename.body?.chat?.topic === 'now with topic');
  const directory = await api(`/api/v1/communities/get?id=${communityId}`, { cookie: ben.cookie });
  const dirChannels = directory.body?.channels || [];
  check('channel directory shows public + hides unjoined private', dirChannels.some((c) => c.id === generalId) && !dirChannels.some((c) => c.id === secretId));

  console.log('\nE. messages: paging, threads, edit/delete, system events');
  const nonMemberRead = await api(`/api/v1/chats/messages?chatId=${generalId}`, { cookie: ben.cookie });
  check('non-member cannot read a channel', nonMemberRead.status === 403);
  const sent = [];
  for (let i = 1; i <= 5; i += 1) {
    const message = await api('/api/v1/chats/messages', { cookie: anna.cookie, method: 'POST', body: { chatId: generalId, text: `message ${i}` } });
    sent.push(message.body?.message);
    if (message.status !== 200) check(`send #${i}`, false, JSON.stringify(message.body));
  }
  check('five messages sent', sent.filter(Boolean).length === 5);
  const emptyMsg = await api('/api/v1/chats/messages', { cookie: anna.cookie, method: 'POST', body: { chatId: generalId, text: '   ' } });
  check('empty message refused', emptyMsg.status === 400);
  const page1 = await api(`/api/v1/chats/messages?chatId=${generalId}&limit=2`, { cookie: cleo.cookie });
  check('page 1 newest-first with cursor', page1.status === 200 && page1.body?.messages?.[0]?.text === 'message 5' && !!page1.body?.nextCursor);
  const page2 = await api(`/api/v1/chats/messages?chatId=${generalId}&limit=2&cursor=${encodeURIComponent(page1.body.nextCursor)}`, { cookie: cleo.cookie });
  check('cursor pages backwards without overlap', page2.status === 200 && page2.body?.messages?.[0]?.text === 'message 3');
  check('system chat-created message exists', page1.body?.messages?.every((m) => m.chatId === generalId) && (await api(`/api/v1/chats/messages?chatId=${generalId}&limit=50`, { cookie: cleo.cookie })).body?.messages?.some((m) => m.systemType === 'chat-created'));
  const rootMessage = sent[0];
  const threadReply = await api('/api/v1/chats/messages', { cookie: cleo.cookie, method: 'POST', body: { chatId: generalId, text: 'thread reply', threadRootId: rootMessage.id } });
  check('thread reply lands', threadReply.status === 200 && threadReply.body?.message?.threadRootId === rootMessage.id);
  const threadPage = await api(`/api/v1/chats/messages?chatId=${generalId}&threadRootId=${rootMessage.id}`, { cookie: anna.cookie });
  check('thread endpoint returns root + replies', threadPage.status === 200 && threadPage.body?.threadRoot?.id === rootMessage.id && threadPage.body?.messages?.length === 1);
  const mainAfterThread = await api(`/api/v1/chats/messages?chatId=${generalId}&limit=50`, { cookie: anna.cookie });
  const mainRoot = mainAfterThread.body?.messages?.find((m) => m.id === rootMessage.id);
  check('thread replies stay out of the main list but count on the root', !mainAfterThread.body?.messages?.some((m) => m.id === threadReply.body?.message?.id) && mainRoot?.threadCount === 1);
  const editByOther = await api('/api/v1/chats/messages/edit', { cookie: cleo.cookie, method: 'POST', body: { id: rootMessage.id, text: 'hax' } });
  check('only the author edits', editByOther.status === 403);
  const editOk = await api('/api/v1/chats/messages/edit', { cookie: anna.cookie, method: 'POST', body: { id: rootMessage.id, text: 'message 1 (better)' } });
  check('author edit stamps editedAt', editOk.status === 200 && !!editOk.body?.message?.editedAt);
  const deleteTarget = sent[1];
  const deleteByAdmin = await api('/api/v1/chats/messages/delete', { cookie: anna.cookie, method: 'POST', body: { id: deleteTarget.id } });
  const afterDelete = await api(`/api/v1/chats/messages?chatId=${generalId}&limit=50`, { cookie: cleo.cookie });
  const deletedRow = afterDelete.body?.messages?.find((m) => m.id === deleteTarget.id);
  check('soft delete keeps a placeholder row with no text', deleteByAdmin.status === 200 && deletedRow?.deleted === true && deletedRow?.text === '');

  console.log('\nF. reactions: unicode + custom emoji');
  const target = sent[2];
  const reactOn = await api('/api/v1/chats/react', { cookie: cleo.cookie, method: 'POST', body: { messageId: target.id, emoji: '🎉' } });
  check('unicode reaction lands', reactOn.status === 200 && reactOn.body?.reactionCounts?.['🎉'] === 1 && reactOn.body?.viewerReactions?.includes('🎉'));
  const reactOff = await api('/api/v1/chats/react', { cookie: cleo.cookie, method: 'POST', body: { messageId: target.id, emoji: '🎉' } });
  check('same token toggles off', reactOff.status === 200 && !reactOff.body?.reactionCounts?.['🎉']);
  const badToken = await api('/api/v1/chats/react', { cookie: cleo.cookie, method: 'POST', body: { messageId: target.id, emoji: 'lol' } });
  check('non-emoji token refused', badToken.status === 400);
  const emojiUpload = await api('/api/v1/emojis', { cookie: anna.cookie, method: 'POST', body: { name: 'party-blob', image: GIF_URI, communityId } });
  check('community emoji uploaded (gif, animated)', emojiUpload.status === 200 && emojiUpload.body?.emoji?.animated === true);
  const emojiId = emojiUpload.body?.emoji?.id;
  const dupe = await api('/api/v1/emojis', { cookie: ben.cookie, method: 'POST', body: { name: 'party-blob', image: PNG_URI, communityId } });
  check('duplicate name in scope is 409', dupe.status === 409);
  const badUri = await api('/api/v1/emojis', { cookie: anna.cookie, method: 'POST', body: { name: 'evil', image: 'data:text/html;base64,PGI+aGk8L2I+', communityId } });
  check('non-image data URI refused', badUri.status === 400);
  const customReact = await api('/api/v1/chats/react', { cookie: cleo.cookie, method: 'POST', body: { messageId: target.id, emoji: `custom:${emojiId}` } });
  check('custom emoji reaction lands + resolves image', customReact.status === 200 && customReact.body?.reactionCounts?.[`custom:${emojiId}`] === 1 && customReact.body?.customEmojis?.[emojiId]?.name === 'party-blob');
  const personalEmoji = await api('/api/v1/emojis', { cookie: ben.cookie, method: 'POST', body: { name: 'bens-own', image: PNG_URI } });
  check('personal emoji uploaded', personalEmoji.status === 200 && personalEmoji.body?.emoji?.scope === 'personal');
  const foreignEmoji = await api('/api/v1/chats/react', { cookie: cleo.cookie, method: 'POST', body: { messageId: target.id, emoji: `custom:${personalEmoji.body.emoji.id}` } });
  check("someone else's personal emoji is refused here", foreignEmoji.status === 403);
  const listEmojis = await api(`/api/v1/emojis?chatId=${generalId}`, { cookie: cleo.cookie });
  check('emoji list for the chat carries the community set', listEmojis.status === 200 && listEmojis.body?.emojis?.some((e) => e.id === emojiId));
  const emojiDeleteByMember = await api('/api/v1/emojis/delete', { cookie: cleo.cookie, method: 'POST', body: { id: emojiId } });
  check('non-uploader member cannot delete the emoji', emojiDeleteByMember.status === 403);

  console.log('\nG. DMs + message requests');
  const dmBenAnna = await api('/api/v1/chats', { cookie: ben.cookie, method: 'POST', body: { chatType: 'dm', memberIds: [anna.id] } });
  check('ben (follower of anna) opens a DM → pending request for anna', dmBenAnna.status === 200);
  const benAnnaChatId = dmBenAnna.body?.chat?.id;
  await api('/api/v1/chats/messages', { cookie: ben.cookie, method: 'POST', body: { chatId: benAnnaChatId, text: 'hello anna!' } });
  const annaRequests = await api('/api/v1/chats/requests', { cookie: anna.cookie });
  check('request lands in the follower bucket', annaRequests.status === 200 && annaRequests.body?.requests?.follower?.some((c) => c.id === benAnnaChatId));
  const annaListDuringPending = await api('/api/v1/chats', { cookie: anna.cookie });
  check('pending chat stays out of the main list', !annaListDuringPending.body?.chats?.some((c) => c.id === benAnnaChatId));
  const annaPeek = await api(`/api/v1/chats/messages?chatId=${benAnnaChatId}`, { cookie: anna.cookie });
  check('recipient can read the request conversation', annaPeek.status === 200 && annaPeek.body?.messages?.some((m) => m.text === 'hello anna!'));
  const annaReply = await api('/api/v1/chats/messages', { cookie: anna.cookie, method: 'POST', body: { chatId: benAnnaChatId, text: 'hey ben 👋' } });
  const annaRequestsAfter = await api('/api/v1/chats/requests', { cookie: anna.cookie });
  check('replying accepts the request implicitly', annaReply.status === 200 && !annaRequestsAfter.body?.requests?.follower?.some((c) => c.id === benAnnaChatId));
  const dmDupe = await api('/api/v1/chats', { cookie: anna.cookie, method: 'POST', body: { chatType: 'dm', memberIds: [ben.id] } });
  check('DM is deduped per pair', dmDupe.status === 200 && dmDupe.body?.existing === true && dmDupe.body?.chat?.id === benAnnaChatId);
  const dmCleoAnna = await api('/api/v1/chats', { cookie: cleo.cookie, method: 'POST', body: { chatType: 'dm', memberIds: [anna.id] } });
  const cleoAnnaChatId = dmCleoAnna.body?.chat?.id;
  await api('/api/v1/chats/messages', { cookie: cleo.cookie, method: 'POST', body: { chatId: cleoAnnaChatId, text: 'mystery message' } });
  const annaRequests2 = await api('/api/v1/chats/requests', { cookie: anna.cookie });
  check('no-connection DM lands in the unknown bucket', annaRequests2.body?.requests?.unknown?.some((c) => c.id === cleoAnnaChatId));
  const decline = await api('/api/v1/chats/requests', { cookie: anna.cookie, method: 'POST', body: { chatId: cleoAnnaChatId, accept: false } });
  const annaListAfterDecline = await api('/api/v1/chats', { cookie: anna.cookie });
  check('declined request disappears for the recipient', decline.status === 200 && decline.body?.state === 'declined' && !annaListAfterDecline.body?.chats?.some((c) => c.id === cleoAnnaChatId));
  const annaReadDeclined = await api(`/api/v1/chats/messages?chatId=${cleoAnnaChatId}`, { cookie: anna.cookie });
  check('declined chat is unreadable for the decliner', annaReadDeclined.status === 403);
  const dmAnnaBen2 = await api('/api/v1/chats', { cookie: anna.cookie, method: 'POST', body: { chatType: 'dm', memberIds: [ben.id] } });
  check('DM to someone who follows you needs no request', dmAnnaBen2.body?.chat?.myMember?.state === 'active');

  console.log('\nH. groups: rename, nicknames, admins, succession');
  // groups obey the request wall: members who follow the creator land active
  await api('/api/v1/users/follow', { cookie: anna.cookie, method: 'POST', body: { userId: ben.id, follow: true } });
  await api('/api/v1/users/follow', { cookie: cleo.cookie, method: 'POST', body: { userId: ben.id, follow: true } });
  const group = await api('/api/v1/chats', { cookie: ben.cookie, method: 'POST', body: { chatType: 'group', memberIds: [anna.id, cleo.id], name: 'The Test Trio' } });
  check('group created with follower members active', group.status === 200 && group.body?.chat?.memberCount === 3);
  const groupId = group.body?.chat?.id;
  const renameByMember = await api('/api/v1/chats/update', { cookie: cleo.cookie, method: 'POST', body: { id: groupId, name: 'Trio Deluxe' } });
  check('any member renames a group (Messenger style)', renameByMember.status === 200 && renameByMember.body?.chat?.name === 'Trio Deluxe');
  const nickname = await api('/api/v1/chats/members', { cookie: anna.cookie, method: 'POST', body: { chatId: groupId, nickname: { userId: cleo.id, nickname: 'Captain Cleo' } } });
  check('anyone can set a nickname for anyone', nickname.status === 200 && nickname.body?.members?.find((m) => m.userId === cleo.id)?.nickname === 'Captain Cleo');
  const promoteAnna = await api('/api/v1/chats/members', { cookie: ben.cookie, method: 'POST', body: { chatId: groupId, role: { userId: anna.id, role: 'admin' } } });
  check('owner promotes anna to group admin', promoteAnna.status === 200);
  const removeByMember = await api('/api/v1/chats/members', { cookie: cleo.cookie, method: 'POST', body: { chatId: groupId, remove: anna.id } });
  check('plain member cannot remove people', removeByMember.status === 403);
  const removeCleo = await api('/api/v1/chats/members', { cookie: anna.cookie, method: 'POST', body: { chatId: groupId, remove: cleo.id } });
  check('admin removes cleo', removeCleo.status === 200 && !removeCleo.body?.members?.some((m) => m.userId === cleo.id));
  const readd = await api('/api/v1/chats/members', { cookie: ben.cookie, method: 'POST', body: { chatId: groupId, add: [cleo.id] } });
  check('cleo re-added revives the membership', readd.status === 200 && readd.body?.members?.some((m) => m.userId === cleo.id));
  const benLeaves = await api('/api/v1/chats/leave', { cookie: ben.cookie, method: 'POST', body: { chatId: groupId } });
  const groupAfterLeave = await api(`/api/v1/chats/get?id=${groupId}`, { cookie: anna.cookie });
  const annaRow = groupAfterLeave.body?.members?.find((m) => m.userId === anna.id);
  check('owner leaving promotes the earliest admin', benLeaves.status === 200 && annaRow?.role === 'owner');
  const dmLeave = await api('/api/v1/chats/leave', { cookie: anna.cookie, method: 'POST', body: { chatId: benAnnaChatId } });
  check('DMs cannot be left', dmLeave.status === 400);

  console.log('\nI. read receipts, unread counts, privacy parity');
  const groupMsgs = [];
  for (let i = 1; i <= 3; i += 1) {
    const m = await api('/api/v1/chats/messages', { cookie: anna.cookie, method: 'POST', body: { chatId: groupId, text: `receipt test ${i}` } });
    groupMsgs.push(m.body?.message);
  }
  const cleoList = await api('/api/v1/chats', { cookie: cleo.cookie });
  const cleoGroupEntry = cleoList.body?.chats?.find((c) => c.id === groupId);
  check('unread count reflects the three fresh messages', cleoGroupEntry?.unreadCount >= 3);
  check('list totals include the group', cleoList.body?.totalUnread >= 3 && typeof cleoList.body?.serverTime === 'string');
  const markRead = await api('/api/v1/chats/read', { cookie: cleo.cookie, method: 'POST', body: { chatId: groupId, messageId: groupMsgs[2].id } });
  check('mark-read advances the receipt', markRead.status === 200 && markRead.body?.lastReadMessageId === groupMsgs[2].id);
  const rewind = await api('/api/v1/chats/read', { cookie: cleo.cookie, method: 'POST', body: { chatId: groupId, messageId: groupMsgs[0].id } });
  check('receipts are forward-only', rewind.status === 200 && rewind.body?.lastReadMessageId === groupMsgs[2].id);
  const cleoListAfter = await api('/api/v1/chats', { cookie: cleo.cookie });
  check('unread clears after reading', cleoListAfter.body?.chats?.find((c) => c.id === groupId)?.unreadCount === 0);
  const annaSees = await api(`/api/v1/chats/get?id=${groupId}`, { cookie: anna.cookie });
  check('sender sees cleo’s read receipt', !!annaSees.body?.members?.find((m) => m.userId === cleo.id)?.lastReadAt);
  const settingsGet = await api('/api/v1/chats/settings', { cookie: cleo.cookie });
  check('read receipts default on', settingsGet.status === 200 && settingsGet.body?.readReceipts === true);
  const settingsOff = await api('/api/v1/chats/settings', { cookie: cleo.cookie, method: 'POST', body: { readReceipts: false } });
  check('setting flips off', settingsOff.status === 200 && settingsOff.body?.readReceipts === false);
  const annaSeesHidden = await api(`/api/v1/chats/get?id=${groupId}`, { cookie: anna.cookie });
  check('receipts hide once cleo opts out', annaSeesHidden.body?.members?.find((m) => m.userId === cleo.id)?.lastReadAt === null);
  const cleoSeesNone = await api(`/api/v1/chats/get?id=${groupId}`, { cookie: cleo.cookie });
  const annaRowForCleo = cleoSeesNone.body?.members?.find((m) => m.userId === anna.id);
  check('parity: cleo stops seeing others’ receipts too', annaRowForCleo?.lastReadAt === null);
  const cleoUnreadStill = await api('/api/v1/chats', { cookie: cleo.cookie });
  check('unread counting is unaffected by the privacy setting', cleoUnreadStill.body?.chats?.find((c) => c.id === groupId)?.unreadCount === 0);
  await api('/api/v1/chats/settings', { cookie: cleo.cookie, method: 'POST', body: { readReceipts: true } });
  const badSetting = await api('/api/v1/chats/settings', { cookie: cleo.cookie, method: 'POST', body: { readReceipts: 'yes' } });
  check('non-boolean setting refused', badSetting.status === 400);

  console.log('\nJ. mute + updates poll payload');
  const mute = await api('/api/v1/chats/members', { cookie: cleo.cookie, method: 'POST', body: { chatId: groupId, mute: true } });
  await api('/api/v1/chats/messages', { cookie: anna.cookie, method: 'POST', body: { chatId: groupId, text: 'muted ping' } });
  const updates = await api('/api/v1/chats/updates', { cookie: cleo.cookie });
  const mutedEntry = updates.body?.chats?.find((c) => c.id === groupId);
  check('muted chat keeps its unread but leaves totalUnread', mute.status === 200 && mutedEntry?.unreadCount >= 1 && mutedEntry?.myMember?.muted === true && !updates.body?.totalUnread);

  console.log('\nL. hardening regressions (review round)');
  const dora = await register('vm-dora-');
  // channel adds cannot outrun the community invite gate
  const outsiderAdd = await api('/api/v1/chats/members', { cookie: anna.cookie, method: 'POST', body: { chatId: generalId, add: [dora.id] } });
  check('adding a non-community member to a channel is refused', outsiderAdd.status === 403);
  const outsiderCreate = await api('/api/v1/chats', { cookie: anna.cookie, method: 'POST', body: { chatType: 'channel', communityId, name: 'leaky', memberIds: [dora.id] } });
  check('creating a channel with outsider invitees is refused', outsiderCreate.status === 403);
  // generic DELETE cannot reach messenger things
  const genericDelete = await api(`/api/v1/things?id=${generalId}`, { cookie: anna.cookie, method: 'DELETE' });
  const channelStillThere = await api(`/api/v1/chats/get?id=${generalId}`, { cookie: anna.cookie });
  check('generic DELETE cannot destroy a chat', genericDelete.status === 404 && channelStillThere.status === 200);
  const genericDeleteMsg = await api(`/api/v1/things?id=${sent[3].id}`, { cookie: anna.cookie, method: 'DELETE' });
  check('generic DELETE cannot reach chat messages', genericDeleteMsg.status === 404);
  // omitted limit falls through to the default page size (Number(null) trap)
  const noLimitPage = await api(`/api/v1/chats/messages?chatId=${generalId}`, { cookie: anna.cookie });
  check('omitted limit returns a full default page', noLimitPage.status === 200 && noLimitPage.body?.messages?.length >= 5);
  // unread floor = join time: fresh members do not inherit history as unread
  const doraJoins = await api('/api/v1/communities/join', { cookie: dora.cookie, method: 'POST', body: { code: invite.body.invite.code } });
  await api('/api/v1/chats/members', { cookie: dora.cookie, method: 'POST', body: { chatId: generalId, join: true } });
  const doraList = await api('/api/v1/chats', { cookie: dora.cookie });
  const doraGeneral = doraList.body?.chats?.find((c) => c.id === generalId);
  check('pre-join history is not unread for a fresh member', doraJoins.status === 200 && doraGeneral?.unreadCount === 0);
  // denormalized preview follows deletes
  const previewProbe = await api('/api/v1/chats/messages', { cookie: anna.cookie, method: 'POST', body: { chatId: generalId, text: 'preview me then delete me' } });
  await api('/api/v1/chats/messages/delete', { cookie: anna.cookie, method: 'POST', body: { id: previewProbe.body.message.id } });
  const listAfterPreviewDelete = await api('/api/v1/chats', { cookie: anna.cookie });
  const generalEntry = listAfterPreviewDelete.body?.chats?.find((c) => c.id === generalId);
  check('sidebar preview follows a deleted newest message', generalEntry?.lastMessage?.deleted === true && generalEntry?.lastMessage?.text === '');
  // pending members leave no receipts and cannot mark read
  const eve = await register('vm-eve-');
  const dmAnnaEve = await api('/api/v1/chats', { cookie: anna.cookie, method: 'POST', body: { chatType: 'dm', memberIds: [eve.id] } });
  const evePending = await api('/api/v1/chats/messages', { cookie: anna.cookie, method: 'POST', body: { chatId: dmAnnaEve.body.chat.id, text: 'request ping' } });
  const eveRead = await api('/api/v1/chats/read', { cookie: eve.cookie, method: 'POST', body: { chatId: dmAnnaEve.body.chat.id, messageId: evePending.body.message.id } });
  check('pending recipients cannot leave read receipts', eveRead.status === 403);
  // group invites from strangers land as requests
  const strangerGroup = await api('/api/v1/chats', { cookie: anna.cookie, method: 'POST', body: { chatType: 'group', memberIds: [eve.id], name: 'Surprise Party' } });
  const eveRequests = await api('/api/v1/chats/requests', { cookie: eve.cookie });
  check('group invite from a stranger queues as a request', strangerGroup.status === 200 && eveRequests.body?.requests?.unknown?.some((c) => c.id === strangerGroup.body.chat.id));
  // DM member verbs stay sealed
  const dmRemove = await api('/api/v1/chats/members', { cookie: anna.cookie, method: 'POST', body: { chatId: benAnnaChatId, remove: ben.id } });
  const dmRole = await api('/api/v1/chats/members', { cookie: anna.cookie, method: 'POST', body: { chatId: benAnnaChatId, role: { userId: ben.id, role: 'admin' } } });
  check('DM members cannot be removed or promoted', dmRemove.status === 400 && dmRole.status === 400);
  // community leave revokes channel access
  const cleoLeavesCommunity = await api('/api/v1/communities/members', { cookie: cleo.cookie, method: 'POST', body: { communityId, leave: true } });
  const cleoReadAfterLeave = await api(`/api/v1/chats/messages?chatId=${generalId}`, { cookie: cleo.cookie });
  check('leaving the community revokes channel membership', cleoLeavesCommunity.status === 200 && cleoReadAfterLeave.status === 403);
  // ex-owner rejoining a chat comes back a plain member
  const benRejoin = await api('/api/v1/chats/members', { cookie: anna.cookie, method: 'POST', body: { chatId: groupId, add: [ben.id] } });
  const benRow = benRejoin.body?.members?.find((m) => m.userId === ben.id);
  check('an ex-owner rejoins as a plain member', benRejoin.status === 200 && benRow?.role === 'member' && benRow?.state === 'active');
  // emoji images are fetched by id, not shipped in message payloads
  const pageWithCustom = await api(`/api/v1/chats/messages?chatId=${generalId}&limit=50`, { cookie: anna.cookie });
  const shippedEmoji = pageWithCustom.body?.customEmojis?.[emojiId];
  check('message payloads ship custom emojis without image bytes', !!shippedEmoji && shippedEmoji.image === '' && shippedEmoji.name === 'party-blob');
  const byIds = await api(`/api/v1/emojis?ids=${emojiId}`, { cookie: anna.cookie });
  check('emoji images resolve by id', byIds.status === 200 && byIds.body?.emojis?.[0]?.image?.startsWith('data:image/gif'));

  console.log('\nK. generic things paths stay closed');
  const genericCreate = await api('/api/v1/things', { cookie: cleo.cookie, method: 'POST', body: { thingtime: ['chat'], crystal: { chatType: 'dm', name: 'forged' } } });
  check('generic create of messenger kinds is 403', genericCreate.status === 403);
  const genericMember = await api('/api/v1/things', { cookie: cleo.cookie, method: 'POST', body: { thingtime: ['chat-member'], crystal: { memberKey: `${secretId}:${cleo.id}`, role: 'owner', state: 'active' } } });
  check('membership cannot be forged through /things', genericMember.status === 403);
  const genericPeek = await api(`/api/v1/things?id=${generalId}`, { cookie: ben.cookie });
  check('chats are invisible through generic reads', genericPeek.status === 404);
  const genericMsgPeek = await api(`/api/v1/things?id=${sent[3].id}`, { cookie: ben.cookie });
  check('messages are invisible through generic reads', genericMsgPeek.status === 404);
  const genericReact = await api('/api/v1/things/react', { cookie: ben.cookie, method: 'POST', body: { id: sent[3].id, emoji: '👍' } });
  check('generic react cannot reach chat messages of others', genericReact.status === 404);
  const customOnPost = await api('/api/v1/things/react', { cookie: ben.cookie, method: 'POST', body: { id: sent[3].id, emoji: `custom:${emojiId}` } });
  check('custom tokens never pass the post reaction validator', customOnPost.status === 400 || customOnPost.status === 404);

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('Failed:');
    for (const name of failures) console.log(`  - ${name}`);
  }
  process.exit(failures.length ? 1 : 0);
};

run().catch((err) => {
  console.error('verification crashed:', err);
  process.exit(1);
});
