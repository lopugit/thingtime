'use strict';

const { randomUUID, randomBytes, createHash, timingSafeEqual } = require('node:crypto');
const digest = value => createHash('sha256').update(value).digest();

// A lease grants one agent exclusive use of an install. The public task/agent
// IDs are metadata, never authority: subsequent operations require the secret
// returned by claim. Lost leases are not silently adopted by another agent.
class BrowserLeases {
  constructor({ now = Date.now, durationMs = 15 * 60 * 1000 } = {}) {
    this.now = now;
    this.durationMs = durationMs;
    this.leases = new Map();
  }

  claim({ installId, taskId, agentId }) {
    for (const value of [installId, taskId, agentId]) if (typeof value !== 'string' || !value.trim()) throw new Error('An install, task and agent identity are required.');
    if ([...this.leases.values()].some(lease => lease.installId === installId)) throw new Error('This browser is already claimed. Release its current session before claiming it again.');
    const token = randomBytes(32).toString('base64url');
    const lease = { id: randomUUID(), installId, taskId, agentId, expiresAt: this.now() + this.durationMs, tokenHash: digest(token) };
    this.leases.set(lease.id, lease);
    return { ...this.public(lease), token };
  }

  public({ tokenHash, ...lease }) { return structuredClone(lease); }
  list() { return [...this.leases.values()].map(lease => ({ ...this.public(lease), expired: lease.expiresAt <= this.now() })); }

  require({ leaseId, token }, { allowExpired = false } = {}) {
    const lease = this.leases.get(leaseId);
    if (!lease || typeof token !== 'string' || !timingSafeEqual(lease.tokenHash, digest(token))) throw new Error('The current browser lease is required.');
    if (!allowExpired && lease.expiresAt <= this.now()) throw new Error('This browser lease has expired.');
    return this.public(lease);
  }

  renew(credentials) {
    const lease = this.require(credentials);
    this.leases.get(lease.id).expiresAt = this.now() + this.durationMs;
    return this.public(this.leases.get(lease.id));
  }

  release(credentials) {
    const lease = this.require(credentials, { allowExpired: true });
    this.leases.delete(lease.id);
    return lease;
  }
}

module.exports = { BrowserLeases };
