import React from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Box, Button, Flex, Input, Select, Text } from '@chakra-ui/react';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useApi } from '~/hooks/useApi';
import { useDataPlane } from '~/hooks/useDataPlane';
import { PageHeader, PageShell } from '~/components/Layout/PageShell';
import { installSuiteForWorkspace } from '~/components/Builder/installSuite';
import { getElectronBridge } from '~/utils/electronBridge';
import { AgentTaskSecuritySettings } from '~/components/AgentTasks/AgentNetworkSettings';
import { AgentBrowserViewer, type BrowserClaim } from '~/components/AgentTasks/AgentBrowserViewer';
import { isolatedAgentNetwork, type AgentBrowserSnapshot, type AgentTaskSecurity } from '~/components/AgentTasks/networkTypes';

export default function AgentBrowsersRoute() {
	const user = useCurrentUser(), plane = useDataPlane(), { taskId = '' } = useParams();
	const bridge = getElectronBridge();
	const [apiOrigin, setApiOrigin] = React.useState<string | null>(() => bridge ? null : location.origin);
	React.useEffect(() => {
		let active = true;
		if (bridge) void bridge.getInfo?.().then(info => {
			if (active && info.apiOrigin) setApiOrigin(new URL(info.apiOrigin).origin);
		}).catch(() => { if (active) setApiOrigin(null); });
		return () => { active = false; };
	}, [bridge]);
	return <PageShell width={1100}><PageHeader eyebrow="Thingtime desktop" title="Agent browsers" variant="ink" subtitle="Separate browsers, profiles and security settings for each task." />
		{user ? plane && apiOrigin ? <TaskBrowserControls key={`${apiOrigin}:${user.id}:${plane}:${taskId}`} taskId={taskId} ownerId={user.id} plane={plane} apiOrigin={apiOrigin} /> : <Text>Task controls require the current API origin and database identity. Reconnect the selected API endpoint.</Text> : <Text>Sign in to manage your agent tasks.</Text>}
	</PageShell>;
}

