import type { DesktopBundleCheckpointReason } from './electronBridge';
/** Explicit lifecycle participants. No draft content or credentials cross IPC. */
export type DesktopUpdateParticipant = {
  kind: 'persistence' | 'work';
  ready: () => boolean;
  checkpoint?: (signal: AbortSignal) => Promise<() => boolean>;
  automaticUpdates?: (sessionHash: string) => boolean;
};
export function waitForDesktopUpdateWork<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const aborted = () => { signal.removeEventListener('abort', aborted); reject(signal.reason); };
    if (signal.aborted) { reject(signal.reason); return; }
    signal.addEventListener('abort', aborted, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}
export function createDesktopBundleSafety() {
  const participants = new Set<DesktopUpdateParticipant>();
  const listeners = new Set<() => void>();
  let generation = 0;
  const changed = () => { generation++; listeners.forEach(fn => fn()); };
  return {
    changed,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    register(participant: DesktopUpdateParticipant) {
      participants.add(participant); changed();
      return () => { participants.delete(participant); changed(); };
    },
    automaticUpdatesEnabled(sessionHash: string) {
      const members = [...participants].filter(p => p.kind === 'persistence');
      return Boolean(sessionHash) && members.length > 0 && members.every(p => p.ready()) &&
        members.some(p => p.automaticUpdates?.(sessionHash) === true) && !members.some(p => p.automaticUpdates?.(sessionHash) === false);
    },
    async checkpoint(signal: AbortSignal, sessionHash: string, observe?: (reason: DesktopBundleCheckpointReason) => void) {
      const report = (reason: DesktopBundleCheckpointReason) => { try { observe?.(reason); } catch { /* Diagnostics cannot change safety. */ } };
      const start = generation, members = [...participants];
      const current = () => {
        if (signal.aborted || start !== generation) { report('participant-changed'); return false; }
        for (const member of members) {
          let ready: boolean;
          try { ready = member.ready(); } catch (error) { report('participant-unavailable'); throw error; }
          if (!ready) { report(member.kind === 'persistence' ? 'persistence-unready' : 'work-unready'); return false; }
        }
        return true;
      };
      const persistence = members.filter(p => p.kind === 'persistence');
      if (!persistence.length) { report('persistence-missing'); throw Error('Desktop persistence is not ready'); }
      if (!current()) throw Error('Desktop persistence is not ready');
      let enabled: boolean;
      try { enabled = persistence.some(p => p.automaticUpdates?.(sessionHash) === true) && !persistence.some(p => p.automaticUpdates?.(sessionHash) === false); }
      catch (error) { report('preference-unavailable'); throw error; }
      if (!enabled) {
        report('preference-disabled'); throw Error('Desktop persistence is not ready');
      }
      const checks: (() => boolean)[] = [];
      for (const member of members) {
        signal.throwIfAborted();
        if (!current()) throw Error('Desktop work changed');
        if (member.checkpoint) {
          report(member.kind === 'persistence' ? 'persistence-checkpoint' : 'participant-checkpoint');
          checks.push(await waitForDesktopUpdateWork(member.checkpoint(signal), signal));
        }
      }
      if (!current()) throw Error('Desktop checkpoint changed');
      if (!checks.every(check => check())) { report('certificate-invalid'); throw Error('Desktop checkpoint changed'); }
      report('certificate-ready');
      return () => current() && checks.every(check => check());
    }
  };
}
export const desktopBundleSafety = createDesktopBundleSafety();
