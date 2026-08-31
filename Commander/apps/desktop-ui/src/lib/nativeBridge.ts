import type { NativeRequest, NativeResponse } from '@commander/protocol';
import type { MouseEvent as ReactMouseEvent } from 'react';

declare global {
  interface Window {
    webkit?: {
      messageHandlers?: {
        commander?: { postMessage(message: NativeRequest): void };
      };
    };
    chrome?: { webview?: { postMessage(message: NativeRequest): void } };
    commanderNativeReply?: (response: NativeResponse) => void;
  }
}

const pending = new Map<string, (response: NativeResponse) => void>();

export function nativeBridgeAvailable(): boolean {
  return Boolean(window.webkit?.messageHandlers?.commander || window.chrome?.webview);
}

window.commanderNativeReply = (response) => {
  pending.get(response.id)?.(response);
  pending.delete(response.id);
};

export async function nativeRequest<T = unknown>(
  method: NativeRequest['method'],
  params?: unknown,
): Promise<T | undefined> {
  const request: NativeRequest = {
    id: crypto.randomUUID(),
    method,
    ...(params === undefined ? {} : { params }),
  };
  const apple = window.webkit?.messageHandlers?.commander;
  const windows = window.chrome?.webview;

  if (!apple && !windows) return undefined;

  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      pending.delete(request.id);
      reject(new Error(`Native request timed out: ${method}`));
    }, 10_000);

    pending.set(request.id, (response) => {
      window.clearTimeout(timeout);
      if (!response.ok) reject(new Error(response.error ?? 'Native request failed'));
      else resolve(response.result as T);
    });

    if (apple) apple.postMessage(request);
    else windows?.postMessage(request);
  });
}

export async function hideLauncher(): Promise<void> {
  await nativeRequest('launcher.hide');
}

export function beginWindowDrag(event: ReactMouseEvent<HTMLElement>): void {
  if (event.button !== 0) return;
  const target = event.target;
  if (
    target instanceof Element &&
    target.closest('input, button, a, select, textarea, [data-no-window-drag]')
  )
    return;
  event.preventDefault();
  void nativeRequest('window.beginDrag').catch(() => undefined);
}
