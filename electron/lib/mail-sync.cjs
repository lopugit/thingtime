'use strict';
// Bounded request/response bridge. No sockets, files or provider errors reach the renderer.
class DesktopMailSync {
  constructor({ fetchBatch, trustedOrigin }) { this.fetchBatch = fetchBatch; this.trustedOrigin = trustedOrigin; this.active = new Map(); }
  authorize(event) {
    const frame = event?.senderFrame;
    if (!frame || frame !== event.sender?.mainFrame || new URL(frame.url).origin !== this.trustedOrigin())
      throw new Error('Mail sync requires the main Thingtime page.');
    return frame.url;
  }
  cancel(event, request) {
    this.authorize(event);
    const job = this.active.get(request?.requestId);
    if (job?.sender === event.sender) job.controller.abort();
  }
  async sync(event, request) {
    const url = this.authorize(event);
    if (!request || !/^[a-zA-Z0-9_-]{8,100}$/.test(request.requestId) || JSON.stringify(request).length > 64 * 1024)
      throw new Error('Invalid mail sync request.');
    if (!request.account?.sync?.local || request.account.sync.transport !== 'native') throw new Error('Native device sync is not enabled.');
    if (this.active.size >= 2 || this.active.has(request.requestId)) throw new Error('Another mail sync is running.');
    const controller = new AbortController();
    const sender = event.sender;
    const abort = () => controller.abort();
    const navigate = (_event, _url, _inPlace, mainFrame) => { if (mainFrame) abort(); };
    this.active.set(request.requestId, { sender, controller });
    sender.on('did-start-navigation', navigate);
    sender.once('destroyed', abort);
    try {
      const batch = await this.fetchBatch(request.account, {
        protocol: request.protocol, path: request.path, cursor: request.cursor, discover: request.discover === true
      }, AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]));
      controller.signal.throwIfAborted();
      if (this.authorize(event) !== url) throw new Error('Mail page changed.');
      return { ok: true, version: 1, ...batch };
    } catch {
      // Provider errors can contain authentication commands and server responses.
      throw new Error('Device mail sync failed. Check the server and app password, then retry.');
    } finally {
      sender.removeListener('did-start-navigation', navigate);
      sender.removeListener('destroyed', abort);
      this.active.delete(request.requestId);
    }
  }
  stop() { for (const job of this.active.values()) job.controller.abort(); }
}
module.exports = { DesktopMailSync };
