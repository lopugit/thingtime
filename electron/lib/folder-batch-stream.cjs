'use strict';
const invalid = () => new Error('Native folder batch framing was invalid.');
class FolderBatchStream {
    constructor(request, exchange, fail) {
        if (request.method !== 'folder-sync.request' || request.parameters.action !== 'upload-batch' || typeof exchange !== 'function') throw invalid();
        this.request = request; this.exchange = exchange; this.fail = fail;
        this.pending = Buffer.alloc(0); this.callbacks = new Set(); this.sequence = 0; this.response = null; this.closed = false; this.error = null;
    }
    connect(write) { if (this.writeReply) throw invalid(); this.writeReply = write; }
    append(bytes) { if (this.pending.length + bytes.length > 600_000) throw invalid(); if (bytes.length) this.pending = Buffer.concat([this.pending, bytes]); }
    write(chunk) {
        let start = 0;
        for (let i = 0; i < chunk.length; i++) if (chunk[i] === 10) {
            this.append(chunk.subarray(start, i)); this.line(this.pending.toString('utf8')); this.pending = Buffer.alloc(0); start = i + 1;
        }
        this.append(chunk.subarray(start));
    }
    line(line) {
        if (this.closed || this.response) throw invalid();
        const value = JSON.parse(line);
        if (value.type === 'result' && value.response?.id === this.request.id && typeof value.response.ok === 'boolean') { this.response = value.response; return; }
        if (value.type !== 'batch' || Object.keys(value).sort().join(',') !== 'callbackId,frame,type' ||
            value.callbackId !== this.sequence + 1 || this.sequence >= 4096 || this.callbacks.size >= 32 ||
            !value.frame || !['prepare-ready', 'chunk', 'put-ready', 'verify-ready'].includes(value.frame.kind) ||
            !this.writeReply) throw invalid();
        const id = ++this.sequence; this.callbacks.add(id);
        Promise.resolve().then(() => this.exchange(value.frame)).then(reply => {
            if (this.closed || this.response || !this.callbacks.delete(id)) return;
            const bytes = Buffer.from(JSON.stringify({ callbackId: id, reply }) + '\n');
            if (bytes.length > 524_288) throw invalid(); this.writeReply(bytes);
        }).catch(error => { if (!this.closed && !this.error) { this.error = error; this.fail(error); } });
    }
    finish() {
        if (this.error) throw this.error;
        if (this.pending.length || !this.response || (this.response.ok && this.callbacks.size)) throw invalid();
        this.closed = true; this.callbacks.clear(); return this.response;
    }
    close() { this.closed = true; this.callbacks.clear(); this.pending = Buffer.alloc(0); }
}
function encodeBatchInput(request) {
    if (request.method !== 'folder-sync.request' || request.parameters.action !== 'upload-batch') throw invalid();
    const bytes = Buffer.from(JSON.stringify(request)); if (bytes.length > 600_000) throw invalid();
    const header = Buffer.alloc(4); header.writeUInt32BE(bytes.length); return Buffer.concat([header, bytes]);
}
module.exports = { FolderBatchStream, encodeBatchInput };
