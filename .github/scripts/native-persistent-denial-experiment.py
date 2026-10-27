#!/usr/bin/env python3
"""Fixed inert hosted observations; never admits candidate execution."""
import ctypes
import errno
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import signal
import socket
import ssl
import subprocess
import sys
import tempfile
import time

PYTHON = '/usr/bin/python3'
ENV = {'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'LC_ALL': 'C'}
COMMAND_SECONDS = 10
WATCHDOG_SECONDS = 210
LABELS = ('tcp4', 'tcp6', 'udp4')
TARGETS = {'tcp4': (socket.AF_INET, socket.SOCK_STREAM, '1.1.1.1', 443),
           'tcp6': (socket.AF_INET6, socket.SOCK_STREAM, '2606:4700:4700::1111', 443),
           'udp4': (socket.AF_INET, socket.SOCK_DGRAM, '1.1.1.1', 53)}
DNS = bytes.fromhex('123401000001000000000000076578616d706c6503636f6d0000010001')


def label(head):
    if not re.fullmatch('[0-9a-f]{40}', head):
        raise ValueError('full-reviewed-head-required')
    value = 'tt-pd-' + head
    if len(value) > 50:
        raise ValueError('label-too-long')
    return value


def write_json(path, value):
    # Parent is root-owned; never chown receipt contents to the fixture.
    temporary = path.with_suffix('.new')
    with temporary.open('x') as stream:
        os.chmod(temporary, 0o644)
        json.dump(value, stream)
    temporary.replace(path)


def command(phase, argv, allowed=(0,), timeout=COMMAND_SECONDS):
    result = subprocess.run(argv, env=ENV, cwd='/', close_fds=True,
                            stdin=subprocess.DEVNULL, capture_output=True, timeout=timeout)
    if result.returncode not in allowed:
        raise RuntimeError(phase + '-status-' + str(result.returncode))
    return result


def require_hosted(environ=os.environ):
    expected = {'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'github-hosted',
                'RUNNER_OS': 'macOS', 'GITHUB_REPOSITORY': 'lopugit/thingtime',
                'GITHUB_EVENT_NAME': 'pull_request', 'REVIEW_ACTOR': 'lopugit'}
    if sys.platform != 'darwin' or os.geteuid() != 0 or any(environ.get(k) != v for k, v in expected.items()):
        raise RuntimeError('fresh-reviewed-hosted-root-context-required')
    value = environ.get('SUDO_UID', '')
    if not value.isdecimal() or int(value) <= 0:
        raise RuntimeError('distinct-runner-uid-required')
    return int(value)


def validate_admission(value, helper_bytes):
    keys = {'actor', 'label', 'helperSha', 'helperSha256', 'reviewedHeadSha',
            'workflowSha', 'workflowSha256', 'workflowBytesEqual', 'candidateCheckout'}
    if (not isinstance(value, dict) or set(value) != keys or value['actor'] != 'lopugit' or
        not all(isinstance(value[k], str) and re.fullmatch('[0-9a-f]{40}', value[k]) and value[k] != '0' * 40
                for k in ('helperSha', 'reviewedHeadSha', 'workflowSha')) or
        not all(isinstance(value[k], str) and re.fullmatch('[0-9a-f]{64}', value[k]) for k in ('helperSha256', 'workflowSha256')) or
        value['label'] != label(value['reviewedHeadSha']) or value['workflowBytesEqual'] is not True or
        value['candidateCheckout'] is not False or hashlib.sha256(helper_bytes).hexdigest() != value['helperSha256']):
        raise RuntimeError('reviewed-admission-mismatch')
    return value


def runner_identities(text, runner_uid):
    found, brokers = set(), set()
    for line in text.splitlines():
        fields = line.split(None, 3)
        if len(fields) != 4:
            continue
        pid, ppid, uid, executable = fields
        name = Path(executable).name
        if name not in ('Runner.Listener', 'Runner.Worker', 'mDNSResponder'):
            continue
        if not all(value.isdecimal() for value in (pid, ppid, uid)):
            raise RuntimeError('invalid-runner-identity-metadata')
        if name == 'mDNSResponder':
            if int(uid) == runner_uid:
                raise RuntimeError('dns-broker-shares-transport-uid')
            brokers.add(int(uid))
        else:
            if int(uid) != runner_uid:
                raise RuntimeError('runner-identity-conflict')
            found.add(name)
    if found != {'Runner.Listener', 'Runner.Worker'} or not brokers:
        raise RuntimeError('runner-identities-incomplete')
    return sorted(brokers)


def allocate_numeric_identity(runner_uid):
    # Numeric credentials only. No account creation or domain absence claim.
    for uid in range(5500, 5700):
        if uid == runner_uid:
            continue
        if any(command('numeric-record-search', ['/usr/bin/dscl', '.', '-search', table, field, str(uid)]).stdout.strip()
               for table, field in (('/Users', 'UniqueID'), ('/Groups', 'PrimaryGroupID'))):
            continue
        if command('numeric-process-check', ['/usr/bin/pgrep', '-u', str(uid)], allowed=(0, 1)).returncode != 1:
            continue
        return uid
    raise RuntimeError('numeric-identity-range-exhausted')


def firewall_rules(runner_uid, fixture_uid, brokers):
    if runner_uid <= 0 or fixture_uid <= 0 or runner_uid == fixture_uid or runner_uid in brokers:
        raise ValueError('unsafe-rule-identities')
    rules = [f'pass out quick {af} proto {proto} all user {runner_uid}' +
             (' flags any' if proto == 'tcp' else '') + ' keep state'
             for af in ('inet', 'inet6') for proto in ('tcp', 'udp')]
    roles = {'fixture': fixture_uid, 'root': 0}
    roles.update({f'broker{i}': uid for i, uid in enumerate(sorted(set(brokers) - {0}))})
    for role, uid in roles.items():
        for part in LABELS:
            family, kind, host, port = TARGETS[part]
            af, proto = ('inet6' if family == socket.AF_INET6 else 'inet'), ('udp' if kind == socket.SOCK_DGRAM else 'tcp')
            rules.append(f'block drop out quick {af} proto {proto} from any to {host} port {port} user {uid} label "pd_{role}_{part}"')
    rules += ['block drop out quick inet all label "pd_default4"',
              'block drop out quick inet6 all label "pd_default6"']
    return '\n'.join(rules) + '\n', roles


def label_packets(output, expected):
    # pfctl(8) documents label plus seven numeric accounting fields. Unknown
    # formats/labels fail; no guessed default count or timeout-only attribution.
    result = {}
    for line in output.splitlines():
        fields = line.split()
        if len(fields) != 8 or fields[0] not in expected or fields[0] in result or not all(x.isdecimal() for x in fields[1:]):
            raise RuntimeError('unsupported-pf-label-statistics')
        result[fields[0]] = int(fields[2])
    if set(result) != set(expected):
        raise RuntimeError('pf-label-statistics-incomplete')
    return result


def drop(uid, gid):
    os.setgroups([])
    os.setgid(gid)
    os.setuid(uid)
    if (os.getuid(), os.geteuid(), os.getgid(), os.getegid()) != (uid, uid, gid, gid):
        raise RuntimeError('numeric-drop-mismatch')
    if os.getgroups() not in ([], [gid]):
        raise RuntimeError('unexpected-supplementary-groups')


def launch(work, uid, gid, mode, *arguments):
    return subprocess.Popen([PYTHON, '-I', '-S', str(work / 'helper.py'), 'drop', str(uid), str(gid),
                             mode, *map(str, arguments)], env=ENV, cwd='/', stdin=subprocess.DEVNULL,
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, close_fds=True, start_new_session=True)


def receive(process, timeout=10):
    try:
        output, _ = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)  # Only the exact trusted child group.
        process.communicate(timeout=3)
        raise RuntimeError('fixed-probe-timeout') from None
    if len(output) > 4096:
        raise RuntimeError('fixed-probe-output-too-large')
    value = json.loads(output)
    if not isinstance(value, dict):
        raise RuntimeError('fixed-probe-result-invalid')
    if process.returncode != 0:
        code = value.get('failureCode')
        if set(value) != {'failureCode'} or not isinstance(code, str) or not re.fullmatch('[a-z][a-z0-9-]{0,119}', code):
            raise RuntimeError('fixed-probe-failed-without-diagnostic')
        raise RuntimeError('fixed-probe-' + code)
    return value


