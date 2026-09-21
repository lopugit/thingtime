import React from 'react';
import { AttachmentComposer, type AttachmentComposerHandle } from '~/components/Attachments/AttachmentComposer';
import type { AttachmentComposerSnapshot, PublicAttachment } from '~/components/Attachments/attachmentTypes';
import { PostAttachments } from '~/components/Attachments/PostAttachments';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import type { ServiceRecord } from '~/schemas/serviceWorkspace';

type MediaEntry = { id: string; crystal: { text?: string }; attachments?: PublicAttachment[] };
export function ServiceMedia({
	record,
	canEdit,
	report,
	selectImage
}: {
	record: ServiceRecord;
	canEdit: boolean;
	report: (error: unknown) => void;
	selectImage: (key: 'thumbnailId' | 'bannerId', id: string) => Promise<void>;
}) {
	const api = useApi();
	const user = useCurrentUser();
	const apiRef = React.useRef(api);
	apiRef.current = api;
	const reportRef = React.useRef(report);
	reportRef.current = report;
	const [entries, setEntries] = React.useState<MediaEntry[]>([]);
	const [cursor, setCursor] = React.useState<string | null>(null);
	const [title, setTitle] = React.useState('');
	const [description, setDescription] = React.useState('');
	const [stage, setStage] = React.useState('Gallery');
	const [split, setSplit] = React.useState(false);
	const [snapshot, setSnapshot] = React.useState<AttachmentComposerSnapshot | null>(null);
	const [saving, setSaving] = React.useState(false);
	const [composerVersion, setComposerVersion] = React.useState(0);
	const [error, setError] = React.useState('');
	const composer = React.useRef<AttachmentComposerHandle>(null);
	const requestId = React.useRef(crypto.randomUUID());
	const live = React.useRef(true);
	const busy = React.useRef(false);
	const load = React.useCallback(
		async (after?: string) => {
			try {
				await Promise.all([requireThingtimeCapability('api.things', '1.24.0'), requireThingtimeCapability('api.attachment-content', '1.10.0')]);
				const result = await apiRef.current.v1.things.list({ target: record.id, thingtime: 'comment', cursor: after, limit: 50 });
				if (!result.ok) throw new Error(result.error || 'Could not load media');
				if (live.current) {
					setEntries((previous) => [
						...new Map<string, MediaEntry>([...(after ? previous : []), ...result.things].map((entry: MediaEntry) => [entry.id, entry])).values()
					]);
					setCursor(result.nextCursor || null);
				}
			} catch (error) {
				if (live.current) {
					setError((error as Error).message);
					reportRef.current(error);
				}
			}
		},
		[record.id]
	);
	React.useEffect(() => {
		live.current = true;
		void load();
		return () => {
			live.current = false;
		};
	}, [load]);
	async function save(event: React.FormEvent) {
		event.preventDefault();
		if (busy.current || !snapshot?.attachmentIds.length || snapshot.blocking) return;
		busy.current = true;
		setSaving(true);
		setError('');
		try {
			await requireThingtimeCapability('api.things-comment', '1.7.0');
			const result = await apiRef.current.v1.things.comment({
				id: record.id,
				shareId: requestId.current,
				text: `[${stage}] ${title.trim() || 'Media'}${description.trim() ? `\n${description.trim()}` : ''}`,
				attachmentIds: snapshot.attachmentIds
			});
			if (!result.ok) throw new Error(result.error || 'Could not save media');
			composer.current?.markCommitted(snapshot.attachmentIds);
			setSnapshot(null);
			setComposerVersion((version) => version + 1);
			requestId.current = crypto.randomUUID();
			setTitle('');
			setDescription('');
			if (stage === 'Before' && split) setStage('After');
			await load();
		} catch (error) {
			setError((error as Error).message);
			report(error);
		} finally {
			busy.current = false;
			setSaving(false);
		}
	}
	const media = entries.filter((entry) => entry.attachments?.length);
	const gallery = (filter?: string) => (
		<div className="sw-media-list">
			{media
				.filter((entry) => !filter || String(entry.crystal.text).startsWith(`[${filter}]`))
				.map((entry) => (
					<article key={entry.id} className="sw-media-entry">
						<p className="sw-media-caption">{entry.crystal.text}</p>
						<PostAttachments attachments={entry.attachments} postId={entry.id} />
						{canEdit && ['customer', 'address', 'equipment'].includes(record.kind) && (
							<div className="sw-image-picks">
								{entry.attachments
									?.filter((a) => a.mediaKind === 'image')
									.map((a) => (
										<div key={a.id}>
											<span>{a.title || a.name || 'Image'}</span>
											<button onClick={() => void selectImage('thumbnailId', a.id).catch(() => {})}>
												Use as {record.kind === 'customer' ? 'profile' : 'thumbnail'}
											</button>
											{record.kind === 'address' && <button onClick={() => void selectImage('bannerId', a.id).catch(() => {})}>Use as banner</button>}
										</div>
									))}
							</div>
						)}
					</article>
				))}
		</div>
	);
	return (
		<section className="sw-panel">
			<div className="sw-section-heading">
				<h2>Photos & attachments</h2>
				{['job', 'visit'].includes(record.kind) && (
					<label className="sw-check">
						<input
							type="checkbox"
							checked={split}
							onChange={(event) => {
								setSplit(event.target.checked);
								setStage(event.target.checked ? 'Before' : 'Gallery');
							}}
						/>
						Before / after
					</label>
				)}
			</div>
			{split ? (
				<div className="sw-split">
					<div>
						<h3>Before</h3>
						{gallery('Before')}
					</div>
					<div>
						<h3>After</h3>
						{gallery('After')}
					</div>
				</div>
			) : (
				gallery()
			)}
			{!media.length && <p className="sw-muted">Add photos, videos, documents, or audio for this {record.kind === 'visit' ? 'visit' : 'record'}.</p>}
			{cursor && <button onClick={() => void load(cursor)}>Load older media</button>}
			{canEdit && user && (
				<details className="sw-upload-details">
					<summary>Add media</summary>
					<form className="sw-form" onSubmit={save}>
						<label>
							<span>Title</span>
							<input
								value={title}
								onChange={(e) => setTitle(e.target.value)}
								maxLength={200}
								placeholder="e.g. Front lawn complete"
								disabled={saving}
							/>
						</label>
						{['job', 'visit'].includes(record.kind) && (
							<label>
								<span>Stage</span>
								<select value={stage} onChange={(e) => setStage(e.target.value)} disabled={saving}>
									<option>Gallery</option>
									<option>Before</option>
									<option>After</option>
								</select>
							</label>
						)}
						<label className="sw-wide">
							<span>Description</span>
							<textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={3000} rows={2} disabled={saving} />
						</label>
						<div className="sw-wide">
							<AttachmentComposer
								key={composerVersion}
								ref={composer}
								ownerId={user.id}
								purpose="comment"
								disabled={saving}
								onChange={setSnapshot}
								ariaLabel="Upload record media"
								helperText="Choose multiple files. You can add a title and description to each file."
							/>
						</div>
						<button type="submit" className="sw-primary" disabled={saving || !snapshot?.attachmentIds.length || snapshot.blocking}>
							{saving ? 'Saving…' : `Save ${stage.toLowerCase()} media`}
						</button>
					</form>
				</details>
			)}
			{error && (
				<p className="sw-error" role="alert">
					{error}
				</p>
			)}
		</section>
	);
}
