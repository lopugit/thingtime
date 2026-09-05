import React from 'react';
import { Box, Button, Flex, Input, Select, Switch, Tab, TabList, TabPanel, TabPanels, Tabs, Text, Textarea } from '@chakra-ui/react';
import { Link, useParams, useSearchParams } from 'react-router';

import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useLopu } from '~/components/Lopu/useLopu';
import { PostList } from '~/components/Feed/PostList';
import type { PostChange, PublicPost } from '~/components/Feed/feedTypes';
import { SubspaceIcon } from './SubspaceCard';
import {
	ACCESS_META,
	type PublicModlogEntry,
	type PublicSubspace,
	type PublicSubspaceMember,
	type SubspaceAccess,
	type SubspaceFeedResponse,
	type SubspaceFlair,
	type SubspaceRule
} from './subspaceTypes';

// /s/:slug/mod — moderator tools: the queue (newest posts incl. removed ones,
// every card carrying its mod menu), members (search + actions), the ban
// list, settings (identity/branding/access), rules, flairs, and the mod log.
// Every mutation goes through /api/v1/subspaces/* and re-projects in place.

const INK = 'var(--tt-ink, #16161a)';
const TEXT = 'var(--tt-text, #5a5a66)';
const MUTED = 'var(--tt-muted, #9a9aa6)';
const BORDER = '1px solid var(--tt-border, #ececef)';
const RADIUS_MD = 'var(--tt-radius-md, 12px)';
const RADIUS_LG = 'var(--tt-radius-lg, 16px)';

const TABS = ['queue', 'members', 'banned', 'settings', 'rules', 'flairs', 'log'] as const;
type ModTab = (typeof TABS)[number];

const Label = ({ children }: { children: React.ReactNode }) => (
	<Text fontFamily="mono" fontSize="10px" fontWeight={600} letterSpacing="0.08em" textTransform="uppercase" color={MUTED}>
		{children}
	</Text>
);

const Card = ({ children }: { children: React.ReactNode }) => (
	<Flex flexDirection="column" rowGap={3} background="var(--tt-card, #ffffff)" border={BORDER} borderRadius={RADIUS_LG} padding={4}>
		{children}
	</Flex>
);

const memberName = (member: PublicSubspaceMember) => member.profile?.displayName || member.profile?.username || member.userId;

