import { DRAWER_MODAL_Z } from '~/components/Nav/Drawer/useDrawer';
import React from 'react';
import { AlertDialog, AlertDialogOverlay, AlertDialogContent, AlertDialogHeader, AlertDialogBody, AlertDialogFooter, Button } from '@chakra-ui/react';
import {
	LayoutDashboard,
	CalendarDays,
	Users,
	MapPin,
	ClipboardList,
	Wrench,
	ShieldCheck,
	Settings2,
	Trash2,
	Leaf,
	ArrowLeft,
	Plus,
	RefreshCw,
	Map as MapIcon
} from 'lucide-react';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useLopu } from '~/components/Lopu/useLopu';
import { ThingComments } from '~/components/Things/ThingComments';
import { useWebpageRuntime } from '../webpageRuntime';
import {
	SERVICE_FIELDS,
	SERVICE_LABELS,
	SERVICE_SINGULAR as SINGULAR,
	isServiceStaff,
	serviceTitle,
	type ServiceKind,
	type ServiceRecord
} from '~/schemas/serviceWorkspace';
import { readAllWorkspace, workspaceRequest, attachmentUrl, type WorkspaceSnapshot } from './client';
import { ServiceRecordEditor, type ServiceDraft } from './ServiceRecordEditor';
import { ServiceRecordMenu } from './ServiceRecordMenu';
import { ServicePlanner } from './ServicePlanner';
import { ServiceMap } from './ServiceMaps';
import { ServiceMedia } from './ServiceMedia';
import { serviceWorkspaceStyles } from './serviceWorkspaceStyles';
import { serviceWorkspaceContexts, serviceContextText } from '~/schemas/serviceWorkspaceContext';
import { ServiceJobContext } from './ServiceJobContext';
import { CollectionList } from '~/components/Collections/CollectionList';
import { collectionStyles } from '~/components/Collections/collectionStyles';
import { serviceListFilters } from './serviceListFilters';
import { popTrail, pushTrail, serviceParentRecordId } from './serviceNavigation';

type Section = 'overview' | 'planner' | 'map' | 'setup' | 'trash' | ServiceKind;
const NAV = [
	{ id: 'overview', label: 'Overview', icon: LayoutDashboard },
	{ id: 'planner', label: 'Planner', icon: CalendarDays },
	{ id: 'customer', label: 'Customers', icon: Users },
	{ id: 'address', label: 'Properties', icon: MapPin },
	{ id: 'job', label: 'Jobs', icon: ClipboardList },
	{ id: 'equipment', label: 'Equipment', icon: Wrench },
	{ id: 'map', label: 'Map', icon: MapIcon },
	{ id: 'member', label: 'Team', icon: ShieldCheck },
	{ id: 'setup', label: 'Setup', icon: Settings2 },
	{ id: 'trash', label: 'Trash', icon: Trash2 }
] as const;

