import React from 'react';
import { ThingDefinitionEditor } from './DefinitionEditor/ThingDefinitionEditor';
import { MenuItem } from '@chakra-ui/react';
import { useNavigate } from 'react-router';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useLopu } from '../Lopu/useLopu';
import { ThingTransferControls } from '../Things/ThingTransferControls';
import { RenameDialog, ShareDialog } from '../Things/ThingsDialogs';
import { thingRenameCrystal, type ThingsThing } from '../Things/thingsCore';
import { sharePathForThing } from '../Sharing/audienceCore';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';

/** Builder uses the same persisted content, audience and transfer operations as Things. */
export const BuilderThingMenu = (props: {
	id: string;
	linkKey?: string;
	kind?: 'webpage' | 'component';
	disabledReason?: string;
	onChanged?: () => void;
	onMetadataChanged?: (thing: ThingsThing) => void;
}) => {
	const user = useCurrentUser();
	return <BuilderThingActions key={`${user?.id || ''}:${props.id}:${props.linkKey || ''}`} {...props} ownerId={user?.id} />;
};

function BuilderThingActions({
	id,
	linkKey,
	kind = 'webpage',
	disabledReason,
	onChanged,
	onMetadataChanged,
	ownerId
}: React.ComponentProps<typeof BuilderThingMenu> & { ownerId?: string }) {
	const api = useApi();
	const navigate = useNavigate();
	const lopu = useLopu();
	const [thing, setThing] = React.useState<ThingsThing | null>(null);
	const [dialog, setDialog] = React.useState<'share' | 'rename' | 'definition' | null>(null);
	const [busy, setBusy] = React.useState(false);
	const active = React.useRef(true);
	const pending = React.useRef(false);
	React.useEffect(() => {
		active.current = true;
		return () => {
			active.current = false;
		};
	}, []);
	const own = !!ownerId && thing?.author?.id === ownerId;
	const refresh = async () => {
		try {
			const response = await api.v1.things.get({ id, key: linkKey });
			if (!active.current) return;
			if (!response?.ok || !response.thing) throw new Error(response?.error || 'Could not read this Thing');
			setThing(response.thing);
		} catch (error) {
			if (active.current)
				lopu({ title: 'Could not load settings', description: error instanceof Error ? error.message : 'Try again.', status: 'error' });
		}
	};
	const run = async (operation: () => Promise<boolean>): Promise<boolean> => {
		if (pending.current || disabledReason) return false;
		pending.current = true;
		setBusy(true);
		try {
			return await operation();
		} catch (error) {
			if (active.current)
				lopu({ title: 'Could not update this Thing', description: error instanceof Error ? error.message : 'Try again.', status: 'error' });
			return false;
		} finally {
			pending.current = false;
			if (active.current) setBusy(false);
		}
	};
	const changed = async () => {
		if (!active.current) return;
		await refresh();
		onChanged?.();
	};
	const copyLink = () => {
		const path = thing ? sharePathForThing(thing) : kind === 'webpage' ? `/p/${encodeURIComponent(id)}` : `/thing/${encodeURIComponent(id)}`;
		void navigator.clipboard
			.writeText(new URL(path, window.location.origin).href)
			.then(() => {
				if (active.current) lopu({ title: 'Link copied', status: 'success' });
			})
			.catch(() => {
				if (active.current) lopu({ title: 'Could not copy link', status: 'error' });
			});
	};
	return (
		<>
			<ThingTransferControls
				id={id}
				linkKey={linkKey}
				settings
				label={`${kind === 'webpage' ? 'Page' : 'Component'} settings`}
				onOpen={() => void refresh()}
				canCut={own}
				disabledReason={disabledReason}
				onImported={onChanged}
				menuItems={
					<>
						<MenuItem onClick={() => setDialog('definition')} isDisabled={!own || busy || !!disabledReason}>Edit definition…</MenuItem>
						<MenuItem onClick={() => setDialog('share')} isDisabled={!own || busy || !!disabledReason}>
							Privacy and sharing…
						</MenuItem>
						<MenuItem onClick={copyLink}>Share / Copy link</MenuItem>
						<MenuItem onClick={() => setDialog('rename')} isDisabled={!own || busy || !!disabledReason}>
							Rename…
						</MenuItem>
						<MenuItem
							isDisabled={!ownerId || busy || !!disabledReason}
							onClick={() =>
								void run(async () => {
									await requireThingtimeCapability('api.things-fork', '1.6.0');
									if (!active.current) return false;
									const response = await fetch('/api/v1/things/fork', {
										method: 'POST',
										credentials: 'include',
										headers: { 'Content-Type': 'application/json' },
										body: JSON.stringify({ id, key: linkKey })
									});
									const data = await response.json();
									if (!response.ok || !data.ok || !data.id) throw new Error(data.error || 'Could not duplicate this Thing');
									if (!active.current) return false;
									lopu({ title: 'Private duplicate created', status: 'success' });
									onChanged?.();
									navigate(kind === 'webpage' ? `/builder?page=${encodeURIComponent(data.id)}` : `/thing/${encodeURIComponent(data.id)}`);
									return true;
								})
							}
						>
							Duplicate privately
						</MenuItem>
						<MenuItem onClick={() => navigate(`/thing/${encodeURIComponent(id)}`)}>Open in Things</MenuItem>
					</>
				}
			/>
			{dialog === 'definition' ? <ThingDefinitionEditor id={id} onClose={() => setDialog(null)} onSaved={() => void changed()} /> : null}
			<ShareDialog
				things={dialog === 'share' && thing ? [thing] : []}
				onClose={() => setDialog(null)}
				onApply={(acl) =>
					run(async () => {
						const response = await api.v1.things.bulk({ op: 'share', ids: [id], acl });
						if (!response?.ok || response.succeeded !== 1)
							throw new Error(response?.results?.find((result: any) => !result.ok)?.error || response?.error || 'Could not change privacy');
						if (!active.current) return false;
						if (thing) onMetadataChanged?.({ ...thing, acl });
						lopu({ title: 'Privacy updated', status: 'success' });
						await changed();
						return true;
					})
				}
			/>
			<RenameDialog
				thing={dialog === 'rename' ? thing : null}
				onClose={() => setDialog(null)}
				onRename={(current, name) =>
					run(async () => {
						const response = await api.v1.things.update({ id, crystal: thingRenameCrystal(current, name), expectedUpdatedAt: current.updatedAt });
						if (!response?.ok) throw new Error(response?.error || 'Could not rename');
						if (!active.current) return false;
						onMetadataChanged?.({ ...current, crystal: { ...current.crystal, ...thingRenameCrystal(current, name) } });
						lopu({ title: 'Renamed', status: 'success' });
						await changed();
						return true;
					})
				}
			/>
		</>
	);
}
