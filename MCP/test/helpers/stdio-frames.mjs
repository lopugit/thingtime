import { ReadBuffer } from '@modelcontextprotocol/sdk/shared/stdio.js';

// Preserve incomplete newline frames (and UTF-8 sequences) between pipe chunks.
// The small total budget also bounds a peer sending many complete frames.
export function stdioFrames(limit = 131072) {
  const reader = new ReadBuffer({ maxBufferSize: limit });
  let received = 0;
  return chunk => {
    received += chunk.length;
    if (received > limit) throw new Error('Lifecycle stdio output limit exceeded');
    reader.append(chunk);
    const messages = [];
    for (let message; (message = reader.readMessage()) !== null;) messages.push(message);
    return messages;
  };
}
