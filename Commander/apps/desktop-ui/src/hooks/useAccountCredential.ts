import { useEffect } from 'react';
import type { CommanderAccount } from '@commander/protocol';
import { api } from '../lib/api.js';
import { nativeBridgeAvailable, nativeRequest } from '../lib/nativeBridge.js';

/** Restore the account's original credential, independent of the next-login profile. */
export function useAccountCredential(
  account: CommanderAccount | undefined,
  refresh: () => Promise<void>,
  reportError: (message: string | null) => void,
): void {
  const id = account?.id;
  const issuer = account?.environment?.baseUrl;
  const clientId = account?.environment?.clientId;
  useEffect(() => {
    if (!id || !nativeBridgeAvailable()) return;
    let cancelled = false;
    let pending = false;
    let restoreFailed = false;
    const restore = async () => {
      if (pending || cancelled) return;
      pending = true;
      try {
        let environment = issuer && clientId ? { baseUrl: issuer, clientId } : undefined;
        if (!environment) {
          const metadata = await nativeRequest<{
            environments?: Array<{ accountId: string; baseUrl: string; clientId: string }>;
          }>('credential.environments', { accountIds: [id] });
          if (cancelled) return;
          const matches = (metadata?.environments ?? []).filter((entry) => entry.accountId === id);
          const unique = new Map(
            matches.map((entry) => [JSON.stringify([entry.baseUrl, entry.clientId]), entry]),
          );
          if (unique.size !== 1)
            throw new Error('The saved account could not be matched to one Keychain environment.');
          const result = await api.reconcileAccountEnvironments([...unique.values()]);
          environment = result.accounts.find((entry) => entry.id === id)?.environment;
          if (!environment) throw new Error('The saved account environment could not be restored.');
          if (!cancelled) await refresh();
        }
        if (cancelled) return;
        await nativeRequest('credential.unlock', {
          accountId: id,
          issuer: environment.baseUrl,
          clientId: environment.clientId,
        });
        if (!cancelled && restoreFailed) reportError(null);
        restoreFailed = false;
      } catch {
        restoreFailed = true;
        if (!cancelled)
          reportError(
            'Commander could not unlock the saved account. Your account is still saved. Unlock your Mac Keychain and return to Commander to retry.',
          );
      } finally {
        pending = false;
      }
    };
    void restore();
    // A locked Keychain is temporary; retry on returning to the app, not in a loop.
    window.addEventListener('focus', restore);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', restore);
    };
  }, [id, issuer, clientId, refresh, reportError]);
}
