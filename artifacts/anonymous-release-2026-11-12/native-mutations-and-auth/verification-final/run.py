import datetime, glob, hashlib, json, os, pathlib, re, shlex, subprocess, time

ROOT = pathlib.Path(__file__).resolve().parents[4]
OUT = pathlib.Path(__file__).resolve().parent
ROOTS = ['remix', 'electron', 'native-bundles', 'MCP', 'iOS', 'apple']

def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def inventory(label):
    raw = subprocess.check_output(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', *ROOTS], cwd=ROOT)
    paths = sorted(set(raw.decode().split('\0')) - {''})
    rows = []
    for name in paths:
        path = ROOT / name
        if path.is_file():
            rows.append({'path': name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    payload = json.dumps(rows, indent=2) + '\n'
    (OUT / (label + '.json')).write_text(payload)
    return {'files': len(rows), 'sha256': hashlib.sha256(payload.encode()).hexdigest(), 'rows': rows}

def expand(pattern):
    return sorted(str(pathlib.Path(p).relative_to(ROOT / 'remix')) for p in glob.glob(str(ROOT / 'remix' / pattern)))

pnpm = ['corepack', 'pnpm', '--dir', 'remix', 'run']
node = ['node', '--import', 'tsx', '--test']
commands = [(name, ROOT, pnpm + [name], 900) for name in ['test:native-things', 'test:things', 'test:document-store', 'test:storage', 'test:timeline', 'test:api-capabilities']]
commands += [
    ('pat-revalidation', ROOT / 'remix', ['node', '--experimental-test-module-mocks', '--import', 'tsx', '--test', 'app/api/utils/auth/patRevalidation.test.mts'], 300),
    ('workspace-components', ROOT / 'remix', node + ['app/api/utils/serviceWorkspaces/access.test.ts', 'app/api/utils/serviceWorkspaces/googlePlaces.test.ts'] + expand('app/components/Builder/ServiceWorkspace/*.test.ts') + expand('app/components/Collections/*.test.ts'), 300),
    ('native-home', ROOT / 'remix', node + expand('server/utils/nativeHome*.test.ts'), 300),
    ('electron-fixture-contract', ROOT, ['node', '--test', 'electron/test/bundled-sqlite-account-fixture.test.cjs'], 120),
    ('typecheck', ROOT, pnpm + ['typecheck'], 900),
    ('typecheck-ratchet', ROOT, pnpm + ['typecheck:ratchet'], 900),
    ('lint', ROOT, pnpm + ['lint'], 900),
]
env = os.environ.copy()
env.update({'MONGODB_URI': 'mongodb://127.0.0.1:1/frozen-validation-no-mongo', 'MONGODB_CONNECTION_STRING': 'mongodb://127.0.0.1:1/frozen-validation-no-mongo', 'MONGO_PASS': 'synthetic-unused'})
before = inventory('source-before')
receipt = {'startedAt': now(), 'attribution': {'base': '860ebaf31', 'integratedMain': 'f2538e192', 'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()}, 'sourceRoots': ROOTS, 'inventoryPolicy': 'Unique git ls-files --cached --others --exclude-standard; ignored outputs excluded; regular-file contents SHA256', 'before': {k:v for k,v in before.items() if k != 'rows'}, 'fixtureEnvironment': 'Both Mongo URI aliases point to unreachable loopback port 1; no real database selected.', 'checks': []}

def save():
    (OUT / 'verification.json').write_text(json.dumps(receipt, indent=2) + '\n')

save()
print('BEFORE ' + json.dumps(receipt['before']), flush=True)
for index, (name, cwd, args, deadline) in enumerate(commands, 1):
    log = OUT / (f'{index:02d}-' + name.replace(':', '-') + '.log')
    check = {'name': name, 'cwd': str(cwd), 'command': shlex.join(args), 'startedAt': now(), 'timeoutSeconds': deadline, 'log': log.name}
    start = time.monotonic()
    print('START ' + name, flush=True)
    with log.open('w') as output:
        try:
            process = subprocess.run(args, cwd=cwd, env=env, stdout=output, stderr=subprocess.STDOUT, timeout=deadline)
            check['exitCode'] = process.returncode
        except subprocess.TimeoutExpired:
            check['exitCode'] = None
            check['timedOut'] = True
    check.update({'endedAt': now(), 'elapsedSeconds': round(time.monotonic() - start, 3)})
    content = log.read_text(errors='replace')
    totals = {}
    for line in content.splitlines():
        if line.startswith(('# ', 'ℹ ')):
            parts = line[2:].split()
            if len(parts) == 2 and parts[0] in ['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo'] and parts[1].isdigit():
                totals[parts[0]] = totals.get(parts[0], 0) + int(parts[1])
    check['testTotals'] = totals
    receipt['checks'].append(check)
    save()
    print('END ' + json.dumps(check), flush=True)
    if 'ECONNREFUSED' in content or 'MongoServerSelectionError' in content:
        receipt['stoppedReason'] = 'Unexpected database connection attempt; inspect preserved log before continuing.'
        save()
        break
after = inventory('source-after')
before_map = {r['path']: r['sha256'] for r in before['rows']}
after_map = {r['path']: r['sha256'] for r in after['rows']}
receipt.update({'endedAt': now(), 'after': {k:v for k,v in after.items() if k != 'rows'}, 'sourceUnchanged': before['rows'] == after['rows'], 'changedPaths': sorted(name for name in before_map.keys() | after_map.keys() if before_map.get(name) != after_map.get(name))})
save()
print('FINAL ' + json.dumps({'sourceUnchanged': receipt['sourceUnchanged'], 'checks': len(receipt['checks']), 'stoppedReason': receipt.get('stoppedReason')}), flush=True)
