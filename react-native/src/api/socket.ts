import { io, type Socket } from 'socket.io-client';

import { API_BASE_URL } from '~/config';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(API_BASE_URL, { autoConnect: true, transports: ['websocket'] });
  }
  return socket;
}

// Subscribe to live updates for a given thing uuid. Mirrors the
// `registerListener` event handled in api/src/index.js. Returns an
// unsubscribe function.
export function listenToThing(uuid: string, onUpdate: (payload: unknown) => void): () => void {
  const s = getSocket();
  s.emit('registerListener', { uuid });
  s.on('update', onUpdate);
  return () => {
    s.off('update', onUpdate);
  };
}
