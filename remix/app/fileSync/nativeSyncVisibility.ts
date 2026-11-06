import { nativeUploadMayContinue, subscribeNativeUploadBackground } from './nativeUploadBackground';

export const NATIVE_SYNC_FOREGROUND_WAIT = 'Transfer saved. It will resume when Thingtime returns to the foreground.';

/** A native lease covers only the already accepted file. Once it ends, no new
 * scan, API call or file operation may be admitted while the WebView is hidden. */
export function watchNativeSyncVisibility(signal: AbortSignal, suspend: (message: string) => void,
	page: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'> = document) {
	const changed = () => {
		if (!signal.aborted && page.visibilityState === 'hidden' && !nativeUploadMayContinue(signal)) suspend(NATIVE_SYNC_FOREGROUND_WAIT);
	};
	page.addEventListener('visibilitychange', changed);
	const unsubscribe = subscribeNativeUploadBackground(signal, changed);
	return {
		check() { changed(); signal.throwIfAborted(); },
		dispose() { page.removeEventListener('visibilitychange', changed); unsubscribe(); }
	};
}