def network_probe(part, expected):
    family, kind, host, port = TARGETS[part]
    stream = socket.socket(family, kind)
    stream.settimeout(2)
    try:
        stream.connect((host, port))
        if kind == socket.SOCK_DGRAM:
            stream.send(DNS)
            if stream.recv(512)[:2] != DNS[:2]:
                raise RuntimeError('positive-dns-response-mismatch')
        if expected != 'positive':
            raise RuntimeError('denial-escaped')
    except (socket.timeout, TimeoutError):
        if expected != 'denied':
            raise RuntimeError('positive-control-timeout') from None
    except OSError:
        raise RuntimeError('network-error-is-not-denial') from None
    finally:
        stream.close()
    return {'part': part, 'expected': expected, 'observed': True}


def resolve_control():
    addresses = sorted({(family, sockaddr[0]) for family, kind, proto, canon, sockaddr in
                        socket.getaddrinfo('api.github.com', 443, type=socket.SOCK_STREAM)
                        if family in (socket.AF_INET, socket.AF_INET6)})
    if not addresses:
        raise RuntimeError('fixed-control-dns-no-addresses')
    return {'fixedHost': 'api.github.com', 'addresses': addresses, 'resolvedBeforePolicy': True}


def https_control(addresses):
    if not addresses:
        raise RuntimeError('fixed-control-addresses-missing')
    for family, address in addresses:
        version = ipaddress.ip_address(address).version
        if (family, version) not in ((socket.AF_INET, 4), (socket.AF_INET6, 6)):
            raise RuntimeError('fixed-control-address-family-invalid')
        # Numeric connect uses no getaddrinfo/resolver after PF. TLS still binds
        # the original fixed hostname, with normal certificate verification.
        with socket.socket(family, socket.SOCK_STREAM) as raw:
            raw.settimeout(4)
            raw.connect((address, 443))
            with ssl.create_default_context().wrap_socket(raw, server_hostname='api.github.com') as stream:
                stream.settimeout(4)
                stream.sendall(b'GET /meta HTTP/1.1\r\nHost: api.github.com\r\nUser-Agent: Thingtime-inert-persistent-denial\r\nConnection: close\r\n\r\n')
                if not stream.recv(256).split(b'\r\n', 1)[0].startswith(b'HTTP/1.1 200'):
                    raise RuntimeError('runner-https-control-failed')
    return {'publicHttps': True, 'tlsVerified': True, 'endpointCount': len(addresses),
            'dnsResolutionDuringControl': False}


