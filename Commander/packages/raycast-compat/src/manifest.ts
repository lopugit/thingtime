import { spawn } from 'node:child_process';
import { access, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { CommanderExtension, ExtensionCommand } from '@commander/protocol';

interface RaycastManifestCommand {
  name?: unknown;
  title?: unknown;
  subtitle?: unknown;
  description?: unknown;
  mode?: unknown;
  keywords?: unknown;
  entry?: unknown;
  preferences?: unknown;
}

interface RaycastManifest {
  name?: unknown;
  title?: unknown;
  description?: unknown;
  version?: unknown;
  author?: unknown;
  icon?: unknown;
  commands?: unknown;
  disabledCommands?: unknown;
  scripts?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
  packageManager?: unknown;
  preferences?: unknown;
}

export type RaycastPreferenceType =
  'textfield' | 'password' | 'checkbox' | 'dropdown' | 'appPicker' | 'file' | 'directory';

export interface RaycastPreferenceDefinition {
  name: string;
  type: RaycastPreferenceType;
  commandName?: string;
  defaultValue?: unknown;
}

export type RaycastPackageManager = 'pnpm' | 'yarn' | 'npm' | 'bun';
export type RaycastDiagnosticSeverity = 'info' | 'warning' | 'error';
export type RaycastCompatibilityDiagnosticCode =
  | 'sdk.detected'
  | 'sdk.not-declared'
  | 'command.ready'
  | 'command.source-only'
  | 'command.entry-missing'
  | 'command.mode-unsupported'
  | 'build.available'
  | 'build.script-missing'
  | 'build.failed'
  | 'build.timed-out';

export interface RaycastCompatibilityDiagnostic {
  code: RaycastCompatibilityDiagnosticCode;
  severity: RaycastDiagnosticSeverity;
  message: string;
  commandName?: string;
  remediation?: string;
}

export interface RaycastCommandPreparation {
  command: ExtensionCommand;
  status: 'ready' | 'source-only' | 'metadata-only' | 'unsupported-mode';
  sourceEntry?: string;
  buildEntry?: string;
}

export interface RaycastExtensionSourceReport {
  extension: CommanderExtension;
  extensionPath: string;
  manifestPath: string;
  packageManager: RaycastPackageManager;
  buildScript?: string;
  sdkDeclared: boolean;
  commands: RaycastCommandPreparation[];
  diagnostics: RaycastCompatibilityDiagnostic[];
  readyNoViewCommands: number;
}

export interface PrepareRaycastExtensionOptions {
  /** Run an extension-authored build script only when the caller explicitly opts in. */
  build?: boolean;
  /** Required together with build=true because package scripts execute untrusted code. */
  allowUntrustedBuildScripts?: boolean;
  buildTimeoutMs?: number;
}

export interface RaycastBuildResult {
  attempted: boolean;
  command?: string;
  exitCode?: number;
  timedOut?: boolean;
  stdout?: string;
  stderr?: string;
}

export interface PreparedRaycastExtension {
  report: RaycastExtensionSourceReport;
  build: RaycastBuildResult;
}

export class RaycastBuildConsentError extends Error {
  constructor() {
    super(
      'Building a Raycast extension executes extension-authored package scripts; pass allowUntrustedBuildScripts: true to opt in',
    );
    this.name = 'RaycastBuildConsentError';
  }
}

const manifestCandidates = ['package.json', 'extension.json'];
const sourceExtensions = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs'];
const buildExtensions = ['.js', '.mjs', '.cjs'];
const MAX_BUILD_OUTPUT_BYTES = 64 * 1024;

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function commandFrom(value: RaycastManifestCommand, disabled: boolean): ExtensionCommand | null {
  const name = text(value.name).trim();
  const title = text(value.title, name).trim();
  if (!name || !title) return null;
  const mode = value.mode === 'no-view' || value.mode === 'menu-bar' ? value.mode : 'view';
  return {
    name,
    title,
    ...(text(value.description || value.subtitle)
      ? { description: text(value.description || value.subtitle) }
      : {}),
    mode,
    keywords: Array.isArray(value.keywords)
      ? value.keywords.filter((item): item is string => typeof item === 'string')
      : [],
    disabled,
  };
}

async function existingFile(candidates: string[]): Promise<string | undefined> {
  for (const candidate of candidates) {
    try {
      const details = await stat(candidate);
      if (details.isFile()) return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return undefined;
}

function manifestCommands(
  manifest: RaycastManifest,
): Array<{ manifest: RaycastManifestCommand; command: ExtensionCommand }> {
  const enabled = Array.isArray(manifest.commands) ? manifest.commands : [];
  const disabled = Array.isArray(manifest.disabledCommands) ? manifest.disabledCommands : [];
  return [
    ...enabled.map((value) => ({
      manifest: value as RaycastManifestCommand,
      command: commandFrom(value as RaycastManifestCommand, false),
    })),
    ...disabled.map((value) => ({
      manifest: value as RaycastManifestCommand,
      command: commandFrom(value as RaycastManifestCommand, true),
    })),
  ].filter(
    (value): value is { manifest: RaycastManifestCommand; command: ExtensionCommand } =>
      value.command !== null,
  );
}

async function loadManifest(
  extensionPath: string,
): Promise<{ extensionPath: string; manifestPath: string; manifest: RaycastManifest }> {
  const resolved = await realpath(extensionPath);
  if (!(await stat(resolved)).isDirectory()) throw new Error('Raycast extension path must be a directory');
  const manifestPath = await findRaycastManifest(resolved);
  return {
    extensionPath: resolved,
    manifestPath,
    manifest: JSON.parse(await readFile(manifestPath, 'utf8')) as RaycastManifest,
  };
}

function extensionFrom(extensionPath: string, manifest: RaycastManifest): CommanderExtension {
  const name = text(manifest.name, path.basename(extensionPath)).trim();
  if (!name) throw new Error('Raycast extension manifest is missing name');
  const commands = manifestCommands(manifest).map(({ command }) => command);
  if (!commands.length) throw new Error('Raycast extension has no valid commands');
  return {
    id: `raycast:${text(manifest.author, 'local')}/${name}`,
    name,
    title: text(manifest.title, name),
    description: text(manifest.description, 'Raycast-compatible extension'),
    version: text(manifest.version, '0.0.0'),
    ...(text(manifest.author) ? { author: text(manifest.author) } : {}),
    ...(text(manifest.icon) ? { icon: path.resolve(extensionPath, text(manifest.icon)) } : {}),
    source: 'sideload',
    path: extensionPath,
    enabled: true,
    compatibility: 'partial',
    commands,
  };
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

const preferenceTypes = new Set<RaycastPreferenceType>([
  'textfield',
  'password',
  'checkbox',
  'dropdown',
  'appPicker',
  'file',
  'directory',
]);

function preferenceDefinitions(value: unknown, commandName?: string): RaycastPreferenceDefinition[] {
  if (!Array.isArray(value)) return [];
  const definitions: RaycastPreferenceDefinition[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const preference = candidate as { name?: unknown; type?: unknown; default?: unknown };
    const name = text(preference.name).trim();
    if (!name || !preferenceTypes.has(preference.type as RaycastPreferenceType)) continue;
    definitions.push({
      name,
      type: preference.type as RaycastPreferenceType,
      ...(commandName ? { commandName } : {}),
      ...('default' in preference ? { defaultValue: structuredClone(preference.default) } : {}),
    });
  }
  return definitions;
}

export async function readRaycastPreferenceDefinitions(
  extensionPath: string,
): Promise<RaycastPreferenceDefinition[]> {
  const { manifest } = await loadManifest(extensionPath);
  const definitions = preferenceDefinitions(manifest.preferences);
  for (const { manifest: command, command: normalized } of manifestCommands(manifest)) {
    definitions.push(...preferenceDefinitions(command.preferences, normalized.name));
  }
  return definitions;
}

async function detectPackageManager(
  extensionPath: string,
  manifest: RaycastManifest,
): Promise<RaycastPackageManager> {
  const declared = text(manifest.packageManager).split('@')[0];
  if (declared === 'pnpm' || declared === 'yarn' || declared === 'npm' || declared === 'bun') return declared;
  const lockfiles: Array<[RaycastPackageManager, string]> = [
    ['pnpm', 'pnpm-lock.yaml'],
    ['yarn', 'yarn.lock'],
    ['bun', 'bun.lock'],
    ['bun', 'bun.lockb'],
    ['npm', 'package-lock.json'],
  ];
  for (const [manager, lockfile] of lockfiles) {
    try {
      await access(path.join(extensionPath, lockfile));
      return manager;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return 'npm';
}

function safeManifestEntry(extensionPath: string, value: unknown): string | undefined {
  const entry = text(value).trim();
  if (!entry || path.isAbsolute(entry)) return undefined;
  const resolved = path.resolve(extensionPath, entry);
  return resolved.startsWith(`${extensionPath}${path.sep}`) ? resolved : undefined;
}

function sourceCandidates(extensionPath: string, command: RaycastManifestCommand, name: string): string[] {
  const explicit = safeManifestEntry(extensionPath, command.entry);
  return [
    ...(explicit ? [explicit] : []),
    ...sourceExtensions.map((extension) => path.join(extensionPath, 'src', `${name}${extension}`)),
    ...sourceExtensions.map((extension) => path.join(extensionPath, 'src', name, `index${extension}`)),
  ];
}

function buildCandidates(extensionPath: string, name: string): string[] {
  return [
    ...buildExtensions.map((extension) => path.join(extensionPath, 'dist', `${name}${extension}`)),
    ...buildExtensions.map((extension) =>
      path.join(extensionPath, 'dist', 'commands', `${name}${extension}`),
    ),
    ...buildExtensions.map((extension) => path.join(extensionPath, 'dist', name, `index${extension}`)),
  ];
}

export async function findRaycastManifest(extensionPath: string): Promise<string> {
  for (const candidate of manifestCandidates) {
    const absolute = path.join(extensionPath, candidate);
    try {
      const parsed = JSON.parse(await readFile(absolute, 'utf8')) as RaycastManifest;
      if (Array.isArray(parsed.commands) || Array.isArray(parsed.disabledCommands)) return absolute;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      if (error instanceof SyntaxError) throw new Error(`${candidate} is not valid JSON`);
      throw error;
    }
  }
  throw new Error('No Raycast extension manifest found (expected package.json or extension.json)');
}

export async function readRaycastExtension(extensionPath: string): Promise<CommanderExtension> {
  const loaded = await loadManifest(extensionPath);
  return extensionFrom(loaded.extensionPath, loaded.manifest);
}

/** Inspect source and build artifacts without installing dependencies or executing extension code. */
export async function inspectRaycastExtensionSource(
  extensionPath: string,
): Promise<RaycastExtensionSourceReport> {
  const loaded = await loadManifest(extensionPath);
  const extension = extensionFrom(loaded.extensionPath, loaded.manifest);
  const packageManager = await detectPackageManager(loaded.extensionPath, loaded.manifest);
  const scripts = stringRecord(loaded.manifest.scripts);
  const dependencies = {
    ...stringRecord(loaded.manifest.dependencies),
    ...stringRecord(loaded.manifest.devDependencies),
  };
  const sdkDeclared = typeof dependencies['@raycast/api'] === 'string';
  const buildScript = scripts.build;
  const diagnostics: RaycastCompatibilityDiagnostic[] = [
    {
      code: sdkDeclared ? 'sdk.detected' : 'sdk.not-declared',
      severity: sdkDeclared ? 'info' : 'warning',
      message: sdkDeclared
        ? 'The extension declares @raycast/api.'
        : 'The extension does not declare @raycast/api.',
      ...(!sdkDeclared
        ? {
            remediation:
              'Confirm this is a Raycast extension and add the official SDK dependency when required.',
          }
        : {}),
    },
  ];

  const manifestEntries = new Map(
    manifestCommands(loaded.manifest).map(({ manifest, command }) => [command.name, manifest]),
  );
  const commands: RaycastCommandPreparation[] = [];
  for (const command of extension.commands) {
    const manifestCommand = manifestEntries.get(command.name) ?? {};
    const [sourceEntry, buildEntry] = await Promise.all([
      existingFile(sourceCandidates(loaded.extensionPath, manifestCommand, command.name)),
      existingFile(buildCandidates(loaded.extensionPath, command.name)),
    ]);
    let status: RaycastCommandPreparation['status'];
    if (command.mode !== 'no-view') status = 'unsupported-mode';
    else if (buildEntry) status = 'ready';
    else if (sourceEntry) status = 'source-only';
    else status = 'metadata-only';
    commands.push({
      command,
      status,
      ...(sourceEntry ? { sourceEntry } : {}),
      ...(buildEntry ? { buildEntry } : {}),
    });

    if (command.mode !== 'no-view') {
      diagnostics.push({
        code: 'command.mode-unsupported',
        severity: 'warning',
        commandName: command.name,
        message: `${command.mode} command rendering is not implemented.`,
        remediation:
          'Use Raycast for this command until Commander implements the corresponding custom render-tree bridge.',
      });
    } else if (buildEntry) {
      diagnostics.push({
        code: 'command.ready',
        severity: 'info',
        commandName: command.name,
        message: `Runnable build entry found at ${path.relative(loaded.extensionPath, buildEntry)}.`,
      });
    } else if (sourceEntry) {
      diagnostics.push({
        code: 'command.source-only',
        severity: 'warning',
        commandName: command.name,
        message: `Source entry found at ${path.relative(loaded.extensionPath, sourceEntry)}, but no built JavaScript entry exists.`,
        remediation: buildScript
          ? `Review the extension, install its dependencies, then run ${packageManager} run build.`
          : 'Add a build script that emits dist/<command>.js.',
      });
    } else {
      diagnostics.push({
        code: 'command.entry-missing',
        severity: 'error',
        commandName: command.name,
        message: 'Neither a conventional source entry nor a built JavaScript entry was found.',
        remediation: `Expected src/${command.name}.tsx (or .ts/.js) and dist/${command.name}.js.`,
      });
    }
  }

  if (buildScript)
    diagnostics.push({
      code: 'build.available',
      severity: 'info',
      message: `Manifest build script detected: ${buildScript}`,
    });
  else if (commands.some((command) => command.status === 'source-only'))
    diagnostics.push({
      code: 'build.script-missing',
      severity: 'error',
      message: 'Source commands need a build, but the manifest has no build script.',
      remediation: 'Add a package.json build script that emits JavaScript into dist/.',
    });

  return {
    extension,
    extensionPath: loaded.extensionPath,
    manifestPath: loaded.manifestPath,
    packageManager,
    ...(buildScript ? { buildScript } : {}),
    sdkDeclared,
    commands,
    diagnostics,
    readyNoViewCommands: commands.filter((command) => !command.command.disabled && command.status === 'ready')
      .length,
  };
}

/**
 * Optionally build a source extension after explicit trust consent, then return a fresh report.
 * This does not install dependencies and does not make the extension a security sandbox.
 */
export async function prepareRaycastExtensionSource(
  extensionPath: string,
  options: PrepareRaycastExtensionOptions = {},
): Promise<PreparedRaycastExtension> {
  let report = await inspectRaycastExtensionSource(extensionPath);
  const needsBuild = report.commands.some(
    (command) => !command.command.disabled && command.status === 'source-only',
  );
  if (!options.build || !needsBuild || !report.buildScript) return { report, build: { attempted: false } };
  if (!options.allowUntrustedBuildScripts) throw new RaycastBuildConsentError();

  const timeoutMs = Math.max(1_000, Math.min(options.buildTimeoutMs ?? 120_000, 10 * 60_000));
  const command = report.packageManager;
  const args = report.packageManager === 'yarn' ? ['build'] : ['run', 'build'];
  const renderedCommand = `${command} ${args.join(' ')}`;
  const result = await runBuild(command, args, report.extensionPath, timeoutMs);
  report = await inspectRaycastExtensionSource(extensionPath);
  if (result.timedOut) {
    report.diagnostics.push({
      code: 'build.timed-out',
      severity: 'error',
      message: `Extension build exceeded ${timeoutMs}ms.`,
      remediation: 'Inspect the extension build locally before retrying with a deliberate timeout.',
    });
  } else if (result.exitCode !== 0) {
    report.diagnostics.push({
      code: 'build.failed',
      severity: 'error',
      message: `Extension build exited with status ${result.exitCode ?? 'unknown'}.`,
      remediation: 'Review the bounded build output and extension dependencies.',
    });
  }
  return { report, build: { attempted: true, command: renderedCommand, ...result } };
}

async function runBuild(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<Omit<RaycastBuildResult, 'attempted' | 'command'>> {
  return await new Promise((resolve) => {
    const ownsProcessGroup = process.platform !== 'win32';
    const child = spawn(command, args, {
      cwd,
      shell: false,
      detached: ownsProcessGroup,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: buildEnvironment(),
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let terminationFallback: NodeJS.Timeout | undefined;
    const append = (current: string, chunk: Buffer): string =>
      `${current}${chunk.toString('utf8')}`.slice(-MAX_BUILD_OUTPUT_BYTES);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    const finish = (value: Omit<RaycastBuildResult, 'attempted' | 'command'>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (terminationFallback) clearTimeout(terminationFallback);
      resolve({ stdout, stderr, ...value });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (ownsProcessGroup && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
      terminationFallback = setTimeout(() => finish({ timedOut: true }), 1_000);
    }, timeoutMs);
    child.once('error', (error) => finish({ exitCode: -1, stderr: `${stderr}\n${error.message}`.trim() }));
    child.once('exit', (code) => finish({ exitCode: code ?? -1, timedOut }));
  });
}

function buildEnvironment(): NodeJS.ProcessEnv {
  const allowed = [
    'PATH',
    'HOME',
    'TMPDIR',
    'TEMP',
    'TMP',
    'SystemRoot',
    'ComSpec',
    'PATHEXT',
    'USERPROFILE',
  ] as const;
  const environment: NodeJS.ProcessEnv = { CI: '1', NO_COLOR: '1' };
  for (const name of allowed) {
    if (process.env[name]) environment[name] = process.env[name];
  }
  return environment;
}
