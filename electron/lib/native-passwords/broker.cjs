'use strict';
const path = require('node:path');
const { randomUUID, randomBytes, randomInt } = require('node:crypto');
const { PasswordBridgeStore } = require('./store.cjs');
const { PasswordBrowser, unlockKeyring, keyringState } = require('./consumers.cjs');
const { createVaultTransport } = require('./vault.cjs');
const { METHODS, UUID, manifest, exactOrigin, targetScope, same, field, entryMatches, fail } = require('./contract.cjs');

const GRANT_MS = 15 * 60 * 1000;
const text = value => typeof value === 'string' && value.trim() && !/[\x00-\x1f\x7f]/.test(value);
class NativePasswordBroker {
  constructor({ userData, safeStorage, context, approve, verify, platform = process.platform, store, vault, browserFactory, keyring = unlockKeyring, inspectKeyring = keyringState, now = Date.now }) {
    this.userData = userData; this.platform = platform; this.context = context; this.approve = approve; this.now = now; this.keyring = keyring; this.inspectKeyring = inspectKeyring;
    this.directory = path.join(userData, 'native-passwords');
    this.store = store || new PasswordBridgeStore({ directory: this.directory, safeStorage, platform });
    this.vault = vault || createVaultTransport({ context });
    this.browserFactory = browserFactory || (() => new PasswordBrowser({ directory: path.join(this.directory, 'browsers') }));
    this.verify = verify || (async () => fail('VERIFICATION_UNAVAILABLE', 'The native per-request verification interface is unavailable.'));
    this.grants = new Map(); this.cleaning = new Map(); this.generation = 0; this.queue = Promise.resolve();
    this.timer = setInterval(() => { for (const [id, grant] of this.grants) if (this.now() >= grant.expiresAt) void this.release(id).catch(() => {}); }, 15000); this.timer.unref();
  }
  serial(work) { const pending = this.queue.then(work, work); this.queue = pending.catch(() => {}); return pending; }
  scope(ownerId) {
    if (!text(ownerId)) fail('INVALID_ACCOUNT', 'Use the current signed-in account ID.');
    const current = this.context();
    if (!current?.session) fail('SIGNED_OUT', 'Open Thingtime and sign into the intended vault account.');
    return { origin: exactOrigin(current.endpoint), ownerId };
  }
  async connection(action, ownerId) {
    if (action === 'disconnect') return this.serial(async () => {
      await this.invalidate(); const state = await this.store.read(); state.connection = null; await this.store.write(state);
      return { ok: true, connection: 'disconnected', message: 'Desktop Password AutoFill disconnected.' };
    });
    if (!this.store.available()) return { ok: true, connection: 'unavailable', availability: 'keyringUnavailable', message: 'Unlock or configure the operating-system keyring. Plaintext storage is not supported.' };
    if (!ownerId) { if (action === 'sync') await this.invalidate(); return { ok: true, connection: 'unavailable' }; }
    const scope = this.scope(ownerId);
    return this.serial(async () => {
      const state = await this.store.read();
      if (action === 'status') return { ok: true, connection: !state.connection ? 'disconnected' : same(state.connection, scope) ? 'connected' : 'differentSession', mode: 'scopedDesktop' };
      if (action === 'sync') {
        if (!same(state.connection, scope)) await this.invalidate();
        return { ok: true, connection: !state.connection ? 'disconnected' : same(state.connection, scope) ? 'connected' : 'differentSession', mode: 'scopedDesktop' };
      }
      if (action !== 'connect') fail('UNSUPPORTED_OPERATION', 'Unsupported password connection operation.');
      const generation = this.generation;
      await this.vault(scope, { operation: 'catalog' }, () => { if (generation !== this.generation || !same(this.scope(ownerId), scope)) fail('SESSION_CHANGED', 'The vault account changed.'); });
      await this.invalidate(); state.connection = scope; await this.store.write(state);
      return { ok: true, connection: 'connected', mode: 'scopedDesktop', message: 'Connected for scoped desktop browser autofill and agent requests. System-wide AutoFill and passkeys are not available on this platform.' };
    });
  }
  async requireConnection(scope) {
    this.store.requireAvailable();
    if (!same(this.scope(scope.ownerId), scope) || !same((await this.store.read()).connection, scope)) fail('NOT_CONNECTED', 'Connect this account in Thingtime → Passwords before requesting native credentials.');
  }
  assertGrant(grant) {
    if (!grant || this.grants.get(grant.id) !== grant || this.now() >= grant.expiresAt || grant.generation !== this.generation || !same(this.scope(grant.scope.ownerId), grant.scope) || grant.session !== this.context()?.session) fail('GRANT_EXPIRED', 'Authorize a new scope after expiry, sign-out, restart or account change.');
  }
  async checked(grant, body) {
    this.assertGrant(grant); await this.requireConnection(grant.scope); this.assertGrant(grant);
    return this.vault(grant.scope, body, () => this.assertGrant(grant));
  }
  async authorize(input) {
    const scope = { origin: exactOrigin(input.origin), ownerId: input.ownerId };
    const target = targetScope(input.target, this.platform);
    if (!text(input.taskId)) fail('INVALID_SCOPE', 'Supply a stable task identity.');
    await this.requireConnection(scope);
    const generation = this.generation, session = this.context()?.session;
    await this.vault(scope, { operation: 'catalog' });
    const approved = await this.approve({ taskId: input.taskId, scope, target, expiresInMinutes: 15 });
    if (!approved) fail('CONSENT_REFUSED', 'The native credential scope was not approved.');
    if (generation !== this.generation || session !== this.context()?.session) fail('SESSION_CHANGED', 'The vault account changed while authorization was open.');
    await this.requireConnection(scope);
    await this.vault(scope, { operation: 'catalog' });
    if (generation !== this.generation || session !== this.context()?.session) fail('SESSION_CHANGED', 'The vault account changed before authorization completed.');
    const id = randomBytes(32).toString('base64url'), expiresAt = this.now() + GRANT_MS;
    this.grants.set(id, { id, scope, target, taskId: input.taskId, expiresAt, generation, session, browser: null });
    return { grant: id, expiresAt, target, taskId: input.taskId };
  }
  async generate(grant, input) {
    if (!UUID.test(input.requestId) || !text(input.title) || typeof input.username !== 'string' || /[\x00-\x1f\x7f]/.test(input.username)) fail('INVALID_REQUEST', 'Generation requires a stable UUID, title and account username.');
    input = { ...input, title: input.title.trim() };
    return this.serial(async () => {
      await this.requireConnection(grant.scope); this.assertGrant(grant);
      const state = await this.store.read(), id = input.requestId;
      const binding = { scope: grant.scope, target: grant.target, taskId: grant.taskId, title: input.title, username: input.username };
      let pending = state.pending[id];
      if (pending && !same(pending.binding, binding)) fail('RETRY_CHANGED', 'This generation ID belongs to a different immutable request.');
      if (!pending) {
        // A completed operation is not recreated after app restart. A read at
        // this stable ID either returns the prior receipt or fails closed.
        try {
          const existing = await this.checked(grant, { operation: 'read', id });
          if (existing.id !== id || !entryMatches(existing.entry, grant.target) || existing.entry.title !== input.title || field(existing.entry, 'username', ['text', 'email']) !== input.username) fail('RETRY_CHANGED', 'This generation ID already names another saved entry.');
          return { entryId: id, saved: true, reused: true };
        } catch (error) { if (error.code !== 'NOT_FOUND') throw error; }
        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-._~!';
        const password = Array.from({ length: 32 }, () => alphabet[randomInt(alphabet.length)]).join('');
        const entry = { title: input.title, passwordType: 'login', fields: [
          { id: 'username', label: 'Username', type: 'text', value: input.username },
          { id: 'password', label: 'Password', type: 'password', value: password },
          grant.target.kind === 'website' ? { id: 'website', label: 'Website', type: 'url', value: grant.target.origin } : { id: 'native-consumer', label: 'Native consumer', type: 'text', value: grant.target.id },
        ] };
        pending = { binding, entry, writeId: randomUUID() }; state.pending[id] = pending;
        // Persist only through the OS keyring before a possibly ambiguous write.
        await this.store.write(state);
      }
      await this.checked(grant, { operation: 'save', id, writeId: pending.writeId, revision: 0, entry: pending.entry });
      const readback = await this.checked(grant, { operation: 'read', id });
      if (readback.id !== id || !same(readback.entry, pending.entry)) fail('READBACK_FAILED', 'The saved credential could not be verified. Retry this same request ID.');
      delete state.pending[id]; await this.store.write(state); this.assertGrant(grant);
      return { entryId: id, saved: true };
    });
  }
  async request(input) {
    if (!input || !METHODS.includes(input.method)) fail('UNSUPPORTED_OPERATION', 'Unsupported native password operation.');
    if (input.method === 'manifest') return manifest(this.userData, this.platform);
    if (input.method === 'status') return { available: this.store.available(), platform: this.platform, ...await this.connection('status', input.ownerId) };
    if (input.method === 'authorize') return this.authorize(input);
    if (input.method === 'release') {
      if (typeof input.grant !== 'string' || !this.grants.has(input.grant) && !this.cleaning.has(input.grant)) fail('GRANT_EXPIRED', 'This grant has already been released.');
      await this.release(input.grant); return { released: true };
    }
    const grant = this.grants.get(input.grant); this.assertGrant(grant);
    await this.requireConnection(grant.scope); this.assertGrant(grant);
    if (input.method === 'generate') return this.generate(grant, input);
    if (input.method === 'catalog') {
      const result = await this.checked(grant, { operation: 'catalog', ...(input.cursor ? { cursor: input.cursor } : {}) });
      // The 1.7 catalog projects exact canonical origins without exposing fields.
      // Never retrieve decrypted entries merely to filter discovery metadata.
      const entries = (result.catalog || []).filter(item => UUID.test(item.id) && grant.target.kind === 'website' && item.fillEligible === true && item.origins?.includes(grant.target.origin))
        .map(item => ({ id: item.id, title: typeof item.title === 'string' ? item.title : '', username: typeof item.username === 'string' ? item.username : '' }));
      return { entries, nextCursor: result.nextCursor || null };
    }
    if (input.method === 'open-browser') {
      if (grant.target.kind !== 'website') fail('UNSUPPORTED_TARGET', 'This scope is not a website.');
      if (grant.browser) fail('BROWSER_EXISTS', 'This scope already owns a browser; release it before creating another.');
      const browser = this.browserFactory(); grant.browser = browser;
      try { await browser.open(grant.target, input.url); this.assertGrant(grant); }
      catch (error) { if (grant.browser === browser) grant.browser = null; await browser.close(); throw error; }
      return { opened: true, origin: grant.target.origin, isolatedProfile: true, network: 'normal' };
    }
    if (!UUID.test(input.entryId)) fail('INVALID_ENTRY', 'Choose an exact saved credential ID.');
    if (input.method === 'fill') {
      if (grant.target.kind !== 'website' || !grant.browser) fail('TARGET_CLOSED', 'Open the scope’s task browser first.');
      const bound = await grant.browser.bind(input.selectors);
      try {
        const proof = await this.verify({ scope: grant.scope, target: grant.target, entryId: input.entryId, assertCurrent: () => this.assertGrant(grant) });
        this.assertGrant(grant);
        const result = await this.checked(grant, { operation: 'fill', id: input.entryId, passkeySession: proof });
        if (typeof result.username !== 'string' || typeof result.password !== 'string') fail('INVALID_RESPONSE', 'The selected credential was unavailable.');
        this.assertGrant(grant);
        await bound.deliver({ username: result.username, password: result.password });
        return { delivered: true, submitted: false, entryId: input.entryId };
      } finally { await bound.close(); }
    }
    if (input.method === 'unlock-keyring') {
      if (grant.target.kind !== 'local-app' || grant.target.id !== 'org.gnome.keyring') fail('WRONG_TARGET', 'Authorize the GNOME login keyring consumer explicitly.');
      const previous = await this.inspectKeyring(); this.assertGrant(grant);
      if (!previous.locked) return { unlocked: true, alreadyUnlocked: true, credentialUsed: false, consumer: 'org.gnome.keyring' };
      const proof = await this.verify({ scope: grant.scope, target: grant.target, entryId: input.entryId, assertCurrent: () => this.assertGrant(grant) });
      this.assertGrant(grant);
      const result = await this.checked(grant, { operation: 'read', id: input.entryId, passkeySession: proof });
      if (result.id !== input.entryId || !entryMatches(result.entry, grant.target)) fail('WRONG_CREDENTIAL', 'The saved credential is not bound to this native consumer.');
      this.assertGrant(grant); await this.keyring(field(result.entry, 'password', ['password']), previous, () => this.assertGrant(grant));
      return { unlocked: true, consumer: 'org.gnome.keyring' };
    }
    fail('UNSUPPORTED_OPERATION', 'Unsupported native password operation.');
  }
  async release(id) {
    const grant = this.grants.get(id) || this.cleaning.get(id); this.grants.delete(id);
    if (!grant) return;
    this.cleaning.set(id, grant);
    if (!grant.closing) grant.closing = Promise.resolve().then(() => grant.browser?.close()).then(() => { this.cleaning.delete(id); }).finally(() => { grant.closing = null; });
    await grant.closing;
  }
  async invalidate() { this.generation++; const results = await Promise.allSettled([...new Set([...this.grants.keys(), ...this.cleaning.keys()])].map(id => this.release(id))); if (results.some(result => result.status === 'rejected')) fail('CLEANUP_FAILED', 'A task browser did not close. Retry disconnect before switching accounts.'); }
  async close() { clearInterval(this.timer); await this.invalidate(); }
}
module.exports = { NativePasswordBroker, GRANT_MS };
