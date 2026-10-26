#!/usr/bin/env python3
"""Protected-controller-only unsigned native compilation. No candidate imports."""
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import time

DEADLINE_SECONDS = 45 * 60
PYTHON = '/usr/bin/python3'
PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'
SHA = re.compile(r'[0-9a-f]{40}')


def require_hosted_runner(environ=os.environ, system=platform.system, euid=os.geteuid):
    required = {'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'github-hosted', 'RUNNER_OS': 'macOS',
                'GITHUB_REPOSITORY': 'lopugit/thingtime',
                'GITHUB_EVENT_NAME': 'workflow_dispatch'}
    if system() != 'Darwin' or any(environ.get(k) != v for k, v in required.items()):
        raise RuntimeError('Refusing: requires protected dispatch on a GitHub-hosted macOS VM')
    allowed_callers = {
        'refs/heads/github-actions': 'lopugit/thingtime/.github/workflows/native-compile.yml@refs/heads/github-actions',
        'refs/heads/main': 'lopugit/thingtime/.github/workflows/native-compile-listener.yml@refs/heads/main',
    }
    if allowed_callers.get(environ.get('GITHUB_REF')) != environ.get('GITHUB_WORKFLOW_REF') or not environ.get('GITHUB_WORKFLOW_REF'):
        raise RuntimeError('Refusing: requires the protected implementation or exact main listener')
    if environ.get('GITHUB_ACTOR') != 'lopugit':
        raise RuntimeError('Refusing: requires repository owner dispatch')
    uid, user = environ.get('SUDO_UID', ''), environ.get('SUDO_USER', '')
    if euid() != 0 or not uid.isdecimal() or int(uid) == 0 or not re.fullmatch(r'[a-zA-Z_][a-zA-Z_0-9-]*', user):
        raise RuntimeError('Refusing: requires root supervisor and distinct runner identity')
    return int(uid), user


def validate_source(pr, expected_sha):
    if not SHA.fullmatch(expected_sha):
        raise ValueError('Expected immutable lowercase source SHA')
    if (pr.get('state') != 'open' or pr.get('author_association') != 'OWNER' or
        pr.get('head', {}).get('repo', {}).get('full_name') != 'lopugit/thingtime' or
        pr.get('base', {}).get('repo', {}).get('full_name') != 'lopugit/thingtime' or
        pr.get('head', {}).get('sha') != expected_sha):
        raise ValueError('Source must be the current exact head of an open same-repository owner PR')
    return expected_sha


def firewall_rules(runner_uid):
    if not isinstance(runner_uid, int) or runner_uid <= 0:
        raise ValueError('Invalid runner UID')
    # PF user matching covers TCP/UDP only; unconditional final rules cover
    # ICMP and every other outbound IPv4/IPv6 protocol as well.
    return (f'pass out quick inet proto {{ tcp udp }} all user {runner_uid} keep state\n'
            f'pass out quick inet6 proto {{ tcp udp }} all user {runner_uid} keep state\n'
            'block drop out quick inet all\nblock drop out quick inet6 all\n')


def extract_candidate(archive, destination):
    """Runs only under the isolated UID; never import/execute archive content."""
    destination = Path(destination)
    with tarfile.open(archive, mode='r|gz') as stream:
        for member in stream:
            path = PurePosixPath(member.name)
            if path.is_absolute() or '..' in path.parts or not path.parts:
                raise ValueError('Unsafe candidate archive path')
            parts = path.parts[1:]  # GitHub tarballs have one repository prefix.
            allowed = parts and (parts[0] in ('apple', 'iOS') or parts[:2] == ('macos', 'ThingtimePasswords'))
            if not allowed:
                continue
            if not (member.isdir() or member.isfile()):
                raise ValueError('Native source archive must contain only directories and regular files')
            target = destination.joinpath(*parts)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                # No symlinks are admitted; exclusive creation also rejects
                # duplicate members and special-file replacement attempts.
                with target.open('xb') as output, stream.extractfile(member) as source:
                    shutil.copyfileobj(source, output)
                target.chmod(0o755 if member.mode & 0o111 else 0o644)
    for required in ['apple/Passwords/Package.swift', 'apple/FileSync/Package.swift',
                     'iOS/project.yml', 'macos/ThingtimePasswords/project.yml']:
        if not (destination/required).is_file():
            raise ValueError('Candidate archive is missing a required native entry point')


def build_environment(home, user, developer):
    return ['/usr/bin/env', '-i', f'PATH={PATH}', f'HOME={home}', f'USER={user}',
            f'LOGNAME={user}', f'TMPDIR={home}/', f'DEVELOPER_DIR={developer}',
            'CI=true', 'DOTENV_CONFIG_PATH=/dev/null']