// ── Queue ──────────────────────────────────────────────────────────────────
const QueuePanel = ({ slug }: { slug: string }) => {
	const api = useApi();
	const lopu = useLopu();
	const [posts, setPosts] = React.useState<PublicPost[]>([]);
	const [nextCursor, setNextCursor] = React.useState<string | null>(null);
	const [loading, setLoading] = React.useState(true);
	const [onlyRemoved, setOnlyRemoved] = React.useState(false);
	const load = React.useCallback(
		async (cursor?: string | null) => {
			setLoading(true);
			try {
				const resp = (await api.v1.subspaces.feed({ slug, sort: 'new', includeRemoved: true, cursor: cursor || undefined, limit: 30 })) as SubspaceFeedResponse;
				setPosts((prev) => (cursor ? [...prev, ...resp.posts.filter((post) => !prev.some((existing) => existing.id === post.id))] : resp.posts));
				setNextCursor(resp.nextCursor ?? null);
			} catch (err: any) {
				lopu({ title: err?.error || 'Could not load the queue 😞', status: 'error' });
			} finally {
				setLoading(false);
			}
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[slug]
	);
	React.useEffect(() => {
		load();
	}, [load]);
	const handlePostChanged = React.useCallback((id: string, next: PostChange) => {
		setPosts((prev) =>
			prev.flatMap((post) => {
				if (post.id !== id) return [post];
				const resolved = typeof next === 'function' ? next(post) : next;
				return resolved ? [resolved] : [];
			})
		);
	}, []);
	const shown = onlyRemoved ? posts.filter((post) => post.subspaceMod?.removed) : posts;
	return (
		<Flex flexDirection="column" rowGap={3}>
			<Flex alignItems="center" columnGap={2}>
				<Text fontSize="sm" color={TEXT}>
					Newest first, removed posts included — use each card’s ··· menu to remove, approve, pin, lock or flair.
				</Text>
				<Flex as="label" marginLeft="auto" alignItems="center" columnGap={2} fontSize="xs" color={MUTED} cursor="pointer" flexShrink={0}>
					Removed only
					<Switch size="sm" isChecked={onlyRemoved} onChange={(event) => setOnlyRemoved(event.target.checked)} />
				</Flex>
			</Flex>
			<PostList posts={shown} loading={loading} hasMore={!!nextCursor} onLoadMore={() => nextCursor && load(nextCursor)} onPostChanged={handlePostChanged} emptyLabel="Queue is clear ✨" />
		</Flex>
	);
};

// ── Members / banned ───────────────────────────────────────────────────────
const MemberRow = (props: { member: PublicSubspaceMember; isOwner: boolean; onAction: (member: PublicSubspaceMember, action: string, extra?: Record<string, unknown>) => void }) => {
	const { member, isOwner, onAction } = props;
	return (
		<Flex alignItems="center" columnGap={2} rowGap={1} flexWrap="wrap" paddingY={2} borderBottom={BORDER} _last={{ borderBottom: 'none' }} data-member={member.userId}>
			<Box minWidth={0} flex="1">
				<Text as={Link} to={member.profile?.username ? `/profile/${member.profile.username}` : '#'} fontSize="sm" fontWeight={600} color={INK} _hover={{ textDecoration: 'underline' }}>
					{memberName(member)}
				</Text>
				<Text fontSize="xs" color={MUTED}>
					{member.role === 'owner' ? '👑 owner' : member.role === 'moderator' ? '🎩 moderator' : 'member'}
					{member.approved && member.role === 'member' ? ' · ✅ approved poster' : ''}
					{member.banned ? ` · 🚫 banned${member.banUntil ? ` until ${new Date(member.banUntil).toLocaleDateString()}` : ''}${member.banReason ? ` (${member.banReason})` : ''}` : ''}
					{' · joined '}
					{new Date(member.joinedAt).toLocaleDateString()}
				</Text>
			</Box>
			{member.role !== 'owner' && (
				<Flex columnGap={1} flexWrap="wrap">
					{member.banned ? (
						<Button size="xs" borderRadius="999px" onClick={() => onAction(member, 'unban')}>
							Unban
						</Button>
					) : (
						<>
							<Button size="xs" borderRadius="999px" variant="outline" onClick={() => onAction(member, member.approved ? 'unapprove' : 'approve')}>
								{member.approved ? 'Unapprove' : 'Approve poster'}
							</Button>
							{isOwner && (
								<Button size="xs" borderRadius="999px" variant="outline" onClick={() => onAction(member, 'role', { role: member.role === 'moderator' ? 'member' : 'moderator' })}>
									{member.role === 'moderator' ? 'Demote' : 'Make mod'}
								</Button>
							)}
							{(isOwner || member.role !== 'moderator') && (
								<>
									<Button size="xs" borderRadius="999px" variant="outline" onClick={() => onAction(member, 'remove')}>
										Kick
									</Button>
									<Button
										size="xs"
										borderRadius="999px"
										colorScheme="red"
										variant="outline"
										onClick={() => {
											const reason = window.prompt('Ban reason (shown to the user)') || undefined;
											const days = window.prompt('Ban length in days (blank = permanent)') || '';
											onAction(member, 'ban', { reason, banDays: days ? Number(days) : undefined });
										}}
									>
										Ban
									</Button>
								</>
							)}
						</>
					)}
				</Flex>
			)}
		</Flex>
	);
};

const MembersPanel = ({ slug, banned, isOwner }: { slug: string; banned: boolean; isOwner: boolean }) => {
	const api = useApi();
	const lopu = useLopu();
	const [members, setMembers] = React.useState<PublicSubspaceMember[]>([]);
	const [nextCursor, setNextCursor] = React.useState<string | null>(null);
	const [loading, setLoading] = React.useState(true);
	const [username, setUsername] = React.useState('');
	const [action, setAction] = React.useState('add');
	const [busy, setBusy] = React.useState(false);

	const load = React.useCallback(
		async (cursor?: string | null) => {
			setLoading(true);
			try {
				const resp: any = await api.v1.subspaces.members({ slug, banned, cursor: cursor || undefined, limit: 50 });
				setMembers((prev) => (cursor ? [...prev, ...resp.members] : resp.members));
				setNextCursor(resp.nextCursor ?? null);
			} catch (err: any) {
				lopu({ title: err?.error || 'Could not load members 😞', status: 'error' });
			} finally {
				setLoading(false);
			}
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[slug, banned]
	);
	React.useEffect(() => {
		load();
	}, [load]);

	const mutate = async (target: { userId?: string; username?: string }, act: string, extra: Record<string, unknown> = {}) => {
		if (busy) return;
		setBusy(true);
		try {
			const resp: any = await api.v1.subspaces.mutateMember({ slug, ...target, action: act, ...extra });
			const member: PublicSubspaceMember = resp.member;
			setMembers((prev) => {
				const exists = prev.some((entry) => entry.userId === member.userId);
				const next = exists ? prev.map((entry) => (entry.userId === member.userId ? member : entry)) : [member, ...prev];
				// a row that no longer belongs in this list (unbanned in the ban
				// list, kicked/banned in the member list) drops out
				return next.filter((entry) => (banned ? entry.banned : !entry.banned && !entry.left));
			});
			lopu({ title: `${act} → ${memberName(member)} ✓`, status: 'success', duration: 4000 });
		} catch (err: any) {
			lopu({ title: err?.error || 'Member action failed 😞', status: 'error' });
		} finally {
			setBusy(false);
		}
	};

	return (
		<Flex flexDirection="column" rowGap={3}>
			<Card>
				<Label>{banned ? 'Ban someone' : 'Act on a username'}</Label>
				<Flex columnGap={2} rowGap={2} flexWrap="wrap" alignItems="center">
					<Input size="sm" width="200px" borderRadius={RADIUS_MD} placeholder="username" value={username} onChange={(event) => setUsername(event.target.value.trim())} />
					{!banned && (
						<Select size="sm" width="170px" borderRadius={RADIUS_MD} value={action} onChange={(event) => setAction(event.target.value)}>
							<option value="add">Add member</option>
							<option value="approve">Approve poster</option>
							<option value="unapprove">Unapprove poster</option>
							<option value="remove">Kick</option>
							{isOwner && <option value="role:moderator">Make moderator</option>}
							{isOwner && <option value="role:member">Demote to member</option>}
						</Select>
					)}
					<Button
						size="sm"
						borderRadius={RADIUS_MD}
						isDisabled={!username}
						isLoading={busy}
						onClick={() => {
							if (banned) {
								const reason = window.prompt('Ban reason (shown to the user)') || undefined;
								const days = window.prompt('Ban length in days (blank = permanent)') || '';
								mutate({ username }, 'ban', { reason, banDays: days ? Number(days) : undefined });
							} else if (action.startsWith('role:')) mutate({ username }, 'role', { role: action.split(':')[1] });
							else mutate({ username }, action);
						}}
					>
						{banned ? 'Ban 🚫' : 'Apply'}
					</Button>
				</Flex>
			</Card>
			<Card>
				<Label>{banned ? 'Banned' : 'Members'}</Label>
				{loading && members.length === 0 && (
					<Text fontSize="sm" color={MUTED}>
						Loading…
					</Text>
				)}
				{!loading && members.length === 0 && (
					<Text fontSize="sm" color={MUTED}>
						{banned ? 'Nobody is banned 🕊️' : 'No members yet'}
					</Text>
				)}
				{members.map((member) => (
					<MemberRow key={member.userId} member={member} isOwner={isOwner} onAction={(target, act, extra) => mutate({ userId: target.userId }, act, extra)} />
				))}
				{nextCursor && (
					<Button size="sm" variant="outline" borderRadius={RADIUS_MD} alignSelf="center" onClick={() => load(nextCursor)}>
						Load more ⬇️
					</Button>
				)}
			</Card>
		</Flex>
	);
};

// ── Settings ───────────────────────────────────────────────────────────────
const SettingsPanel = ({ subspace, onSaved }: { subspace: PublicSubspace; onSaved: (next: PublicSubspace) => void }) => {
	const api = useApi();
	const lopu = useLopu();
	const isOwner = subspace.viewer.role === 'owner';
	const [name, setName] = React.useState(subspace.name);
	const [description, setDescription] = React.useState(subspace.description || '');
	const [access, setAccess] = React.useState<SubspaceAccess>(subspace.access);
	const [nsfw, setNsfw] = React.useState(subspace.nsfw);
	const [icon, setIcon] = React.useState(subspace.branding.icon || '');
	const [iconUrl, setIconUrl] = React.useState(subspace.branding.iconUrl || '');
	const [bannerUrl, setBannerUrl] = React.useState(subspace.branding.bannerUrl || '');
	const [accent, setAccent] = React.useState(subspace.branding.accent || '');
	const [saving, setSaving] = React.useState(false);
	const save = async () => {
		setSaving(true);
		try {
			const resp: any = await api.v1.subspaces.update({
				id: subspace.id,
				name,
				description,
				branding: { icon: icon || null, iconUrl: iconUrl || null, bannerUrl: bannerUrl || null, accent: accent || null },
				...(isOwner ? { access, nsfw } : {})
			});
			onSaved(resp.subspace);
			lopu({ title: 'Subspace settings saved ✨', status: 'success', duration: 4000 });
		} catch (err: any) {
			lopu({ title: err?.error || 'Could not save settings 😞', status: 'error' });
		} finally {
			setSaving(false);
		}
	};
	return (
		<Card>
			<Flex columnGap={3} alignItems="center">
				<SubspaceIcon subspace={{ ...subspace, branding: { ...subspace.branding, icon, iconUrl, accent } }} size="56px" fontSize="2xl" />
				<Box>
					<Label>Identity</Label>
					<Text fontSize="xs" color={MUTED}>
						/s/{subspace.slug} · slug is permanent
					</Text>
				</Box>
			</Flex>
			<Box>
				<Label>Name</Label>
				<Input size="sm" borderRadius={RADIUS_MD} value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
			</Box>
			<Box>
				<Label>Description</Label>
				<Textarea size="sm" borderRadius={RADIUS_MD} rows={3} value={description} maxLength={1000} onChange={(event) => setDescription(event.target.value)} />
			</Box>
			<Flex columnGap={3} rowGap={3} flexWrap="wrap">
				<Box width="80px">
					<Label>Icon emoji</Label>
					<Input size="sm" borderRadius={RADIUS_MD} textAlign="center" value={icon} maxLength={8} onChange={(event) => setIcon(event.target.value)} />
				</Box>
				<Box width="140px">
					<Label>Accent</Label>
					<Input size="sm" borderRadius={RADIUS_MD} fontFamily="mono" placeholder="#7c5cff" value={accent} maxLength={32} onChange={(event) => setAccent(event.target.value)} />
				</Box>
				<Box flex="1" minWidth="200px">
					<Label>Icon image URL</Label>
					<Input size="sm" borderRadius={RADIUS_MD} placeholder="https://…" value={iconUrl} onChange={(event) => setIconUrl(event.target.value)} />
				</Box>
				<Box flex="1" minWidth="200px">
					<Label>Banner image URL</Label>
					<Input size="sm" borderRadius={RADIUS_MD} placeholder="https://…" value={bannerUrl} onChange={(event) => setBannerUrl(event.target.value)} />
				</Box>
			</Flex>
			<Flex columnGap={3} rowGap={3} flexWrap="wrap" alignItems="flex-end">
				<Box minWidth="220px">
					<Label>Who can post {isOwner ? '' : '(owner only)'}</Label>
					<Select size="sm" borderRadius={RADIUS_MD} value={access} isDisabled={!isOwner} onChange={(event) => setAccess(event.target.value as SubspaceAccess)}>
						{(Object.keys(ACCESS_META) as SubspaceAccess[]).map((key) => (
							<option key={key} value={key}>
								{ACCESS_META[key].emoji} {ACCESS_META[key].label} — {ACCESS_META[key].hint}
							</option>
						))}
					</Select>
				</Box>
				<Flex as="label" alignItems="center" columnGap={2} fontSize="sm" color={INK} cursor={isOwner ? 'pointer' : 'default'} paddingBottom={1}>
					<Switch isChecked={nsfw} isDisabled={!isOwner} onChange={(event) => setNsfw(event.target.checked)} />
					18+ subspace 🔞
				</Flex>
				<Button marginLeft="auto" size="sm" borderRadius={RADIUS_MD} isLoading={saving} onClick={save} data-testid="mod-save-settings">
					Save ✨
				</Button>
			</Flex>
		</Card>
	);
};

// ── Rules ──────────────────────────────────────────────────────────────────
const RulesPanel = ({ subspace, onSaved }: { subspace: PublicSubspace; onSaved: (next: PublicSubspace) => void }) => {
	const api = useApi();
	const lopu = useLopu();
	const [rules, setRules] = React.useState<SubspaceRule[]>(subspace.rules);
	const [saving, setSaving] = React.useState(false);
	const update = (index: number, patch: Partial<SubspaceRule>) => setRules((prev) => prev.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
	const move = (index: number, delta: number) =>
		setRules((prev) => {
			const next = [...prev];
			const target = index + delta;
			if (target < 0 || target >= next.length) return prev;
			[next[index], next[target]] = [next[target], next[index]];
			return next;
		});
	const save = async () => {
		setSaving(true);
		try {
			const resp: any = await api.v1.subspaces.update({ id: subspace.id, rules: rules.filter((rule) => rule.title.trim()) });
			onSaved(resp.subspace);
			setRules(resp.subspace.rules);
			lopu({ title: 'Rules saved 📜', status: 'success', duration: 4000 });
		} catch (err: any) {
			lopu({ title: err?.error || 'Could not save rules 😞', status: 'error' });
		} finally {
			setSaving(false);
		}
	};
	return (
		<Card>
			<Label>Rules · {rules.length}/15</Label>
			{rules.map((rule, index) => (
				<Flex key={index} flexDirection="column" rowGap={1} border={BORDER} borderRadius={RADIUS_MD} padding={3} data-rule-index={index}>
					<Flex columnGap={2} alignItems="center">
						<Text fontSize="xs" color={MUTED} width="18px">
							{index + 1}.
						</Text>
						<Input size="sm" borderRadius={RADIUS_MD} placeholder="Rule title" value={rule.title} maxLength={100} onChange={(event) => update(index, { title: event.target.value })} />
						<Button size="xs" variant="ghost" onClick={() => move(index, -1)} aria-label="Move up">
							▲
						</Button>
						<Button size="xs" variant="ghost" onClick={() => move(index, 1)} aria-label="Move down">
							▼
						</Button>
						<Button size="xs" variant="ghost" color="var(--tt-danger, #e5484d)" onClick={() => setRules((prev) => prev.filter((_, i) => i !== index))} aria-label="Remove rule">
							✕
						</Button>
					</Flex>
					<Textarea size="sm" borderRadius={RADIUS_MD} rows={2} placeholder="Detail (optional)" value={rule.text || ''} maxLength={500} onChange={(event) => update(index, { text: event.target.value || null })} />
				</Flex>
			))}
			<Flex columnGap={2}>
				<Button size="sm" variant="outline" borderRadius={RADIUS_MD} isDisabled={rules.length >= 15} onClick={() => setRules((prev) => [...prev, { title: '', text: null }])}>
					Add rule ➕
				</Button>
				<Button marginLeft="auto" size="sm" borderRadius={RADIUS_MD} isLoading={saving} onClick={save} data-testid="mod-save-rules">
					Save 📜
				</Button>
			</Flex>
		</Card>
	);
};

// ── Flairs ─────────────────────────────────────────────────────────────────
const FlairsPanel = ({ subspace, onSaved }: { subspace: PublicSubspace; onSaved: (next: PublicSubspace) => void }) => {
	const api = useApi();
	const lopu = useLopu();
	const [flairs, setFlairs] = React.useState<SubspaceFlair[]>(subspace.flairs);
	const [saving, setSaving] = React.useState(false);
	const update = (index: number, patch: Partial<SubspaceFlair>) => setFlairs((prev) => prev.map((flair, i) => (i === index ? { ...flair, ...patch } : flair)));
	const save = async () => {
		setSaving(true);
		try {
			const resp: any = await api.v1.subspaces.update({
				id: subspace.id,
				flairs: flairs.filter((flair) => flair.label.trim()).map((flair) => ({ ...flair, id: flair.id || undefined }))
			});
			onSaved(resp.subspace);
			setFlairs(resp.subspace.flairs);
			lopu({ title: 'Flairs saved 🏷️', status: 'success', duration: 4000 });
		} catch (err: any) {
			lopu({ title: err?.error || 'Could not save flairs 😞', status: 'error' });
		} finally {
			setSaving(false);
		}
	};
	return (
		<Card>
			<Label>Post flairs · {flairs.length}/50</Label>
			{flairs.map((flair, index) => (
				<Flex key={index} columnGap={2} rowGap={2} alignItems="center" flexWrap="wrap" border={BORDER} borderRadius={RADIUS_MD} padding={2} data-flair-index={index}>
					<Input size="sm" width="56px" textAlign="center" borderRadius={RADIUS_MD} placeholder="🏷️" value={flair.emoji || ''} maxLength={8} onChange={(event) => update(index, { emoji: event.target.value || null })} />
					<Input size="sm" flex="1" minWidth="140px" borderRadius={RADIUS_MD} placeholder="Label" value={flair.label} maxLength={64} onChange={(event) => update(index, { label: event.target.value })} />
					<Input size="sm" width="110px" fontFamily="mono" borderRadius={RADIUS_MD} placeholder="#color" value={flair.color || ''} maxLength={32} onChange={(event) => update(index, { color: event.target.value || null })} />
					<Flex as="label" alignItems="center" columnGap={1} fontSize="xs" color={MUTED} cursor="pointer">
						<Switch size="sm" isChecked={flair.modOnly} onChange={(event) => update(index, { modOnly: event.target.checked })} />
						mods only
					</Flex>
					<Text fontSize="10px" fontFamily="mono" color={MUTED} title="Flair id (set on first save)">
						{flair.id || 'new'}
					</Text>
					<Button size="xs" variant="ghost" color="var(--tt-danger, #e5484d)" onClick={() => setFlairs((prev) => prev.filter((_, i) => i !== index))} aria-label="Remove flair">
						✕
					</Button>
				</Flex>
			))}
			<Flex columnGap={2}>
				<Button size="sm" variant="outline" borderRadius={RADIUS_MD} isDisabled={flairs.length >= 50} onClick={() => setFlairs((prev) => [...prev, { id: '', label: '', emoji: null, color: null, modOnly: false }])}>
					Add flair ➕
				</Button>
				<Button marginLeft="auto" size="sm" borderRadius={RADIUS_MD} isLoading={saving} onClick={save} data-testid="mod-save-flairs">
					Save 🏷️
				</Button>
			</Flex>
		</Card>
	);
};

// ── Mod log ────────────────────────────────────────────────────────────────
const LogPanel = ({ slug }: { slug: string }) => {
	const api = useApi();
	const lopu = useLopu();
	const [entries, setEntries] = React.useState<PublicModlogEntry[]>([]);
	const [nextCursor, setNextCursor] = React.useState<string | null>(null);
	const [loading, setLoading] = React.useState(true);
	const load = React.useCallback(
		async (cursor?: string | null) => {
			setLoading(true);
			try {
				const resp: any = await api.v1.subspaces.modlog({ slug, cursor: cursor || undefined, limit: 50 });
				setEntries((prev) => (cursor ? [...prev, ...resp.entries] : resp.entries));
				setNextCursor(resp.nextCursor ?? null);
			} catch (err: any) {
				lopu({ title: err?.error || 'Could not load the mod log 😞', status: 'error' });
			} finally {
				setLoading(false);
			}
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[slug]
	);
	React.useEffect(() => {
		load();
	}, [load]);
	return (
		<Card>
			<Label>Mod log</Label>
			{!loading && entries.length === 0 && (
				<Text fontSize="sm" color={MUTED}>
					Nothing logged yet 🕊️
				</Text>
			)}
			{entries.map((entry) => (
				<Flex key={entry.id} flexDirection="column" paddingY={2} borderBottom={BORDER} _last={{ borderBottom: 'none' }} data-modlog-action={entry.action}>
					<Flex columnGap={2} alignItems="baseline" flexWrap="wrap">
						<Text fontFamily="mono" fontSize="xs" fontWeight={700} color={INK}>
							{entry.action}
						</Text>
						<Text fontSize="xs" color={MUTED}>
							by {entry.actor?.displayName || entry.actor?.username || 'someone'}
							{entry.user ? ` → ${entry.user.displayName || entry.user.username}` : ''}
							{entry.postId ? (
								<>
									{' · '}
									<Link to={`/post/${entry.postId}`}>post ↗</Link>
								</>
							) : null}
							{' · '}
							{new Date(entry.createdAt).toLocaleString()}
						</Text>
					</Flex>
					{(entry.reason || entry.detail) && (
						<Text fontSize="xs" color={TEXT}>
							{entry.reason || ''}
							{entry.detail ? ` ${JSON.stringify(entry.detail)}` : ''}
						</Text>
					)}
				</Flex>
			))}
			{nextCursor && (
				<Button size="sm" variant="outline" borderRadius={RADIUS_MD} alignSelf="center" onClick={() => load(nextCursor)}>
					Load more ⬇️
				</Button>
			)}
		</Card>
	);
};

// ── Page ───────────────────────────────────────────────────────────────────
export const SubspaceModPage = () => {
	const { slug = '' } = useParams();
	const api = useApi();
	const user = useCurrentUser();
	const lopu = useLopu();
	const [searchParams, setSearchParams] = useSearchParams();
	const tab = (TABS as readonly string[]).includes(searchParams.get('tab') || '') ? (searchParams.get('tab') as ModTab) : 'queue';
	const [subspace, setSubspace] = React.useState<PublicSubspace | null>(null);
	const [denied, setDenied] = React.useState(false);

	React.useEffect(() => {
		let cancelled = false;
		api.v1.subspaces
			.get({ slug })
			.then((resp: any) => {
				if (cancelled) return;
				setSubspace(resp.subspace);
				setDenied(!resp.subspace?.viewer?.canModerate);
			})
			.catch((err: any) => {
				if (!cancelled) lopu({ title: err?.error || 'Could not load the subspace 😞', status: 'error' });
			});
		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [slug, user?.id]);

	const setTab = (next: ModTab) => {
		const params = new URLSearchParams(searchParams);
		params.set('tab', next);
		setSearchParams(params, { replace: true });
	};

	return (
		<Flex
			justifyContent="center"
			width="100%"
			minHeight="100vh"
			background="var(--tt-surface, #fafafb)"
			paddingTop="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px))"
			paddingBottom={16}
		>
			{/* full-width like the subspace page; panels stretch with the viewport */}
			<Flex flexDirection="column" rowGap={4} width="100%" paddingX={[3, 4, 6, 8]} paddingTop={[3, 4, 5]}>
				<Flex alignItems="center" columnGap={3}>
					{subspace && <SubspaceIcon subspace={subspace} size="44px" fontSize="xl" />}
					<Box>
						<Label>Mod tools 🎩</Label>
						<Text as="h1" fontFamily="heading" fontSize="2xl" fontWeight={700} letterSpacing="-0.02em" color={INK} lineHeight="1.1">
							{subspace?.name || `s/${slug}`}
						</Text>
					</Box>
					<Button as={Link} to={`/s/${slug}`} marginLeft="auto" size="sm" variant="outline" borderRadius="999px" borderColor="var(--tt-border, #ececef)">
						← Back to s/{slug}
					</Button>
				</Flex>
				{denied && (
					<Flex border={BORDER} borderRadius={RADIUS_LG} padding={6} justifyContent="center" background="var(--tt-card, #ffffff)">
						<Text fontSize="sm" color={MUTED}>
							Moderators only — you need a mod hat for this page 🎩
						</Text>
					</Flex>
				)}
				{subspace && !denied && (
					<Tabs index={TABS.indexOf(tab)} onChange={(index) => setTab(TABS[index])} variant="soft-rounded" size="sm" colorScheme="gray" isLazy>
						<TabList flexWrap="wrap" rowGap={1} data-testid="mod-tabs">
							{TABS.map((entry) => (
								<Tab key={entry} textTransform="capitalize" fontSize="xs">
									{entry}
								</Tab>
							))}
						</TabList>
						<TabPanels>
							<TabPanel paddingX={0}>
								<QueuePanel slug={slug} />
							</TabPanel>
							<TabPanel paddingX={0}>
								<MembersPanel slug={slug} banned={false} isOwner={subspace.viewer.role === 'owner'} />
							</TabPanel>
							<TabPanel paddingX={0}>
								<MembersPanel slug={slug} banned isOwner={subspace.viewer.role === 'owner'} />
							</TabPanel>
							<TabPanel paddingX={0}>
								<SettingsPanel subspace={subspace} onSaved={setSubspace} />
							</TabPanel>
							<TabPanel paddingX={0}>
								<RulesPanel subspace={subspace} onSaved={setSubspace} />
							</TabPanel>
							<TabPanel paddingX={0}>
								<FlairsPanel subspace={subspace} onSaved={setSubspace} />
							</TabPanel>
							<TabPanel paddingX={0}>
								<LogPanel slug={slug} />
							</TabPanel>
						</TabPanels>
					</Tabs>
				)}
			</Flex>
		</Flex>
	);
};