def failure_code(error):
    if isinstance(error, subprocess.TimeoutExpired):
        return 'command-timeout'
    if isinstance(error, OSError):
        return 'os-error-' + str(error.errno) if isinstance(error.errno, int) else 'os-error'
    if isinstance(error, RuntimeError) and re.fullmatch('[a-z][a-z0-9-]{0,119}', str(error)):
        return str(error)
    return 'unexpected-' + type(error).__name__.lower()


def authority_probe(control, report, runner_uid, expected_uid):
    if os.geteuid() != expected_uid or expected_uid in (0, runner_uid):
        raise RuntimeError('fixture-identity-mismatch')
    status = subprocess.run(['/usr/bin/sudo', '-n', '/usr/bin/true'], env=ENV, cwd='/',
                            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL, close_fds=True, timeout=3).returncode
    if status != 1:
        raise RuntimeError('normal-sudo-refusal-not-observed')
    try:
        os.setuid(runner_uid)
    except OSError as error:
        if error.errno != errno.EPERM:
            raise
    else:
        raise RuntimeError('fixture-obtained-transport-identity')
    # Synthetic canaries only: never open real runner credentials or profiles.
    for path, flags in [(control / 'synthetic-credential', os.O_RDONLY), (control / 'policy.conf', os.O_WRONLY),
                        (report / 'receipt-canary.json', os.O_WRONLY), (control.parent / 'helper.py', os.O_WRONLY)]:
        try:
            descriptor = os.open(path, flags | os.O_NOFOLLOW)
        except OSError as error:
            if error.errno != errno.EACCES:
                raise RuntimeError('canary-refusal-not-permission-denial') from None
        else:
            os.close(descriptor)  # No read/write even if the premise failed.
            raise RuntimeError('protected-canary-accessible')
    return {'fixtureUidVerified': True, 'normalSudoRefusal': True,
            'transportSetuidDenied': True, 'syntheticCanaryAccessDenied': True}


