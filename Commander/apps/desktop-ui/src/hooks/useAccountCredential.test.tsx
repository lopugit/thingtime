// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommanderAccount } from '@commander/protocol';
import { useAccountCredential } from './useAccountCredential.js';
import { nativeRequest } from '../lib/nativeBridge.js';
import { api } from '../lib/api.js';
vi.mock('../lib/nativeBridge.js', () => ({ nativeBridgeAvailable: () => true, nativeRequest: vi.fn() }));
vi.mock('../lib/api.js', () => ({ api: { reconcileAccountEnvironments: vi.fn() } }));
const account: CommanderAccount = {
  id: 'saved',
  username: 'fixture',
  scopes: [],
  expiresAt: '2030-01-01',
  environment: { baseUrl: 'https://original.test', clientId: 'legacy-client' },
};
const { environment: _environment, ...legacyAccount } = account;
afterEach(cleanup);
beforeEach(() => vi.resetAllMocks());
describe('saved account restoration', () => {
  it('uses the saved issuer and legacy client, and restores each switched account', async () => {
    const refresh = vi.fn();
    const report = vi.fn();
    const { rerender } = renderHook(({ value }) => useAccountCredential(value, refresh, report), {
      initialProps: { value: account },
    });
    await waitFor(() =>
      expect(nativeRequest).toHaveBeenCalledWith('credential.unlock', {
        accountId: 'saved',
        issuer: 'https://original.test',
        clientId: 'legacy-client',
      }),
    );
    rerender({
      value: {
        ...account,
        id: 'other',
        environment: { baseUrl: 'https://other.test', clientId: 'other-client' },
      },
    });
    await waitFor(() =>
      expect(nativeRequest).toHaveBeenLastCalledWith('credential.unlock', {
        accountId: 'other',
        issuer: 'https://other.test',
        clientId: 'other-client',
      }),
    );
    rerender({ value: account });
    await waitFor(() =>
      expect(nativeRequest).toHaveBeenLastCalledWith('credential.unlock', {
        accountId: 'saved',
        issuer: 'https://original.test',
        clientId: 'legacy-client',
      }),
    );
  });
  it('keeps a locked account saved and retries once on focus without a polling loop', async () => {
    vi.mocked(nativeRequest).mockRejectedValueOnce(new Error('Locked')).mockResolvedValue(undefined);
    const report = vi.fn();
    renderHook(() => useAccountCredential(account, vi.fn(), report));
    await waitFor(() =>
      expect(report).toHaveBeenCalledWith(expect.stringContaining('account is still saved')),
    );
    expect(nativeRequest).toHaveBeenCalledTimes(1);
    await act(async () => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(nativeRequest).toHaveBeenCalledTimes(2));
    expect(report).toHaveBeenLastCalledWith(null);
    expect(api.reconcileAccountEnvironments).not.toHaveBeenCalled();
  });
  it('recovers an unlabeled legacy account only from its exact Keychain metadata', async () => {
    vi.mocked(nativeRequest).mockResolvedValueOnce({
      environments: [{ accountId: 'saved', ...account.environment }],
    });
    vi.mocked(api.reconcileAccountEnvironments).mockResolvedValue({ accounts: [account] });
    const refresh = vi.fn();
    renderHook(() => useAccountCredential(legacyAccount, refresh, vi.fn()));
    await waitFor(() =>
      expect(nativeRequest).toHaveBeenCalledWith('credential.unlock', {
        accountId: 'saved',
        issuer: 'https://original.test',
        clientId: 'legacy-client',
      }),
    );
    expect(refresh).toHaveBeenCalledOnce();
  });
  it('does not guess between ambiguous Keychain environments or unlock a removed account', async () => {
    vi.mocked(nativeRequest).mockResolvedValue({
      environments: [
        { accountId: 'saved', ...account.environment },
        { accountId: 'saved', baseUrl: 'https://other.test', clientId: 'other' },
      ],
    });
    const report = vi.fn();
    const refresh = vi.fn();
    const { rerender } = renderHook(
      ({ value }: { value: CommanderAccount | undefined }) => useAccountCredential(value, refresh, report),
      { initialProps: { value: legacyAccount as CommanderAccount | undefined } },
    );
    await waitFor(() => expect(report).toHaveBeenCalledOnce());
    expect(api.reconcileAccountEnvironments).not.toHaveBeenCalled();
    expect(nativeRequest).toHaveBeenCalledTimes(1);
    rerender({ value: undefined });
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(nativeRequest).toHaveBeenCalledTimes(1);
  });
});
