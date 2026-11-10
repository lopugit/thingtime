#!/usr/bin/env python3
"""Create immutable local build media. Never mount, sign, boot or execute its payload."""
import argparse
import contextlib
from collections import deque
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import signal
import stat
import struct
import subprocess
import sys
import tarfile
import time
import uuid

PREFIXES = ('apple/', 'macos/ThingtimePasswords/', 'iOS/')
PROFILE = '(version 1) (allow default) (deny network*)'
FIELDS = ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns', 'st_nlink', 'st_mode', 'st_uid')


class MediaError(Exception):
    pass


def fail(label):
    raise MediaError(label)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def checked_path(path, directory=False, private=False):
    path = Path(path)
    if not path.is_absolute() or '..' in path.parts:
        fail('path')
    for parent in path.parents:
        if not stat.S_ISDIR(parent.lstat().st_mode):
            fail('path')
    info = path.lstat()
    if (not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode))
            or info.st_uid != os.geteuid() or info.st_mode & (0o077 if private else 0o022)
            or (not directory and info.st_nlink != 1)):
        fail('ownership')
    return path


@contextlib.contextmanager
def source_file(path, private=False):
    path = checked_path(path, private=private)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
    try:
        before = os.fstat(fd)
        if any(getattr(before, k) != getattr(path.lstat(), k) for k in FIELDS):
            fail('integrity')
        with os.fdopen(fd, 'rb', closefd=False) as handle:
            yield handle
        if any(getattr(before, k) != getattr(os.fstat(fd), k)
               or getattr(before, k) != getattr(path.lstat(), k) for k in FIELDS):
            fail('integrity')
    finally:
        os.close(fd)


def write_new(path, data, mode=0o600):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, mode)
    with os.fdopen(fd, 'wb') as handle:
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())


def json_bytes(value):
    return (json.dumps(value, sort_keys=True, indent=2) + '\n').encode()


def copy_bound(path, target, expected, private=False, executable=False):
    if not re.fullmatch('[a-f0-9]{64}', expected):
        fail('digest')
    hasher = hashlib.sha256()
    with source_file(path, private=private) as original:
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                     0o700 if executable else 0o600)
        with os.fdopen(fd, 'wb') as output:
            while chunk := original.read(1024 * 1024):
                hasher.update(chunk)
                output.write(chunk)
            output.flush()
            os.fsync(output.fileno())
    if hasher.hexdigest() != expected:
        fail('digest')


def finish_group(group, environment):
    def members():
        output = subprocess.check_output(['/bin/ps', '-axo', 'pid=,pgid=,uid='],
                                         env=environment, text=True, timeout=5)
        return [line.split() for line in output.splitlines()
                if len(line.split()) == 3 and line.split()[1] == str(group)]
    remaining = members()
    if not remaining:
        return False
    # The group was created by this invocation; never signal another UID or a host user broadly.
    if any(int(row[2]) != os.geteuid() for row in remaining):
        fail('tool-ownership')
    for number in (signal.SIGTERM, signal.SIGKILL):
        if not members():
            return True
        os.killpg(group, number)
        deadline = time.monotonic() + 5
        while members() and time.monotonic() < deadline:
            time.sleep(0.05)
    if members():
        fail('tool-reap')
    return True


def run_fixed(arguments, cwd, seconds=120, output=False):
    """Only trusted host tools; own process group, empty env, network denied, bounded reap."""
    environment = {'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'HOME': str(cwd),
                   'TMPDIR': str(cwd) + '/', 'LANG': 'C', 'LC_ALL': 'C',
                   'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null',
                   'GIT_NO_REPLACE_OBJECTS': '1', 'COPYFILE_DISABLE': '1'}
    command = ['/usr/bin/sandbox-exec', '-p', PROFILE] + arguments
    # Use a disk-backed private file rather than accumulating unbounded diagnostics in memory.
    log = Path(cwd) / ('.tool-' + str(uuid.uuid4()))
    interrupted = False
    try:
        with log.open('xb') as handle:
            log.chmod(0o600)
            process = subprocess.Popen(command, cwd=cwd, env=environment, stdin=subprocess.DEVNULL,
                                       stdout=handle, stderr=subprocess.DEVNULL, close_fds=True,
                                       start_new_session=True)
            try:
                process.wait(timeout=seconds)
            except BaseException:
                interrupted = True
                if process.poll() is None:
                    os.killpg(process.pid, signal.SIGTERM)
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid, signal.SIGKILL)
                        process.wait(timeout=5)
            finally:
                descendants = finish_group(process.pid, environment)
        if interrupted:
            fail('tool-deadline')
        if descendants or process.returncode != 0:
            fail('tool-failed')
        return log.read_bytes() if output else b''
    finally:
        if log.exists():
            log.unlink()


