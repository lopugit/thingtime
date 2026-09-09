import React from 'react';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { sharedAttachmentUrl } from './sharedMediaCore';

const SharedMediaContext = React.createContext<(url: string) => string>((url) => url);
export const useSharedMediaUrl = () => React.useContext(SharedMediaContext);
export const SharedMediaProvider = ({ linkKey, children }: { linkKey?: string; children: React.ReactNode }) => {
	const [readyKey, setReadyKey] = React.useState<string>();
	const [failure, setFailure] = React.useState<string>();
	React.useEffect(() => {
		if (!linkKey) return;
		let cancelled = false;
		setFailure(undefined);
		void requireThingtimeCapability('api.attachment-content', '1.1.1').then(() => {
			if (!cancelled) setReadyKey(linkKey);
		}).catch(() => { if (!cancelled) setFailure(linkKey); });
		return () => { cancelled = true; };
	}, [linkKey]);
	const mediaUrl = React.useCallback((url: string) => {
		const authorized = sharedAttachmentUrl(url, linkKey);
		return authorized !== url && readyKey !== linkKey ? '' : authorized;
	}, [linkKey, readyKey]);
	return <SharedMediaContext.Provider value={mediaUrl}>{children}{linkKey && failure === linkKey ? <p role="alert">Shared media requires a newer server. Please refresh after the update.</p> : null}</SharedMediaContext.Provider>;
};