def peer_ids(connection):
    uid, gid = ctypes.c_uint(), ctypes.c_uint()
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.getpeereid(connection.fileno(), ctypes.byref(uid), ctypes.byref(gid)) != 0:
        raise RuntimeError('peer-credentials-unavailable')
    return uid.value, gid.value


def ipc_probe(work, fixture_uid, runner_uid, runner_gid):
    # Deliberately reachable synthetic broker; authorization uses kernel peer
    # credentials. This does not inventory or claim isolation of stock services.
    path = work / 'synthetic-ipc'
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(str(path)); os.chmod(path, 0o666); server.listen(2); server.settimeout(5)
    observations = []
    try:
        for uid, gid, expected in [(fixture_uid, fixture_uid, b'DENIED'), (runner_uid, runner_gid, b'ALLOWED')]:
            process = launch(work, uid, gid, 'ipc-client', path)
            try:
                connection, _ = server.accept()
                with connection:
                    peer = peer_ids(connection)
                    if peer != (uid, gid):
                        raise RuntimeError('synthetic-ipc-peer-mismatch')
                    connection.sendall(b'ALLOWED' if peer[0] == runner_uid else b'DENIED')
                result = receive(process)
                if result != {'reply': expected.decode()}:
                    raise RuntimeError('synthetic-ipc-authorization-failed')
                observations.append({'role': 'fixture' if uid == fixture_uid else 'runner', 'peerCredentialGate': True})
            finally:
                if process.poll() is None:
                    os.killpg(process.pid, signal.SIGKILL); process.wait(timeout=3)
    finally:
        server.close()  # Socket/owned state remains for provider disposal.
    return observations


def snapshot(control, state):
    if 'Status: Enabled' not in command('pf-enabled', ['/sbin/pfctl', '-si']).stdout.decode():
        raise RuntimeError('pf-not-enabled')
    rules = command('pf-readback', ['/sbin/pfctl', '-sr']).stdout
    digest = hashlib.sha256(rules).hexdigest()
    if digest != state['loadedRulesSha256']:
        raise RuntimeError('loaded-policy-changed')
    return label_packets(command('pf-counters', ['/sbin/pfctl', '-s', 'labels']).stdout.decode(), state['labels'])


def attributed_denials(work, state, role, uid):
    results = []
    for part in LABELS:
        before = snapshot(work / 'control', state)
        process = launch(work, uid, uid, 'network', part, 'denied') if uid else subprocess.Popen(
            [PYTHON, '-I', '-S', str(work / 'helper.py'), 'network', part, 'denied'], env=ENV,
            cwd='/', stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            close_fds=True, start_new_session=True)
        observed = receive(process)
        key = 'pd_' + role + '_' + part
        delta = snapshot(work / 'control', state)[key] - before[key]
        if observed != {'part': part, 'expected': 'denied', 'observed': True} or delta <= 0:
            raise RuntimeError('denial-without-labeled-policy-attribution')
        results.append({'role': role, 'part': part, 'blockedPacketDelta': delta})
    return results


