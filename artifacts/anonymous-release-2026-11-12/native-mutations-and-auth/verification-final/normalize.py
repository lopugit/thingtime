import hashlib, json, pathlib, re

out = pathlib.Path(__file__).resolve().parent
receipt = json.loads((out / 'verification.json').read_text())
for check in receipt['checks']:
    raw = (out / check['log']).read_bytes()
    content = re.sub(r'\x1b\[[0-9;]*m', '', raw.decode(errors='replace'))
    totals = {}
    for name, count in re.findall(r'^(?:#|ℹ) (tests|suites|pass|fail|cancelled|skipped|todo) (\d+)\s*$', content, re.M):
        totals[name] = totals.get(name, 0) + int(count)
    check['testTotals'] = totals
    check['logSha256'] = hashlib.sha256(raw).hexdigest()
    check['experimentalWarningLines'] = len(re.findall(r'ExperimentalWarning:', content))
    summaries = re.findall(r'(\d+) problems? \((\d+) errors?, (\d+) warnings?\)', content)
    if summaries:
        check['lintTotals'] = dict(zip(['problems', 'errors', 'warnings'], map(int, summaries[-1])))
before = {row['path']: row['sha256'] for row in json.loads((out / 'source-before.json').read_text())}
after = {row['path']: row['sha256'] for row in json.loads((out / 'source-after.json').read_text())}
receipt['changedPaths'] = sorted(path for path in before.keys() | after.keys() if before.get(path) != after.get(path))
receipt['sourceUnchanged'] = before == after
receipt['aggregateTestTotals'] = {key: sum(check['testTotals'].get(key, 0) for check in receipt['checks']) for key in ['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo']}
receipt['normalization'] = 'Totals sum the top-level TAP or Node spec reporter summaries, including multiple Node invocations in one package command. Raw logs unchanged.'
(out / 'verification.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps({'checks': [(c['name'], c['exitCode'], c['testTotals'], c.get('lintTotals')) for c in receipt['checks']], 'totals': receipt['aggregateTestTotals'], 'sourceUnchanged': receipt['sourceUnchanged'], 'changedPaths': receipt['changedPaths']}, indent=2))
