// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { beginWindowDrag } from './nativeBridge.js';

describe('native window dragging', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'webkit');
  });

  it('requests a native drag from non-interactive chrome and ignores controls', () => {
    const postMessage = vi.fn((message: { id: string }) => {
      window.commanderNativeReply?.({ id: message.id, ok: true });
    });
    Object.defineProperty(window, 'webkit', {
      configurable: true,
      value: { messageHandlers: { commander: { postMessage } } },
    });
    const preventDefault = vi.fn();
    const chrome = document.createElement('span');

    beginWindowDrag({ button: 0, target: chrome, preventDefault } as never);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ method: 'window.beginDrag' }));

    const input = document.createElement('input');
    beginWindowDrag({ button: 0, target: input, preventDefault } as never);
    expect(postMessage).toHaveBeenCalledOnce();
  });
});
