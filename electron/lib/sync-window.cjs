'use strict';

/** A bounded lifetime lease for the bundled renderer's explicit sync run.
 * Closing hides an active Mac window; Quit and navigation always release it.
 * This grants no file access and does not launch a new transfer. */
class SyncWindowLease {
    constructor(context) { this.context = context; this.window = null; this.quitting = false; }
    set(event, input) {
        const { window, origin, enabled } = this.context();
        if (!enabled || !window || window.isDestroyed() || event.sender !== window.webContents ||
            event.senderFrame !== window.webContents.mainFrame || !origin ||
            new URL(event.senderFrame.url).origin !== origin || typeof input?.active !== 'boolean' ||
            Object.keys(input).length !== 1 || this.quitting) throw Error('Sync requires the bundled Thingtime window.');
        window.webContents.setBackgroundThrottling(!input.active);
        this.window = input.active ? window : null;
        return { ok: true, version: '1.0.0' };
    }
    close(event, window) {
        if (!this.quitting && this.window === window && !window.isDestroyed()) { event.preventDefault(); window.hide(); return true; }
        return false;
    }
    invalidate() {
        if (this.window && !this.window.isDestroyed()) this.window.webContents.setBackgroundThrottling(true);
        this.window = null;
    }
    quit() { this.quitting = true; this.invalidate(); }
}
module.exports = { SyncWindowLease };
