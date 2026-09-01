import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, isAbsolute, normalize } from 'node:path';

import type { LiveConnector } from './types.js';

export const MAX_PUBLIC_PROJECT_REFERENCES = 128;
const MAX_PROJECT_REGISTRY_BYTES = 1_048_576;
const validID = (value: string) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);

const projectLabelFromPath = (projectPath: string): string => {
	const source = basename(projectPath).replace(/[\\/\p{Cc}\p{Cf}]/gu, ' ').trim();
	if (!source) return 'Project';
	let label = '';
	let size = 0;
	for (const character of source) {
		const characterSize = Buffer.byteLength(character, 'utf8');
		if (size + characterSize > 120) break;
		label += character;
		size += characterSize;
	}
	return label.trim() || 'Project';
};

export type PublicProjectReference = {
	projectId: string;
	projectLabel: string;
};

/**
 * Keeps absolute working directories inside the node process. Remote commands
 * and mirrored sessions use bounded opaque project ids and a basename label.
 */
export class LocalProjectRegistry {
	private readonly paths = new Map<string, string>();
	private readonly references = new Map<string, PublicProjectReference>();

	constructor(
		configuredProjects: Record<string, string> = {},
		private readonly defaultProjectId: string | null = null,
		private readonly registryFilePath: string | null = null
	) {
		for (const [id, path] of Object.entries(configuredProjects)) {
			if (!validID(id)) throw new Error('A configured project id is invalid.');
			this.register(path, id);
		}
		if (defaultProjectId && !this.paths.has(defaultProjectId)) {
			throw new Error('The default project id is not configured.');
		}
		if (registryFilePath && (!isAbsolute(registryFilePath) || registryFilePath.length > 4_096)) {
			throw new Error('The local project registry file is invalid.');
		}
	}

	static fromEnvironment(environment: NodeJS.ProcessEnv): LocalProjectRegistry {
		let projects: Record<string, string> = {};
		const raw = environment.THINGTIME_NODE_PROJECTS_JSON;
		if (raw) {
			const parsed: unknown = JSON.parse(raw);
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
				throw new Error('The local project registry is invalid.');
			}
			projects = Object.fromEntries(
				Object.entries(parsed).map(([id, path]) => {
					if (typeof path !== 'string') throw new Error('A configured project path is invalid.');
					return [id, path];
				})
			);
		}
		return new LocalProjectRegistry(
			projects,
			environment.THINGTIME_NODE_DEFAULT_PROJECT_ID || null,
			environment.THINGTIME_NODE_PROJECT_REGISTRY_PATH || null
		);
	}

	/** Reloads the Electron-owned 0600 registry without exposing its paths. */
	reloadFromFile(): void {
		if (!this.registryFilePath) return;
		let details;
		try {
			details = lstatSync(this.registryFilePath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
			throw new Error('The local project registry file is unavailable.');
		}
		if (
			!details.isFile() ||
			details.isSymbolicLink() ||
			details.size > MAX_PROJECT_REGISTRY_BYTES ||
			(details.mode & 0o077) !== 0 ||
			(typeof process.getuid === 'function' && details.uid !== process.getuid())
		) {
			throw new Error('The local project registry file failed its privacy checks.');
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(readFileSync(this.registryFilePath, 'utf8')) as unknown;
		} catch {
			throw new Error('The local project registry file is invalid.');
		}
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			throw new Error('The local project registry file is invalid.');
		}
		const source = parsed as Record<string, unknown>;
		if (
			Object.keys(source).some((key) => key !== 'version' && key !== 'projectPaths') ||
			source.version !== 1 ||
			!Array.isArray(source.projectPaths) ||
			source.projectPaths.length > MAX_PUBLIC_PROJECT_REFERENCES
		) {
			throw new Error('The local project registry file is invalid.');
		}
		const seen = new Set<string>();
		for (const projectPath of source.projectPaths) {
			if (
				typeof projectPath !== 'string' ||
				!isAbsolute(projectPath) ||
				projectPath.length > 4_096 ||
				/[\0\r\n]/u.test(projectPath) ||
				seen.has(projectPath)
			) {
				throw new Error('The local project registry file is invalid.');
			}
			seen.add(projectPath);
			this.register(projectPath);
		}
	}

	register(path: string, explicitId?: string): PublicProjectReference {
		const resolved = this.normalizedPath(path);
		const id = explicitId ?? `local-${createHash('sha256').update('thingtime-project\0').update(resolved).digest('hex').slice(0, 32)}`;
		if (!validID(id)) throw new Error('The local project id is invalid.');
		const reference = { projectId: id, projectLabel: projectLabelFromPath(resolved) };
		this.paths.delete(id);
		this.references.delete(id);
		this.paths.set(id, resolved);
		this.references.set(id, reference);
		while (this.paths.size > MAX_PUBLIC_PROJECT_REFERENCES) {
			const oldest = this.paths.keys().next().value;
			if (!oldest) break;
			this.paths.delete(oldest);
			this.references.delete(oldest);
		}
		return reference;
	}

	/**
	 * Returns the bounded, path-free project vocabulary that may cross the
	 * connector boundary. The configured default is first so clients can offer
	 * a useful initial selection without learning anything about local paths.
	 */
	list(): PublicProjectReference[] {
		const references = [...this.references.values()];
		if (!this.defaultProjectId) return references.map((reference) => ({ ...reference }));
		return references
			.sort((left, right) => Number(right.projectId === this.defaultProjectId) - Number(left.projectId === this.defaultProjectId))
			.map((reference) => ({ ...reference }));
	}

	resolve(projectId?: string | null): string {
		this.reloadFromFile();
		const id = projectId || this.defaultProjectId || (this.paths.size === 1 ? this.paths.keys().next().value : null);
		const path = id ? this.paths.get(id) : null;
		if (!path) throw new Error('That local project is unavailable. Refresh the device project list and try again.');
		return this.safeDirectory(path);
	}

	private normalizedPath(path: string): string {
		if (!isAbsolute(path) || path.length > 4_096) throw new Error('A local project path is invalid.');
		try {
			return realpathSync(path);
		} catch {
			return normalize(path);
		}
	}

	private safeDirectory(path: string): string {
		if (!isAbsolute(path) || path.length > 4_096) throw new Error('A local project path is invalid.');
		let resolved: string;
		try {
			resolved = realpathSync(path);
			if (!statSync(resolved).isDirectory()) throw new Error('not-directory');
		} catch {
			throw new Error('A configured local project is unavailable.');
		}
		return resolved;
	}
}

/**
 * Populates an empty fresh-install registry from connectors that can discover
 * local projects. The connector owns the bounded scan and the registry owns
 * every local path; errors are intentionally contained on the node.
 */
export const refreshEmptyProjectRegistry = async <Connector extends Pick<LiveConnector, 'refreshProjects'>>(
	registry: LocalProjectRegistry,
	connectors: Iterable<Connector>,
	startConnector: (connector: Connector) => Promise<void>
): Promise<void> => {
	for (const connector of connectors) {
		if (!connector.refreshProjects) continue;
		try {
			await startConnector(connector);
			if (registry.list().length === 0) await connector.refreshProjects();
		} catch {
			// Local connector failures can contain paths. Keep them off the wire;
			// connector/list still returns any references registered before failure.
		}
		if (registry.list().length >= MAX_PUBLIC_PROJECT_REFERENCES) break;
	}
};