def safe_member(name):
    path = PurePosixPath(name)
    if (not name or path.is_absolute() or '..' in path.parts or '\\' in name
            or str(path) != name.rstrip('/')
            or any(ord(c) < 32 or ord(c) == 127 for c in name)):
        fail('archive-path')
    return path


def audit_xcode(path):
    """Headers only; never extract vendor archive on the host or follow archive links."""
    seen = set()
    links = {}
    kinds = {}
    counts = {'regular': 0, 'directories': 0, 'symlinks': 0}
    with source_file(path, private=True) as raw, tarfile.open(fileobj=raw, mode='r|*') as archive:
        for member in archive:
            name = safe_member(member.name)
            if name.parts[0] != 'Xcode.app' or str(name) in seen:
                fail('archive-path')
            seen.add(str(name))
            if any(p in ('_MASReceipt', '.DS_Store', 'Accounts', 'Keychains', '.env')
                   or p.startswith(('._', '.env.')) or p.endswith(('.p8', '.p12', '.mobileprovision'))
                   for p in name.parts):
                fail('archive-private-metadata')
            if (member.mode & 0o7000 or member.islnk() or member.isdev() or member.isfifo() or member.issparse()
                    or any(k.startswith(('SCHILY.', 'LIBARCHIVE.', 'GNU.sparse.')) for k in member.pax_headers)):
                fail('archive-type')
            if member.issym():
                target = PurePosixPath(member.linkname)
                if (not member.linkname or target.is_absolute() or "\\" in member.linkname
                        or any(ord(c) < 32 or ord(c) == 127 for c in member.linkname)):
                    fail("archive-link")
                links[name.parts] = target.parts
                kinds[name.parts] = 'link'
                counts['symlinks'] += 1
            elif member.isfile():
                counts['regular'] += 1
                kinds[name.parts] = 'file'
            elif member.isdir():
                counts['directories'] += 1
                kinds[name.parts] = 'directory'
            else:
                fail('archive-type')
    # Resolve the complete archive graph, including links declared after their users.
    # Expansion must occur before subsequent '..', unlike lexical normalization.
    for key in links:
        pending = deque(key)
        resolved = []
        active = set()
        while pending:
            part = pending.popleft()
            if isinstance(part, tuple):
                active.remove(part)
                continue
            if part == '..':
                if len(resolved) <= 1:
                    fail('archive-link')
                resolved.pop()
            elif part != '.':
                resolved.append(part)
                current = tuple(resolved)
                if current in links:
                    if current in active:
                        fail('archive-link-cycle')
                    active.add(current)
                    resolved.pop()
                    pending.appendleft(current)  # End-of-expansion marker.
                    pending.extendleft(reversed(links[current]))
        if not resolved or resolved[0] != 'Xcode.app':
            fail('archive-link')
    # A tar entry cannot write beneath an archive symlink/non-directory, regardless
    # of declaration order. Normal vendor framework aliases have no children.
    for key in kinds:
        for count in range(1, len(key)):
            if kinds.get(key[:count], 'directory') != 'directory':
                fail('archive-parent')
    if not {'Xcode.app/Contents/Info.plist', 'Xcode.app/Contents/_CodeSignature/CodeResources'} <= seen:
        fail('archive-layout')
    return counts


