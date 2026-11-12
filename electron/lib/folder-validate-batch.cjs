'use strict';
const { createHash } = require('node:crypto');
const invalid = () => new Error('The pinned folder batch could not be verified.');
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const text = value => { if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 16384) throw invalid(); return value; };
const closed = (value, keys) => { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) throw invalid(); return value; };
const pathKey = value => { text(value); if (value.length > 4096 || /[\\\p{Cc}\p{Cf}]/u.test(value) || value.split('/').some(x => !x || x === '.' || x === '..')) throw invalid(); return value.normalize('NFC').toLowerCase(); };
function folderBatchCanonicalBytes(d) {
    closed(d, ['version', 'kind', 'batchId', 'scope', 'configuration', 'members']);
    const s = closed(d.scope, ['origin', 'ownerId', 'dataPlane', 'rootId', 'deviceId']);
    const saved = closed(d.configuration, ['id', 'updatedAt', 'configuration']);
    const c = closed(saved.configuration, ['configurationVersion', 'name', 'deviceId', 'localRootId', 'sourceKind', 'remoteFolderId', 'mode', 'paused', 'propagateDeletes', 'network', 'chargingOnly', 'excludedPaths', 'ignoreRules', 'resourceLimits']);
    if (d.version !== 1 || d.kind !== 'folders' || !uuid(d.batchId) || s.dataPlane !== 'home' || saved.id !== s.rootId || c.deviceId !== s.deviceId ||
        ![1, 2, 3].includes(c.configurationVersion) || !['backup', 'upload'].includes(c.mode) || c.paused !== false || c.propagateDeletes !== false ||
        (c.sourceKind !== undefined && c.sourceKind !== 'folder') || !Array.isArray(c.excludedPaths) || c.excludedPaths.length > 100 ||
        typeof c.chargingOnly !== 'boolean' || (c.ignoreRules !== undefined && typeof c.ignoreRules !== 'string') ||
        !Array.isArray(d.members) || !d.members.length || d.members.length > 256 || Buffer.byteLength(JSON.stringify(d)) > 327680) throw invalid();
    const ignoreRules = (c.ignoreRules ?? '').replace(/\r\n/g, '\n');
    if (ignoreRules && c.configurationVersion === 1) throw invalid();
    const resourceKeys = ['uploadBytesPerSecond', 'downloadBytesPerSecond', 'transferConcurrency', 'indexingConcurrency', 'cpuPercent'];
    const limits = c.resourceLimits === undefined ? undefined : closed(c.resourceLimits, resourceKeys);
    const limitFields = resourceKeys.map(key => {
        const n = limits?.[key]; if (n === undefined) return '';
        if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || (['transferConcurrency', 'indexingConcurrency'].includes(key) && !Number.isSafeInteger(n)) || (key === 'cpuPercent' && (!Number.isInteger(n) || n < 1 || n > 100))) throw invalid();
        const bytes = Buffer.alloc(8); bytes.writeDoubleBE(n); return bytes.toString('hex');
    });
    const hasLimits = limitFields.some(Boolean);
    if ((hasLimits && c.configurationVersion !== 3) || (!hasLimits && c.configurationVersion === 3)) throw invalid();
    const fields = [hasLimits ? 'thingtime-folder-batch-v2' : 'thingtime-folder-batch-v1', d.batchId, s.origin, s.ownerId, s.dataPlane, s.rootId, s.deviceId,
        saved.id, saved.updatedAt, hasLimits ? '3' : ignoreRules ? '2' : '1', c.name.trim(), c.deviceId, c.localRootId, c.sourceKind ?? 'folder', c.remoteFolderId,
        c.mode, '0', '0', c.network, c.chargingOnly ? '1' : '0', String(c.excludedPaths.length), ...c.excludedPaths, ignoreRules, ...(hasLimits ? limitFields : []), String(d.members.length)];
    const paths = new Set(), ids = new Set(), inodes = new Set(), destinations = new Set();
    for (const [index, member] of d.members.entries()) {
        closed(member, ['ordinal', 'write', 'parent']); const w = closed(member.write, ['operation', 'scope', 'folderId', 'before', 'cloudRootId']);
        const op = closed(w.operation, ['id', 'mutation', 'confirmed']), m = closed(op.mutation, ['kind', 'from', 'path', 'source', 'expectedTarget']);
        const e = closed(m.source, ['path', 'id', 'version', 'kind', 'size', 'sha256']);
        closed(w.scope, ['origin', 'ownerId', 'dataPlane', 'rootId', 'deviceId']);
        const key = pathKey(m.path), destination = JSON.stringify([w.folderId, pathKey(m.path.split('/').at(-1))]);
        if (member.ordinal !== index || !uuid(op.id) || op.confirmed !== false || m.kind !== 'copy' || m.from !== 'local' || m.expectedTarget !== null ||
            e.path !== m.path || e.kind !== 'folder' || e.size !== 0 || e.sha256 !== null ||
            w.before !== null || w.cloudRootId !== c.remoteFolderId || Object.keys(s).some(k => w.scope[k] !== s[k]) ||
            paths.has(key) || ids.has(op.id) || inodes.has(e.id) || destinations.has(destination)) throw invalid();
        paths.add(key); ids.add(op.id); inodes.add(e.id); destinations.add(destination);
        text(e.id); text(e.version);
        const p = closed(member.parent, ['kind', 'id', 'ordinal']);
        const parentPath = m.path.split('/').slice(0, -1).join('/'); let parentValue;
        if (p.kind === 'root' && Object.keys(p).length === 1 && !parentPath && w.folderId === c.remoteFolderId) parentValue = '';
        else if (p.kind === 'existing' && Object.keys(p).length === 2 && typeof p.id === 'string' && p.id === w.folderId && parentPath && !d.members.slice(0,index).some(x => x.write.operation.id === p.id)) parentValue = p.id;
        else if (p.kind === 'member' && Object.keys(p).length === 2 && Number.isSafeInteger(p.ordinal) && p.ordinal >= 0 && p.ordinal < index &&
            d.members[p.ordinal].write.operation.id === w.folderId && d.members[p.ordinal].write.operation.mutation.path === parentPath) parentValue = String(p.ordinal);
        else throw invalid();
        fields.push(String(index), op.id, w.cloudRootId, w.folderId, m.path, e.id, e.version, p.kind, parentValue);
    }
    for (const member of d.members) {
        const parentPath = member.write.operation.mutation.path.split('/').slice(0,-1).join('/');
        const parent = d.members.find(x => pathKey(x.write.operation.mutation.path) === (parentPath ? pathKey(parentPath) : ''));
        if (parent && (member.parent.kind !== 'member' || member.parent.ordinal !== parent.ordinal)) throw invalid();
    }
    // Empty ignore text/raw hash are intentional; all other fields are strings.
    if (fields.some(f => typeof f !== 'string')) throw invalid();
    return Buffer.from(fields.map(f => `${Buffer.byteLength(f)}:${f}`).join(''));
}

