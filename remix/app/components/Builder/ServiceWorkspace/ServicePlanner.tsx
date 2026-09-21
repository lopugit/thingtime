import React from 'react';
import { serviceDateOffset, serviceTitle, serviceWeekStart, type ServiceRecord } from '~/schemas/serviceWorkspace';
import { workspaceRequest } from './client';

export function ServicePlanner({
	rootId,
	records,
	canEdit,
	open,
	create,
	refresh,
	report,
	timeZone,
	menu
}: {
	rootId: string;
	records: ServiceRecord[];
	canEdit: boolean;
	open: (id: string) => void;
	create: (date: string) => void;
	refresh: () => Promise<void>;
	report: (error: unknown) => void;
	timeZone: string;
	menu: (record: ServiceRecord) => React.ReactNode;
}) {
	const today = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
	const [date, setDate] = React.useState(today);
	const [mode, setMode] = React.useState<'day' | 'week'>('week');
	const [moving, setMoving] = React.useState(false);
	const [dragging, setDragging] = React.useState<string | null>(null);
	const busy = React.useRef(false);
	const [optimistic, setOptimistic] = React.useState<{ id: string; date: string; order: number } | null>(null);
	const start = mode === 'week' ? serviceWeekStart(date) : date;
	const days = Array.from({ length: mode === 'week' ? 7 : 1 }, (_, n) => serviceDateOffset(start, n));
	const visits = records
		.filter((r) => r.kind === 'visit' && !r.values.archived)
		.map((r) => (optimistic?.id === r.id ? { ...r, values: { ...r.values, date: optimistic.date, order: optimistic.order } } : r));
	async function move(record: ServiceRecord, day: string, before?: ServiceRecord) {
		if (!canEdit || busy.current || before?.id === record.id) return;
		const list = visits.filter((r) => r.id !== record.id && r.values.date === day).sort((a, b) => (a.values.order || 0) - (b.values.order || 0));
		const index = before ? list.findIndex((r) => r.id === before.id) : list.length;
		const prev = list[index - 1]?.values.order;
		const next = list[index]?.values.order;
		const order = prev === undefined ? (next ?? 1024) - 1024 : next === undefined ? prev + 1024 : (prev + next) / 2;
		busy.current = true;
		setMoving(true);
		setOptimistic({ id: record.id, date: day, order });
		try {
			await workspaceRequest(rootId, {
				operation: 'move',
				id: record.id,
				date: day,
				time: record.values.time,
				order,
				expectedUpdatedAt: record.updatedAt
			});
			await refresh();
		} catch (error) {
			report(error);
		} finally {
			busy.current = false;
			setMoving(false);
			setOptimistic(null);
			setDragging(null);
		}
	}
	return (
		<section aria-label="Job planner">
			<div className="sw-toolbar">
				<div className="sw-buttons">
					<button onClick={() => setDate(serviceDateOffset(date, mode === 'week' ? -7 : -1))} aria-label="Previous period">
						←
					</button>
					<button onClick={() => setDate(today)}>Today</button>
					<button onClick={() => setDate(serviceDateOffset(date, mode === 'week' ? 7 : 1))} aria-label="Next period">
						→
					</button>
				</div>
				<h2>{new Date(start + 'T12:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}</h2>
				<div className="sw-buttons">
					<button aria-pressed={mode === 'day'} onClick={() => setMode('day')}>
						Day
					</button>
					<button aria-pressed={mode === 'week'} onClick={() => setMode('week')}>
						Week
					</button>
					<label className="sw-sr">
						Planner date
						<input
							type="date"
							value={date}
							onChange={(e) => e.target.value && setDate(e.target.value)}
							onInput={(e) => e.currentTarget.value && setDate(e.currentTarget.value)}
						/>
					</label>
				</div>
			</div>
			<p className="sw-muted">
				{timeZone} · {canEdit ? 'Drag visits between days or use the move controls. Open a visit to set its time.' : 'Your upcoming visits.'}
				{moving ? ' Saving move…' : ''}
			</p>
			<div className={`sw-planner sw-planner-${mode}`}>
				{days.map((day) => {
					const items = visits.filter((r) => r.values.date === day).sort((a, b) => (a.values.order || 0) - (b.values.order || 0));
					return (
						<section
							key={day}
							className={'sw-day' + (day === today ? ' sw-day-today' : '')}
							aria-label={day}
							onDragOver={(e) => {
								if (dragging && canEdit) e.preventDefault();
							}}
							onDrop={(e) => {
								e.preventDefault();
								const record = records.find((r) => r.id === dragging);
								if (record) void move(record, day);
							}}
						>
							<header>
								<h3>{new Date(day + 'T12:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric' })}</h3>
								<span>{items.length}</span>
							</header>
							{items.map((visit, index) => (
								<article
									key={visit.id}
									className="sw-visit"
									draggable={canEdit && !moving}
									onDragStart={(e) => {
										setDragging(visit.id);
										e.dataTransfer.effectAllowed = 'move';
										e.dataTransfer.setData('text/plain', visit.id);
									}}
									onDragEnd={() => setDragging(null)}
									onDragOver={(e) => {
										if (dragging) {
											e.preventDefault();
											e.stopPropagation();
										}
									}}
									onDrop={(e) => {
										e.preventDefault();
										e.stopPropagation();
										const record = records.find((r) => r.id === dragging);
										if (record) void move(record, day, visit);
									}}
								>
									<button className="sw-card-open" onClick={() => open(visit.id)}>
										<span className="sw-badge">{visit.values.status || 'Scheduled'}</span>
										<strong>{serviceTitle(visit)}</strong>
										<span>{visit.values.time || 'Time to be set'}</span>
									</button>
									{menu(visit)}
									{canEdit && (
										<div className="sw-move-controls">
											<button
												disabled={moving || index === 0}
												aria-label={`Move ${serviceTitle(visit)} up`}
												onClick={() => void move(visit, day, items[index - 1])}
											>
												↑
											</button>
											<button
												disabled={moving || index === items.length - 1}
												aria-label={`Move ${serviceTitle(visit)} down`}
												onClick={() => void move(visit, day, items[index + 2])}
											>
												↓
											</button>
											<label>
												Move to
												<input
													type="date"
													aria-label={`Move ${serviceTitle(visit)} to date`}
													value={day}
													disabled={moving}
													onChange={(e) => e.target.value && void move(visit, e.target.value)}
													onInput={(e) => e.currentTarget.value && e.currentTarget.value !== day && void move(visit, e.currentTarget.value)}
												/>
											</label>
										</div>
									)}
								</article>
							))}
							{!items.length && <p className="sw-empty-small">No visits scheduled</p>}
							{canEdit && (
								<button className="sw-add-day" onClick={() => create(day)}>
									+ Schedule visit
								</button>
							)}
						</section>
					);
				})}
			</div>
		</section>
	);
}
