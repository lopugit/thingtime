import React from 'react';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { sharedAttachmentUrl } from './sharedMediaCore';

const SharedMediaContext = React.createContext<(url: string) => string>((url) => url);
export const useSharedMediaUrl = () => React.useContext(SharedMediaContext);
export const SharedMediaProvider = ({ linkKey, sharedRoot, children }: { linkKey?: string; sharedRoot?: string; children: React.ReactNode }) => {
	const contextKey = JSON.stringify([linkKey || '', sharedRoot || '']);
	const [readyKey, setReadyKey] = React.useState<string>();
	const [failure, setFailure] = React.useState<string>();
	React.useEffect(() => {
		if (!linkKey && !sharedRoot) return;
		let cancelled = false;
		setFailure(undefined);
		void requireThingtimeCapability('api.attachment-content', sharedRoot ? '1.6.2' : '1.1.1').then(() => {
			if (!cancelled) setReadyKey(contextKey);
		}).catch(() => { if (!cancelled) setFailure(contextKey); });
		return () => { cancelled = true; };
	}, [linkKey, sharedRoot, contextKey]);
	const mediaUrl = React.useCallback((url: string) => {
		const authorized = sharedAttachmentUrl(url, linkKey, sharedRoot);
		return authorized !== url && readyKey !== contextKey ? '' : authorized;
	}, [linkKey, sharedRoot, readyKey, contextKey]);
	return <SharedMediaContext.Provider value={mediaUrl}>{children}{(linkKey || sharedRoot) && failure === contextKey ? <p role="alert">Shared media requires a newer server. Please refresh after the update.</p> : null}</SharedMediaContext.Provider>;
};