function validateFolderBatchInput(input, context) {
    closed(input.batch, ['descriptor', 'digest', 'ordinals']);
    const { descriptor, digest, ordinals } = input.batch;
    if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest) || createHash('sha256').update(folderBatchCanonicalBytes(descriptor)).digest('hex') !== digest ||
        descriptor.scope.origin !== context.apiOrigin || descriptor.scope.ownerId !== input.ownerId || descriptor.scope.deviceId !== input.deviceId ||
        descriptor.configuration.configuration.localRootId !== input.rootId || !Number.isSafeInteger(input.remainingMs) || input.remainingMs < 1 || input.remainingMs > 180000 ||
        !Array.isArray(ordinals) || !ordinals.length || ordinals.length > descriptor.members.length ||
        ordinals.some((n, i) => !Number.isSafeInteger(n) || n < 0 || n >= descriptor.members.length || (i && n <= ordinals[i-1])) ||
        Buffer.byteLength(JSON.stringify(input)) > 524288) throw invalid();
}
function validateFolderBatchReply(input, value) {
    const { descriptor, digest, ordinals } = input.batch;
    const body = closed(value.validatedFolderBatch, ['ok', 'version', 'batchId', 'digest', 'results']);
    if (value.rootId !== input.rootId || !Array.isArray(value.roots) || body.ok !== true || body.version !== 1 || body.batchId !== descriptor.batchId || body.digest !== digest ||
        !Array.isArray(body.results) || body.results.length !== ordinals.length || Buffer.byteLength(JSON.stringify(value)) > 524288) throw invalid();
    body.results.forEach((row,i) => {
        closed(row, row.status === 'validated' ? ['ordinal','status'] : ['ordinal','status','code','retryable']);
        if (row.ordinal !== ordinals[i] || (row.status !== 'validated' && !(row.status === 'failed' && ['source-changed','invalid-member'].includes(row.code) && row.retryable === false))) throw invalid();
    });
}
module.exports = { folderBatchCanonicalBytes, validateFolderBatchInput, validateFolderBatchReply };
