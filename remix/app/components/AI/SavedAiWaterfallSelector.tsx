import React from 'react';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { AiWaterfallSelector, type AiWaterfallSelectorProps } from './AiWaterfallSelector';
import { useSavedAiWaterfalls } from './useSavedAiWaterfalls';
import { aiWaterfallEndpoints } from '~/api/utils/ai/waterfallCatalog';
type Props = Omit<AiWaterfallSelectorProps, 'endpoints' | 'library'> & { endpoints?: AiWaterfallSelectorProps['endpoints'] };
export const SavedAiWaterfallSelector = (props: Props) => {
	const user = useCurrentUser();
	if (!props.isOpen) return null;
	return user && !user.temporary ? (
		<Connected key={user.id} {...props} userId={user.id} />
	) : (
		<AiWaterfallSelector {...props} endpoints={props.endpoints ?? aiWaterfallEndpoints()} />
	);
};
const Connected = ({ userId, ...props }: Props & { userId: string }) => {
	const library = useSavedAiWaterfalls(userId);
	return <AiWaterfallSelector {...props} endpoints={props.endpoints ?? library.endpoints} library={library} />;
};
