#!/usr/bin/env python3
"""Bounded, separate arm64 iOS simulator image dependency build; no production target changes."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
import urllib.request

HERE = Path(__file__).resolve().parent

def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def replace(path, old, new):
    text = path.read_text()
    if old not in text:
        raise ValueError(f'Pinned recipe adaptation no longer matches: {path.name}')
    path.write_text(text.replace(old, new))

def execute(args):
    pins = json.loads((HERE / 'inputs.json').read_text())
    root = args.cache
    if root.is_relative_to(HERE.parents[2]):
        raise ValueError('Cache must be outside the checkout')
    root.mkdir(parents=True, exist_ok=False)
    (root / 'home').mkdir()
    env = {'PATH': '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
           'HOME': str(root / 'home'), 'TMPDIR': str(root)}
    if os.environ.get('DEVELOPER_DIR'):
        env['DEVELOPER_DIR'] = os.environ['DEVELOPER_DIR']
    deadline = time.monotonic() + 1800
    report = {'recipeCommit': pins['recipeCommit'], 'target': 'arm64-apple-ios15.0-simulator',
              'libvips': '8.18.7', 'sharp': '0.35.5', 'completedSteps': [],
              'sharpExecuted': False, 'nitroImported': False, 'apiStarted': False, 'storageTested': False,
              'productionParity': False, 'sourceToBinaryReproducibility': 'unproven'}
    def run(command, label):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError('30 minute experiment deadline')
        report['activeStep'] = label
        print(label, flush=True)
        with (root / (label + '.log')).open('wb') as log:
            proc = subprocess.Popen([str(x) for x in command], cwd=root, env=env,
                                    stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            (root / 'active-process.json').write_text(json.dumps({'pid': proc.pid, 'step': label}) + '\n')
            try:
                result = proc.wait(timeout=remaining)
            except BaseException:
                os.killpg(proc.pid, signal.SIGTERM)
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(proc.pid, signal.SIGKILL)
                    proc.wait()
                raise
            finally:
                (root / 'active-process.json').unlink(missing_ok=True)
            if result:
                raise RuntimeError(f'{label} exited {result}; see {label}.log')
        report['completedSteps'].append(label)
    def fetch(url, target, expected):
        target.parent.mkdir(parents=True, exist_ok=True)
        if args.download_cache and (args.download_cache / target.name).is_file():
            shutil.copyfile(args.download_cache / target.name, target)
        else:
            with urllib.request.urlopen(url, timeout=min(60, max(1, deadline-time.monotonic()))) as source, target.open('xb') as output:
                shutil.copyfileobj(source, output)
        if sha(target) != expected:
            raise ValueError(f'SHA256 mismatch: {target.name}')
    try:
        recipe = root / 'recipe'
        for name, expected in pins['recipeFiles'].items():
            fetch(f"https://raw.githubusercontent.com/TimOliver/vips-cocoa/{pins['recipeCommit']}/Scripts/{name}",
                  recipe / 'Scripts' / name, expected)
        for source in pins['sources']:
            fetch(source['url'], recipe / 'Vendor' / source['url'].split('/')[-1], source['sha256'])
        run([sys.executable, '-m', 'venv', root / 'tools'], 'tool-venv')
        run([root / 'tools/bin/pip', 'install', *pins['tools']], 'tool-install')
        env['PATH'] = str(root / 'tools/bin') + ':' + env['PATH']
        sdk = subprocess.check_output(['xcrun', '--sdk', 'iphonesimulator', '--show-sdk-path'], env=env, text=True).strip()
        report['sdk'] = Path(sdk).name
        report['clang'] = subprocess.check_output(['xcrun', 'clang', '--version'], env=env, text=True).splitlines()[0]
        scripts = recipe / 'Scripts'
        replace(scripts / 'env.sh', 'export LIBVIPS_VERSION="8.18.0"', 'export LIBVIPS_VERSION="8.18.7"')
        replace(scripts / 'env.sh', 'export TARGETS=$(get_active_targets)', 'export TARGETS="ios-sim-arm64"')
        replace(scripts / 'env.sh', 'export JOBS=$(sysctl -n hw.ncpu)', 'export JOBS=4')
        replace(scripts / 'cross-files/ios-sim-arm64.ini', '/Applications/Xcode.app/Contents/Developer/Platforms/iPhoneSimulator.platform/Developer/SDKs/iPhoneSimulator.sdk', sdk)
        # Calling a function as an if-condition disables errexit throughout its body.
        replace(scripts / 'utils.sh', '''        if ! "$build_func" "$target"; then
            log_error "Failed to build ${lib_name} for ${target}"
            return 1
        fi''', '        "$build_func" "$target"')
        # This experiment covers only required current PNG/JPEG/WebP/GIF/EXIF/RGBA paths.
        # GIF reading uses libvips bundled nsgif; no GIF encoding is promised.
        for feature in ['fftw', 'heif', 'jpeg-xl', 'tiff', 'highway']:
            replace(scripts / 'build-libvips.sh', f'-D{feature}=enabled', f'-D{feature}=disabled')
        for name in ['expat', 'libffi', 'pcre2', 'libjpeg-turbo', 'libpng', 'libwebp', 'glib', 'libexif', 'lcms2', 'libvips']:
            run(['/bin/bash', scripts / ('build-' + name + '.sh')], 'build-' + name)
        report['dependencyBuildPassed'] = True
    except Exception as error:
        report['error'] = str(error).replace(str(root), '<CACHE>')
        raise
    finally:
        report['observedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        (root / 'verification.json').write_text(json.dumps(report, indent=2) + '\n')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', required=True, type=lambda x: Path(x).resolve())
    parser.add_argument('--download-cache', type=lambda x: Path(x).resolve(), help='Optional read-only cached source archives; hashes still checked')
    execute(parser.parse_args())
