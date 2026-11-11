#!/usr/bin/env python3
"""Explicit opt-in, separate simulator; never changes the production iOS target."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import stat
import subprocess
import time
import urllib.request
import zipfile

HERE = Path(__file__).resolve().parent
URL = 'https://github.com/fogtape/nodejs-mobile/releases/download/v24.22.1-0/nodejs-mobile-ios-24.22.1-0.zip'
DIGEST = '3fa1b8fb0720768b01c2e0dae3a17e788476e8c1613a1d9a54e206793b45326e'
PINS = {
    'bcrypt': {
        'src/blowfish.cc': 'ae054436efc92bb17a69832fa2e04823375765a10aa726dcfd1f0e42a3a76858',
        'src/bcrypt.cc': 'cf1f9a181571653ff8a6089cf54bad4d354e1b3cc68c8d4c319d42338db52f2f',
        'src/bcrypt_node.cc': '816139374a489becd768564177bf57198c9b12eb83f14476272d9cd690053d87',
        'src/node_blf.h': '3ade3327092d38ff15af128831ed262f1c8659a91554700c88a7b51e9741fe2f'
    },
    'addon_api': {
        'napi.h': '5e0eff20229ba021fa7c5ff6f62dfecc36f8c29f2da365b25cde3d6489d8b924',
        'napi-inl.h': '83f7520e9028cee918ca876def8cd982ee67906f2b587c60a9d8d79183b881eb',
        'napi-inl.deprecated.h': 'b66ed1e565e735bbfabcc2f72d466ab7c5414d3ef8851d1af440b81be7f2375c'
    }
}
IDENTITY = 'com.thingtime.nodeprobe.pr1000'

def digest(path):
    with open(path, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def inputs(args):
    for role, files in PINS.items():
        for name, expected in files.items():
            if digest(getattr(args, role) / name) != expected:
                raise ValueError(f'{role}/{name} source hash mismatch')
    entry = args.web_output / 'server/index.mjs'
    if not re.fullmatch('[a-f0-9]{64}', args.entry_sha256) or digest(entry) != args.entry_sha256:
        raise ValueError('Canonical Nitro entry hash mismatch')
    if not (args.web_output / 'public/index.html').is_file():
        raise ValueError('Require the actual complete canonical Nitro/Vite .output')

def sanitize(value):
    if isinstance(value, dict):
        return {key: sanitize(item) for key, item in value.items()}
    if isinstance(value, list):
        return [sanitize(item) for item in value]
    if isinstance(value, str):
        return re.sub(r'/Users/[^\n]*?/ThingtimeNodeProbe\.app', '<APP_BUNDLE>', value)
    return value

def execute(args):
    inputs(args)
    if args.check_inputs:
        print('Pinned bcrypt/header and canonical entry checks passed; no execution.')
        return
    if not args.allow_public_prerelease:
        raise ValueError('Explicit --allow-public-prerelease required; source-to-binary reproducibility is unproven')
    if args.cache.is_relative_to(HERE.parents[2]) or args.cache.is_relative_to(args.web_output):
        raise ValueError('Use a fresh private cache outside the checkout and source output')
    # Exclusively create a new cache, never erase or reuse another run's files.
    args.cache.mkdir(parents=True, exist_ok=False)
    env = {key: os.environ[key] for key in ['PATH', 'HOME', 'TMPDIR', 'DEVELOPER_DIR'] if key in os.environ}
    commands = []
    def run(command, timeout=90):
        commands.append([str(part) for part in command])
        result = subprocess.run(command, env=env, check=True, capture_output=True, text=True, timeout=timeout)
        return result.stdout.strip()
    report = {'distributionSha256': DIGEST, 'sourceToBinaryReproducibility': 'unproven',
              'apiStarted': False, 'storageTested': False, 'simulatorDeleted': False}
    device = None
    try:
        archive = args.cache / 'runtime.zip'
        with urllib.request.urlopen(URL, timeout=60) as source, archive.open('xb') as target:
            shutil.copyfileobj(source, target)
        if digest(archive) != DIGEST:
            raise ValueError('Runtime archive hash mismatch; refusing extraction or execution')
        app = args.cache / 'ThingtimeNodeProbe.app'
        framework = app / 'Frameworks'
        framework.mkdir(parents=True)
        prefix = 'NodeMobile.xcframework/ios-arm64-simulator/'
        with zipfile.ZipFile(archive) as files:
            for item in files.infolist():
                if item.is_dir() or not (item.filename.startswith(prefix) or item.filename.startswith('include/')):
                    continue
                relative = Path(item.filename[len(prefix):] if item.filename.startswith(prefix) else item.filename)
                if relative.is_absolute() or '..' in relative.parts or stat.S_ISLNK(item.external_attr >> 16):
                    raise ValueError('Unsafe runtime archive entry')
                target = (framework if item.filename.startswith(prefix) else args.cache) / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(files.read(item))
        shutil.copytree(args.web_output, app / '.output', symlinks=False)
        if digest(app / '.output/server/index.mjs') != args.entry_sha256:
            raise ValueError('Nitro entry changed while copying')
        (app / 'probe.mjs').write_text((HERE / 'probe.mjs').read_text().replace('__ENTRY_SHA256__', args.entry_sha256))
        (app / 'Info.plist').write_bytes(plistlib.dumps({
            'CFBundleIdentifier': IDENTITY, 'CFBundleName': 'Thingtime Node Probe',
            'CFBundleExecutable': 'ThingtimeNodeProbe', 'CFBundlePackageType': 'APPL',
            'CFBundleVersion': '1', 'CFBundleShortVersionString': '1.0',
            'LSRequiresIPhoneOS': True, 'MinimumOSVersion': '18.0', 'UIDeviceFamily': [1, 2], 'UILaunchScreen': {}
        }))
        sdk = run(['xcrun', '--sdk', 'iphonesimulator', '--show-sdk-path'])
        common = ['xcrun', 'clang++', '-arch', 'arm64', '-isysroot', sdk, '-mios-simulator-version-min=18.0']
        addon = app / '.output/server/node_modules/bcrypt/prebuilds/ios-arm64/bcrypt.node'
        addon.parent.mkdir(parents=True, exist_ok=True)
        run(common + ['-std=c++17', '-fexceptions', '-DNAPI_CPP_EXCEPTIONS', '-DNODE_GYP_MODULE_NAME=bcrypt_lib',
            '-D_GNU_SOURCE', '-I', str(args.cache / 'include/node'), '-I', str(args.addon_api),
            '-I', str(args.bcrypt / 'src'), '-dynamiclib', '-F', str(framework), '-framework', 'NodeMobile',
            '-Wl,-rpath,@executable_path/Frameworks',
            *[str(args.bcrypt / 'src' / name) for name in ['blowfish.cc', 'bcrypt.cc', 'bcrypt_node.cc']], '-o', str(addon)])
        run(common + ['-fobjc-arc', str(HERE / 'main.mm'), '-F', str(framework), '-framework', 'NodeMobile',
            '-framework', 'UIKit', '-framework', 'Foundation', '-Wl,-rpath,@executable_path/Frameworks',
            '-o', str(app / 'ThingtimeNodeProbe')])
        for target in [addon, framework / 'NodeMobile.framework', app]:
            run(['/usr/bin/codesign', '--force', '--sign', '-', str(target)])
        device = run(['xcrun', 'simctl', 'create', 'Thingtime Node24 Nitro isolated probe', args.device_type, args.runtime])
        run(['xcrun', 'simctl', 'boot', device])
        run(['xcrun', 'simctl', 'bootstatus', device, '-b'], timeout=120)
        run(['xcrun', 'simctl', 'install', device, str(app)])
        run(['xcrun', 'simctl', 'launch', device, IDENTITY])
        container = Path(run(['xcrun', 'simctl', 'get_app_container', device, IDENTITY, 'data']))
        receipt = container / 'Documents/nitro-import.json'
        deadline = time.monotonic() + 45
        while not receipt.exists() and time.monotonic() < deadline:
            time.sleep(0.2)
        if not receipt.exists():
            raise RuntimeError('No native receipt within 45 seconds')
        report['native'] = sanitize(json.loads(receipt.read_text()))
        if report['native'].get('bcrypt') != {'rounds': 10, 'valid': True, 'invalid': False}:
            raise RuntimeError('Real bcrypt behavior did not pass')
        report['experimentCompleted'] = True
    except Exception as error:
        report['experimentCompleted'] = False
        report['error'] = sanitize(str(error))
        raise
    finally:
        if device:
            subprocess.run(['xcrun', 'simctl', 'terminate', device, IDENTITY], env=env, capture_output=True)
            subprocess.run(['xcrun', 'simctl', 'shutdown', device], env=env, capture_output=True)
            result = subprocess.run(['xcrun', 'simctl', 'delete', device], env=env, capture_output=True)
            report['simulatorDeleted'] = result.returncode == 0
        report['observedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        (args.cache / 'verification.json').write_text(json.dumps(report, indent=2) + '\n')
        # Local-only reconstruction details may contain cache paths; do not publish this file verbatim.
        (args.cache / 'commands.local.json').write_text(json.dumps(commands, indent=2) + '\n')
        if device and not report['simulatorDeleted']:
            raise RuntimeError('Task simulator cleanup failed; inspect local command record')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ['cache', 'web-output', 'bcrypt', 'addon-api']:
        parser.add_argument('--' + flag, type=lambda value: Path(value).resolve(), required=True)
    parser.add_argument('--entry-sha256', required=True)
    parser.add_argument('--runtime', required=True, help='Installed iOS simulator runtime identifier')
    parser.add_argument('--device-type', default='com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro')
    parser.add_argument('--check-inputs', action='store_true')
    parser.add_argument('--allow-public-prerelease', action='store_true')
    execute(parser.parse_args())
