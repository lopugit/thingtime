'use strict';

const MAX_RANGE_BYTES = 32 * 1024 * 1024;
const MAX_LINE_BYTES = 1_048_576;
const invalid = () => new Error('Native folder stream was incomplete or invalid.');

/** Accumulate a single requested range, with bounded framing and no disclosure
 * until the final native response and DesktopFolderSync account check succeed. */
class FolderStream {
    constructor(request) {
        const p = request.parameters;
        if (request.method !== 'folder-sync.request' || p.action !== 'read-range' ||
            !Number.isSafeInteger(p.length) || p.length <= 0 || p.length > MAX_RANGE_BYTES ||
            !Number.isSafeInteger(p.offset) || p.offset < 0) throw invalid();
        this.request = request;
        this.bytes = Buffer.alloc(p.length);
        this.received = 0;
        this.pending = Buffer.alloc(0);
        this.response = null;
    }
    write(chunk) {
        // Process each complete line immediately, even if an OS read batches
        // many frames. The unfinished line never grows beyond one frame.
        let start = 0;
        for (let end = 0; end < chunk.length; end++) {
            if (chunk[end] !== 10) continue;
            this.append(chunk.subarray(start, end));
            this.line(this.pending.toString('utf8'));
            this.pending = Buffer.alloc(0); start = end + 1;
        }
        this.append(chunk.subarray(start));
    }
    append(bytes) {
        if (this.pending.length + bytes.length > MAX_LINE_BYTES) throw invalid();
        if (bytes.length) this.pending = Buffer.concat([this.pending, bytes]);
    }
    line(line) {
        if (this.response) throw invalid();
        const frame = JSON.parse(line);
        if (frame.type === 'chunk') {
            if (frame.offset !== this.received || typeof frame.data !== 'string' ||
                frame.data.length > 87_384 || !frame.data.length ||
                !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(frame.data)) throw invalid();
            const bytes = Buffer.from(frame.data, 'base64');
            if (!bytes.length || bytes.length > 65_536 || bytes.toString('base64') !== frame.data ||
                this.received + bytes.length > this.bytes.length) throw invalid();
            bytes.copy(this.bytes, this.received); this.received += bytes.length;
        } else if (frame.type === 'result' && frame.response?.id === this.request.id && typeof frame.response.ok === 'boolean') {
            this.response = frame.response;
        } else throw invalid();
    }
    finish() {
        if (this.pending.length || !this.response) throw invalid();
        if (!this.response.ok) return this.response;
        const p = this.request.parameters, result = this.response.result, c = result?.chunk;
        if (this.received !== p.length || !result ||
            ['requestId', 'ownerId', 'deviceId', 'origin', 'rootId', 'path'].some(key => result[key] !== p[key]) ||
            c?.version !== p.version || c.offset !== p.offset || c.length !== p.length ||
            !Number.isSafeInteger(c.size) || c.size < p.offset || c.size - p.offset < p.length || c.data !== undefined || c.bytes !== undefined) throw invalid();
        c.bytes = this.bytes;
        return this.response;
    }
}
module.exports = { FolderStream, MAX_RANGE_BYTES };
