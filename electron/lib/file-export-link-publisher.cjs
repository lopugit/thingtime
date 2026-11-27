'use strict';

// This short-lived process pins the selected directory as its kernel cwd.
// Final names are always exclusive. Uncertain final entries are never removed.
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');
const { isUtf8 } = require('node:buffer');
const { execFile } = require('node:child_process');
const path = require('node:path');
const unsupported = error => ['ENOTSUP', 'EOPNOTSUPP', 'ENOSYS'].includes(error?.code);
const sameNode = (a, b) => String(a.dev) === String(b.dev) && String(a.ino) === String(b.ino);
const failed = () => Error('Link publication could not be verified. Check the selected folder before retrying.');
const stamp = value => `${value.dev}:${value.ino}:${value.size}:${value.mtimeNs}:${value.ctimeNs}:${value.nlink}`;
const run = (file, args) => new Promise((resolve, reject) => execFile(file, args, { timeout: 5000, maxBuffer: 262144 }, (error, stdout) => error ? reject(error) : resolve(stdout)));
async function filesystemType() {
    if (process.platform !== 'darwin') return '';
    // diskutil accepts mount roots rather than arbitrary subdirectories. Read
    // only filesystem metadata, without creating an unowned symlink probe.
    let current = await fs.realpath('.'), device = (await fs.stat('.')).dev;
    for (;;) {
        const parent = path.dirname(current);
        if (parent === current || (await fs.stat(parent)).dev !== device) break;
        current = parent;
    }
    const xml = await run('/usr/sbin/diskutil', ['info', '-plist', current]);
    return /<key>FilesystemType<\/key>\s*<string>([^<]+)<\/string>/.exec(xml)?.[1] ?? '';
}
async function verifyBytes(file, bytes, links = 1n) {
    const before = await file.stat({ bigint: true });
    if (!before.isFile() || before.size !== BigInt(bytes.length) || before.nlink !== links) throw failed();
    const actual = Buffer.alloc(bytes.length); let offset = 0;
    while (offset < actual.length) {
        const { bytesRead } = await file.read(actual, offset, actual.length - offset, offset);
        if (!bytesRead) throw failed(); offset += bytesRead;
    }
    if (!actual.equals(bytes) || stamp(before) !== stamp(await file.stat({ bigint: true }))) throw failed();
    return before;
}
async function publishLink(input, operations = fs, control = {}) {
    const check = control.check ?? (() => {}), authorize = control.authorize ?? (async () => {});
    if (!input || typeof input.name !== 'string' || !input.name || /[\x00-\x1f/\\:]/.test(input.name) || ['.', '..'].includes(input.name)) throw failed();
    const link = input.symbolicLink;
    if (link?.format !== 'posix-symlink-v1' || typeof link.targetBase64 !== 'string') throw failed();
    const target = Buffer.from(link.targetBase64, 'base64');
    if (!target.length || target.includes(0) || target.toString('base64') !== link.targetBase64) throw failed();
    const parent = await fs.open('.', constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    let candidate, candidateName, candidateInfo, final, publishing = false, complete = false;
    const gate = async () => { check(); await authorize(); check(); };
    try {
        if (!sameNode(await parent.stat({ bigint: true }), input.parent)) throw failed();
        await gate();
        let representation = 'symbolic-link', type;
        try {
            // One exclusive syscall publishes a complete link. A pathname stat
            // after this call cannot establish ownership, so never unlink it.
            await operations.symlink(target, input.name);
            const after = await fs.lstat(input.name, { bigint: true });
            if (!after.isSymbolicLink() || !(await fs.readlink(input.name, { encoding: 'buffer' })).equals(target)) throw failed();
        } catch (error) {
            if (!unsupported(error)) {
                if (process.platform !== 'darwin' || error?.code !== 'EINVAL' || isUtf8(target)) throw error;
                type = await (operations.filesystemType ?? filesystemType)();
                if (!['msdos', 'exfat'].includes(type)) throw error;
            }
            check(); representation = 'symbolic-link-fallback';
            const bytes = Buffer.from(JSON.stringify({ format: 'thingtime-symbolic-link-fallback-v1', originalKind: 'symbolic-link', symbolicLink: link, tags: ['former-symbolic-link'] }) + '\n');
            candidateName = '.thingtime-link-candidate-' + randomUUID();
            candidate = await fs.open(candidateName, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
            await candidate.writeFile(bytes); await candidate.sync();
            // An open exclusive-creation handle, not a later pathname lookup,
            // proves ownership. FAT may change the inode on first allocation.
            candidateInfo = await verifyBytes(candidate, bytes);
            if (!sameNode(await fs.lstat(candidateName, { bigint: true }), candidateInfo)) throw failed();
            type ??= await (operations.filesystemType ?? filesystemType)().catch(() => '');
            await gate();
            if (!['msdos', 'exfat'].includes(type)) {
                // Hard-link publication is atomic and exclusive on filesystems
                // that support it. Never retry a collision or permission error.
                try { await (operations.link ?? fs.link)(candidateName, input.name); publishing = true; }
                catch (error) { if (!unsupported(error)) throw error; }
            }
            if (!publishing) {
                // FAT has no hard links or atomic exclusive inode publication.
                // Preserve the verified private candidate if this final write is
                // interrupted. Never retry or delete an uncertain final name.
                await gate();
                final = await (operations.openFinal ?? fs.open)(input.name, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
                publishing = true;
                await final.writeFile(bytes); await final.sync();
                const owned = await verifyBytes(final, bytes);
                if (!sameNode(await fs.lstat(input.name, { bigint: true }), owned)) throw failed();
            } else {
                if (!sameNode(await fs.lstat(input.name, { bigint: true }), candidateInfo)) throw failed();
                await verifyBytes(candidate, bytes, 2n);
            }
        }
        await parent.sync();
        if (representation === 'symbolic-link') {
            const after = await fs.lstat(input.name, { bigint: true });
            if (!after.isSymbolicLink() || !(await fs.readlink(input.name, { encoding: 'buffer' })).equals(target)) throw failed();
        }
        complete = true;
        return { representation, targetSha256: createHash('sha256').update(target).digest('hex') };
    } finally {
        await final?.close().catch(() => {});
        if (candidate && candidateName) {
            try {
                const owned = await candidate.stat({ bigint: true });
                if ((complete || !publishing) && sameNode(await fs.lstat(candidateName, { bigint: true }), owned)) { await fs.unlink(candidateName); await parent.sync(); }
            } catch { /* Preserve every uncertain inode, including another writer. */ }
            await candidate.close().catch(() => {});
        }
        await parent.close();
    }
}

if (require.main === module) {
    let aborted = false, started = false;
    const pending = new Map();
    const cancel = () => { aborted = true; for (const finish of pending.values()) finish(false); pending.clear(); };
    process.on('disconnect', cancel);
    const check = () => { if (aborted || !process.connected) throw failed(); };
    const authorize = () => new Promise((resolve, reject) => {
        check(); const ticket = randomUUID();
        const timeout = setTimeout(() => { pending.delete(ticket); reject(failed()); }, 10000); timeout.unref?.();
        pending.set(ticket, accepted => { clearTimeout(timeout); pending.delete(ticket); accepted ? resolve() : reject(failed()); });
        process.send({ kind: 'authority', ticket }, error => { if (error) pending.get(ticket)?.(false); });
    });
    process.on('message', message => {
        if (message?.kind === 'cancel') { cancel(); return; }
        if (message?.kind === 'authority-reply') { pending.get(message.ticket)?.(message.accepted === true && !aborted); return; }
        if (message?.kind !== 'publish' || started) return;
        started = true;
        publishLink(message.input, fs, { check, authorize }).then(result => {
            if (process.connected) process.send({ ok: true, ...result }, () => process.disconnect());
        }, () => {
            if (process.connected) process.send({ ok: false }, () => process.disconnect());
        });
    });
}
module.exports = { publishLink };
