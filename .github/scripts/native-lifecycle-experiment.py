#!/usr/bin/env python3
"""REVIEW DRAFT. Inert hosted platform experiment; never imports candidate code."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import uuid

PYTHON = '/usr/bin/python3'
ENV = {'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'LC_ALL': 'C'}
ABSENT = 113  # Observational platform hypothesis, NOT a production absence API.


def write_json(path, value, mode=0o600):
    temporary = path.with_suffix('.new')
    with temporary.open('w') as stream:
        os.chmod(temporary, mode)
        json.dump(value, stream)
    temporary.replace(path)


def command(label, args, allowed=(0,)):
    result = subprocess.run(args, env=ENV, cwd='/', stdin=subprocess.DEVNULL,
                            capture_output=True, timeout=10, close_fds=True)
    if result.returncode not in allowed:
        raise RuntimeError(label + '-unexpected-status-' + str(result.returncode))
    return result


def record(table, name):
    result = command('record-read', ['/usr/bin/dscl', '-plist', '.', '-read', '/' + table + '/' + name])
    return plistlib.loads(result.stdout)


def verify_resource(resource):
    user = record('Users', resource['user'])
    group = record('Groups', resource['user'])
    expected = {'UniqueID': str(resource['uid']), 'PrimaryGroupID': str(resource['uid']),
                'NFSHomeDirectory': resource['home'], 'UserShell': '/usr/bin/false'}
    for key, value in expected.items():
        if user.get('dsAttrTypeStandard:' + key) != [value]:
            raise RuntimeError('task-account-ownership-mismatch')
    if group.get('dsAttrTypeStandard:PrimaryGroupID') != [str(resource['uid'])]:
        raise RuntimeError('task-group-ownership-mismatch')


def domain_status(uid):
    return command('domain-observation', ['/bin/launchctl', 'print', 'user/' + str(uid)],
                   allowed=(0, ABSENT)).returncode


def pids(uid):
    result = command('uid-inventory', ['/usr/bin/pgrep', '-u', str(uid)], allowed=(0, 1))
    if result.returncode == 1:
        return []
    values = result.stdout.decode('ascii').split()
    if not values or not all(value.isdecimal() for value in values):
        raise RuntimeError('invalid-task-process-inventory')
    return [int(value) for value in values]


def fixture(mode, home, uid, foreign_uid):
    """Fixed inert behavior; no network, profiles, secrets, candidate or shell."""
    home = Path(home)
    if os.getuid() != uid or os.geteuid() != uid or os.getgid() != uid or os.getegid() != uid:
        raise RuntimeError('fixture-credentials-mismatch')
    if mode == 'escaped':
        while True:
            time.sleep(2)
    groups = os.getgroups()
    if 0 in groups or 80 in groups:
        raise RuntimeError('fixture-privileged-group-membership')
    command('negative-sudo-control', ['/usr/bin/sudo', '-n', '/usr/bin/true'], allowed=(1,))
    manager = command('manager-uid', ['/bin/launchctl', 'manageruid']).stdout.strip()
    if manager != str(uid).encode():
        raise RuntimeError('fixture-bootstrap-manager-mismatch')
    # A separate task-owned sentinel domain tests cross-UID mutation refusal.
    # RunAtLoad=false and KeepAlive=false make unexpected admission inert.
    own_target = 'user/' + str(uid)
    if not (home / 'own-admission-passed').exists():
        command('own-domain-admission-positive', ['/bin/launchctl', 'bootstrap', own_target, str(home / 'foreign.plist')])
        (home / 'own-admission-passed').touch()
    else:
        command('own-domain-admission-still-present', ['/bin/launchctl', 'print', own_target + '/com.thingtime.inert.foreign.' + home.name])
    foreign = command('foreign-domain-probe', ['/bin/launchctl', 'bootstrap',
                      'user/' + str(foreign_uid), str(home / 'foreign.plist')], allowed=tuple(range(256)))
    escaped = subprocess.Popen([PYTHON, '-I', '-S', __file__, 'fixture', 'escaped', str(home),
                               str(uid), str(foreign_uid)], env=ENV, cwd='/', start_new_session=True,
                               stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, close_fds=True)
    with (home / 'events.jsonl').open('a') as stream:
        stream.write(json.dumps({'pid': os.getpid(), 'uid': os.getuid(), 'gid': os.getgid(),
                                'managerUid': int(manager), 'foreignStatus': foreign.returncode,
                                'groups': groups, 'normalSudoRefusal': True,
                                'escapedPid': escaped.pid, 'monotonic': time.monotonic()}) + '\n')
        stream.flush()
    while True:
        time.sleep(2)


def cleanup(work):
    state = json.loads((work / 'state.json').read_text())
    with (work / 'cleanup.lock').open('r+') as lock:
        until = time.monotonic() + 10
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= until:
                    raise RuntimeError('cleanup-lock-timeout')
                time.sleep(.1)
        if (work / 'done').exists():
            return
        # This experiment never changes PF; uncertainty means discard the job VM.
        output = {'experiment': 'task-user-launchd-v1', 'case': state['case'],
                  'candidateExecuted': False, 'policyChanged': False,
                  'platformAcceptance': False, 'result': 'quarantine-discard-hosted-vm'}
        try:
            resources = state['resources']
            if not resources:
                raise RuntimeError('no-owned-resources-recorded')
            for resource in resources:
                uid = resource['uid']
                if uid <= 0 or uid == state['runnerUid'] or not resource.get('domainAttempted'):
                    raise RuntimeError('cleanup-resource-not-admitted')
                verify_resource(resource)
                command('exact-task-domain-bootout', ['/bin/launchctl', 'bootout', 'user/' + str(uid)],
                        allowed=(0, ABSENT))
                command('exact-task-uid-reap', ['/usr/bin/pkill', '-KILL', '-u', str(uid)], allowed=(0, 1))
            # Observation interval exceeds the fixed two-second KeepAlive throttle.
            # Domain print exit statuses are recorded hypotheses, not a parsed API.
            until = time.monotonic() + 60
            observations = 0
            while time.monotonic() < until:
                for resource in resources:
                    if pids(resource['uid']) or domain_status(resource['uid']) != ABSENT:
                        raise RuntimeError('task-process-or-domain-remains')
                observations += 1
                time.sleep(2)
            if not (work / 'platform-fixture-passed').exists():
                raise RuntimeError('fixture-assertions-never-completed')
            for resource in resources:
                verify_resource(resource)
                command('delete-owned-account', ['/usr/bin/dscl', '.', '-delete', '/Users/' + resource['user']])
                command('delete-owned-group', ['/usr/bin/dscl', '.', '-delete', '/Groups/' + resource['user']])
            output.update(result='inert-platform-observations-passed', platformAcceptance=True,
                          absentStatusHypothesis=ABSENT, noRespawnObservations=observations,
                          noRespawnSeconds=60, realJobCancellationTested=False,
                          networkIsolationTested=False, nativeCompileTested=False)
        except BaseException as error:
            # Fixed generated labels only; do not serialize command output.
            output['failure'] = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        write_json(Path(state['report']) / 'result.json', output, 0o644)
        (work / 'done').touch(mode=0o600)


def watchdog(work, parent):
    until = time.monotonic() + 180
    while True:
        requested = (work / 'cleanup-requested').exists()
        try:
            os.kill(parent, 0)
            alive = True
        except ProcessLookupError:
            alive = False
        if requested or not alive:
            cleanup(work)
            return
        if time.monotonic() >= until:
            state = json.loads((work / 'state.json').read_text())
            write_json(Path(state['report']) / 'result.json', {'result': 'quarantine-supervisor-deadline',
                       'candidateExecuted': False, 'policyChanged': False, 'platformAcceptance': False}, 0o644)
            return
        time.sleep(.2)


def allocate(work, used):
    for uid in range(5500, 5700):
        if uid in used:
            continue
        found = False
        for table, field in [('/Users', 'UniqueID'), ('/Groups', 'PrimaryGroupID')]:
            if command('fresh-numeric-identity', ['/usr/bin/dscl', '.', '-search', table, field,
                                                str(uid)]).stdout.strip():
                found = True
        if not found and not pids(uid) and domain_status(uid) == ABSENT:
            name = '_ttlife' + uuid.uuid4().hex[:14]
            for table in ('Users', 'Groups'):
                names = command('fresh-record-name', ['/usr/bin/dscl', '.', '-list', '/' + table]).stdout.decode().splitlines()
                if name in names:
                    raise RuntimeError('generated-account-name-already-exists')
            home = work / name
            home.mkdir(mode=0o700)
            return {'uid': uid, 'user': name, 'home': str(home), 'domainAttempted': False}
    raise RuntimeError('bounded-fresh-identity-range-exhausted')


def supervise(case, report, admission):
    os.umask(0o077)
    if case not in ('normal', 'parent-loss'):
        raise ValueError('unknown-fixed-case')
    if (sys.platform != 'darwin' or os.geteuid() != 0 or
            os.environ.get('GITHUB_ACTIONS') != 'true' or
            os.environ.get('RUNNER_ENVIRONMENT') != 'github-hosted' or
            os.environ.get('GITHUB_REPOSITORY') != 'lopugit/thingtime'):
        raise RuntimeError('hosted-root-experiment-only')
    runner_uid = int(os.environ['SUDO_UID'])
    if runner_uid <= 0:
        raise RuntimeError('invalid-runner-uid')
    provenance = json.loads(Path(admission).read_text())
    if not all(re.fullmatch('[0-9a-f]{40}', provenance.get(key, ''))
               for key in ('helperSha', 'reviewedHeadSha', 'workflowSha')):
        raise RuntimeError('invalid-reviewed-provenance')
    if provenance.get('actor') != 'lopugit' or provenance.get('label') != 'native-lifecycle-' + provenance['reviewedHeadSha']:
        raise RuntimeError('exact-owner-review-label-required')
    report = Path(report).resolve()
    if not report.is_relative_to(Path(os.environ['RUNNER_TEMP']).resolve()) or report.exists():
        raise RuntimeError('new-task-report-required')
    report.mkdir(mode=0o755)
    command('launchctl-positive-control', ['/bin/launchctl', 'print', 'system'])
    work = Path(tempfile.mkdtemp(prefix='tt-inert-lifecycle-', dir='/private/tmp'))
    work.chmod(0o755)
    helper = work / 'trusted-experiment.py'
    shutil.copyfile(__file__, helper)
    helper.chmod(0o644)
    write_json(report / 'provenance.json', provenance, 0o644)
    state = {'case': case, 'runnerUid': runner_uid, 'report': str(report), 'resources': []}
    write_json(work / 'state.json', state)
    (work / 'cleanup.lock').touch(mode=0o600)
    watcher = subprocess.Popen([PYTHON, '-I', '-S', str(helper), 'watchdog', str(work), str(os.getpid())],
                               env=ENV, cwd='/', stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, close_fds=True, start_new_session=True)
    def request_cleanup(signum=None, frame=None):
        raise RuntimeError('supervisor-interrupted')
    signal.signal(signal.SIGTERM, request_cleanup)
    signal.signal(signal.SIGINT, request_cleanup)
    signal.signal(signal.SIGALRM, request_cleanup)
    signal.alarm(120)
    try:
        for _ in range(2):
            resource = allocate(work, {runner_uid, *(item['uid'] for item in state['resources'])})
            # Persist ownership intent before creation; teardown still requires exact readback.
            state['resources'].append(resource)
            write_json(work / 'state.json', state)
            path = '/Groups/' + resource['user']
            command('create-task-group', ['/usr/bin/dscl', '.', '-create', path, 'PrimaryGroupID', str(resource['uid'])])
            for key, value in [('UniqueID', str(resource['uid'])), ('PrimaryGroupID', str(resource['uid'])),
                               ('NFSHomeDirectory', resource['home']), ('UserShell', '/usr/bin/false'),
                               ('AuthenticationAuthority', ';DisabledUser;')]:
                command('create-disabled-task-account', ['/usr/bin/dscl', '.', '-create',
                        '/Users/' + resource['user'], key, value])
            verify_resource(resource)
            command('own-task-home', ['/usr/sbin/chown', str(resource['uid']) + ':' + str(resource['uid']), resource['home']])
            resource['domainAttempted'] = True
            write_json(work / 'state.json', state)
            command('bootstrap-exact-task-domain', ['/bin/launchctl', 'bootstrap', 'user/' + str(resource['uid'])])
            if domain_status(resource['uid']) != 0:
                raise RuntimeError('new-task-domain-not-readable')
        task, sentinel = state['resources']
        home = Path(task['home'])
        foreign = {'Label': 'com.thingtime.inert.foreign.' + task['user'],
                   'ProgramArguments': ['/usr/bin/true'], 'RunAtLoad': False, 'KeepAlive': False}
        (home / 'foreign.plist').write_bytes(plistlib.dumps(foreign))
        (home / 'foreign.plist').chmod(0o644)
        command('own-inert-foreign-plist', ['/usr/sbin/chown', str(task['uid']) + ':' + str(task['uid']), str(home / 'foreign.plist')])
        label = 'com.thingtime.inert.main.' + task['user']
        plist = work / (label + '.plist')
        plist.write_bytes(plistlib.dumps({'Label': label, 'ProgramArguments': [PYTHON, '-I', '-S', str(helper),
                          'fixture', 'main', str(home), str(task['uid']), str(sentinel['uid'])],
                          'RunAtLoad': True, 'KeepAlive': True, 'ThrottleInterval': 2,
                          'AbandonProcessGroup': True, 'EnvironmentVariables': ENV,
                          'StandardOutPath': '/dev/null', 'StandardErrorPath': '/dev/null'}))
        plist.chmod(0o644)
        command('bootstrap-fixed-inert-service', ['/bin/launchctl', 'bootstrap', 'user/' + str(task['uid']), str(plist)])
        seen = set()
        until = time.monotonic() + 30
        while time.monotonic() < until:
            events = [json.loads(line) for line in (home / 'events.jsonl').read_text().splitlines()] if (home / 'events.jsonl').exists() else []
            for event in events:
                if event['foreignStatus'] not in (1, 13) or event['managerUid'] != task['uid'] or event['uid'] != task['uid'] or event['gid'] != task['uid']:
                    raise RuntimeError('namespace-or-foreign-admission-failed')
                observed = pids(task['uid'])
                if event['pid'] in observed and event['escapedPid'] in observed:
                    if event['pid'] not in seen:
                        seen.add(event['pid'])
                        if len(seen) == 1:
                            command('exercise-keepalive', ['/bin/launchctl', 'kill', 'SIGKILL', 'user/' + str(task['uid']) + '/' + label])
            if len(seen) >= 2:
                break
            time.sleep(.2)
        if len(seen) < 2:
            raise RuntimeError('keepalive-respawn-not-observed')
        write_json(report / 'fixture.json', {'freshTaskUid': task['uid'], 'freshSentinelUid': sentinel['uid'],
                   'managerUidMatched': True, 'crossUidAdmissionRefused': True, 'keepAlivePidsObserved': len(seen),
                   'escapedProcessObserved': True}, 0o644)
        (work / 'platform-fixture-passed').touch(mode=0o600)
        if case == 'parent-loss':
            os._exit(75)  # Only this task's supervisor exits; watchdog must clean independently.
    finally:
        signal.alarm(0)
        (work / 'cleanup-requested').touch(mode=0o600)
    watcher.wait(timeout=100)
    result = json.loads((report / 'result.json').read_text())
    if result['result'] != 'inert-platform-observations-passed':
        raise RuntimeError('platform-experiment-incomplete-discard-vm')


if __name__ == '__main__':
    if sys.argv[1] == 'fixture':
        fixture(sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5]))
    elif sys.argv[1] == 'watchdog':
        watchdog(Path(sys.argv[2]), int(sys.argv[3]))
    elif sys.argv[1] == 'supervise':
        supervise(*sys.argv[2:])
    else:
        raise ValueError('unsupported-fixed-subcommand')