def audit_xcodegen(data):
    """Thin arm64 Mach-O; all dylibs/rpaths must resolve to guest OS vendor locations."""
    if len(data) < 32:
        fail('binary')
    magic, cpu, _, filetype, count, command_bytes, _, _ = struct.unpack_from('<8I', data)
    if (magic != 0xfeedfacf or cpu != 0x0100000c or filetype != 2
            or command_bytes > len(data) - 32 or count > command_bytes // 8):
        fail('binary')
    offset = 32
    libraries = []
    runpaths = 0
    minimum_os = None
    for _ in range(count):
        if offset + 8 > 32 + command_bytes:
            fail('binary')
        cmd, size = struct.unpack_from('<II', data, offset)
        if size < 8 or size % 8 or offset + size > 32 + command_bytes:
            fail('binary')
        if cmd in (0xc, 0x80000018, 0x8000001f, 0x20, 0x80000023, 0x8000001c, 0xe):
            if size < 12:
                fail('binary')
            start = struct.unpack_from('<I', data, offset + 8)[0]
            minimum_header = 12 if cmd in (0x8000001c, 0xe) else 24
            if size < minimum_header or start < minimum_header or start >= size:
                fail('binary')
            raw = data[offset + start:offset + size]
            if b'\0' not in raw:
                fail('binary')
            value = raw.split(b'\0', 1)[0].decode('utf-8', errors='strict')
            if cmd == 0x8000001c:
                # Search paths are inert: no direct load may use @rpath/@loader_path.
                # Preserve vendor bytes; do not rewrite unused build-machine runpaths.
                runpaths += 1
            else:
                if '..' in PurePosixPath(value).parts or not value.startswith(('/usr/lib/', '/System/Library/')):
                    fail('binary-dependency')
                libraries.append(value)
        elif cmd in (0x6, 0x9, 0x10, 0x27):  # Legacy external loads / LC_DYLD_ENVIRONMENT
            fail('binary-environment')
        elif cmd == 0x32:
            if size < 24 or struct.unpack_from('<I', data, offset + 8)[0] != 1:
                fail('binary-platform')
            minimum_os = struct.unpack_from('<I', data, offset + 12)[0]
        elif cmd == 0x24:  # LC_VERSION_MIN_MACOSX
            if size < 16:
                fail('binary-platform')
            minimum_os = struct.unpack_from('<I', data, offset + 8)[0]
        offset += size
    if offset != 32 + command_bytes or minimum_os is None or not libraries:
        fail('binary')
    return {'architecture': 'arm64', 'dependencies': libraries,
            'unusedRunpathCount': runpaths, 'allDirectDependenciesUseSystemPaths': True,
            'minimumMacOS': '%d.%d.%d' % (minimum_os >> 16, (minimum_os >> 8) & 255, minimum_os & 255),
            'guestExecutionVerified': False}


def export_source(repository, commit, directory, runner=run_fixed):
    if not re.fullmatch('[a-f0-9]{40}', commit):
        fail('source-commit')
    checked_path(repository, directory=True)
    base = ['/usr/bin/git', '--no-optional-locks', '-c', 'core.fsmonitor=false',
            '-c', 'core.hooksPath=/dev/null', '-C', str(repository)]
    if runner(base + ['cat-file', '-t', commit], directory, output=True).strip() != b'commit':
        fail('source-commit')
    tree = runner(base + ['rev-parse', commit + '^{tree}'], directory, output=True).decode().strip()
    if not re.fullmatch('[a-f0-9]{40}', tree):
        fail('source-tree')
    listing = runner(base + ['ls-tree', '-rz', commit, '--', *PREFIXES], directory, output=True)
    members = []
    with tarfile.open(directory / 'source.tar', 'x', format=tarfile.PAX_FORMAT) as archive:
        os.chmod(directory / 'source.tar', 0o600)
        for entry in listing.split(b'\0'):
            if not entry:
                continue
            header, raw_name = entry.split(b'\t', 1)
            mode, kind, oid = header.decode().split()
            name = raw_name.decode('utf-8', errors='strict')
            safe_member(name)
            if (mode not in ('100644', '100755') or kind != 'blob' or not name.startswith(PREFIXES)
                    or any(p == '.env' or (p.startswith('.env.') and name != 'iOS/.env.example') or p in ('Keychains', 'Accounts')
                           or p.endswith(('.p8', '.p12', '.mobileprovision')) for p in PurePosixPath(name).parts)):
                fail('source-member')
            data = runner(base + ['cat-file', 'blob', oid], directory, output=True)
            member = tarfile.TarInfo('source/' + name)
            member.size = len(data)
            member.mode = 0o755 if mode == '100755' else 0o644
            member.uid = member.gid = member.mtime = 0
            member.uname = member.gname = ''
            archive.addfile(member, io.BytesIO(data))
            members.append({'path': name, 'gitObject': oid, 'sha256': digest(data), 'mode': mode})
    names = {m['path'] for m in members}
    if not {'apple/Passwords/Package.swift', 'apple/FileSync/Package.swift', 'iOS/project.yml',
            'macos/ThingtimePasswords/project.yml'} <= names:
        fail('source-closure')
    result = {'sourceCommit': commit, 'sourceTree': tree, 'prefixes': list(PREFIXES), 'files': members}
    write_new(directory / 'source-manifest.json', json_bytes(result))
    return result


def file_record(path):
    with source_file(path, private=True) as handle:
        h = hashlib.sha256()
        while chunk := handle.read(1024 * 1024):
            h.update(chunk)
        return {'file': Path(path).name, 'bytes': handle.tell(), 'sha256': h.hexdigest()}


def stage(parent, task, repository, commit, xcode, xcode_sha, xcodegen, xcodegen_sha,
          labels, runner=run_fixed):
    parent = checked_path(parent, directory=True, private=True)
    try:
        task = str(uuid.UUID(task))
    except ValueError:
        fail('task')
    if set(labels) != {'xcode', 'xcodeBuild', 'macOSSDK', 'simulatorSDK', 'xcodegen'} or any(
            not re.fullmatch('[A-Za-z0-9][A-Za-z0-9.]*', v) for v in labels.values()):
        fail('toolchain-label')
    task_root = parent / task
    try:
        task_root.mkdir(mode=0o700)
    except FileExistsError:
        checked_path(task_root, directory=True, private=True)
    build_id = str(uuid.uuid4())
    build = task_root / build_id
    build.mkdir(mode=0o700)
    media = build / 'payload'
    media.mkdir(mode=0o700)
    # Failures remain confined to this new unique build. Never overwrite an installed VM input.
    copy_bound(xcode, media / 'Xcode.tar.gz', xcode_sha, private=True)
    audit = audit_xcode(media / 'Xcode.tar.gz')
    copy_bound(xcodegen, media / 'xcodegen', xcodegen_sha, executable=True)
    binary = audit_xcodegen((media / 'xcodegen').read_bytes())
    source = export_source(repository, commit, media, runner)
    recipe = Path(__file__).with_name('guest-build.sh')
    with source_file(recipe) as original:
        write_new(media / 'guest-build.sh', original.read(), 0o700)
    files = {k: file_record(media / n) for k, n in {
        'sourceArchive': 'source.tar', 'sourceManifest': 'source-manifest.json',
        'xcodeArchive': 'Xcode.tar.gz', 'xcodegen': 'xcodegen', 'recipe': 'guest-build.sh'}.items()}
    manifest = {'contractVersion': '1.0.0', 'taskID': task, 'buildID': build_id,
                'sourceCommit': commit, 'sourceTree': source['sourceTree'], 'toolchain': labels,
                'files': files, 'guestToolchainVerified': False, 'candidateAdmission': False}
    write_new(media / 'build-manifest.json', json_bytes(manifest))
    image = build / 'build-input.iso'
    runner(['/usr/bin/hdiutil', 'makehybrid', '-udf', '-udf-volume-name', 'TTNativeBuild',
            '-o', str(image), str(media)], build, seconds=1800)
    image.chmod(0o600)
    record = file_record(image)
    if record['bytes'] <= 0 or record['bytes'] % 512:
        fail('image-format')
    if any(file_record(media / v['file']) != v for v in files.values()):
        fail('integrity')
    receipt = {'contractVersion': '1.0.0', 'taskID': task, 'buildID': build_id,
               'sourceCommit': commit, 'sourceTree': source['sourceTree'], 'sourceMembers': len(source['files']),
               'input': record, 'format': 'RAW-UDF', 'files': files, 'toolchain': labels,
               'archiveAudit': audit, 'xcodegenAudit': binary,
               'hostMounted': False, 'guestStarted': False, 'guestToolchainVerified': False,
               'candidateAdmission': False, 'guestBuildExecuted': False}
    write_new(build / 'media.json', json_bytes(receipt))
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--parent', required=True, type=Path)
    parser.add_argument('--task-id', required=True)
    parser.add_argument('--repository', required=True, type=Path)
    parser.add_argument('--source-commit', required=True)
    parser.add_argument('--xcode-archive', required=True, type=Path)
    parser.add_argument('--xcode-sha256', required=True)
    parser.add_argument('--xcodegen', required=True, type=Path)
    parser.add_argument('--xcodegen-sha256', required=True)
    for label in ('xcode-version', 'xcode-build', 'macos-sdk', 'simulator-sdk', 'xcodegen-version'):
        parser.add_argument('--' + label, required=True)
    a = parser.parse_args()
    labels = dict(zip(('xcode', 'xcodeBuild', 'macOSSDK', 'simulatorSDK', 'xcodegen'),
                      (a.xcode_version, a.xcode_build, a.macos_sdk, a.simulator_sdk, a.xcodegen_version)))
    receipt = stage(a.parent, a.task_id, a.repository, a.source_commit, a.xcode_archive,
                    a.xcode_sha256, a.xcodegen, a.xcodegen_sha256, labels)
    print(json.dumps(receipt, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except (Exception, KeyboardInterrupt) as error:
        print(json.dumps({'error': str(error) if isinstance(error, MediaError) else 'media-validation',
                          'candidateAdmission': False, 'guestStarted': False}), file=sys.stderr)
        sys.exit(1)