def terminal_result(state, failure=None, code=None):
    return {'experiment': 'inert-persistent-denial-v1', 'source': state['admission'],
            'candidateExecuted': False, 'nativeCompileAdmitted': False, 'platformAcceptance': False,
            'policyChanged': True if state.get('policyActivated') else (None if state.get('policyActivationAttempted') else False),
            'policyMutationAttempted': state.get('policyActivationAttempted', False),
            'denyRulesLoaded': state.get('policyActivated', False), 'policyRestored': False,
            'pfEnableReferenceReleased': False, 'providerDisposalRequired': True,
            'providerDestructionObserved': False, 'rootAuthored': True, 'candidateAdmission': False,
            'result': 'inert-observations-complete' if failure is None else 'inert-observation-failed',
            'failureStage': failure, 'failureCode': code, 'observations': state.get('observations', {}),
            'unproven': ['stock-service-delegation-enforcement', 'real-transport-credential-inaccessibility',
                         'future-candidate-namespace-authority', 'live-dns-broker-and-cache-expiry-continuity',
                         'artifact-readback-after-job', 'provider-destruction-receipt']}


def watchdog(work, ready):
    signal.alarm(WATCHDOG_SECONDS)
    control = work / 'control'
    os.write(ready, b'R'); os.close(ready)
    while True:
        state = json.loads((control / 'state.json').read_text())
        if (control / 'supervisor-finished').exists():
            return
        if time.monotonic() > state['deadline']:
            write_json(Path(state['report']) / 'result.json', terminal_result(state, 'watchdog-deadline'))
            return  # PF remains loaded even on timeout.
        try:
            os.kill(state['parentPid'], 0)
        except ProcessLookupError:
            break
        time.sleep(.5)
    try:
        if not state.get('parentLossArmed'):
            raise RuntimeError('supervisor-lost-before-parent-loss-checkpoint')
        # The escaped process was launched in another session. Neither PID nor
        # service absence is claimed; provider disposal owns its final lifetime.
        os.kill(state['escapedPid'], 0)
        before = snapshot(control, state)
        (work / 'escaped-release').touch(mode=0o444)
        until = time.monotonic() + 20
        output = work / 'fixture-home' / 'escaped.json'
        while not output.exists():
            if time.monotonic() >= until:
                raise RuntimeError('escaped-observation-timeout')
            time.sleep(.1)
        if output.stat().st_size > 4096:
            raise RuntimeError('escaped-observation-size-invalid')
        escaped = json.loads(output.read_text())
        expected = [{'part': part, 'expected': 'denied', 'observed': True} for part in LABELS]
        if escaped != expected:
            raise RuntimeError('escaped-observation-invalid')
        after = snapshot(control, state)
        deltas = {part: after['pd_fixture_' + part] - before['pd_fixture_' + part] for part in LABELS}
        if any(value <= 0 for value in deltas.values()):
            raise RuntimeError('escaped-denial-without-policy-attribution')
        state['observations']['escapedAfterParentLoss'] = {'fixedProbeResults': escaped, 'blockedPacketDeltas': deltas}
        state['observations']['runnerAfterParentLoss'] = receive(launch(work, state['runnerUid'], state['runnerGid'], 'https', json.dumps(state['controlAddresses'])))
        snapshot(control, state)
        write_json(Path(state['report']) / 'result.json', terminal_result(state))
    except BaseException as error:
        write_json(Path(state['report']) / 'result.json', terminal_result(state, 'parent-loss', failure_code(error)))


def start_watchdog(work):
    import select
    read, write = os.pipe()
    pid = os.fork()
    if pid == 0:
        os.close(read)
        try:
            os.setsid()
            null = os.open('/dev/null', os.O_RDWR)
            for fd in (0, 1, 2): os.dup2(null, fd)
            os.closerange(3, write)
            os.closerange(write + 1, int(os.sysconf('SC_OPEN_MAX')))
            watchdog(work, write)
            os._exit(0)
        except BaseException:
            os._exit(111)
    os.close(write)
    try:
        if not select.select([read], [], [], 5)[0] or os.read(read, 1) != b'R':
            raise RuntimeError('watchdog-not-ready')
    finally:
        os.close(read)
    return pid


