// Test-only framed pipe adapter. Never used by the installed native host.
export class MacFixtureTransport {
  pending = new Map();
  lanes = new Map();
  retired = new Set();
  closed;
  timings = {};
  constructor({ write, createStream, now = () => performance.now(), timeoutMs = 280_000 }) {
    Object.assign(this, { write, createStream, now, timeoutMs });
    this.epoch = now();
  }
  record(action, field, value, queuedAt, startedAt) {
    const row = this.timings[action] ??= { count: 0, queueTotalMs: 0, queueMaxMs: 0, serviceTotalMs: 0, serviceMaxMs: 0 };
    if (field === 'queue') {
      row.count++;
      row.firstEnqueueMs ??= queuedAt - this.epoch;
      row.firstStartMs ??= startedAt - this.epoch;
    } else row.lastEndMs = this.now() - this.epoch;
    row[field + 'TotalMs'] += value;
    row[field + 'MaxMs'] = Math.max(row[field + 'MaxMs'], value);
  }
  frame(payload) {
    const metadata = { ...payload };
    let bytes;
    if (payload.action === 'stage-range') { bytes = payload.bytes; metadata.length = bytes.byteLength; delete metadata.bytes; }
    const encoded = Buffer.from(JSON.stringify(metadata)), header = Buffer.alloc(4);
    header.writeUInt32BE(encoded.length);
    return Buffer.concat([header, encoded, ...(bytes ? [bytes] : [])]);
  }
  request(payload, signal) {
    const id = payload.requestId;
    if (!id || this.pending.has(id) || this.retired.has(id)) return Promise.reject(Error('Invalid fixture request identity'));
    if (this.closed) return Promise.reject(this.closed);
    if (signal?.aborted) return Promise.reject(signal.reason ?? Error('Fixture request aborted'));
    const lane = payload.action === 'scan-changes' ? 'poll' : payload.action === 'resources' && !payload.rootId ? 'resources' : 'active';
    const queuedAt = this.now();
    let release;
    const done = new Promise(resolve => { release = resolve; });
    const prior = this.lanes.get(lane) ?? Promise.resolve();
    this.lanes.set(lane, prior.then(() => done));
    return new Promise((resolve, reject) => {
      const row = { id, payload, signal, resolve, reject, release, queuedAt, startedAt: undefined, stream: undefined };
      this.pending.set(id, row);
      row.abort = () => this.cancel(row, signal.reason ?? Error('Fixture request aborted'));
      signal?.addEventListener('abort', row.abort, { once: true });
      void prior.then(() => {
        if (!this.pending.has(id)) return;
        if (this.closed) { this.finish(row, this.closed); return; }
        row.startedAt = this.now(); this.record(payload.action, 'queue', row.startedAt - queuedAt, queuedAt, row.startedAt);
        try {
          if (payload.action === 'read-range') row.stream = this.createStream(payload);
          row.timer = setTimeout(() => {
            this.cancel(row, Error('Native fixture request timeout'));
          }, this.timeoutMs);
          this.write(this.frame(payload));
        } catch (error) { this.finish(row, error); }
      });
    });
  }
  cancel(row, error) {
    if (this.pending.get(row.id) !== row || row.cancelled) return;
    if (row.startedAt === undefined) { this.finish(row, error); return; }
    // Reject the caller immediately but retain the manager lane until its reply.
    row.cancelled = true; row.reject(error); clearTimeout(row.timer);
    row.signal?.removeEventListener('abort', row.abort);
    row.timer = setTimeout(() => this.close(Error('Fixture cancellation acknowledgement timeout')), 5000);
    try { this.write(this.frame({ action: 'fixture-cancel', requestId: row.id })); }
    catch (failure) { this.close(failure); }
  }
  finish(row, error, value) {
    if (this.pending.get(row.id) !== row) return;
    this.pending.delete(row.id); this.retired.add(row.id);
    clearTimeout(row.timer); row.signal?.removeEventListener('abort', row.abort);
    if (row.startedAt !== undefined) this.record(row.payload.action, 'service', this.now() - row.startedAt);
    row.release();
    if (!row.cancelled) error ? row.reject(error) : row.resolve(value);
  }
  receive(value) {
    const row = this.pending.get(value.requestId);
    if (!row) {
      if (this.retired.has(value.requestId)) return; // Late reply to a cancelled request.
      throw Error('Unknown native fixture response identity');
    }
    if (row.cancelled) { if (value.type !== 'chunk') this.finish(row); return; }
    if (value.type === 'chunk') {
      if (!row.stream) throw Error('Unexpected fixture stream frame');
      row.stream.write(Buffer.from(JSON.stringify(value) + '\n')); return;
    }
    if (!value.ok) { this.finish(row, Error('Native fixture request refused')); return; }
    try {
      if (row.stream) {
        row.stream.write(Buffer.from(JSON.stringify({ type: 'result', response: { id: row.id, ok: true, result: value.result } }) + '\n'));
        this.finish(row, undefined, row.stream.finish().result);
      } else this.finish(row, undefined, value.result);
    } catch (error) { this.finish(row, error); }
  }
  close(error = Error('Native fixture transport closed')) {
    if (this.closed) return;
    this.closed = error;
    for (const row of this.pending.values()) this.finish(row, error);
  }
}

