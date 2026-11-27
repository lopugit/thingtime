// Only authored storage failure labels leave this boundary. Never copy a
// response body, user content, identifiers or an arbitrary exception message
// into operational logs merely to classify an HTTP failure.
export const storageFailureCode = (message: unknown): string | undefined => {
  if (message === 'Account content requires storage migration before its ledger can be reconciled') return 'STORAGE_MIGRATION_REQUIRED';
  if (message === 'Account storage recovery is busy; pending changes will be reconciled before more growth can be saved') return 'STORAGE_RECOVERY_BUSY';
  if (message === 'Account storage accounting is being initialized — try again shortly' ||
      message === 'Account storage accounting is unavailable — try again' ||
      message === 'The account subscription ledger is missing') return 'STORAGE_ACCOUNTING_UNAVAILABLE';
  return undefined;
};

// Some handlers translate StorageMutationError into a JSON response themselves.
// Inspect only a bounded clone, without consuming or delaying the actual body.
export const storageFailureFromResponse = async (response: Response): Promise<string | undefined> => {
  if (response.status < 500 || !response.headers.get('content-type')?.includes('application/json')) return undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    reader = response.clone().body?.getReader();
    if (!reader) return undefined;
    const read = async () => {
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader!.read();
        if (done) break;
        size += value.byteLength;
        if (size > 16 * 1024) return undefined;
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const body = JSON.parse(new TextDecoder().decode(bytes));
      return body?.ok === false ? storageFailureCode(body.error) : undefined;
    };
    return await Promise.race([
      read(),
      new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), 100); })
    ]);
  } catch { return undefined; }
  finally {
    clearTimeout(timer);
    // A tee's cancellation waits for the original stream, which may be long
    // lived. Release our branch without waiting for the caller to consume it.
    void reader?.cancel().catch(() => {});
  }
};
