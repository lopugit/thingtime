import React from 'react';
import { createFolderHostFetch } from '~/fileSync/folderHostFetch.client';
import { useDataPlane } from '~/hooks/useDataPlane';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { rootIdentity } from '~/utils/rootIdentity';
import { getElectronBridge } from '~/utils/electronBridge';
import type { CapabilityTransport } from '~/api/utils/capabilities/requireCapability.client';

type Scope = { expectedActor: string; expectedApiOrigin: string };
type Transport = CapabilityTransport & { origin: string };
export type AdminSettingsEditorProps = { scope: Scope; transport: Transport; dataPlane: string };

export function AdminSettingsScope({ editor: Editor }: { editor: React.ComponentType<AdminSettingsEditorProps> }) {
	const user = useCurrentUser();
	const identity = React.useSyncExternalStore(rootIdentity.subscribe, rootIdentity.read, rootIdentity.read);
	const [selected, setSelected] = React.useState<{ generation: number; origin: string } | null>(null);
	React.useEffect(() => {
		let active = true;
		const bridge = getElectronBridge();
		if (!bridge) setSelected({ generation: identity.generation, origin: window.location.origin });
		else
			void bridge
				.getInfo?.()
				.then((info) => {
					if (active && info.apiOrigin) setSelected({ generation: identity.generation, origin: new URL(info.apiOrigin).origin });
				})
				.catch(() => {
					if (active) setSelected(null);
				});
		return () => {
			active = false;
		};
	}, [identity.generation]);
	if (!user?.isAdmin || identity.pending || selected?.generation !== identity.generation) return null;
	return (
		<ScopedAdminEditor
			editor={Editor}
			key={JSON.stringify([user.id, selected.origin, identity.generation])}
			scope={{ expectedActor: user.id, expectedApiOrigin: selected.origin }}
		/>
	);
}
function ScopedAdminEditor({ scope, editor: Editor }: { scope: Scope; editor: React.ComponentType<AdminSettingsEditorProps> }) {
	const dataPlane = useDataPlane();
	const { expectedActor, expectedApiOrigin } = scope;
	const transport = React.useMemo(() => {
		const generation = rootIdentity.read().generation;
		const check = () => {
			const identity = rootIdentity.read();
			if (identity.pending || identity.generation !== generation) throw new Error('The settings account or server changed.');
		};
		return {
			origin: expectedApiOrigin,
			currentOrigin: () => {
				check();
				return expectedApiOrigin;
			},
			fetch: createFolderHostFetch({
				origin: expectedApiOrigin,
				localOrigin: window.location.origin,
				ownerId: expectedActor,
				expectedDataPlane: dataPlane ?? 'unavailable',
				signal: new AbortController().signal,
				check,
				fetch: window.fetch.bind(window)
			})
		};
	}, [expectedActor, expectedApiOrigin, dataPlane]);
	return <Editor key={dataPlane ?? 'unavailable'} scope={scope} transport={transport} dataPlane={dataPlane ?? 'unavailable'} />;
}
