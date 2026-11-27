/** A suspended WebView can miss progress hints and visibilitychange. Never
 * retain lease-active certainty across a native resume/focus boundary. */
export function nativePhotoProgressLifecycle(input: {
    window: EventTarget; document: EventTarget; visible: () => boolean;
    invalidate: () => void; refresh: () => void; hidden: () => void;
}) {
    const reconcile = () => {
        input.invalidate();
        if (input.visible()) input.refresh();
        else input.hidden();
    };
    input.document.addEventListener('visibilitychange', reconcile);
    input.window.addEventListener('pageshow', reconcile);
    input.window.addEventListener('focus', reconcile);
    return () => {
        input.document.removeEventListener('visibilitychange', reconcile);
        input.window.removeEventListener('pageshow', reconcile);
        input.window.removeEventListener('focus', reconcile);
    };
}
