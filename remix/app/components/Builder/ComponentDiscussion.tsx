import React from 'react';
// A static import lets the lightweight embed tree-shake this interactive UI.
import { ThingComments } from '../Things/ThingComments';
import { NativeControlsEnabled } from './NativeComponentControls';
import { useWebpageRuntime } from './webpageRuntime';

// This control uses the canonical Thing discussion and its API authorization.
// Authored markup cannot inject a post projection, viewer, or write callback.
export function ComponentDiscussion({ thingId, description, collectionControls }: Record<string, unknown>) {
	const enabled = React.useContext(NativeControlsEnabled);
	const runtime = useWebpageRuntime();
	if (!enabled) return <p role="note">Discussion is available on the interactive page.</p>;
	if (typeof thingId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(thingId))
		return <p role="note">Choose a Thing to display its discussion.</p>;
	return (
		<div data-tt-discussion onClick={(event) => event.stopPropagation()}>
			<ThingComments
				thingId={thingId}
				description={typeof description === 'string' ? description.slice(0, 2000) : undefined}
				collectionControls={collectionControls !== false}
				onCommentAdded={runtime.refresh}
			/>
		</div>
	);
}
