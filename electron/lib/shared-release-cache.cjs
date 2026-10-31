'use strict';

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const DESKTOP_APPLICATION_SUPPORT_ID = 'com.thingtime.desktop';

function validatedHomeDirectory(homeDirectory = os.homedir()) {
	if (typeof homeDirectory !== 'string' || !path.isAbsolute(homeDirectory)) {
		throw new Error('Thingtime needs an absolute home directory to locate recovery bundles.');
	}
	return path.resolve(homeDirectory);
}

/**
 * A version-independent cache location intentionally outside Electron's
 * per-build userData directory. It is shared by Thingtime Desktop and the
 * standalone native recovery application, so a broken desktop version never
 * strands its previously verified bundles.
 */
function sharedReleaseCacheRoot(homeDirectory) {
	return path.join(validatedHomeDirectory(homeDirectory), 'Library', 'Application Support', DESKTOP_APPLICATION_SUPPORT_ID, 'release-cache');
}

function recoveryApplicationCacheRoot(homeDirectory) {
	return path.join(validatedHomeDirectory(homeDirectory), 'Library', 'Application Support', DESKTOP_APPLICATION_SUPPORT_ID, 'recovery-cache');
}

function isRegularDirectory(directory) {
	const stat = fs.lstatSync(directory);
	return !stat.isSymbolicLink() && stat.isDirectory();
}

/**
 * Existing PR #68 builds used Electron's per-app userData cache. Preserve it
 * non-destructively on the first independent Recovery launch so verified
 * rollback choices are not stranded by the move to Application Support.
 */
function migrateLegacyReleaseCache({ legacyRoot, sharedRoot }) {
	const legacy = path.resolve(legacyRoot);
	const shared = path.resolve(sharedRoot);
	if (legacy === shared || !fs.existsSync(legacy) || fs.existsSync(shared)) return false;
	if (!isRegularDirectory(legacy)) throw new Error('The legacy Thingtime release cache is not a regular directory.');
	const parent = path.dirname(shared);
	fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
	if (!isRegularDirectory(parent)) throw new Error('The Thingtime shared cache parent is not a regular directory.');
	fs.cpSync(legacy, shared, { dereference: false, errorOnExist: true, force: false, recursive: true });
	return true;
}

module.exports = {
	DESKTOP_APPLICATION_SUPPORT_ID,
	migrateLegacyReleaseCache,
	recoveryApplicationCacheRoot,
	sharedReleaseCacheRoot
};
