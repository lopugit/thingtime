#!/usr/bin/env python3
"""Package/validate reviewed CLI bytes. Never execute, sign, register or launch them."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import pwd
import re
import stat
import sys
import uuid

APP_NAME = "Thingtime Offline VM.app"
EXECUTABLE = "offline-native-vm"


class PackageError(Exception):
    pass


def private_directory(path):
    path = Path(path)
    if not path.is_absolute() or ".." in path.parts:
        raise PackageError("path")
    for current in [*reversed(path.parents), path]:
        info = current.lstat()
        if not stat.S_ISDIR(info.st_mode):
            raise PackageError("path")
    info = path.lstat()
    if info.st_uid != os.geteuid() or info.st_mode & 0o077:
        raise PackageError("ownership")


def read_file(path, executable=False):
    path = Path(path)
    if not path.is_absolute() or ".." in path.parts:
        raise PackageError("path")
    for parent in path.parents:
        if not stat.S_ISDIR(parent.lstat().st_mode):
            raise PackageError("path")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
    try:
        before = os.fstat(fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != os.geteuid()
                or before.st_nlink != 1 or before.st_mode & 0o022
                or (executable and not before.st_mode & 0o100)):
            raise PackageError("ownership")
        data = bytearray()
        while True:
            chunk = os.read(fd, 1024 * 1024)
            if not chunk:
                break
            data.extend(chunk)
        after = os.fstat(fd)
        named = path.lstat()
        fields = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns", "st_nlink", "st_mode", "st_uid")
        if any(getattr(before, key) != getattr(after, key) or getattr(before, key) != getattr(named, key) for key in fields):
            raise PackageError("integrity")
        return bytes(data)
    finally:
        os.close(fd)


def task_identifier(value):
    try:
        return str(uuid.UUID(value))
    except (ValueError, AttributeError):
        raise PackageError("task") from None


def info_plist(task_id):
    task_id = task_identifier(task_id)
    return {"CFBundleDevelopmentRegion": "en", "CFBundleExecutable": EXECUTABLE,
            "CFBundleIdentifier": "com.thingtime.offline-native-vm.task." + task_id.replace("-", ""),
            "CFBundleInfoDictionaryVersion": "6.0", "CFBundleName": "Thingtime Offline VM",
            "CFBundleDisplayName": "Offline VM " + task_id,
            "CFBundlePackageType": "APPL", "CFBundleShortVersionString": "1.0.0",
            "CFBundleVersion": "1", "LSMinimumSystemVersion": "13.0", "NSHighResolutionCapable": True}


def checked_binary(path, expected):
    if not re.fullmatch("[0-9a-f]{64}", expected):
        raise PackageError("digest")
    data = read_file(path, executable=True)
    # Native 64-bit Mach-O only, never a shell or other launcher script.
    if data[:4] != bytes.fromhex("cffaedfe") or hashlib.sha256(data).hexdigest() != expected:
        raise PackageError("digest")
    return data


def write_exclusive(path, data, mode=0o600):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, mode)
    try:
        with os.fdopen(fd, "wb", closefd=False) as file:
            file.write(data)
            file.flush()
            os.fsync(file.fileno())
    finally:
        os.close(fd)


def stage_at(cache, binary, expected, task_id):
    """Internal explicit root enables inert fixture tests; CLI supplies only fixed OS cache."""
    task_id = task_identifier(task_id)
    cache = Path(cache)
    private_directory(cache)
    data = checked_binary(binary, expected)
    task = cache / task_id
    try:
        task.mkdir(mode=0o700)
    except FileExistsError:
        private_directory(task)
    # Stable identity per task, unique private staging directory per immutable build.
    stage = task / str(uuid.uuid4())
    stage.mkdir(mode=0o700)
    app = stage / APP_NAME
    app.mkdir(mode=0o700)
    contents = app / "Contents"
    contents.mkdir(mode=0o700)
    (contents / "MacOS").mkdir(mode=0o700)
    write_exclusive(contents / "MacOS" / EXECUTABLE, data, 0o700)
    write_exclusive(contents / "Info.plist", plistlib.dumps(info_plist(task_id), sort_keys=True))
    write_exclusive(contents / "PkgInfo", b"APPL????")
    receipt = validate_at(cache, app, expected, task_id)
    write_exclusive(stage / "package.json", json.dumps(receipt, indent=2, sort_keys=True).encode() + b"\n")
    return receipt


def validate_at(cache, app, expected, task_id):
    cache, app = Path(cache), Path(app)
    private_directory(cache)
    task_id = task_identifier(task_id)
    # Exact staged depth/name and UUID-owned build directory, never ~/Applications/Thingtime.app.
    if (app.name != APP_NAME or app.parent.parent != cache / task_id
            or task_identifier(app.parent.name) != app.parent.name):
        raise PackageError("path")
    for directory in [app.parent.parent, app.parent, app, app / "Contents", app / "Contents/MacOS"]:
        private_directory(directory)
    allowed = {"Contents", "Contents/MacOS", "Contents/MacOS/" + EXECUTABLE,
               "Contents/Info.plist", "Contents/PkgInfo", "Contents/_CodeSignature", "Contents/_CodeSignature/CodeResources"}
    for root, directories, files in os.walk(app, followlinks=False):
        for name in directories + files:
            path = Path(root) / name
            if path.relative_to(app).as_posix() not in allowed or path.is_symlink():
                raise PackageError("layout")
            if path.is_dir():
                if path.relative_to(app).as_posix() == "Contents/_CodeSignature":
                    # codesign may create a public-readable directory inside our private app.
                    info = path.lstat()
                    if info.st_uid != os.geteuid() or info.st_mode & 0o022:
                        raise PackageError("ownership")
                else:
                    private_directory(path)
            else:
                read_file(path)
    if plistlib.loads(read_file(app / "Contents/Info.plist")) != info_plist(task_id):
        raise PackageError("plist")
    if read_file(app / "Contents/PkgInfo") != b"APPL????":
        raise PackageError("layout")
    checked_binary(app / "Contents/MacOS" / EXECUTABLE, expected)
    return {"contractVersion": "1.0.0", "operation": "package-viewer-only", "taskID": task_id,
            "bundle": str(app), "bundleIdentifier": info_plist(task_id)["CFBundleIdentifier"],
            "executableSHA256": expected, "launchPerformed": False, "vmStarted": False,
            "signatureVerified": False, "readiness": False, "candidateAdmission": False}


def cache_root():
    # Do not import HOME, preferences, profiles or environment into the app.
    home = Path(pwd.getpwuid(os.geteuid()).pw_dir)
    base = home / "Library/Caches/com.thingtime.offline-native-vm"
    private_directory(base)
    cache = base / "app-staging"
    try:
        cache.mkdir(mode=0o700)
    except FileExistsError:
        pass
    private_directory(cache)
    return cache


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=["stage", "validate"])
    parser.add_argument("--task-id", required=True)
    parser.add_argument("--binary-sha256", required=True)
    parser.add_argument("--binary", type=Path)
    parser.add_argument("--bundle", type=Path)
    args = parser.parse_args()
    if args.operation == "stage" and args.binary and not args.bundle:
        receipt = stage_at(cache_root(), args.binary, args.binary_sha256, args.task_id)
    elif args.operation == "validate" and args.bundle and not args.binary:
        receipt = validate_at(cache_root(), args.bundle, args.binary_sha256, args.task_id)
    else:
        raise PackageError("arguments")
    print(json.dumps(receipt, indent=2, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (PackageError, OSError, ValueError, plistlib.InvalidFileException) as error:
        # Fixed diagnostics, never arbitrary file data/error messages/paths.
        print(json.dumps({"operation": "package-viewer-only", "error": str(error) if isinstance(error, PackageError) else "validation", "launchPerformed": False}))
        sys.exit(1)