export default function ServiceWorkspace({ rootId: suppliedRoot, name = 'Service workspace' }: { rootId?: unknown; name?: string }) {
	const user = useCurrentUser();
	// Mount by account as well as workspace: switching accounts cannot retain private state.
	return (
		<>
			<style>{serviceWorkspaceStyles + collectionStyles}</style>
			<Workspace
				key={`${user?.id || 'anonymous'}:${String(suppliedRoot)}`}
				rootId={typeof suppliedRoot === 'string' ? suppliedRoot : ''}
				name={name}
			/>
		</>
	);
}
function Workspace({ rootId, name }: { rootId: string; name: string }) {
	const user = useCurrentUser();
	const runtime = useWebpageRuntime();
	const lopu = useLopu();
	const [data, setData] = React.useState<WorkspaceSnapshot | null>(null);
	const [section, setSection] = React.useState<Section>('overview');
	const [selectedId, setSelectedId] = React.useState<string | null>(null);
	// Records the viewer opened on the way to the current one (see serviceNavigation).
	const [trail, setTrail] = React.useState<string[]>([]);
	const [query, setQuery] = React.useState('');
	const [trash, setTrash] = React.useState(false);
	const [draft, setDraft] = React.useState<ServiceDraft | null>(null);
	const [pendingDelete, setPendingDelete] = React.useState<ServiceRecord | null>(null);
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState('');
	const [missing, setMissing] = React.useState(false);
	const cancelRef = React.useRef<HTMLButtonElement>(null);
	const live = React.useRef(true);
	const generation = React.useRef(0);
	const mutating = React.useRef(false);
	const report = React.useCallback(
		(failure: unknown) =>
			lopu({
				title: 'Could not complete that action',
				description: failure instanceof Error ? failure.message : 'Please try again.',
				status: 'error'
			}),
		[lopu]
	);
	const refresh = React.useCallback(async () => {
		if (!rootId || !user?.id) return;
		const epoch = ++generation.current;
		try {
			const next = await readAllWorkspace(rootId);
			if (live.current && epoch === generation.current) {
				setData(next);
				setError('');
				setMissing(false);
			}
		} catch (failure) {
			if (live.current && epoch === generation.current) {
				const status = (failure as any).status;
				if ([401, 403, 404].includes(status)) setData(null);
				setMissing(status === 404);
				setError((failure as Error).message);
			}
			throw failure;
		}
	}, [rootId, user?.id]);
	React.useEffect(() => {
		live.current = true;
		void refresh().catch(() => {});
		const focus = () => {
			if (document.visibilityState === 'visible') void refresh().catch(() => {});
		};
		document.addEventListener('visibilitychange', focus);
		return () => {
			live.current = false;
			document.removeEventListener('visibilitychange', focus);
		};
	}, [refresh]);
	const canEdit = !!data && isServiceStaff(data.role);
	const records = data?.records || [];
	const contexts = React.useMemo(() => serviceWorkspaceContexts(data?.records || [], data?.team), [data?.records, data?.team]);
	const context = (record: ServiceRecord) => <ServiceJobContext context={contexts.get(record.id)} job={record.kind === 'job'} />;
	const active = records.filter((r) => !r.values.archived);
	const selected = records.find((r) => r.id === selectedId);
	const recordById = (id: string) => records.find((r) => r.id === id);
	const previous = trail.length ? recordById(trail[trail.length - 1]) : undefined;
	const open = (id: string) => {
		setTrail((current) => pushTrail(current, selectedId, id));
		setSelectedId(id);
		setQuery('');
	};
	// Back returns to the record the viewer came from (property → job → visit),
	// and to the section list once the trail is exhausted.
	const back = () => {
		const next = popTrail(trail, (id) => records.some((r) => r.id === id));
		setTrail(next.trail);
		setSelectedId(next.id);
		setQuery('');
	};
	const create = (kind: ServiceKind, defaults: Record<string, any> = {}) => setDraft({ kind, defaults });
	const edit = (record: ServiceRecord) => setDraft({ kind: record.kind, record });
	const duplicate = (record: ServiceRecord) => {
		const { thumbnailId, bannerId, archived, userId, order, ...values } = record.values;
		setDraft({ kind: record.kind, defaults: { ...values, ...(values.title ? { title: `${values.title} (copy)` } : {}) } });
	};
	async function mutate(body: Record<string, unknown>, message: string) {
		if (mutating.current) return;
		mutating.current = true;
		setBusy(true);
		try {
			await workspaceRequest(rootId, body);
			await refresh();
			lopu({ title: message, status: 'success' });
		} catch (failure) {
			report(failure);
			throw failure;
		} finally {
			mutating.current = false;
			setBusy(false);
		}
	}
	const remove = (record: ServiceRecord) =>
		record.values.archived
			? void mutate({ operation: 'archive', id: record.id, expectedUpdatedAt: record.updatedAt, archived: false }, 'Record restored').catch(() => {})
			: setPendingDelete(record);
	const menu = (record: ServiceRecord) =>
		canEdit && !record.values.workspaceOwner && (record.kind !== 'member' || data?.role === 'Admin') ? (
			<ServiceRecordMenu
				record={record}
				edit={() => edit(record)}
				duplicate={() => duplicate(record)}
				remove={() => remove(record)}
				disabled={busy}
			/>
		) : null;
	const subtitle = (record: ServiceRecord) => {
		const v = record.values;
		if (record.kind === 'customer') return [v.contact, v.email || v.phone].filter(Boolean).join(' · ');
		if (record.kind === 'address') return v.address;
		if (record.kind === 'job') return v.estimatedMinutes ? `${v.estimatedMinutes} min estimated` : 'Job template';
		if (record.kind === 'visit') return [v.date, v.time, v.status].filter(Boolean).join(' · ');
		if (record.kind === 'equipment') return [v.category, v.serialNumber].filter(Boolean).join(' · ');
		if (record.kind === 'member') return v.role;
		if (record.kind === 'time') return `${v.minutes} minutes${v.subjobId ? ` · ${recordById(v.subjobId)?.values.title || 'Sub-job'}` : ''}`;
		if (record.kind === 'usage')
			return [
				recordById(v.equipmentId)?.values.title,
				v.batteryPercent !== '' && v.batteryPercent != null ? `${v.batteryPercent}% battery` : '',
				v.fuelLitres ? `${v.fuelLitres} L fuel` : ''
			]
				.filter(Boolean)
				.join(' · ');
		if (record.kind === 'link')
			return [recordById(v.customerId), recordById(v.addressId)]
				.filter(Boolean)
				.map((r) => serviceTitle(r!))
				.join(' ↔ ');
		return v.description || '';
	};
	const searchText = (record: ServiceRecord) =>
		`${serviceTitle(record)} ${subtitle(record)} ${serviceContextText(contexts.get(record.id))} ${Object.values(record.values)
			.filter((value) => typeof value === 'string')
			.join(' ')}`;
	const list = (items: ServiceRecord[], empty = 'Nothing here yet.', compact = false, label = 'Records', controlled = false) => (
		<CollectionList
			key={`${selectedId || section}:${label}:${trash}`}
			label={label}
			items={items}
			searchText={searchText}
			filters={serviceListFilters(items, data?.team)}
			empty={empty}
			query={controlled ? query : undefined}
			onQueryChange={controlled ? setQuery : undefined}
		>
			{(visibleItems) => (
				<div className={compact ? 'sw-record-list' : 'sw-record-grid'}>
					{visibleItems.map((record) => (
						<article className="sw-record" key={record.id}>
							<button className="sw-record-main" onClick={() => open(record.id)}>
								{['customer', 'address', 'equipment'].includes(record.kind) && (
									<span className={'sw-avatar sw-avatar-' + record.kind}>
										{record.values.thumbnailId ? (
											<img src={attachmentUrl(record.values.thumbnailId)} alt="" loading="lazy" />
										) : (
											serviceTitle(record)
												.split(' ')
												.map((x) => x[0])
												.join('')
												.slice(0, 2)
												.toUpperCase()
										)}
									</span>
								)}
								<span>
									<strong>{serviceTitle(record)}</strong>
									<small>{subtitle(record)}</small>
									{context(record)}
									{record.values.archived && <span className="sw-badge">Deleted</span>}
								</span>
							</button>
							{menu(record)}
						</article>
					))}
				</div>
			)}
		</CollectionList>
	);
	const sectionList = (title: string, items: ServiceRecord[], add?: () => void, addLabel = 'Add') => (
		<section className="sw-panel">
			<div className="sw-section-heading">
				<h2>
					{title}
					<span className="sw-count">{items.length}</span>
				</h2>
				{canEdit && add && (
					<button onClick={add}>
						<Plus size={15} />
						{addLabel}
					</button>
				)}
			</div>
			{list(items, `No ${title.toLowerCase()} yet.`, true, title)}
		</section>
	);
	async function initialize() {
		await mutate({ operation: 'initialize', name, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }, 'Workspace created');
		if (!runtime.pageId) return;
		// A builder page that was never saved cannot be bound yet: say so and
		// point at Setup instead of surfacing the generic failure toast.
		try {
			await workspaceRequest(rootId, { operation: 'bindPage', pageId: runtime.pageId });
			await refresh();
			lopu({ title: 'Builder page connected', status: 'success' });
		} catch {
			lopu({
				title: 'Save this page to connect it',
				description: 'Once the page is saved, use Setup → “Connect this builder page to team access” so your team can open it.',
				status: 'info',
				duration: 8000
			});
		}
	}
	if (!user)
		return (
			<div className="service-workspace sw-empty">
				<Leaf size={28} />
				<h2>{name}</h2>
				<p>Sign in with your Thingtime account to open your franchise workspace.</p>
				<a className="sw-primary" href="/login">
					Sign in
				</a>
			</div>
		);
	if (!rootId)
		return (
			<div className="service-workspace sw-empty">
				<h2>Connect a service workspace</h2>
				<p>Set this component’s rootId to the workspace folder ID in the builder. A new ID will offer workspace setup.</p>
			</div>
		);
	if (!data)
		return (
			<div className="service-workspace sw-empty">
				<Leaf size={28} />
				<h2>{name}</h2>
				<p role="status">{error || 'Opening workspace…'}</p>
				{missing && (
					<button className="sw-primary" disabled={busy} onClick={() => void initialize().catch(() => {})}>
						Create workspace
					</button>
				)}
				<button onClick={() => void refresh().catch(report)}>Retry</button>
			</div>
		);
	const today = new Intl.DateTimeFormat('en-CA', { timeZone: data.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
	const visits = active.filter((r) => r.kind === 'visit');
	const filter = (items: ServiceRecord[]) => items.filter((r) => (trash || section === 'trash' ? !!r.values.archived : !r.values.archived));
	const pageTitle = selected ? serviceTitle(selected) : NAV.find((n) => n.id === section)?.label || SERVICE_LABELS[section as ServiceKind];
	const relationButtons = selected
		? SERVICE_FIELDS[selected.kind]
				.filter((field) => field.ref && selected.values[field.key])
				.map((field) => {
					const related = recordById(selected.values[field.key]);
					return related ? (
						<button key={field.key} className="sw-related" onClick={() => open(related.id)}>
							<span>{field.label}</span>
							{serviceTitle(related)} →
						</button>
					) : null;
				})
		: [];
	return (
		<div className="service-workspace">
			<header className="sw-brand">
				<div className="sw-brand-mark">
					<Leaf size={24} />
				</div>
				<div>
					<p>FRANCHISE WORKSPACE</p>
					<h1>{data.name}</h1>
				</div>
				<span className="sw-role">{data.role}</span>
				<button aria-label="Refresh workspace" className="sw-icon-button" disabled={busy} onClick={() => void refresh().catch(report)}>
					<RefreshCw size={17} />
				</button>
			</header>
			<nav className="sw-nav" aria-label="Franchise navigation">
				{NAV.filter((item) => (item.id !== 'member' || data.role === 'Admin') && (item.id !== 'trash' || canEdit)).map((item) => (
					<button
						key={item.id}
						aria-current={section === item.id ? 'page' : undefined}
						onClick={() => {
							setSection(item.id);
							setSelectedId(null);
							setTrail([]);
							setQuery('');
							setTrash(false);
						}}
					>
						<item.icon size={17} />
						<span>{item.label}</span>
					</button>
				))}
			</nav>
			<main className="sw-main">
				{error && (
					<p role="alert" className="sw-error">
						{error} <button onClick={() => void refresh().catch(report)}>Retry</button>
					</p>
				)}
				<div className="sw-page-heading">
					<div>
						{selected && (
							<button className="sw-back" onClick={back}>
								<ArrowLeft size={14} />
								Back to {previous ? serviceTitle(previous) : NAV.find((n) => n.id === section)?.label.toLowerCase() || 'records'}
							</button>
						)}
						<p className="sw-eyebrow">
							{selected
								? SINGULAR[selected.kind]
								: new Date(today + 'T12:00:00').toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}
						</p>
						<h2>{pageTitle}</h2>
					</div>
					<div className="sw-buttons">
						{selected ? (
							<>
								{canEdit && !selected.values.archived && !selected.values.workspaceOwner && (selected.kind !== 'member' || data.role === 'Admin') && (
									<button onClick={() => edit(selected)}>
										<PencilIcon />
										Edit
									</button>
								)}
								{menu(selected)}
							</>
						) : (
							canEdit &&
							['customer', 'address', 'job', 'equipment', 'member'].includes(section) && (
								<button className="sw-primary" onClick={() => create(section as ServiceKind)}>
									<Plus size={16} />
									Add {SINGULAR[section as ServiceKind]}
								</button>
							)
						)}
					</div>
				</div>
				{selected ? (
					<>
						{selected.values.bannerId && (
							<img className="sw-property-banner" src={attachmentUrl(selected.values.bannerId)} alt={`${serviceTitle(selected)} banner`} />
						)}
						{selected.values.archived && (
							<p className="sw-warning">
								This record is in the trash. Related history is preserved.{' '}
								{canEdit && <button onClick={() => remove(selected)}>Restore record</button>}
							</p>
						)}
						<section className="sw-panel sw-detail-summary">
							{context(selected)}
							<div className="sw-detail-fields">
								{SERVICE_FIELDS[selected.kind]
									.filter(
										(field) => !field.ref && field.key !== 'description' && selected.values[field.key] !== '' && selected.values[field.key] != null
									)
									.map((field) => (
										<div key={field.key}>
											<span>{field.label}</span>
											<strong>{String(selected.values[field.key])}</strong>
										</div>
									))}
							</div>
							{selected.values.description && <p className="sw-description">{selected.values.description}</p>}
							{relationButtons.length > 0 && <div className="sw-related-list">{relationButtons}</div>}
						</section>
						{selected.kind === 'customer' && (
							<>
								{sectionList(
									'Properties',
									active.filter(
										(r) =>
											r.kind === 'address' &&
											active.some((link) => link.kind === 'link' && link.values.customerId === selected.id && link.values.addressId === r.id)
									),
									() => create('link', { customerId: selected.id }),
									'Link property'
								)}
							</>
						)}
						{selected.kind === 'address' && (
							<>
								{sectionList(
									'Customers',
									active.filter(
										(r) =>
											r.kind === 'customer' &&
											active.some((link) => link.kind === 'link' && link.values.addressId === selected.id && link.values.customerId === r.id)
									),
									() => create('link', { addressId: selected.id }),
									'Link customer'
								)}
								{sectionList(
									'Jobs',
									active.filter((r) => r.kind === 'job' && r.values.addressId === selected.id),
									() => create('job', { addressId: selected.id }),
									'Create job'
								)}
								{sectionList(
									'Visit history',
									visits
										.filter((r) => recordById(r.values.jobId)?.values.addressId === selected.id)
										.sort((a, b) => `${b.values.date} ${b.values.time}`.localeCompare(`${a.values.date} ${a.values.time}`))
								)}
							</>
						)}
						{selected.kind === 'job' && (
							<>
								{sectionList(
									'Scheduled visits & history',
									visits.filter((r) => r.values.jobId === selected.id).sort((a, b) => b.values.date.localeCompare(a.values.date)),
									() => create('visit', { jobId: selected.id, title: serviceTitle(selected), date: today }),
									'Schedule visit'
								)}
								{sectionList(
									'Sub-jobs',
									active.filter((r) => r.kind === 'subjob' && r.values.jobId === selected.id),
									() => create('subjob', { jobId: selected.id }),
									'Add sub-job'
								)}
							</>
						)}
						{selected.kind === 'visit' && (
							<>
								<section className="sw-panel sw-visit-summary">
									<div>
										<span className="sw-eyebrow">TOTAL LOGGED TIME</span>
										<strong>
											{active
												.filter((r) => r.kind === 'time' && r.values.visitId === selected.id)
												.reduce((sum, r) => sum + Number(r.values.minutes || 0), 0)}{' '}
											min
										</strong>
									</div>
									<div className="sw-buttons">
										{canEdit &&
											['Scheduled', 'In progress', 'Completed'].map((status) => (
												<button
													key={status}
													disabled={busy || selected.values.status === status}
													aria-pressed={selected.values.status === status}
													onClick={() =>
														void mutate(
															{
																operation: 'save',
																id: selected.id,
																kind: 'visit',
																values: { ...selected.values, status },
																expectedUpdatedAt: selected.updatedAt
															},
															`Visit ${status.toLowerCase()}`
														).catch(() => {})
													}
												>
													{status}
												</button>
											))}
									</div>
								</section>
								{canEdit && (
									<>
										{sectionList(
											'Time logs',
											active.filter((r) => r.kind === 'time' && r.values.visitId === selected.id),
											() => create('time', { visitId: selected.id, title: serviceTitle(selected), employeeId: selected.values.employeeId || '' }),
											'Log time'
										)}
										{sectionList(
											'Tools, batteries & travel',
											active.filter((r) => r.kind === 'usage' && r.values.visitId === selected.id),
											() => create('usage', { visitId: selected.id, employeeId: selected.values.employeeId || '' }),
											'Log usage'
										)}
									</>
								)}
							</>
						)}
						{selected.kind === 'equipment' &&
							canEdit &&
							sectionList(
								'Usage history',
								active.filter((r) => r.kind === 'usage' && [r.values.equipmentId, r.values.batteryId, r.values.vehicleId].includes(selected.id))
							)}
						{['address', 'customer', 'job', 'visit', 'equipment'].includes(selected.kind) && (
							<ServiceMedia
								key={selected.id}
								record={selected}
								canEdit={canEdit && !selected.values.archived}
								report={report}
								onSaved={refresh}
								selectImage={async (key, id) => {
									await mutate(
										{
											operation: 'save',
											kind: selected.kind,
											id: selected.id,
											values: { ...selected.values, [key]: id },
											expectedUpdatedAt: selected.updatedAt
										},
										'Photo updated'
									);
								}}
							/>
						)}
						{['address', 'customer', 'job', 'visit', 'equipment'].includes(selected.kind) && (
							<ThingComments
								key={`comments:${selected.id}`}
								thingId={selected.id}
								collectionControls
								onCommentAdded={() => refresh().catch(report)}
								description={`Notes, questions and updates for this ${SINGULAR[selected.kind]}.`}
							/>
						)}
						{selected.kind === 'address' || selected.kind === 'customer'
							? sectionList(
									'Customer address links',
									active.filter((r) => r.kind === 'link' && (selected.kind === 'address' ? r.values.addressId : r.values.customerId) === selected.id)
							  )
							: null}
					</>
				) : section === 'overview' ? (
					<>
						<section className="sw-welcome">
							<div>
								<span className="sw-eyebrow">A GOOD DAY STARTS HERE</span>
								<h3>Ready for the next lawn.</h3>
								<p>Your customers, properties and crew, all in one place.</p>
							</div>
							{canEdit && (
								<button className="sw-primary" onClick={() => create('visit', { date: today })}>
									<Plus size={16} />
									Schedule a visit
								</button>
							)}
						</section>
						<div className="sw-stats">
							{[
								{ label: 'Today’s visits', value: visits.filter((r) => r.values.date === today).length, section: 'planner' },
								{ label: 'Customers', value: active.filter((r) => r.kind === 'customer').length, section: 'customer' },
								{ label: 'Properties', value: active.filter((r) => r.kind === 'address').length, section: 'address' },
								{ label: 'Equipment', value: active.filter((r) => r.kind === 'equipment').length, section: 'equipment' }
							].map((stat) => (
								<button key={stat.label} onClick={() => setSection(stat.section as Section)}>
									<span>{stat.label}</span>
									<strong>{stat.value}</strong>
								</button>
							))}
						</div>
						{sectionList(
							'Today’s visits',
							visits.filter((r) => r.values.date === today).sort((a, b) => (a.values.order || 0) - (b.values.order || 0))
						)}
						{sectionList(
							'Upcoming visits',
							visits
								.filter((r) => r.values.date > today && r.values.status !== 'Cancelled' && r.values.status !== 'Completed')
								.sort(
									(a, b) =>
										`${a.values.date} ${a.values.time || ''}`.localeCompare(`${b.values.date} ${b.values.time || ''}`) ||
										(a.values.order || 0) - (b.values.order || 0) ||
										a.id.localeCompare(b.id)
								)
						)}
					</>
				) : section === 'planner' ? (
					<ServicePlanner
						rootId={rootId}
						records={records}
						canEdit={canEdit}
						open={open}
						create={(date) => create('visit', { date })}
						refresh={refresh}
						report={report}
						timeZone={data.timeZone}
						menu={menu}
						context={context}
						searchText={searchText}
						team={data.team}
					/>
				) : section === 'setup' ? (
					<section className="sw-panel sw-setup">
						<h3>Workspace & integrations</h3>
						<p>
							Your workspace uses nested Thingtime folders for customers, properties, jobs, visits, equipment and logs. Uploaded files and comments
							remain attached to their own records.
						</p>
						<a href={`/things?folder=${encodeURIComponent(rootId)}`}>Open workspace folder →</a>
						<h3>Team access</h3>
						<p>
							Everyone signs in with their Thingtime account. Add an existing username in Team, then choose Admin, Employee, Lopu, Customer or B2B.
							Customer and B2B roles see their linked customer account and properties.
						</p>
						<h3>Maps & address search</h3>
						<p>
							In your Thingtime Vault, add GOOGLE_MAPS_JAVASCRIPT_API_KEY and GOOGLE_PLACES_API_KEY. Enable Maps JavaScript API and Places API (New),
							including billing. Restrict the browser key to your Thingtime website domains, and the server key to Places API. Each key name must be
							unique in the selected environment.
						</p>
						<p>{data.mapsConfigured ? 'Maps browser credential connected.' : 'Maps browser credential not found or ambiguous.'}</p>
						{data.owner && (
							<label className="sw-form">
								<span>Maps Vault environment</span>
								<select
									aria-label="Maps Vault environment"
									value={data.mapsEnvironmentId === null ? '' : data.mapsEnvironmentId || '__auto__'}
									disabled={busy}
									onChange={(event) =>
										void mutate(
											{ operation: 'configureMaps', environmentId: event.target.value === '' ? null : event.target.value },
											'Maps environment updated'
										).catch(() => {})
									}
								>
									<option value="__auto__">Find unique keys across environments</option>
									<option value="">Ungrouped</option>
									{data.mapsEnvironments?.map((group) => (
										<option key={group.id} value={group.id}>
											{group.name}
										</option>
									))}
								</select>
							</label>
						)}
						<a href="/settings">Open Thingtime settings →</a>
						<h3>Lopu integration</h3>
						<p>
							Lopu can work with the workspace’s ordinary Things and nested folders through your existing Thingtime connection. A team member with the
							Lopu role can manage operational records; team access remains with Admins.
						</p>
						{data.owner && runtime.pageId && (
							<button
								disabled={busy}
								onClick={() => void mutate({ operation: 'bindPage', pageId: runtime.pageId }, 'Builder page connected').catch(() => {})}
							>
								Connect this builder page to team access
							</button>
						)}
					</section>
				) : (
					<>
						<div className="sw-list-controls">
							{canEdit && section !== 'map' && section !== 'trash' && (
								<button aria-pressed={trash} onClick={() => setTrash(!trash)}>
									{trash ? 'Show active' : 'Trash'}
								</button>
							)}
						</div>
						{section === 'map' ? (
							<>
								<ServiceMap
									rootId={rootId}
									apiKey={data.mapsBrowserKey}
									addresses={filter(records.filter((r) => r.kind === 'address')).filter((record) =>
										searchText(record).toLowerCase().includes(query.toLowerCase())
									)}
									open={open}
									report={report}
								/>
								{list(filter(records.filter((r) => r.kind === 'address')), 'Add your first property to get started.', false, 'Map properties', true)}
							</>
						) : (
							list(
								filter(records.filter((r) => (section === 'trash' ? !!r.values.archived : r.kind === section))),
								trash
									? 'Trash is empty.'
									: query
									? 'No records match your search.'
									: `Add your first ${SINGULAR[section as ServiceKind] || 'record'} to get started.`,
								false,
								pageTitle || 'Records',
								true
							)
						)}
					</>
				)}
			</main>
			<footer className="sw-footer">
				<Leaf size={14} />
				{data.name}
				<span>{data.timeZone}</span>
				<a href="/legal/privacy-policy">Privacy</a>
				<a href="/legal/terms-of-service">Terms</a>
			</footer>
			{draft && (
				<ServiceRecordEditor
					key={`${draft.record?.id || 'new'}:${draft.kind}`}
					draft={draft}
					data={data}
					close={() => setDraft(null)}
					report={report}
					saved={async (id, outcome) => {
						await refresh();
						setDraft(null);
						// A new child record (time/usage log, sub-job, customer link)
						// keeps the viewer on the parent it was added from.
						const parent = outcome.created ? serviceParentRecordId(outcome.kind, outcome.values, selectedId) : null;
						if (!parent) open(id);
						else if (parent !== selectedId) open(parent);
						lopu({ title: 'Record saved', status: 'success' });
					}}
				/>
			)}
			<AlertDialog
				isOpen={!!pendingDelete}
				leastDestructiveRef={cancelRef}
				onClose={() => {
					if (!busy) setPendingDelete(null);
				}}
			>
				<AlertDialogOverlay zIndex={DRAWER_MODAL_Z}>
					<AlertDialogContent containerProps={{ zIndex: DRAWER_MODAL_Z + 1 }} mx={3}>
						<AlertDialogHeader>Delete {pendingDelete ? serviceTitle(pendingDelete) : 'record'}?</AlertDialogHeader>
						<AlertDialogBody>This moves the record to Trash. You can restore it later. Related records and history remain available.</AlertDialogBody>
						<AlertDialogFooter>
							<Button ref={cancelRef} onClick={() => setPendingDelete(null)} isDisabled={busy}>
								Cancel
							</Button>
							<Button
								ml={3}
								colorScheme="red"
								isLoading={busy}
								onClick={() => {
									if (pendingDelete)
										void mutate({ operation: 'archive', id: pendingDelete.id, expectedUpdatedAt: pendingDelete.updatedAt }, 'Moved to Trash')
											.then(() => {
												setPendingDelete(null);
												// Deleting the open record returns to where it was opened
												// from; deleting from a list keeps the current page.
												if (pendingDelete.id === selectedId) back();
											})
											.catch(() => {});
								}}
							>
								Move to Trash
							</Button>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialogOverlay>
			</AlertDialog>
		</div>
	);
}
function PencilIcon() {
	return <Settings2 size={15} />;
}