def supervise(report, admission_path):
    runner_uid = require_hosted()
    os.umask(0o077)
    report, admission_path = Path(report).resolve(), Path(admission_path).resolve()
    temporary = Path(os.environ['RUNNER_TEMP']).resolve()
    if report == temporary or not report.is_relative_to(temporary) or not admission_path.is_relative_to(temporary):
        raise RuntimeError('report-and-admission-must-be-under-runner-temp')
    report.mkdir(); report.chmod(0o755)
    admission = validate_admission(json.loads(admission_path.read_text()), Path(__file__).read_bytes())
    work = Path(tempfile.mkdtemp(prefix='tt-persistent-denial-', dir='/private/tmp')); work.chmod(0o755)
    control = work / 'control'; control.mkdir(); control.chmod(0o700)
    helper = work / 'helper.py'; helper.write_bytes(Path(__file__).read_bytes()); helper.chmod(0o444)
    state = {'admission': admission, 'report': str(report), 'parentPid': os.getpid(),
             'deadline': time.monotonic() + 160, 'policyActivated': False, 'observations': {}}
    def save(): write_json(control / 'state.json', state)
    save()
    watchdog_pid = start_watchdog(work)
    signal.alarm(150)
    try:
        brokers = runner_identities(command('runner-inventory', ['/bin/ps', '-axo', 'pid=,ppid=,uid=,comm=']).stdout.decode(), runner_uid)
        runner_gid = int(command('runner-gid', ['/usr/bin/id', '-g', str(runner_uid)]).stdout.strip())
        fixture_uid = allocate_numeric_identity(runner_uid)
        state.update(runnerUid=runner_uid, runnerGid=runner_gid, fixtureUid=fixture_uid)
        rules, roles = firewall_rules(runner_uid, fixture_uid, brokers)
        policy = control / 'policy.conf'; policy.write_text(rules); policy.chmod(0o400)
        for name in ('synthetic-credential', 'receipt-canary'):
            (control / name).write_text('synthetic-non-secret'); (control / name).chmod(0o400)
        write_json(report / 'receipt-canary.json', {'synthetic': True})
        state['phase'] = 'authority'; save()
        state['observations']['authority'] = receive(launch(work, fixture_uid, fixture_uid, 'authority', control, report, runner_uid, fixture_uid))
        state['phase'] = 'synthetic-ipc'; save()
        state['observations']['syntheticIpc'] = ipc_probe(work, fixture_uid, runner_uid, runner_gid)
        state['observations']['positiveControls'] = []
        for part in LABELS:
            state['phase'] = 'positive-' + part; save()
            state['observations']['positiveControls'].append(receive(launch(work, runner_uid, runner_gid, 'network', part, 'positive')))
        state['phase'] = 'runner-before-policy'; save()
        resolution = receive(launch(work, runner_uid, runner_gid, 'resolve-control'))
        if (set(resolution) != {'fixedHost', 'addresses', 'resolvedBeforePolicy'} or
            resolution['fixedHost'] != 'api.github.com' or resolution['resolvedBeforePolicy'] is not True):
            raise RuntimeError('fixed-control-dns-observation-invalid')
        state['controlAddresses'] = resolution['addresses']
        state['observations']['prePolicyDns'] = resolution
        state['observations']['runnerBeforePolicy'] = receive(launch(work, runner_uid, runner_gid, 'https', json.dumps(state['controlAddresses'])))
        state['phase'] = 'pf-activation'; save()
        if os.waitpid(watchdog_pid, os.WNOHANG)[0] != 0:
            raise RuntimeError('watchdog-lost-before-policy')
        command('pf-validate', ['/sbin/pfctl', '-n', '-f', str(policy)])
        # Intent is persisted before the first mutation. Never restore or release.
        state['policyActivationAttempted'] = True; save()
        enabled = command('pf-enable', ['/sbin/pfctl', '-E'])
        if not re.search(rb'Token\s*:\s*\d+', enabled.stdout + enabled.stderr):
            raise RuntimeError('pf-enable-reference-unconfirmed')
        command('pf-load', ['/sbin/pfctl', '-f', str(policy)])
        state['policyActivated'] = True; save()
        command('pf-flush-existing-states', ['/sbin/pfctl', '-F', 'states'])
        loaded = command('pf-initial-readback', ['/sbin/pfctl', '-sr']).stdout
        state['labels'] = re.findall(r'label "([a-z0-9_]+)"', rules)
        if not all(('label "' + key + '"').encode() in loaded for key in state['labels']):
            raise RuntimeError('required-policy-labels-not-loaded')
        state['loadedRulesSha256'] = hashlib.sha256(loaded).hexdigest(); save()
        state['phase'] = 'attributed-denials'; save()
        state['observations']['directDenials'] = []
        for role, uid in roles.items():
            state['observations']['directDenials'] += attributed_denials(work, state, role, uid)
        state['observations']['runnerAfterPolicy'] = receive(launch(work, runner_uid, runner_gid, 'https', json.dumps(state['controlAddresses'])))
        home = work / 'fixture-home'; home.mkdir(); os.chown(home, fixture_uid, fixture_uid); home.chmod(0o700)
        escaped = launch(work, fixture_uid, fixture_uid, 'escaped', work)
        state.update(escapedPid=escaped.pid, parentLossArmed=True); save()
        write_json(report / 'provenance.json', {'source': admission, 'rootAuthored': True,
                   'candidateExecuted': False, 'lifetimeBoundary': 'github-hosted-single-job-vm',
                   'unprovenServiceIsolation': True})
        # Simulated supervisor death is real process exit. Watchdog owns readback.
        os._exit(75)
    except BaseException as error:
        write_json(report / 'result.json', terminal_result(state, state.get('phase', 'supervisor-initialization'), failure_code(error)))
        (control / 'supervisor-finished').touch()
        raise RuntimeError('inert-observation-failed-see-root-receipt') from None


