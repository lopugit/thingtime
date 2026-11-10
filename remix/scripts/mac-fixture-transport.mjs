// Test-only framed pipe adapter. Never used by the installed native host.
const fixtureActions = new Set(["validate-folder-batch", "upload-batch", "upload-single", "resources", "context", "conditions", "list", "choose", "remove", "scan", "scan-stream", "scan-stream-finish", "scan-changes", "scan-capture", "scan-status", "scan-cancel", "scan-skips", "scan-page", "scan-discard", "inspect", "observe-path", "read", "read-range", "stage-begin", "stage-append", "stage-range", "stage-finish", "write-approve", "write-check", "publication-lookup", "publish", "trash", "trash-lookup", "trash-expected", "trash-inspect", "trash-restore", "trash-restore-reviewed", "trash-list"]);
export const fixtureActionLabel = action => fixtureActions.has(action) ? action : 'other';
export const fixturePathLabel = path => ['local.bin','remote.bin'].includes(path) ? path : 'other';
export class MacFixtureTransport {
  pending = new Map();
  lanes = new Map();
  retired = new Set();
  closed;
  timings = {};
  constructor({ write, createStream, now = () => performance.now(), timeoutMs = 280_000, observeRequest = (_event) => {} }) {
    Object.assign(this, { write, createStream, now, timeoutMs, observeRequest });
    this.epoch = now();
  }
  record(action, field, value, queuedAt, startedAt, endedAt) {
    const row = this.timings[action] ??= { count: 0, queueTotalMs: 0, queueMaxMs: 0, serviceTotalMs: 0, serviceMaxMs: 0 };
    if (field === 'queue') {
      row.count++;
      row.firstEnqueueMs ??= queuedAt - this.epoch;
      row.firstStartMs ??= startedAt - this.epoch;
    } else row.lastEndMs = endedAt - this.epoch;
    row[field + 'TotalMs'] += value;
    row[field + 'MaxMs'] = Math.max(row[field + 'MaxMs'], value);
  }
  observe(row, phase, at, outcome, details = {}) {
    try { this.observeRequest({ requestId: row.id, action: fixtureActionLabel(row.payload.action),
      path: fixturePathLabel(row.payload.path), lane: row.lane, phase, at, ...(outcome ? { outcome } : {}), ...details }); } catch {}
  }
  frame(payload) {
    const metadata = { ...payload };
    let bytes;
    if (payload.action === 'stage-range') { bytes = payload.bytes; metadata.length = bytes.byteLength; delete metadata.bytes; }
    const encoded = Buffer.from(JSON.stringify(metadata)), header = Buffer.alloc(4);
    header.writeUInt32BE(encoded.length);
    return Buffer.concat([header, encoded, ...(bytes ? [bytes] : [])]);
  }
  request(payload, signal, options = {}) {
    const id = payload.requestId;
    if (!id || this.pending.has(id) || this.retired.has(id)) return Promise.reject(Error('Invalid fixture request identity'));
    if (this.closed) return Promise.reject(this.closed);
    if (signal?.aborted) return Promise.reject(signal.reason ?? Error('Fixture request aborted'));
    if (options.onBatchFrame !== undefined && typeof options.onBatchFrame !== 'function') return Promise.reject(Error('Invalid fixture callback'));
    const lane = payload.action === 'scan-changes' ? 'poll' : payload.action === 'resources' && !payload.rootId ? 'resources' : 'active';
    const queuedAt = this.now();
    let release;
    const done = new Promise(resolve => { release = resolve; });
    const prior = this.lanes.get(lane) ?? Promise.resolve();
    this.lanes.set(lane, prior.then(() => done));
    return new Promise((resolve, reject) => {
      const row = { id, payload, signal, resolve, reject, release, lane, queuedAt, startedAt: undefined, stream: undefined, onBatchFrame: options.onBatchFrame, callbackIds: options.onBatchFrame ? new Set() : undefined, callbackAbort: options.onBatchFrame ? new AbortController() : undefined };
      this.pending.set(id, row); this.observe(row, 'enqueue', queuedAt);
      row.abort = () => this.cancel(row, signal.reason ?? Error('Fixture request aborted'));
      signal?.addEventListener('abort', row.abort, { once: true });
      void prior.then(() => {
        if (!this.pending.has(id)) return;
        if (this.closed) { this.finish(row, this.closed); return; }
        row.startedAt = this.now(); this.record(payload.action, 'queue', row.startedAt - queuedAt, queuedAt, row.startedAt);
        this.observe(row, 'start', row.startedAt);
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
    row.cancelled = true; row.callbackAbort?.abort(error); this.observe(row, 'cancel', this.now()); row.reject(error); clearTimeout(row.timer);
    row.signal?.removeEventListener('abort', row.abort);
    row.timer = setTimeout(() => this.close(Error('Fixture cancellation acknowledgement timeout')), 5000);
    try { this.write(this.frame({ action: 'fixture-cancel', requestId: row.id })); }
    catch (failure) { this.close(failure); }
  }
  finish(row, error, value) {
    if (this.pending.get(row.id) !== row) return;
    this.pending.delete(row.id); this.retired.add(row.id); row.callbackAbort?.abort(error ?? Error('Fixture request ended'));
    clearTimeout(row.timer); row.signal?.removeEventListener('abort', row.abort);
    const endedAt = this.now();
    if (row.startedAt !== undefined) this.record(row.payload.action, 'service', endedAt - row.startedAt, undefined, undefined, endedAt);
    this.observe(row, 'end', endedAt, row.cancelled || row.signal?.aborted ? 'cancelled' : error ? 'refused' : 'ok');
    row.release();
    if (!row.cancelled) error ? row.reject(error) : row.resolve(value);
  }
  batch(row, value) {
    const kind = value.frame?.kind, id = value.callbackId;
    if (typeof row.onBatchFrame !== 'function' || !Number.isSafeInteger(id) || id < 1 || id > 4096 ||
        row.callbackIds.has(id) || row.callbackIds.size >= 4096 ||
        !['prepare-ready','chunk','put-ready','verify-ready'].includes(kind) ||
        !Number.isFinite(value.nativeEmittedMs)) throw Error('Invalid fixture callback frame');
    row.callbackIds.add(id);
    const details = { callbackId: id, callbackKind: kind, nativeEmittedMs: value.nativeEmittedMs };
    this.observe(row, 'batch-received', this.now(), undefined, details);
    const signal = row.signal ? AbortSignal.any([row.signal, row.callbackAbort.signal]) : row.callbackAbort.signal;
    void (async () => {
      try {
        const reply = await row.onBatchFrame(value.frame, signal);
        if (this.pending.get(row.id) !== row || row.cancelled || this.closed) return;
        const encoded = JSON.stringify(reply);
        // Same closed JSON reply bound as canonical NodeBatchDuplex.
        if (!reply || typeof reply !== 'object' || !encoded || Buffer.byteLength(encoded) > 524288) throw Error('Invalid fixture callback reply');
        this.observe(row, 'batch-reply', this.now(), undefined, details);
        // A callback is control data for the existing operation. It must never
        // queue behind that operation's held active lane or split a stage frame.
        this.write(this.frame({ action: 'fixture-batch-reply', requestId: row.id, callbackId: id, reply }));
      } catch (error) { this.cancel(row, error); }
    })();
  }
  receive(value) {
    const row = this.pending.get(value.requestId);
    if (!row) {
      if (this.retired.has(value.requestId)) return; // Late reply to a cancelled request.
      throw Error('Unknown native fixture response identity');
    }
    if (row.cancelled) { if (!['chunk','batch'].includes(value.type)) this.finish(row); return; }
    if (value.type === 'batch') { this.batch(row, value); return; }
    if (value.type === 'chunk') {
      if (!row.stream) throw Error('Unexpected fixture stream frame');
      row.stream.write(Buffer.from(JSON.stringify(value) + '\n')); return;
    }
    if (!value.ok) { this.finish(row, Error('Native fixture request refused (' + fixtureActionLabel(row.payload.action) + ')')); return; }
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

// Proof observations must never hold the production transfer consumer.
// Register fresh-page provenance after durable commit; drain before fixture success.
export class FixtureReceiptObservations {
  pending = new Set();
  registered = new Set();
  errors = [];
  constructor(now = () => performance.now()) {
    this.now = now;
    this.failed = new Promise((_, reject) => { this.rejectFailure = reject; });
    this.failed.catch(() => {}); // A later caller races this; never leak an unhandled rejection.
  }
  async confirm(identity, commit, observe) {
    const result = await commit(), committedAt = this.now();
    this.schedule(identity, () => observe(result, committedAt));
    return result;
  }
  schedule(identity, observe) {
    if (this.registered.has(identity)) throw Error('Duplicate receipt observation');
    this.registered.add(identity);
    // Invoke now, so the fresh-page barrier is registered before consume continues.
    let observation;
    try { observation = observe(); } catch (error) { observation = Promise.reject(error); }
    const task = Promise.resolve(observation).then(undefined, error => {
      this.errors.push(error);
      if (this.errors.length === 1) this.rejectFailure(error);
    }).finally(() => { this.pending.delete(task); });
    this.pending.add(task);
  }
  async drain() {
    while (this.pending.size) await Promise.all([...this.pending]);
    if (this.errors.length) throw this.errors[0];
  }
}

/** A legacy proof cannot silently satisfy a requested current-worker run. */
export function validateFixtureWorkerParity(result, required, streaming = false, healthy = false) {
  if (required && !['canonicalDesktopManager', 'canonicalRendererHost', 'canonicalTransferWorkerSelected', 'nativeOperationGuards'].every(key => result?.parity?.[key] === true))
    throw Error('Fixture result did not use the requested canonical worker');
  if (streaming && (result?.parity?.streamingTwoWay !== true || result.parity.propagateDeletes !== false || result.parity.localFeed !== true || result.parity.remoteFeed !== true || result.parity.strictAsyncCapture !== true))
    throw Error('Fixture result did not use the requested streaming two-way path');
  if (healthy && (result?.healthyFixture !== true || !Array.isArray(result.injectedLossOrder) || result.injectedLossOrder.length !== 0 || !Number.isFinite(result.phaseMs?.healthy) || JSON.stringify(result.checks) !== JSON.stringify(['wide-native-and-cloud-pages', 'complete-checkpoint', 'real-upload-download-byte-hashes', 'healthy-no-fault-injections', 'no-replayed-transfers', 'stable-convergence'])))
    throw Error('Fixture result did not use the requested healthy baseline');
  return result;
}
