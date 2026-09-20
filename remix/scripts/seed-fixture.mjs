#!/usr/bin/env node
// Seed a realistic local fixture THROUGH THE REAL API (FUNDAMENTALS §2): a
// throwaway user, a folder, and a public post carrying N stored attachments
// uploaded via the normal multipart flow — then tear it down exactly.
//
//   node remix/scripts/seed-fixture.mjs create [--files 3] [--name demo] [--base http://127.0.0.1:<nitro>]
//                                              [--admin-user <name> --admin-password-file <path>] [--no-folder] [--visibility public|hidden|private]
//   node remix/scripts/seed-fixture.mjs resume <remix/.fixtures/<name>.json>   # continue after enabling uploads
//   node remix/scripts/seed-fixture.mjs cleanup <remix/.fixtures/<name>.json | --all>
//   node remix/scripts/seed-fixture.mjs list
//
// Stored bytes need object storage. On a laptop set
// THINGTIME_LOCAL_ATTACHMENT_STORAGE_DIR (see README "Local attachment
// storage") before starting the dev stack; without it uploads fail with
// "Private attachment storage is not configured" and this script stops before
// creating anything else.
//
// New accounts start with uploads locked (signup-permissions hotfix). Either
// pass an admin login (--admin-user + --admin-password-file, never a password
// on the command line) so the script enables uploads for the fixture user
// through POST /api/v1/admin/users/public-uploads, or — with no admin yet —
// let `create` register the user and stop at the first refused upload, add
// ADMIN_USERNAMES=<that username> to remix/.env, restart the dev stack (env
// admins bypass upload approval; a name listed there cannot REGISTER, which
// is why registration happens first), then `resume` the saved state.
//
// State (ids, username and the generated password so you can log in as the
// fixture user) is written to remix/.fixtures/<name>.json (ignored, mode 0600).
// Cleanup deletes the post (cascading its attachments), the folder and signs
// the fixture session out; there is no account-deletion API, so the user row
// stays in the local database.

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const here = path.dirname(fileURLToPath(import.meta.url));
const remixDir = path.resolve(here, '..');
const fixturesDir = path.join(remixDir, '.fixtures');
const require = createRequire(import.meta.url);

export const parseArgs = (argv) => {
	const [command = 'help', ...rest] = argv;
	const options = { command, files: 3, name: 'fixture', base: '', username: '', adminUser: '', adminPasswordFile: '', folder: true, visibility: 'public', dryRun: false, all: false, positional: [] };
	for (let index = 0; index < rest.length; index += 1) {
		const arg = rest[index];
		const next = () => rest[++index];
		if (arg === '--files') options.files = Number(next());
		else if (arg === '--name') options.name = String(next() || 'fixture');
		else if (arg === '--base') options.base = String(next() || '');
		else if (arg === '--username') options.username = String(next() || '');
		else if (arg === '--admin-user') options.adminUser = String(next() || '');
		else if (arg === '--admin-password-file') options.adminPasswordFile = String(next() || '');
		else if (arg === '--visibility') options.visibility = String(next() || 'public');
		else if (arg === '--no-folder') options.folder = false;
		else if (arg === '--dry-run') options.dryRun = true;
		else if (arg === '--all') options.all = true;
		else if (!arg.startsWith('--')) options.positional.push(arg);
		else throw new Error(`Unknown option ${arg}`);
	}
	if (!Number.isInteger(options.files) || options.files < 0 || options.files > 25) throw new Error('--files must be an integer from 0 to 25');
	if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(options.name)) throw new Error('--name must be lowercase letters, digits and dashes');
	if (!['public', 'hidden', 'private'].includes(options.visibility)) throw new Error('--visibility must be public, hidden or private');
	if (options.username && !/^[a-z0-9][a-z0-9._-]{2,31}$/.test(options.username)) throw new Error('--username must be 3-32 lowercase letters, digits, dots, dashes or underscores');
	return options;
};

const defaultBase = () => {
	try {
		const { resolveDevContext } = require('./worktree-ports.cjs');
		return `http://127.0.0.1:${resolveDevContext(remixDir).ports.api}`;
	} catch {
		return 'http://127.0.0.1:10000';
	}
};