// Cumulative counters belong to each native process; preserve totals across
// restarts while ignoring older samples from out-of-order response tasks.
export class FixtureIdentityTiming {
  totalMs = 0;
  maxMs = 0;
  scope = 'summed uncached native identity verification across fixture sessions; includes admission and HTTP; overlapping checks overlap elapsed time';
  beginSession() {
    let prior = 0;
    // Each child stdout callback retains its own observer. A late old-session
    // frame cannot reset or consume a new child's cumulative counter.
    return sample => {
      if (!sample || !Number.isFinite(sample.totalMs) || sample.totalMs < 0 ||
          !Number.isFinite(sample.maxMs) || sample.maxMs < 0) throw Error('Invalid fixture identity timing');
      const next = Math.max(prior, sample.totalMs);
      this.totalMs += next - prior; prior = next;
      this.maxMs = Math.max(this.maxMs, sample.maxMs);
    };
  }
}

// Proof observers share a fresh production feed result instead of issuing a
// second polling RPC that competes with that feed's native long-poll lane.
export class FixturePageObservers {
  waiters = new Set();
  sequence = 0;
  constructor(now = () => performance.now()) { this.now = now; }
  next(signal, afterObservedAt = this.now()) {
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, afterObservedAt, afterSequence: this.sequence };
      waiter.finish = (error, page) => {
        if (!this.waiters.delete(waiter)) return;
        signal.removeEventListener('abort', waiter.abort);
        error ? reject(error) : resolve(page);
      };
      waiter.abort = () => waiter.finish(signal.reason ?? Error('Fixture observation aborted'));
      this.waiters.add(waiter); signal.addEventListener('abort', waiter.abort, { once: true });
      if (signal.aborted) waiter.abort();
    });
  }
  publish(page) {
    const observation = { page, observedAt: this.now(), sequence: ++this.sequence };
    for (const waiter of this.waiters)
      if (observation.sequence > waiter.afterSequence && observation.observedAt >= waiter.afterObservedAt)
        waiter.finish(undefined, observation);
  }
}

export function validateFixtureProofKind(result, mode) {
  if (mode === 'legacy') return result;
  const diagnostic = mode === 'upload-start-diagnostic';
  if (result?.proofKind !== mode || result.twoWayAcceptance !== !diagnostic ||
      (diagnostic ? result.download?.exercised !== false : result.download?.nativeState !== 'running'))
    throw Error('Fixture result does not prove the requested acceptance mode');
  return result;
}