def main(args):
    if not args:
        raise ValueError('mode-required')
    mode, *args = args
    if mode == 'supervise' and len(args) == 2:
        supervise(*args); return
    if mode == 'drop' and len(args) >= 3 and os.geteuid() == 0:
        uid, gid = map(int, args[:2])
        if uid <= 0 or gid <= 0:
            raise ValueError('nonroot-drop-required')
        drop(uid, gid); main(args[2:]); return
    if mode == 'network' and len(args) == 2 and args[0] in LABELS and args[1] in ('positive', 'denied'):
        print(json.dumps(network_probe(*args))); return
    if mode == 'authority' and len(args) == 4:
        print(json.dumps(authority_probe(Path(args[0]), Path(args[1]), int(args[2]), int(args[3])))); return
    if mode == 'ipc-client' and len(args) == 1:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(4); client.connect(args[0]); reply = client.recv(16).decode('ascii')
        print(json.dumps({'reply': reply})); return
    if mode == 'resolve-control' and not args:
        print(json.dumps(resolve_control())); return
    if mode == 'https' and len(args) == 1:
        print(json.dumps(https_control(json.loads(args[0])))); return
    if mode == 'escaped' and len(args) == 1:
        signal.alarm(90)
        work = Path(args[0])
        until = time.monotonic() + 30
        while not (work / 'escaped-release').exists():
            if time.monotonic() >= until:
                raise RuntimeError('escaped-release-timeout')
            time.sleep(.1)
        observed = [network_probe(part, 'denied') for part in LABELS]
        output = work / 'fixture-home' / 'escaped.new'
        output.write_text(json.dumps(observed)); output.replace(output.with_suffix('.json'))
        time.sleep(50); return
    raise ValueError('fixed-inert-mode-only')


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except BaseException as error:
        print(json.dumps({'failureCode': failure_code(error)}), flush=True)
        raise SystemExit(1) from None