// --- tiny valid PNG writer (RGBA, one IDAT) so uploads sniff as image/png ----
const crcTable = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n += 1) {
		let c = n;
		for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();
const crc32 = (bytes) => {
	let crc = 0xffffffff;
	for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
	const typeBytes = Buffer.from(type, 'ascii');
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
	return Buffer.concat([length, typeBytes, data, crc]);
};

export const makePng = (width, height, seed) => {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8; // bit depth
	header[9] = 6; // RGBA
	const raw = Buffer.alloc((width * 4 + 1) * height);
	for (let y = 0; y < height; y += 1) {
		raw[y * (width * 4 + 1)] = 0; // filter: none
		for (let x = 0; x < width; x += 1) {
			const offset = y * (width * 4 + 1) + 1 + x * 4;
			raw[offset] = (x * 7 + seed * 31) & 0xff;
			raw[offset + 1] = (y * 5 + seed * 17) & 0xff;
			raw[offset + 2] = ((x ^ y) + seed * 13) & 0xff;
			raw[offset + 3] = 255;
		}
	}
	return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};

// Varied, recognisable files: PNGs of different sizes plus one text note.
export const fixtureFiles = (count) =>
	Array.from({ length: count }, (_, index) => {
		if (index === count - 1 && count > 1) {
			const text = `Fixture note ${index + 1}\n${'lorem ipsum dolor sit amet '.repeat(40 + index * 10)}\n`;
			return { name: `notes-${index + 1}.txt`, contentType: 'text/plain', bytes: Buffer.from(text, 'utf8') };
		}
		const size = 48 + index * 32;
		return { name: `fixture-${index + 1}.png`, contentType: 'image/png', bytes: makePng(size, size, index + 1) };
	});

// --- minimal cookie jar + JSON client -------------------------------------
class Session {
	constructor(base) {
		this.base = base.replace(/\/$/, '');
		this.cookies = new Map();
	}
	absorb(response) {
		for (const header of response.headers.getSetCookie?.() || []) {
			const [pair] = header.split(';');
			const eq = pair.indexOf('=');
			if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
		}
	}
	cookieHeader() {
		return [...this.cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
	}
	async json(method, route, body) {
		const response = await fetch(`${this.base}${route}`, {
			method,
			headers: { 'Content-Type': 'application/json', Accept: 'application/json', Origin: this.base, ...(this.cookies.size ? { Cookie: this.cookieHeader() } : {}) },
			body: body === undefined ? undefined : JSON.stringify(body)
		});
		this.absorb(response);
		const text = await response.text();
		let payload = null;
		try {
			payload = text ? JSON.parse(text) : null;
		} catch {
			payload = { ok: false, error: text.slice(0, 200) };
		}
		if (!response.ok || payload?.ok === false) {
			const error = new Error(`${method} ${route} → ${response.status}${payload?.error ? `: ${payload.error}` : ''}`);
			error.status = response.status;
			error.code = payload?.code;
			throw error;
		}
		return payload;
	}
	async put(url, bytes, headers) {
		const target = /^https?:/i.test(url) ? url : `${this.base}${url}`;
		const response = await fetch(target, { method: 'PUT', headers: { ...headers, 'Content-Length': String(bytes.byteLength) }, body: bytes });
		if (!response.ok) throw new Error(`PUT part → ${response.status}: ${(await response.text()).slice(0, 200)}`);
	}
}

const sha256Base64 = (bytes) => createHash('sha256').update(bytes).digest('base64');

const uploadFile = async (session, file) => {
	const started = await session.json('POST', '/api/v1/attachments/uploads', { requestId: randomUUID(), filename: file.name, contentType: file.contentType, sizeBytes: file.bytes.byteLength, purpose: 'post' });
	const { id: uploadId, partSizeBytes, partCount } = started.upload;
	const parts = [];
	for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
		const start = (partNumber - 1) * partSizeBytes;
		const slice = file.bytes.subarray(start, Math.min(file.bytes.byteLength, start + partSizeBytes));
		parts.push({ partNumber, checksumSha256: sha256Base64(slice), bytes: slice });
	}
	const signed = await session.json('POST', '/api/v1/attachments/uploads/parts', { uploadId, parts: parts.map(({ partNumber, checksumSha256 }) => ({ partNumber, checksumSha256 })) });
	for (const part of signed.parts) {
		const local = parts.find((entry) => entry.partNumber === part.partNumber);
		await session.put(part.url, local.bytes, part.headers || {});
	}
	const completed = await session.json('POST', '/api/v1/attachments/uploads/complete', { uploadId });
	return completed.attachment;
};

const stateFile = (name) => path.join(fixturesDir, `${name}.json`);
const saveState = (state) => {
	mkdirSync(fixturesDir, { recursive: true });
	writeFileSync(stateFile(state.name), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
	chmodSync(stateFile(state.name), 0o600);
	return stateFile(state.name);
};

const create = async (options) => {
	const base = options.base || defaultBase();
	// --username makes the ADMIN_USERNAMES workflow deterministic (admins bypass upload approval)
	const username = options.username || `fx-${options.name}-${randomBytes(3).toString('hex')}`.slice(0, 32);
	const password = `${randomBytes(18).toString('base64url')}Aa1!`;
	if (options.dryRun) {
		console.log(JSON.stringify({ base, username, files: fixtureFiles(options.files).map((file) => `${file.name} (${file.bytes.byteLength} B)`) }, null, 2));
		console.log(`\nTo allow uploads without an admin login, start the dev stack with ADMIN_USERNAMES=${username} and rerun without --dry-run using --name ${options.name}.`);
		return;
	}
	if (existsSync(stateFile(options.name))) throw new Error(`${path.relative(process.cwd(), stateFile(options.name))} already exists — resume or clean it up first`);
	const session = new Session(base);
	const state = { name: options.name, base, createdAt: new Date().toISOString(), username, password, userId: null, folderId: null, postId: null, attachmentIds: [], filesRequested: options.files, folderRequested: options.folder, visibility: options.visibility };
	const registered = await session.json('POST', '/api/v1/auth/register', { username, password, email: `${username}@example.test` });
	state.userId = registered.user?.id || null;
	console.log(`[seed] registered ${username} (${state.userId})`);
	saveState(state);

	if (options.adminUser) {
		if (!options.adminPasswordFile) throw new Error('--admin-user needs --admin-password-file (never pass a password on the command line)');
		const adminPassword = readFileSync(options.adminPasswordFile, 'utf8').trim();
		const admin = new Session(base);
		await admin.json('POST', '/api/v1/login', { username: options.adminUser, password: adminPassword });
		await admin.json('POST', '/api/v1/admin/users/public-uploads', { userId: state.userId, enabled: true, scope: 'all' });
		console.log(`[seed] uploads enabled for ${username} by ${options.adminUser}`);
	}

	await materialize(session, state);
};

// Everything after registration is resumable: each step checks the saved state
// first, so `resume` after enabling uploads (or after a crash) never creates a
// second folder, post or duplicate attachment.
const materialize = async (session, state) => {
	const file = stateFile(state.name);
	if (state.folderRequested && !state.folderId) {
		const folder = await session.json('POST', '/api/v1/things', { thingtime: ['folder'], crystal: { name: `Fixture ${state.name}`, icon: '🧪' } });
		state.folderId = folder.thing?.id || folder.id || null;
		saveState(state);
		console.log(`[seed] folder ${state.folderId}`);
	}

	const files = fixtureFiles(state.filesRequested);
	for (const [index, entry] of files.entries()) {
		if (state.attachmentIds[index]) continue;
		try {
			const attachment = await uploadFile(session, entry);
			state.attachmentIds[index] = attachment.id;
			saveState(state);
			console.log(`[seed] uploaded ${entry.name} → ${attachment.id}`);
		} catch (error) {
			if (error.code === 'public_uploads_not_approved') {
				throw new Error(
					`Uploads are not approved for ${state.username} (state saved in ${path.relative(process.cwd(), file)}). Either rerun create with --admin-user/--admin-password-file, or add ADMIN_USERNAMES=${state.username} to remix/.env, restart the dev stack, then: node remix/scripts/seed-fixture.mjs resume ${path.relative(process.cwd(), file)}`
				);
			}
			throw error;
		}
	}

	if (!state.postId) {
		const post = await session.json('POST', '/api/v1/things', {
			type: 'text',
			text: `Fixture post "${state.name}" 🧪 — ${files.length} stored file${files.length === 1 ? '' : 's'} uploaded through the real API`,
			visibility: state.visibility,
			attachmentIds: state.attachmentIds
		});
		state.postId = post.post?.id || post.thing?.id || post.id || null;
		saveState(state);
		console.log(`[seed] post ${state.postId}`);
	}
	if (state.folderId && state.postId && !state.filed) {
		await session.json('PATCH', '/api/v1/things', { id: state.postId, folderId: state.folderId });
		state.filed = true;
		saveState(state);
	}
	console.log('\nFixture ready:');
	console.log(`  post     /post/${state.postId}   (API base ${state.base})`);
	if (state.folderId) console.log(`  folder   /things?folder=${state.folderId}`);
	console.log(`  archive  ${state.base}/api/v1/attachments/archive?id=${state.postId}&manifest=1`);
	console.log(`  login    ${state.username} — password stored in ${path.relative(process.cwd(), file)} (mode 0600)`);
	console.log(`  cleanup  node remix/scripts/seed-fixture.mjs cleanup ${path.relative(process.cwd(), file)}`);
};

const resume = async (file) => {
	const state = JSON.parse(readFileSync(file, 'utf8'));
	const session = new Session(state.base);
	await session.json('POST', '/api/v1/login', { username: state.username, password: state.password });
	console.log(`[seed] resuming ${state.name} as ${state.username}`);
	await materialize(session, state);
};

const cleanup = async (file) => {
	const state = JSON.parse(readFileSync(file, 'utf8'));
	const session = new Session(state.base);
	await session.json('POST', '/api/v1/login', { username: state.username, password: state.password });
	const steps = [];
	if (state.postId) {
		await session.json('DELETE', '/api/v1/things', { id: state.postId }).then(() => steps.push(`post ${state.postId} (attachments cascade)`), (error) => steps.push(`post ${state.postId}: ${error.message}`));
	}
	if (state.folderId) {
		await session.json('DELETE', '/api/v1/things', { id: state.folderId }).then(() => steps.push(`folder ${state.folderId}`), (error) => steps.push(`folder ${state.folderId}: ${error.message}`));
	}
	if (state.userId) {
		await session.json('POST', '/api/v1/auth/accounts/remove', { userId: state.userId }).then(() => steps.push('session signed out'), (error) => steps.push(`sign-out: ${error.message}`));
	}
	rmSync(file, { force: true });
	console.log(`[seed] cleaned up ${state.name}:\n  ${steps.join('\n  ')}\n  user row ${state.username} remains (no account-deletion API)`);
};

const list = () => {
	if (!existsSync(fixturesDir)) return console.log('No fixtures.');
	for (const name of readdirSync(fixturesDir).filter((entry) => entry.endsWith('.json'))) {
		const state = JSON.parse(readFileSync(path.join(fixturesDir, name), 'utf8'));
		console.log(`${name}\t${state.username}\tpost ${state.postId || '-'}\tfolder ${state.folderId || '-'}\t${state.attachmentIds?.length || 0} files\t${state.createdAt}`);
	}
};

const main = async () => {
	const options = parseArgs(process.argv.slice(2));
	if (options.command === 'create') return create(options);
	if (options.command === 'resume') {
		if (!options.positional[0]) throw new Error('resume needs a state file');
		return resume(options.positional[0]);
	}
	if (options.command === 'cleanup') {
		const targets = options.all ? (existsSync(fixturesDir) ? readdirSync(fixturesDir).filter((entry) => entry.endsWith('.json')).map((entry) => path.join(fixturesDir, entry)) : []) : options.positional;
		if (!targets.length) throw new Error('cleanup needs a state file or --all');
		for (const target of targets) await cleanup(target);
		return undefined;
	}
	if (options.command === 'list') return list();
	console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 24).map((line) => line.replace(/^\/\/ ?/, '')).join('\n'));
	return undefined;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(`[seed] ${error.message}`);
		process.exit(1);
	});
}