def run(args, **kwargs):
    return subprocess.run(args, check=True, text=True, **kwargs)


def cleanup(work):
    """Trusted supervisor/watchdog cleanup; children die before networking returns."""
    with (work/'cleanup.lock').open('r+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if (work/'cleaned').exists():
            return
        state = json.loads((work/'state.json').read_text())
        if state['user_created']:
            subprocess.run(['/usr/bin/pkill', '-KILL', '-u', str(state['uid'])], capture_output=True)
            for _ in range(50):
                if subprocess.run(['/usr/bin/pgrep', '-u', str(state['uid'])], capture_output=True).returncode != 0:
                    break
                time.sleep(.1)
            else:
                raise RuntimeError('Build descendants remain; network stays denied')
        if state['pf_changed']:
            run(['/sbin/pfctl', '-f', '/etc/pf.conf'], capture_output=True)
        if state['pf_token']:
            run(['/sbin/pfctl', '-X', state['pf_token']], capture_output=True)
        for table, flag in [('Users','user_created'),('Groups','group_created')]:
            record=f"/{table}/{state['user']}"
            if state[flag] and subprocess.run(['/usr/bin/dscl','.', '-read',record],capture_output=True).returncode == 0:
                run(['/usr/bin/dscl','.', '-delete',record],capture_output=True)
        for name in ['source', 'home', 'derived']:
            shutil.rmtree(work/name, ignore_errors=True)
        (work/'cleaned').touch()


def start_watchdog(work):
    parent = os.getpid()
    child = os.fork()
    if child == 0:
        os.setsid()
        deadline = time.monotonic() + DEADLINE_SECONDS + 120
        while time.monotonic() < deadline:
            try:
                os.kill(parent, 0)
            except ProcessLookupError:
                break
            time.sleep(5)
        try:
            cleanup(work)
        finally:
            os._exit(0)
    return child
BASELINE = r'''
import json, socket
results=[]
for family,host in [(socket.AF_INET,'1.1.1.1'),(socket.AF_INET6,'2606:4700:4700::1111')]:
    s=socket.socket(family,socket.SOCK_STREAM);s.settimeout(5)
    try: s.connect((host,443)); results.append({'family':family,'positiveTcp':True})
    except OSError as e:
        if family == socket.AF_INET: raise
        results.append({'family':family,'positiveTcp':False,'errno':e.errno})
    finally: s.close()
s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);s.settimeout(5)
s.sendto(bytes.fromhex('123401000001000000000000076578616d706c6503636f6d0000010001'),('1.1.1.1',53))
assert s.recvfrom(4096)[0][:2] == bytes.fromhex('1234')
s.close()
print(json.dumps({'runnerPositiveControls':results,'positiveUdpDns':True}))
'''


PROBE = r'''
import json, os, socket, subprocess, sys
expected_uid = int(sys.argv[1])
assert os.geteuid() == expected_uid and expected_uid != 0
assert subprocess.check_output(['/usr/bin/id','-u'],text=True).strip() == str(expected_uid)
# The identity has no administrative group or passwordless sudo authority.
assert subprocess.run(['/usr/bin/sudo','-n','/usr/bin/true'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode != 0
results = []
for family, host in [(socket.AF_INET, '1.1.1.1'), (socket.AF_INET6, '2606:4700:4700::1111')]:
    s=socket.socket(family, socket.SOCK_STREAM); s.settimeout(3)
    try:
        s.connect((host,443)); raise AssertionError('Outbound TCP escaped PF')
    except OSError as e: results.append({'family':family,'tcpDenied':True,'errno':e.errno})
    finally: s.close()
# A complete DNS question for example.com; bypasses resolver/proxy configuration.
q=bytes.fromhex('123401000001000000000000076578616d706c6503636f6d0000010001')
s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);s.settimeout(3)
try:
    s.sendto(q,('1.1.1.1',53)); s.recvfrom(4096); raise AssertionError('Outbound UDP/DNS escaped PF')
except OSError as e: results.append({'udpDnsDenied':True,'errno':e.errno})
finally: s.close()
# Child sandbox creation must work, with the same denied network policy.
if len(sys.argv) < 3:
    subprocess.run(['/usr/bin/sandbox-exec','-p','(version 1)(allow default)', '/usr/bin/true'],check=True)
print(json.dumps({'uid':os.geteuid(),'probes':results,'childSandbox':'passed'}))
'''

BUILD = r'''set -eu
cd "$1"
mkdir -p "$2"
xcodegen generate --spec macos/ThingtimePasswords/project.yml
xcodegen generate --spec iOS/project.yml
swift test --package-path apple/Passwords --scratch-path "$2/password-core"
swift test --package-path apple/FileSync --scratch-path "$2/file-sync"
xcodebuild -project macos/ThingtimePasswords/ThingtimePasswords.xcodeproj -scheme ThingtimePasswords -configuration Debug -destination 'generic/platform=macOS' -derivedDataPath "$2/macos" -disableAutomaticPackageResolution CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO THINGTIME_PASSWORD_KEYCHAIN_GROUP=unsigned.com.thingtime.passwords THINGTIME_WEB_URL=https://example.invalid build
xcodebuild -project iOS/Thingtime.xcodeproj -scheme Thingtime -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath "$2/ios" -disableAutomaticPackageResolution CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO THINGTIME_PASSWORD_KEYCHAIN_GROUP=unsigned.com.thingtime.passwords THINGTIME_WEB_URL=https://example.invalid build
'''


def supervise(archive_arg, report_arg, expected_sha, control_sha, pr_json_arg):
    runner_uid, runner_user = require_hosted_runner()
    if not SHA.fullmatch(control_sha):
        raise ValueError('Expected immutable admitted controller SHA')
    runner_temp = Path(os.environ['RUNNER_TEMP']).resolve()
    pr_json = Path(pr_json_arg).resolve()
    if not pr_json.is_relative_to(runner_temp):
        raise RuntimeError('PR metadata must be under RUNNER_TEMP')
    validate_source(json.loads(pr_json.read_text()), expected_sha)
    archive_input, report = Path(archive_arg).resolve(), Path(report_arg).resolve()
    if not archive_input.is_relative_to(runner_temp) or not report.is_relative_to(runner_temp) or report == runner_temp:
        raise RuntimeError('Input archive/report must be children of RUNNER_TEMP')
    developer = Path(os.environ['DEVELOPER_DIR']).resolve()
    if not developer.is_relative_to('/Applications') or not developer.is_dir():
        raise RuntimeError('Expected installed Xcode under /Applications')
    report.mkdir(mode=0o755)
    work = Path(tempfile.mkdtemp(prefix='thingtime-native-control-', dir='/private/tmp'))
    work.chmod(0o755)
    user = f'_ttnative{os.getpid()}'
    uid = 5500
    while any(subprocess.run(['/usr/bin/dscl', '.', '-search', table, field, str(uid)],
                             capture_output=True).stdout.strip()
              for table, field in [('/Users', 'UniqueID'), ('/Groups', 'PrimaryGroupID')]):
        uid += 1
    if subprocess.run(['/usr/bin/id', user], capture_output=True).returncode == 0:
        raise RuntimeError('Refusing to reuse a build identity')
    home, source, derived = work/'home', work/'source', work/'derived'
    for directory in [home, source, derived]:
        directory.mkdir()
    # Root only copies opaque bytes from the API. Candidate extraction occurs
    # later, as the isolated UID, never as root or the runner identity.
    archive = work/'candidate.tar.gz'
    shutil.copyfile(archive_input, archive)
    archive.chmod(0o644)
    trusted_helper = work/'trusted-native-compile.py'
    shutil.copyfile(Path(__file__).resolve(), trusted_helper)
    trusted_helper.chmod(0o644)
    for name, text in [('probe.py', PROBE), ('baseline.py', BASELINE), ('build.sh', BUILD), ('pf.conf', firewall_rules(runner_uid))]:
        (work/name).write_text(text)
    (work/'cleanup.lock').touch(mode=0o600)
    state = {'uid':uid, 'user':user, 'user_created':False, 'group_created':False,
             'pf_changed':False, 'pf_token':None}
    def save_state(**changes):
        state.update(changes)
        temporary = work/'state.new'
        temporary.write_text(json.dumps(state))
        temporary.chmod(0o600)
        temporary.replace(work/'state.json')
    save_state()
    watchdog = start_watchdog(work)
    def terminated(signum, frame):
        raise RuntimeError(f'Native compile interrupted by signal {signum}')
    signal.signal(signal.SIGTERM, terminated)
    signal.signal(signal.SIGINT, terminated)
    def as_build(command, **kwargs):
        kwargs.setdefault('stdin',subprocess.DEVNULL)
        kwargs.setdefault('close_fds',True)
        return run(['/usr/bin/sudo', '-n', '-u', user, *build_environment(home,user,developer), *command], **kwargs)
    digest=hashlib.sha256()
    with archive.open('rb') as content:
        for chunk in iter(lambda: content.read(1024*1024), b''):
            digest.update(chunk)
    provenance = {'sourceSha':expected_sha, 'controllerSha':control_sha,
                  'archiveSha256':digest.hexdigest(), 'signedDeviceAcceptance':False, 'result':'incomplete'}
    try:
        # Intent is persisted before mutation so the watchdog also cleans up
        # partially created records. Names and UID are fresh on this job VM.
        save_state(group_created=True)
        run(['/usr/bin/dscl', '.', '-create', f'/Groups/{user}', 'PrimaryGroupID', str(uid)], capture_output=True)
        save_state(user_created=True)
        for key,value in [('UniqueID',str(uid)), ('PrimaryGroupID',str(uid)), ('NFSHomeDirectory',str(home)),
                          ('UserShell','/usr/bin/false'), ('AuthenticationAuthority',';DisabledUser;')]:
            run(['/usr/bin/dscl', '.', '-create', f'/Users/{user}', key, value], capture_output=True)
        for directory in [home, source, derived]:
            run(['/usr/sbin/chown', f'{uid}:{uid}', str(directory)])
        runner_home = run(['/usr/bin/dscl', '.', '-read', f'/Users/{runner_user}', 'NFSHomeDirectory'],capture_output=True).stdout
        runner_home = Path(runner_home.split(':',1)[1].strip()).resolve()
        if not runner_home.is_relative_to('/Users') or runner_home == Path('/Users'):
            raise RuntimeError('Unexpected ephemeral runner home')
        # Separate group plus private runner home prevents candidate code from
        # reading the runner credential context through permissive staff access.
        runner_home.chmod(0o700)
        baseline=run(['/usr/bin/sudo','-n','-u',runner_user,'/usr/bin/env','-i',f'PATH={PATH}',
                      PYTHON,'-I','-S',str(work/'baseline.py')],capture_output=True)
        (report/'positive-controls.json').write_text(baseline.stdout)
        run(['/sbin/pfctl','-n','-f',str(work/'pf.conf')],capture_output=True)
        enabled = run(['/sbin/pfctl','-E'],capture_output=True)
        match=re.search(r'Token\s*:\s*(\d+)',enabled.stdout+enabled.stderr)
        if not match:
            raise RuntimeError('Cannot retain PF enable token')
        save_state(pf_token=match.group(1),pf_changed=True)
        run(['/sbin/pfctl','-f',str(work/'pf.conf')],capture_output=True)
        run(['/sbin/pfctl','-F','states'],capture_output=True)
        rules=run(['/sbin/pfctl','-sr'],capture_output=True).stdout
        if not all(rule in rules for rule in ['block drop out quick inet all','block drop out quick inet6 all']):
            raise RuntimeError('PF IPv4/IPv6 deny-all rules missing')
        if 'Status: Enabled' not in run(['/sbin/pfctl','-si'],capture_output=True).stdout:
            raise RuntimeError('PF is not enabled')
        (report/'pf-rules.txt').write_text(rules)
        denied=as_build([PYTHON,'-I','-S',str(work/'probe.py'),str(uid)],capture_output=True)
        (report/'isolation.json').write_text(denied.stdout)
        child=as_build(['/usr/bin/sandbox-exec','-p','(version 1)(allow default)',PYTHON,'-I','-S',
                        str(work/'probe.py'),str(uid),'child'],capture_output=True)
        (report/'child-isolation.json').write_text(child.stdout)
        # No candidate bytes have been interpreted/extracted before this point.
        as_build([PYTHON,'-I','-S',str(trusted_helper),'extract',str(archive),str(source)])
        with (report/'build.log').open('w') as log:
            as_build(['/bin/bash','--noprofile','--norc',str(work/'build.sh'),str(source),str(derived)],
                     stdout=log,stderr=subprocess.STDOUT,timeout=DEADLINE_SECONDS)
        provenance['result']='unsigned full macOS/iOS compile and Swift package tests passed'
    finally:
        (report/'result.json').write_text(json.dumps(provenance,indent=2)+'\n')
        cleanup(work)
        try:
            os.kill(watchdog,signal.SIGKILL)
        except ProcessLookupError:
            pass
        os.waitpid(watchdog,0)
        run(['/usr/sbin/chown','-R',f'{runner_uid}:20',str(report)])
        shutil.rmtree(work)


def main():
    if len(sys.argv) == 4 and sys.argv[1] == 'extract':
        if os.geteuid() == 0:
            raise RuntimeError('Candidate extraction must never run as root')
        extract_candidate(sys.argv[2], sys.argv[3])
    elif len(sys.argv) == 4 and sys.argv[1] == 'validate':
        print(validate_source(json.loads(Path(sys.argv[2]).read_text()),sys.argv[3]))
    elif len(sys.argv) == 7 and sys.argv[1] == 'build':
        supervise(*sys.argv[2:])
    else:
        raise RuntimeError('Expected validate <PR JSON> <SHA>, extract <archive> <directory>, or build <archive> <report> <source SHA> <control SHA> <PR JSON>')


if __name__ == '__main__':
    main()