function TaskBrowserControls({ taskId, ownerId, plane, apiOrigin }: { taskId: string; ownerId: string; plane: string; apiOrigin: string }) {
	const api = useApi(), navigate = useNavigate(), bridge = getElectronBridge();
	const [snapshot, setSnapshot] = React.useState<AgentBrowserSnapshot | null>(null);
	const [task, setTask] = React.useState<any>(null), [draftId, setDraftId] = React.useState('');
	const [security, setSecurity] = React.useState<AgentTaskSecurity>({ useCustomSecurity: false, network: isolatedAgentNetwork });
	const [installId, setInstallId] = React.useState(''), [claim, setClaim] = React.useState<BrowserClaim | null>(null);
	const [catalog, setCatalog] = React.useState<Array<{ browser: string; channel: string; buildId?: string; error?: string }>>([]);
	const [buildSelection, setBuildSelection] = React.useState('');
	const [runtime, setRuntime] = React.useState<{ available: boolean; message?: string; socketPath?: string } | null>(null);
	const [busy, setBusy] = React.useState(false), [message, setMessage] = React.useState('');
	const alive = React.useRef(true), ownedClaim = React.useRef<BrowserClaim | null>(null);
	const taskKey = JSON.stringify([apiOrigin, plane, ownerId, taskId]);
	const getThing = api.v1.things.get;
	const request = React.useCallback(async (method: string, params: Record<string, unknown> = {}) => {
		if (!bridge?.agentBrowsers) throw new Error('Open this task in the Thingtime Mac app to use browser controls.');
		return bridge.agentBrowsers({ method, params });
	}, [bridge]);
	React.useEffect(() => {
		alive.current = true;
		return () => { alive.current = false; const current = ownedClaim.current; if (current) void request('release', { leaseId: current.id, token: current.token }).catch(() => {}); };
	}, [request]);
	React.useEffect(() => {
		let active = true, timer: ReturnType<typeof setTimeout>;
		const refresh = async () => {
			try { const next = await request('status') as AgentBrowserSnapshot; if (active) setSnapshot(next); }
			catch (error) { if (active) setMessage(error instanceof Error ? error.message : 'Browser manager unavailable.'); }
			finally { if (active) timer = setTimeout(refresh, 2000); }
		};
		if (bridge?.agentBrowserVersion) void refresh();
		return () => { active = false; clearTimeout(timer); };
	}, [request, bridge]);
	React.useEffect(() => {
		let active = true;
		if (bridge?.agentBrowserVersion) void request('runtime.status').then(result => { if (active) setRuntime(result as typeof runtime); }).catch(error => { if (active) setMessage(error.message); });
		return () => { active = false; };
	}, [request, bridge]);
	React.useEffect(() => {
		if (!taskId) return;
		const abort = new AbortController();
		getThing({ id: taskId }, { signal: abort.signal }).then(async result => {
			const found = result?.thing;
			if (!found || found.author?.id !== ownerId || !found.thingtime?.includes('data') || found.crystal?.recordType !== 'agent-task') throw new Error('Choose one of your agent task Data Things.');
			const next = { useCustomSecurity: found.crystal.useCustomSecurity === true, network: found.crystal.network || isolatedAgentNetwork };
			if (abort.signal.aborted) return;
			await request('task.register', { taskId: taskKey, ...next });
			if (!abort.signal.aborted) { setTask(found); setSecurity(next); }
		}).catch(error => { if (!abort.signal.aborted) setMessage(error instanceof Error ? error.message : 'Could not open this task.'); });
		return () => abort.abort();
	}, [getThing, taskId, ownerId, request, taskKey]);
	React.useEffect(() => {
		if (!claim) return;
		const timer = setInterval(() => { void request('renew', { leaseId: claim.id, token: claim.token }).catch(error => setMessage(error.message)); }, 60000);
		return () => clearInterval(timer);
	}, [claim, request]);
	const perform = async (work: () => Promise<void>) => {
		setBusy(true); setMessage('');
		try { await work(); } catch (error) { if (alive.current) setMessage(error instanceof Error ? error.message : 'The operation failed.'); }
		finally { if (alive.current) setBusy(false); }
	};
	const activeLease = snapshot?.leases.find(lease => lease.taskId === taskKey && !lease.expired);
	const expiredLease = snapshot?.leases.find(lease => lease.taskId === taskKey && lease.expired);
	const session = snapshot?.sessions.find(session => session.leaseId === activeLease?.id && session.state === 'ready');
	return <Box display="grid" gap={5} minWidth={0}>
		<Flex gap={3} wrap="wrap"><Button as={Link} to="/p/agent-tasks" variant="outline">Task board</Button><Button as={Link} to="/settings/things#agent-browser-security" variant="outline">General security settings</Button>
			<Button isDisabled={busy} onClick={() => perform(async () => { const installed = await installSuiteForWorkspace('agent-tasks', { onlyMissing: true }); if (alive.current) navigate(`/p/${installed.entryPageKey}`); })}>Install editable task space</Button>
		</Flex>
		{!taskId && <Flex gap={2} wrap="wrap"><Input flex="1 1 240px" aria-label="Task Thing ID" value={draftId} onChange={event => setDraftId(event.target.value)} placeholder="Open a task by its Thing ID" /><Button onClick={() => navigate(`/agent-browsers/${encodeURIComponent(draftId.trim())}`)} isDisabled={!draftId.trim()}>Open task</Button></Flex>}
		{!bridge?.agentBrowserVersion && <Text>Browser installation and live sessions are available in the Thingtime Mac app. Your editable task board is also available on the web.</Text>}
		{bridge?.agentBrowserVersion && <Box borderWidth="1px" borderRadius="lg" padding={4} display="grid" gap={3}>
			<Text fontWeight="semibold">Isolated runtime</Text>
			<Text fontSize="sm">{runtime?.available ? 'Ready. Each task receives its own browser, local app and temporary database.' : runtime?.message || 'Checking the runtime…'}</Text>
			{!runtime?.available && <Button width="fit-content" isDisabled={busy} onClick={() => perform(async () => { setMessage('Starting the dedicated runtime. The first start downloads its Linux image.'); const next = await request('runtime.prepare'); if (alive.current) { setRuntime(next as typeof runtime); setMessage(''); } })}>Start isolated runtime</Button>}
			{runtime?.socketPath && <Text fontSize="xs" overflowWrap="anywhere">Agent connection: {runtime.socketPath}</Text>}
		</Box>}
		{task && snapshot && <>
			<Box borderWidth="1px" borderRadius="lg" padding={4} display="grid" gap={4} minWidth={0}><Text fontWeight="semibold">{task.crystal.title}</Text>
				<AgentTaskSecuritySettings value={security} defaults={snapshot.defaults} onChange={setSecurity} disabled={busy} />
				<Button width="fit-content" isDisabled={busy} onClick={() => perform(async () => {
					await request('task.validate', security);
					await api.v1.things.update({ id: task.id, expectedActor: ownerId, expectedUpdatedAt: task.updatedAt, crystal: { ...task.crystal, ...security }, replaceCrystal: true });
					const updated = await api.v1.things.get({ id: task.id });
					if (!alive.current) return;
					await request('task.register', { taskId: taskKey, ...security }); setTask(updated.thing); setMessage('Security settings saved for the next claim.');
				})}>Save task security</Button>
			</Box>
			<Box borderWidth="1px" borderRadius="lg" padding={4} display="grid" gap={3} minWidth={0}><Text fontWeight="semibold">Browser installs and claims</Text>
				<Text fontSize="sm" color="gray.500">Duplicate an installed runtime to give another agent its own claim. Browser files can be shared safely; profiles and task networks are separate.</Text>
				<Select aria-label="Installed browser" value={installId} onChange={event => setInstallId(event.target.value)}><option value="">Choose an installed browser</option>{snapshot.installs.map(install => <option key={install.id} value={install.id}>Container · {install.browser} {install.buildId} · {install.id.slice(0, 8)}</option>)}{snapshot.nativeBundles?.installs.map(install => <option key={install.id} value={install.id}>macOS · {install.browser} {install.buildId} · {install.id.slice(0, 8)}</option>)}</Select>
				<Flex gap={2} wrap="wrap"><Button isDisabled={busy} onClick={() => perform(async () => { await request('install', { taskId: taskKey }); setMessage('Preparing Chromium. Download progress appears below.'); })}>Install Chromium runtime</Button>
					<Button isDisabled={busy || !installId} onClick={() => perform(async () => { const copy = await request('duplicate', { id: installId, taskId: taskKey }) as { id: string }; setInstallId(copy.id); })}>Duplicate install</Button>
					<Button isDisabled={busy || !installId || !!activeLease} onClick={() => perform(async () => {
						const next = await request('claim', { taskId: taskKey, installId, agentId: 'Thingtime viewer' }) as BrowserClaim;
						ownedClaim.current = next;
						if (!alive.current) { await request('release', { leaseId: next.id, token: next.token }); ownedClaim.current = null; return; }
						setClaim(next); await request('launch', { leaseId: next.id, token: next.token });
					})}>Claim and launch</Button>
					{claim && <Button isDisabled={busy} onClick={() => perform(async () => { await request('release', { leaseId: claim.id, token: claim.token }); ownedClaim.current = null; setClaim(null); })}>Release browser</Button>}
				</Flex>
				{snapshot.downloads.filter(job => job.taskId === taskKey).map(job => <Flex key={job.id} gap={2} wrap="wrap" align="center"><Text fontSize="sm">{job.browser} {job.buildId}: {job.state}{job.error ? ` — ${job.error}` : ''}</Text>{['preparing', 'building'].includes(job.state) && <Button size="sm" isDisabled={busy} onClick={() => perform(async () => { await request('install.cancel', { id: job.id, taskId: taskKey }); })}>Cancel build</Button>}</Flex>)}
				<Text fontWeight="semibold" marginTop={3}>Native macOS browser copies</Text>
				<Text fontSize="sm" color="gray.500">Install publisher builds in your Applications folder with their signatures preserved. Each claim gets a fresh profile. These copies support “Allow all network traffic” only; use a container for isolated or restricted testing.</Text>
				<Button width="fit-content" isDisabled={busy} onClick={() => perform(async () => { const builds = await request('catalog') as typeof catalog; if (alive.current) setCatalog(builds); })}>Fetch Chrome and Chromium builds</Button>
				{catalog.length > 0 && <Flex gap={2} wrap="wrap"><Select aria-label="Publisher browser build" flex="1 1 240px" value={buildSelection} onChange={event => setBuildSelection(event.target.value)}><option value="">Choose a publisher build</option>{catalog.map((build, index) => <option key={`${build.browser}-${build.channel}`} value={String(index)} disabled={!build.buildId}>{build.browser} {build.channel} · {build.buildId || 'Unavailable'}</option>)}</Select>
					<Button isDisabled={busy || !catalog[Number(buildSelection)]?.buildId || buildSelection === ''} onClick={() => perform(async () => { const selected = catalog[Number(buildSelection)]; await request('native.install', { browser: selected.browser, buildId: selected.buildId, taskId: taskKey }); })}>Install native copy</Button></Flex>}
				{snapshot.nativeBundles?.downloads.filter(job => job.taskId === taskKey).map(job => <Flex key={job.id} gap={2} wrap="wrap" align="center"><Text fontSize="sm">{job.browser} {job.buildId}: {job.state}{job.total > 0 && job.state === 'downloading' ? ` · ${Math.floor(job.downloaded / job.total * 100)}%` : ''}{job.error ? ` — ${job.error}` : ''}</Text>{['downloading', 'verifying'].includes(job.state) && <Button size="sm" isDisabled={busy} onClick={() => perform(async () => { await request('native.cancel', { id: job.id, taskId: taskKey }); })}>Cancel download</Button>}</Flex>)}
				{activeLease && <Text fontSize="sm">Claimed by {activeLease.agentId}</Text>}
				{expiredLease && <Flex gap={2} wrap="wrap" align="center"><Text fontSize="sm">The claim by {expiredLease.agentId} expired. Its browser has stopped.</Text><Button size="sm" isDisabled={busy} onClick={() => perform(async () => { await request('release.expired', { leaseId: expiredLease.id, taskId: taskKey }); })}>Clear expired claim</Button></Flex>}
			</Box>
			{session && activeLease && <AgentBrowserViewer key={session.id} claim={claim?.id === activeLease.id ? claim : undefined} leaseId={activeLease.id} taskId={taskKey} policy={session.policy} />}
		</>}
		{message && <Text role="status" fontSize="sm">{message}</Text>}
	</Box>;
}
