import React from 'react';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { sharedAttachmentUrl, sharedThingPath } from './sharedMediaCore';

const SharedMediaContext = React.createContext<(url: string) => string>((url) => url);
const SharedLinkContext = React.createContext<{ linkKey?: string; sharedRoot?: string }>({});
export const useSharedAccess = () => {
  const { linkKey, sharedRoot } = React.useContext(SharedLinkContext);
  return { key: linkKey, sharedRoot };
};
export const useSharedThingPath = () => {
  const context = React.useContext(SharedLinkContext);
  return (url: string) => sharedThingPath(url, context.linkKey, context.sharedRoot);
};
export const useSharedMediaUrl = () => React.useContext(SharedMediaContext);
export const SharedMediaProvider = ({ linkKey, sharedRoot, children, inheritContext = true }: { linkKey?: string; sharedRoot?: string; children: React.ReactNode; inheritContext?: boolean }) => {
	const parent = React.useContext(SharedLinkContext);
	linkKey = linkKey || (inheritContext ? parent.linkKey : undefined);
	sharedRoot = sharedRoot || (inheritContext ? parent.sharedRoot : undefined);
	const contextKey = JSON.stringify([linkKey || '', sharedRoot || '']);
	const [readyKey, setReadyKey] = React.useState<string>();
	const [failure, setFailure] = React.useState<string>();
	React.useEffect(() => {
		if (!linkKey && !sharedRoot) return;
		let cancelled = false;
		setFailure(undefined);
		void requireThingtimeCapability('api.attachment-content', sharedRoot ? '1.6.3' : '1.1.1').then(() => {
			if (!cancelled) setReadyKey(contextKey);
		}).catch(() => { if (!cancelled) setFailure(contextKey); });
		return () => { cancelled = true; };
	}, [linkKey, sharedRoot, contextKey]);
	const mediaUrl = React.useCallback((url: string) => {
		const authorized = sharedAttachmentUrl(url, linkKey, sharedRoot);
		return authorized !== url && readyKey !== contextKey ? '' : authorized;
	}, [linkKey, sharedRoot, readyKey, contextKey]);
	return <SharedLinkContext.Provider value={{ linkKey, sharedRoot }}><SharedMediaContext.Provider value={mediaUrl}>{children}{(linkKey || sharedRoot) && failure === contextKey ? <p role="alert">Shared media requires a newer server. Please refresh after the update.</p> : null}</SharedMediaContext.Provider></SharedLinkContext.Provider>;
};
