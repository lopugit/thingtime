#!/usr/bin/env python3
"""Compile the genuine Sharp N-API addon against the completed simulator dependency build."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shlex
import signal
import subprocess
import time

HERE = Path(__file__).resolve().parent
RUNTIME_SHA = '3fa1b8fb0720768b01c2e0dae3a17e788476e8c1613a1d9a54e206793b45326e'

def sha(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()

def main(args):
    pins = json.loads((HERE / 'inputs.json').read_text())
    report = {'sharpVersion': '0.35.5', 'libvipsVersion': '8.18.7', 'addonLinked': False,
              'sharpExecuted': False, 'nitroImported': False, 'apiStarted': False, 'storageTested': False}
    for role, root in [('sharpSources', args.sharp / 'src'), ('addonApiHeaders', args.addon_api)]:
        for name, expected in pins[role].items():
            if sha(root / name) != expected:
                raise ValueError(f'Pinned source mismatch: {role}/{name}')
    if sha(args.runtime_cache / 'runtime.zip') != RUNTIME_SHA:
        raise ValueError('Node Mobile distribution digest mismatch')
    build_report = json.loads((args.cache / 'verification.json').read_text())
    if not build_report.get('dependencyBuildPassed'):
        raise ValueError('Require the completed dependency build receipt')
    stage = args.cache / 'sharp-stage'
    stage.mkdir(exist_ok=False)
    env = {'PATH': '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin', 'HOME': str(args.cache / 'home'), 'TMPDIR': str(args.cache)}
    if os.environ.get('DEVELOPER_DIR'):
        env['DEVELOPER_DIR'] = os.environ['DEVELOPER_DIR']
    staging = args.cache / 'recipe/build/staging'
    pcs = [str(p) for p in staging.glob('*/ios-sim-arm64/lib/pkgconfig')]
    pcs.append(str(args.cache / 'recipe/build/output/libvips/ios-sim-arm64/pkgconfig'))
    env['PKG_CONFIG_PATH'] = ':'.join(pcs)
    env['PKG_CONFIG_LIBDIR'] = ''
    try:
        sdk = subprocess.check_output(['xcrun', '--sdk', 'iphonesimulator', '--show-sdk-path'], env=env, text=True).strip()
        cflags = shlex.split(subprocess.check_output(['pkg-config', '--cflags', 'vips-cpp'], env=env, text=True))
        libs = shlex.split(subprocess.check_output(['pkg-config', '--static', '--libs', 'vips-cpp'], env=env, text=True))
        command = ['xcrun', 'clang++', '-arch', 'arm64', '-isysroot', sdk, '-mios-simulator-version-min=18.0',
                   '-std=c++17', '-fexceptions', '-DNAPI_CPP_EXCEPTIONS', '-DNAPI_VERSION=9',
                   '-DNODE_ADDON_API_DISABLE_DEPRECATED', '-DNODE_API_SWALLOW_UNTHROWABLE_EXCEPTIONS',
                   '-DSHARP_USE_GLOBAL_LIBVIPS', '-DG_DISABLE_ASSERT', '-DG_DISABLE_CAST_CHECKS', '-DG_DISABLE_CHECKS',
                   '-I', str(args.runtime_cache / 'include/node'), '-I', str(args.addon_api), *cflags,
                   '-dynamiclib', '-F', str(args.runtime_cache / 'ThingtimeNodeProbe.app/Frameworks'),
                   '-framework', 'NodeMobile', '-Wl,-rpath,@executable_path/Frameworks',
                   *[str(args.sharp / 'src' / name) for name in ['common.cc', 'metadata.cc', 'stats.cc', 'operations.cc', 'pipeline.cc', 'utilities.cc', 'sharp.cc']],
                   *libs, '-o', str(stage / 'sharp-ios-arm64-0.35.5.node')]
        # Local reconstruction record can contain source/cache paths. Do not publish it verbatim.
        (stage / 'command.local.json').write_text(json.dumps(command, indent=2) + '\n')
        # This continues the same first experiment: never renew its 30-minute window.
        remaining = min(300, args.cache.stat().st_birthtime + 1800 - time.time())
        if remaining <= 0:
            raise TimeoutError('Original 30-minute experiment deadline elapsed')
        with (stage / 'compile.log').open('wb') as log:
            process = subprocess.Popen(command, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            (stage / 'active-process.json').write_text(json.dumps({'pid': process.pid, 'step': 'compile-sharp'}) + '\n')
            try:
                result = process.wait(timeout=remaining)
            except BaseException:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
                raise
            finally:
                (stage / 'active-process.json').unlink(missing_ok=True)
            if result:
                raise RuntimeError(f'Actual Sharp compile/link exited {result}; see compile.log')
        report['addonLinked'] = True
        report['addonSha256'] = sha(stage / 'sharp-ios-arm64-0.35.5.node')
    except Exception as error:
        report['error'] = str(error).replace(str(args.cache), '<CACHE>')
        raise
    finally:
        (stage / 'verification.json').write_text(json.dumps(report, indent=2) + '\n')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ['cache', 'runtime-cache', 'sharp', 'addon-api']:
        parser.add_argument('--' + flag, required=True, type=lambda x: Path(x).resolve())
    main(parser.parse_args())
