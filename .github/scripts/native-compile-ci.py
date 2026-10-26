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
BOOTSTRAP_SECONDS = 120
COMMAND_SECONDS = 15
CLEANUP_SECONDS = 60
LOCK_SECONDS = 10
PYTHON = '/usr/bin/python3'
PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'
SHA = re.compile(r'[0-9a-f]{40}')
GROUP_REGISTRAR = None
COMMAND_CONTEXT = None


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
    return (f'pass out quick inet proto tcp all user {runner_uid} flags any keep state\n'
            f'pass out quick inet proto udp all user {runner_uid} keep state\n'
            f'pass out quick inet6 proto tcp all user {runner_uid} flags any keep state\n'
            f'pass out quick inet6 proto udp all user {runner_uid} keep state\n'
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


def start_owned_command(args,kwargs):
    if not COMMAND_CONTEXT:
        return subprocess.Popen(args,text=True,**kwargs)
    work,helper=COMMAND_CONTEXT['work'],COMMAND_CONTEXT['helper']
    with (work/'cleanup.lock').open('r+') as lock:
        acquire_cleanup_lock(lock,time.monotonic()+LOCK_SECONDS)
        state=json.loads((work/'state.json').read_text())
        if ((work/'cleanup-started').exists() or (work/'cleaned').exists() or
                state.get('watchdog_requested') or time.monotonic() >= state['watchdog_deadline']):
            raise RuntimeError('Owned command admission closed for cleanup/expired bootstrap')
        read_gate,write_gate=os.pipe()
        process=None
        try:
            # The trusted launcher cannot execute args until registration is
            # durable. Parent loss closes the pipe and means no exec, even if
            # it happens between Popen and writing state.
            process=subprocess.Popen([PYTHON,'-I','-S',str(helper),'spawn',str(read_gate),*args],
                                     text=True,pass_fds=(read_gate,),**kwargs)
            GROUP_REGISTRAR('add',process.pid)
            os.write(write_gate,b'1')
        except BaseException:
            if process:
                try:os.killpg(process.pid,signal.SIGKILL)
                except ProcessLookupError:pass
                process.communicate(timeout=5)
            raise
        finally:
            os.close(read_gate)
            os.close(write_gate)
        return process


def run(args,check=True,timeout=COMMAND_SECONDS,**kwargs):
    """Every owned command has a deadline and a separately reapable group."""
    if timeout <= 0:raise TimeoutError('Command deadline exhausted')
    capture=kwargs.pop('capture_output',False)
    if capture:kwargs['stdout'],kwargs['stderr']=subprocess.PIPE,subprocess.PIPE
    kwargs.setdefault('stdin',subprocess.DEVNULL)
    kwargs['close_fds']=True
    kwargs['start_new_session']=True
    process=start_owned_command(args,kwargs)
    try:
        stdout,stderr=process.communicate(timeout=timeout)
    except BaseException:
        try:os.killpg(process.pid,signal.SIGKILL)
        except ProcessLookupError:pass
        try:process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            for pipe in [process.stdout,process.stderr]:
                if pipe:pipe.close()
        raise
    finally:
        if GROUP_REGISTRAR:
            try:os.killpg(process.pid,0)
            except ProcessLookupError:GROUP_REGISTRAR('remove',process.pid)
            # Live descendants remain registered for bounded cleanup.
    result=subprocess.CompletedProcess(args,process.returncode,stdout,stderr)
    if check:result.check_returncode()
    return result


def verify_runner_daemons(text, runner_uid):
    """Admission uses PID/effective UID/executable metadata, never process args."""
    names = {'Runner.Listener', 'Runner.Worker'}
    brokers=[]
    found = []
    for line in text.splitlines():
        fields = line.strip().split(None, 3)
        if len(fields) != 4:
            continue
        pid, ppid, uid, executable = fields
        name = Path(executable).name
        if name == 'mDNSResponder':
            if not uid.isdecimal() or int(uid) == runner_uid:
                raise RuntimeError('DNS broker must not share the allowed runner transport UID')
            brokers.append({'pid':int(pid),'parentPid':int(ppid),'uid':int(uid),'executable':name})
            continue
        if name not in names:
            continue
        if not all(value.isdecimal() for value in [pid, ppid, uid]) or int(uid) != runner_uid:
            raise RuntimeError('Actions daemon effective UID does not match runner transport UID')
        found.append({'pid':int(pid), 'parentPid':int(ppid), 'uid':int(uid), 'executable':name})
    if {row['executable'] for row in found} != names:
        raise RuntimeError('Cannot verify both Runner.Listener and Runner.Worker identities')
    if not brokers:
        raise RuntimeError('Cannot verify the DNS broker identity')
    return found+brokers


def admit_runner(runner_uid,report,source_sha,control_sha,mode):
    phase(report,'runner-identities-check')
    try:
        processes=run(['/bin/ps','-axo','pid=,ppid=,uid=,comm='],capture_output=True).stdout
        daemons=verify_runner_daemons(processes,runner_uid)
    except BaseException as error:
        (Path(report)/'result.json').write_text(json.dumps({'sourceSha':source_sha,'controllerSha':control_sha,
            'mode':mode,'result':'runner admission failed before policy mutation','policyChanged':False,
            'candidateExecuted':False,'failureType':type(error).__name__})+'\n')
        phase(report,'admission-failed-before-policy')
        raise
    (Path(report)/'runner-identities.json').write_text(json.dumps(daemons))
    phase(report,'runner-identities-verified')
    return daemons


def phase(report, name):
    # Trusted labels only: no candidate output, URLs, arguments or secrets.
    entry = {'phase':name, 'at':time.time()}
    try:
        with (Path(report)/'phases.jsonl').open('a') as log:
            log.write(json.dumps(entry)+'\n')
            log.flush()
            os.fsync(log.fileno())
    except OSError:
        pass  # Missing diagnostic storage must never prevent security cleanup.
    try:
        print('native-compile phase='+name,flush=True)
    except OSError:
        pass  # A lost runner pipe must not kill the detached cleanup path.



def acquire_cleanup_lock(lock, deadline):
    while True:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return
        except BlockingIOError:
            if time.monotonic() >= deadline:
                raise TimeoutError('Cleanup lock deadline exhausted; network remains denied')
            time.sleep(.1)


def cleanup(work,watchdog_parent=None):
    """Bounded cleanup; never restore networking with isolated descendants alive."""
    deadline = time.monotonic()+CLEANUP_SECONDS
    with (work/'cleanup.lock').open('r+') as lock:
        acquire_cleanup_lock(lock, min(deadline,time.monotonic()+LOCK_SECONDS))
        if (work/'cleaned').exists():
            return True
        state = json.loads((work/'state.json').read_text())
        if watchdog_parent is not None:
            try:
                os.kill(watchdog_parent,0)
                parent_alive=True
            except ProcessLookupError:
                parent_alive=False
            if parent_alive and not state.get('watchdog_requested') and time.monotonic() < state['watchdog_deadline']:
                return False  # A refreshed native deadline defeats a stale decision.
        (work/'cleanup-started').touch()
        report = Path(state['report'])
        phase(report,'cleanup-started')
        def command(args, **kwargs):
            remaining = deadline-time.monotonic()
            return run(args, timeout=min(COMMAND_SECONDS,remaining), capture_output=True, **kwargs)
        for group in state.get('owned_groups',[]):
            try:
                os.killpg(group,signal.SIGKILL)
            except ProcessLookupError:
                pass
            while True:
                try:
                    os.killpg(group,0)
                except ProcessLookupError:
                    break
                if time.monotonic() >= deadline:
                    raise RuntimeError('Owned probe group remains; network stays denied')
                time.sleep(.1)
        phase(report,'owned-probe-groups-gone')
        if state['user_created']:
            command(['/usr/bin/pkill','-KILL','-u',str(state['uid'])],check=False)
            while True:
                status=command(['/usr/bin/pgrep','-u',str(state['uid'])],check=False).returncode
                if status == 1:
                    break
                if status != 0:
                    raise RuntimeError('Cannot verify isolated descendant absence; network stays denied')
                if deadline-time.monotonic() < 1:
                    raise RuntimeError('Build descendants remain; network stays denied')
                time.sleep(.1)
        phase(report,'isolated-descendants-gone')
        if state['pf_changed']:
            command(['/sbin/pfctl','-f','/etc/pf.conf'])
        if state['pf_token']:
            command(['/sbin/pfctl','-X',state['pf_token']])
        phase(report,'network-restored')
        for table, flag in [('Users','user_created'),('Groups','group_created')]:
            record=f"/{table}/{state['user']}"
            if state[flag] and command(['/usr/bin/dscl','.', '-read',record],check=False).returncode == 0:
                command(['/usr/bin/dscl','.', '-delete',record])
        for name in ['source','home','derived']:
            command(['/bin/rm','-rf','--',str(work/name)])
        (work/'cleaned').touch()
        phase(report,'cleanup-complete')
        return True


def native_deadline(mode, gates_passed, now):
    if mode not in ('preflight','native'):
        raise ValueError('Mode must be preflight or native')
    if mode == 'native':
        if not gates_passed:
            raise RuntimeError('Cannot extend bootstrap deadline before all gates pass')
        return now+DEADLINE_SECONDS+CLEANUP_SECONDS
    return None


def arm_native(work,save_state,gates_passed):
    with (work/'cleanup.lock').open('r+') as lock:
        acquire_cleanup_lock(lock,time.monotonic()+LOCK_SECONDS)
        state=json.loads((work/'state.json').read_text())
        now=time.monotonic()
        if ((work/'cleanup-started').exists() or (work/'cleaned').exists() or
                state.get('watchdog_requested') or now >= state['watchdog_deadline']):
            raise RuntimeError('Cannot promote expired or claimed bootstrap')
        save_state(watchdog_deadline=native_deadline('native',gates_passed,now))


def start_watchdog(work):
    global GROUP_REGISTRAR,COMMAND_CONTEXT
    parent=os.getpid()
    child=os.fork()
    if child == 0:
        GROUP_REGISTRAR=None
        COMMAND_CONTEXT=None
        os.setsid()
        while True:
            try:
                state=json.loads((work/'state.json').read_text())
                try:
                    os.kill(parent,0)
                    parent_alive=True
                except ProcessLookupError:
                    parent_alive=False
                if (not parent_alive or state.get('watchdog_requested') or
                        time.monotonic() >= state['watchdog_deadline']):
                    phase(Path(state['report']),'watchdog-cleanup-triggered')
                    if cleanup(work,watchdog_parent=parent):os._exit(0)
                time.sleep(1)
            except BaseException:
                # A broken watchdog cannot leave future native launches open.
                (work/'cleanup-started').touch()
                os._exit(1)
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
assert os.geteuid() == expected_uid
assert subprocess.check_output(['/usr/bin/id','-u'],text=True,timeout=5).strip() == str(expected_uid)
# The identity has no administrative group or passwordless sudo authority.
if expected_uid != 0:
    assert subprocess.run(['/usr/bin/sudo','-n','/usr/bin/true'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,timeout=5).returncode != 0
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
    subprocess.run(['/usr/bin/sandbox-exec','-p','(version 1)(allow default)', '/usr/bin/true'],check=True,timeout=5)
print(json.dumps({'uid':os.geteuid(),'probes':results,'childSandbox':'passed'}))
'''

CONTROL_PROBE = r'''
import json, socket, ssl, sys
expected = sys.argv[1] == 'allow'
host = 'api.github.com'
try:
    with socket.create_connection((host,443),timeout=5) as raw:
        with ssl.create_default_context().wrap_socket(raw,server_hostname=host) as stream:
            stream.settimeout(5)
            stream.sendall(b'GET /meta HTTP/1.1\r\nHost: api.github.com\r\nUser-Agent: Thingtime-native-control-preflight\r\nConnection: close\r\n\r\n')
            line=stream.recv(256).split(b'\r\n',1)[0]
            if not line.startswith(b'HTTP/1.1 200'):
                raise RuntimeError('Unexpected fixed control HTTPS response')
    if not expected:
        raise AssertionError('Root/broker UID escaped PF')
    print(json.dumps({'hostname':'api.github.com','tlsVerified':True,'https':200}))
except (OSError,ssl.SSLError) as error:
    if expected:
        raise RuntimeError('Fixed control hostname/TLS preflight failed') from None
    print(json.dumps({'rootControlDenied':True}))
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


def supervise(archive_arg, report_arg, expected_sha, control_sha, pr_json_arg, mode='preflight'):
    global GROUP_REGISTRAR,COMMAND_CONTEXT
    runner_uid, runner_user = require_hosted_runner()
    if mode not in ('preflight','native') or not SHA.fullmatch(control_sha):
        raise ValueError('Expected valid mode and immutable admitted helper SHA')
    runner_temp = Path(os.environ['RUNNER_TEMP']).resolve()
    pr_json = Path(pr_json_arg).resolve()
    archive_input, report = Path(archive_arg).resolve(),Path(report_arg).resolve()
    if (not pr_json.is_relative_to(runner_temp) or not archive_input.is_relative_to(runner_temp) or
            not report.is_relative_to(runner_temp) or report == runner_temp):
        raise RuntimeError('All task data must be children of RUNNER_TEMP')
    validate_source(json.loads(pr_json.read_text()),expected_sha)
    developer=Path(os.environ['DEVELOPER_DIR']).resolve()
    if not developer.is_relative_to('/Applications') or not developer.is_dir():
        raise RuntimeError('Expected installed Xcode under /Applications')
    # Before any mutation, verify the actual transport daemons, not just shell UID.
    report.mkdir(mode=0o755)
    daemons=admit_runner(runner_uid,report,expected_sha,control_sha,mode)
    work=Path(tempfile.mkdtemp(prefix='thingtime-native-control-',dir='/private/tmp'))
    work.chmod(0o755)
    user=f'_ttnative{os.getpid()}'
    uid=5500
    identity_until=time.monotonic()+30
    while any(run(['/usr/bin/dscl','.', '-search',table,field,str(uid)],capture_output=True).stdout.strip()
              for table,field in [('/Users','UniqueID'),('/Groups','PrimaryGroupID')]):
        uid+=1
        if time.monotonic() >= identity_until:
            raise TimeoutError('Identity allocation deadline exhausted')
    if run(['/usr/bin/id',user],check=False,capture_output=True).returncode == 0:
        raise RuntimeError('Refusing to reuse a build identity')
    home,source,derived=work/'home',work/'source',work/'derived'
    for directory in [home,source,derived]:directory.mkdir()
    archive=work/'candidate.tar.gz'
    digest=None
    if mode == 'native':
        shutil.copyfile(archive_input,archive)
        archive.chmod(0o644)
        hasher=hashlib.sha256()
        with archive.open('rb') as content:
            for chunk in iter(lambda:content.read(1024*1024),b''):hasher.update(chunk)
        digest=hasher.hexdigest()
    trusted_helper=work/'trusted-native-compile.py'
    shutil.copyfile(Path(__file__).resolve(),trusted_helper)
    trusted_helper.chmod(0o644)
    for name,text in [('probe.py',PROBE),('baseline.py',BASELINE),('control.py',CONTROL_PROBE),
                      ('build.sh',BUILD),('pf.conf',firewall_rules(runner_uid))]:
        (work/name).write_text(text)
    (work/'cleanup.lock').touch(mode=0o600)
    state={'uid':uid,'user':user,'report':str(report),'user_created':False,'group_created':False,
           'pf_changed':False,'pf_token':None,'owned_groups':[],
           'watchdog_deadline':time.monotonic()+BOOTSTRAP_SECONDS,'watchdog_requested':False}
    def save_state(**changes):
        state.update(changes)
        temporary=work/'state.new'
        temporary.write_text(json.dumps(state))
        temporary.chmod(0o600)
        temporary.replace(work/'state.json')
    save_state()
    watchdog=start_watchdog(work)
    def register_group(operation,pid):
        groups=list(state['owned_groups'])
        if operation == 'add':groups.append(pid)
        elif pid in groups:groups.remove(pid)
        save_state(owned_groups=groups)
    GROUP_REGISTRAR=register_group
    COMMAND_CONTEXT={'work':work,'helper':trusted_helper}
    def terminated(signum,frame):
        raise RuntimeError(f'Native compile interrupted by signal {signum}')
    signal.signal(signal.SIGTERM,terminated)
    signal.signal(signal.SIGINT,terminated)
    def as_runner(command,**kwargs):
        return run(['/usr/bin/sudo','-n','-u',runner_user,'/usr/bin/env','-i',f'PATH={PATH}',*command],**kwargs)
    def as_build(command,**kwargs):
        return run(['/usr/bin/sudo','-n','-u',user,*build_environment(home,user,developer),*command],**kwargs)
    provenance={'sourceSha':expected_sha,'controllerSha':control_sha,'mode':mode,'archiveSha256':digest,
                'signedDeviceAcceptance':False,'result':'incomplete','candidateExtracted':False,'candidateExecuted':False,'cleanupComplete':None,'policyRestored':None}
    try:
        phase(report,'bootstrap-started')
        save_state(group_created=True)
        run(['/usr/bin/dscl','.', '-create',f'/Groups/{user}','PrimaryGroupID',str(uid)],capture_output=True)
        save_state(user_created=True)
        for key,value in [('UniqueID',str(uid)),('PrimaryGroupID',str(uid)),('NFSHomeDirectory',str(home)),
                          ('UserShell','/usr/bin/false'),('AuthenticationAuthority',';DisabledUser;')]:
            run(['/usr/bin/dscl','.', '-create',f'/Users/{user}',key,value],capture_output=True)
        for directory in [home,source,derived]:run(['/usr/sbin/chown',f'{uid}:{uid}',str(directory)])
        runner_home=run(['/usr/bin/dscl','.', '-read',f'/Users/{runner_user}','NFSHomeDirectory'],capture_output=True).stdout
        runner_home=Path(runner_home.split(':',1)[1].strip()).resolve()
        if not runner_home.is_relative_to('/Users') or runner_home == Path('/Users'):
            raise RuntimeError('Unexpected ephemeral runner home')
        runner_home.chmod(0o700)
        baseline=as_runner([PYTHON,'-I','-S',str(work/'baseline.py')],capture_output=True,timeout=25)
        (report/'positive-controls.json').write_text(baseline.stdout)
        phase(report,'before-policy')
        run(['/sbin/pfctl','-n','-f',str(work/'pf.conf')],capture_output=True)
        enabled=run(['/sbin/pfctl','-E'],capture_output=True)
        match=re.search(r'Token\s*:\s*(\d+)',enabled.stdout+enabled.stderr)
        if not match:raise RuntimeError('Cannot retain PF enable token')
        save_state(pf_token=match.group(1),pf_changed=True)
        run(['/sbin/pfctl','-f',str(work/'pf.conf')],capture_output=True)
        run(['/sbin/pfctl','-F','states'],capture_output=True)
        phase(report,'policy-loaded-states-flushed')
        rules=run(['/sbin/pfctl','-sr'],capture_output=True).stdout
        if not all(rule in rules for rule in ['block drop out quick inet all','block drop out quick inet6 all']):
            raise RuntimeError('PF IPv4/IPv6 deny-all rules missing')
        if 'Status: Enabled' not in run(['/sbin/pfctl','-si'],capture_output=True).stdout:
            raise RuntimeError('PF is not enabled')
        (report/'pf-rules.txt').write_text(rules)
        for number in [1,2]:
            phase(report,f'control-probe-{number}-started')
            control=as_runner([PYTHON,'-I','-S',str(work/'control.py'),'allow'],capture_output=True,timeout=15)
            (report/f'control-{number}.json').write_text(control.stdout)
            phase(report,f'control-probe-{number}-passed')
            if number == 1:
                # Ordinary process timing, not another model/observer. Policy
                # stays loaded during this short bounded continuity interval.
                time.sleep(5)
        denied=as_build([PYTHON,'-I','-S',str(work/'probe.py'),str(uid)],capture_output=True,timeout=25)
        (report/'isolation.json').write_text(denied.stdout)
        child=as_build(['/usr/bin/sandbox-exec','-p','(version 1)(allow default)',PYTHON,'-I','-S',
                        str(work/'probe.py'),str(uid),'child'],capture_output=True,timeout=25)
        (report/'child-isolation.json').write_text(child.stdout)
        root_denied=run([PYTHON,'-I','-S',str(work/'probe.py'),'0','child'],capture_output=True,timeout=20)
        (report/'root-isolation.json').write_text(root_denied.stdout)
        for broker_uid in sorted({row['uid'] for row in daemons if row['executable']=='mDNSResponder'}-{0}):
            broker=run(['/usr/bin/sudo','-n','-u',f'#{broker_uid}','/usr/bin/env','-i',f'PATH={PATH}',
                        PYTHON,'-I','-S',str(work/'probe.py'),str(broker_uid),'child'],
                       capture_output=True,timeout=20)
            (report/f'dns-broker-{broker_uid}-isolation.json').write_text(broker.stdout)
        phase(report,'all-control-and-isolation-gates-passed')
        if mode == 'preflight':
            phase(report,'inert-watchdog-cleanup-requested')
            save_state(watchdog_requested=True)
            wait_until=time.monotonic()+CLEANUP_SECONDS+LOCK_SECONDS+5
            while not (work/'cleaned').exists():
                if time.monotonic() >= wait_until:
                    raise TimeoutError('Watchdog cleanup did not complete within its bound')
                time.sleep(.1)
            provenance['result']='inert preflight and requested detached-watchdog cleanup passed'
        else:
            arm_native(work,save_state,True)
            phase(report,'native-deadline-armed')
            build_until=time.monotonic()+DEADLINE_SECONDS
            phase(report,'candidate-extraction-started')
            as_build([PYTHON,'-I','-S',str(trusted_helper),'extract',str(archive),str(source)],timeout=120)
            provenance['candidateExtracted']=True
            provenance['candidateExecuted']=True
            phase(report,'candidate-build-started')
            with (report/'build.log').open('w') as log:
                as_build(['/bin/bash','--noprofile','--norc',str(work/'build.sh'),str(source),str(derived)],
                         stdout=log,stderr=subprocess.STDOUT,timeout=build_until-time.monotonic())
            provenance['result']='unsigned full macOS/iOS compile and Swift package tests passed'
    except BaseException as error:
        provenance['failureType']=type(error).__name__
        phase(report,'aborting-before-network-restoration')
        raise
    finally:
        GROUP_REGISTRAR=None
        COMMAND_CONTEXT=None
        try:
            (report/'result.json').write_text(json.dumps(provenance,indent=2)+'\n')
        finally:
            cleanup(work)
        provenance.update(cleanupComplete=True,policyRestored=True)
        (report/'result.json').write_text(json.dumps(provenance,indent=2)+'\n')
        try:os.kill(watchdog,signal.SIGKILL)
        except ProcessLookupError:pass
        reap_until=time.monotonic()+5
        while os.waitpid(watchdog,os.WNOHANG)[0] == 0:
            if time.monotonic() >= reap_until:
                raise TimeoutError('Watchdog reap deadline exhausted')
            time.sleep(.1)
        run(['/usr/sbin/chown','-R',f'{runner_uid}:20',str(report)])
        run(['/bin/rm','-rf','--',str(work)])


def main():
    if len(sys.argv) >= 4 and sys.argv[1] == 'spawn':
        if os.geteuid() != 0:raise RuntimeError('Trusted command gate requires root supervisor')
        gate=int(sys.argv[2])
        allowed=os.read(gate,1) == b'1'
        os.close(gate)
        if not allowed:raise SystemExit(111)
        os.execv(sys.argv[3],sys.argv[3:])
    elif len(sys.argv) == 4 and sys.argv[1] == 'extract':
        if os.geteuid() == 0:
            raise RuntimeError('Candidate extraction must never run as root')
        extract_candidate(sys.argv[2], sys.argv[3])
    elif len(sys.argv) == 4 and sys.argv[1] == 'validate':
        print(validate_source(json.loads(Path(sys.argv[2]).read_text()),sys.argv[3]))
    elif len(sys.argv) in (7,8) and sys.argv[1] == 'build':
        supervise(*sys.argv[2:])
    else:
        raise RuntimeError('Expected validate <PR JSON> <SHA>, extract <archive> <directory>, or build <archive> <report> <source SHA> <control SHA> <PR JSON> [preflight|native]')


if __name__ == '__main__':
    main()
