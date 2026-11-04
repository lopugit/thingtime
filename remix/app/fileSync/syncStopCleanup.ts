/** Stop may arrive while the journal is opening. Keep its owner alive until
 * the eventual scoped pause and independent capture cleanup settle. */
export function createSyncStopCleanup(unavailable: () => Promise<void> = async () => {}) {
 let ready!: () => void;
 const initialized = new Promise<void>(resolve => { ready = resolve; });
 let cleanup = unavailable, work: Promise<void> | undefined;
 return {
  install(callback: () => Promise<void>) { cleanup = callback; ready(); },
  request() { return work ??= initialized.then(() => cleanup()); },
  finish() { ready(); return work ?? Promise.resolve(); }
 };
}
