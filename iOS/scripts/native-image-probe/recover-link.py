#!/usr/bin/env python3
"""One per-symbol optional allocator link recovery; all other unresolved symbols remain errors."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess

HERE = Path(__file__).resolve().parent

def main(args):
    pins = json.loads((HERE / 'inputs.json').read_text())
    command = json.loads((args.build_cache / 'sharp-stage/command.local.json').read_text())
    source = Path(next(x for x in command if x.endswith('/src/common.cc'))).parent
    for name, expected in pins['sharpSources'].items():
        if hashlib.sha256((source / name).read_bytes()).hexdigest() != expected:
            raise ValueError('Sharp source changed: ' + name)
    if any('dynamic_lookup' in x or x.startswith('-Wl,-U,') for x in command):
        raise ValueError('Require original strict link command')
    args.cache.mkdir(parents=True, exist_ok=False)
    output = args.cache / 'sharp-ios-arm64-0.35.5.node'
    command[-1] = str(output)
    command.insert(2, '-Wl,-U,_mallctl')
    env = {'PATH': '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin', 'HOME': str(args.build_cache / 'home'), 'TMPDIR': str(args.cache)}
    if os.environ.get('DEVELOPER_DIR'):
        env['DEVELOPER_DIR'] = os.environ['DEVELOPER_DIR']
    report = {'optionalDynamicLookup': ['_mallctl'], 'addonLinked': False, 'sharpExecuted': False, 'nitroImported': False}
    try:
        (args.cache / 'command.local.json').write_text(json.dumps(command, indent=2)+'\n')
        with (args.cache / 'compile.log').open('wb') as log:
            process = subprocess.Popen(command, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            (args.cache / 'active-process.json').write_text(json.dumps({'pid':process.pid,'step':'recover-sharp-link'})+'\n')
            try:
                result = process.wait(timeout=300)
            except BaseException:
                os.killpg(process.pid, signal.SIGTERM)
                try: process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL); process.wait()
                raise
            finally:
                (args.cache / 'active-process.json').unlink(missing_ok=True)
            if result: raise RuntimeError(f'Link recovery exited {result}')
        symbols = subprocess.check_output(['xcrun','nm','-m',str(output)],env=env,text=True)
        (args.cache / 'symbols.local.txt').write_text(symbols)
        dynamic = [x for x in symbols.splitlines() if 'dynamically looked up' in x]
        report['dynamicLookupSymbols'] = dynamic
        if len(dynamic) != 1 or '_mallctl' not in dynamic[0] or 'weak' not in dynamic[0]:
            raise ValueError('Expected only weak optional _mallctl dynamic lookup')
        napi = [x for x in symbols.splitlines() if '(undefined)' in x and ('_napi_' in x or '_node_api_' in x)]
        if not napi or any('(from NodeMobile)' not in x for x in napi):
            raise ValueError('N-API imports must resolve to NodeMobile')
        report['napiImportsBoundToNodeMobile'] = len(napi)
        report['addonLinked'] = True
    except Exception as error:
        report['error'] = str(error)
        raise
    finally:
        (args.cache / 'verification.json').write_text(json.dumps(report,indent=2)+'\n')

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for flag in ['build-cache','cache']:
        parser.add_argument('--'+flag,required=True,type=lambda x:Path(x).resolve())
    main(parser.parse_args())
