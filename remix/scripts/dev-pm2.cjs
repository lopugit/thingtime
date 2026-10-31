#!/usr/bin/env node
'use strict';

// PM2 lifecycle for thingtime dev stacks, worktree-aware and timestamp-aware.
//
//   node scripts/dev-pm2.cjs start [--cwd <remixDir>]   (npm run web-pms)
//   node scripts/dev-pm2.cjs stop  [--cwd <remixDir>]   (npm run web-pms-stop)
//   node scripts/dev-pm2.cjs list                       (npm run web-ports:all)
//
// start/stop match on the stable base name (pm2NameBase), so re-stamping the
// clock-time suffix on each start never leaves an orphaned previous process.
// start can target any worktree's remix dir via --cwd; the name/ports are
// derived from that dir, so it works even if that checkout predates this
// tooling (the name is assigned here, at pm2-start time).

const { execFileSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');

const {
  formatClock,
  isDevAppForBase,
  isDevAppName,
  pm2AppConfig,
  resolveDevContext
} = require('./worktree-ports.cjs');

// Match the repo convention (dev.mjs, dev-nitro.cjs): resolve the shim on win32.
const PM2_BIN = process.platform === 'win32' ? 'pm2.cmd' : 'pm2';
const NPM_BIN = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const parseArgs = (argv) => {
  const args = { command: argv[0], cwd: undefined, cwdProvided: false };

  for (let index = 1; index < argv.length; index++) {
    if (argv[index] === '--cwd') {
      args.cwdProvided = true;
      args.cwd = argv[index + 1];
      index++;
    }
  }

  return args;
};

const pm2 = (args, opts = {}) =>
  execFileSync(PM2_BIN, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    // pm2 jlist embeds each app's full env, so the JSON is large on a busy
    // daemon; the default 1MB buffer overflows (ENOBUFS) and looks like "no apps".
    maxBuffer: 64 * 1024 * 1024,
    ...opts
  });

const jlist = () => {
  let out = '';

  try {
    out = pm2(['jlist']);
  } catch (err) {
    // Surface the failure instead of silently reporting "no apps" — a silent
    // empty list would also make start() skip cleanup and risk a duplicate.
    process.stderr.write(
      `[web-pms] warning: could not query pm2 (${err.code || err.message}); treating as no apps\n`
    );
    return [];
  }

  try {
    return JSON.parse(out);
  } catch {
    return [];
  }
};

// Every app belonging to this stable base (the base, or base + a clock suffix).
const appsForBase = (base) => jlist().filter((app) => isDevAppForBase(app.name, base));

const deleteApps = (apps) => {
  for (const app of apps) {
    try {
      pm2(['delete', String(app.pm_id)]);
    } catch {
      // already gone; ignore
    }
  }
};

const resolveRemixDir = (cwd) =>
  cwd ? path.resolve(cwd) : path.resolve(__dirname, '..');

const portOf = (app, key, fallbackFromName) => {
  const fromEnv = app.pm2_env && app.pm2_env.env && app.pm2_env.env[key];

  if (fromEnv) {
    return String(fromEnv);
  }

  const base = app.name.replace(/-\d{3,4}(?:am|pm)$/, '');
  const match = base.match(/(\d+)$/);

  return match ? fallbackFromName(Number(match[1])) : '?';
};

const start = (remixDir) => {
  const config = pm2AppConfig(remixDir);
  const base = resolveDevContext(remixDir).pm2NameBase;
  const stale = appsForBase(base);

  if (stale.length) {
    process.stdout.write(
      `[web-pms] removing ${stale.length} existing ${base}* app(s): ${stale
        .map((app) => app.name)
        .join(', ')}\n`
    );
    deleteApps(stale);
  }

  process.stdout.write(`[web-pms] starting ${config.name} (cwd ${remixDir})\n`);
  execFileSync(PM2_BIN, ['start', NPM_BIN, '--name', config.name, '--namespace', config.namespace, ...(config.autorestart === false ? ['--no-autorestart'] : []), '--', 'run', 'dev'], {
    cwd: remixDir,
    env: { ...process.env, ...config.env },
    stdio: 'inherit'
  });
};

const stop = (remixDir) => {
  const base = resolveDevContext(remixDir).pm2NameBase;
  const apps = appsForBase(base);

  if (!apps.length) {
    process.stdout.write(`[web-pms] no running app for ${base}\n`);
    return;
  }

  process.stdout.write(`[web-pms] removing ${apps.map((app) => app.name).join(', ')}\n`);
  deleteApps(apps);
};

const list = () => {
  const apps = jlist().filter((app) => isDevAppName(app.name));

  if (!apps.length) {
    process.stdout.write('No thingtime dev apps running under PM2.\n');
    return;
  }

  const rows = apps.map((app) => {
    const env = app.pm2_env || {};
    const started =
      env.status === 'online' && env.pm_uptime ? formatClock(new Date(env.pm_uptime)) : '—';
    const web = portOf(app, 'TT_WEB_PORT', (port) => String(port));
    const api = portOf(app, 'TT_API_PORT', (port) => String(port === 9999 ? 10000 : port + 2));

    return {
      name: app.name,
      status: env.status || '?',
      web,
      api,
      started,
      cwd: env.pm_cwd || '?'
    };
  });

  const width = (key) => Math.max(key.length, ...rows.map((row) => String(row[key]).length));
  const widths = {
    name: width('name'),
    status: width('status'),
    web: Math.max(3, width('web')),
    api: Math.max(3, width('api')),
    started: Math.max(7, width('started'))
  };
  const pad = (value, key) => String(value).padEnd(widths[key]);

  process.stdout.write(
    `${pad('NAME', 'name')}  ${pad('STATUS', 'status')}  ${pad('WEB', 'web')}  ${pad('API', 'api')}  ${pad('STARTED', 'started')}  CWD\n`
  );

  for (const row of rows) {
    process.stdout.write(
      `${pad(row.name, 'name')}  ${pad(row.status, 'status')}  ${pad(row.web, 'web')}  ${pad(row.api, 'api')}  ${pad(row.started, 'started')}  ${row.cwd}\n`
    );
  }
};

const { command, cwd, cwdProvided } = parseArgs(process.argv.slice(2));

if (cwdProvided && !cwd) {
  process.stderr.write('[web-pms] --cwd requires a path to a worktree remix dir\n');
  process.exit(1);
}

const remixDir = resolveRemixDir(cwd);

if ((command === 'start' || command === 'stop') && cwdProvided && !existsSync(remixDir)) {
  process.stderr.write(`[web-pms] --cwd path does not exist: ${remixDir}\n`);
  process.exit(1);
}

if (command === 'start') {
  start(remixDir);
} else if (command === 'stop') {
  stop(remixDir);
} else if (command === 'list') {
  list();
} else {
  process.stderr.write('Usage: dev-pm2.cjs <start|stop|list> [--cwd <remixDir>]\n');
  process.exit(1);
}
