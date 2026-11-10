#!/usr/bin/env python3

"""Safely extract an untrusted GitHub-built Vercel output archive."""

from __future__ import annotations

import argparse
import io
import json
import os
import posixpath
import shutil
import tarfile
import tempfile
from pathlib import Path, PurePosixPath

MAX_ARCHIVE_BYTES = 1_100_000_000
MAX_EXTRACTED_BYTES = 1_100_000_000
MAX_MEMBERS = 100_000
REQUIRED_PREFIX = (".vercel", "output")


def _member_path(name: str) -> PurePosixPath:
    if "\\" in name:
        raise ValueError("archive member used a backslash path")
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or path.parts[:2] != REQUIRED_PREFIX:
        raise ValueError("archive member escaped .vercel/output")
    return path


def _validate_link(member: tarfile.TarInfo, path: PurePosixPath) -> None:
    if "\\" in member.linkname or PurePosixPath(member.linkname).is_absolute():
        raise ValueError("archive link used an unsafe target")
    if member.issym():
        target = posixpath.normpath(posixpath.join(str(path.parent), member.linkname))
    else:
        target = posixpath.normpath(member.linkname)
    if PurePosixPath(target).parts[:2] != REQUIRED_PREFIX or ".." in PurePosixPath(target).parts:
        raise ValueError("archive link escaped .vercel/output")


def extract_archive(archive: Path, destination: Path) -> None:
    if not archive.is_file() or archive.stat().st_size > MAX_ARCHIVE_BYTES:
        raise ValueError("prebuilt archive is missing or too large")
    destination.mkdir(parents=True, exist_ok=True)
    destination_root = destination.resolve()

    with tarfile.open(archive, "r:gz") as bundle:
        members = bundle.getmembers()
        if not members or len(members) > MAX_MEMBERS:
            raise ValueError("prebuilt archive member count is invalid")
        declared_size = 0
        for member in members:
            path = _member_path(member.name)
            if member.ischr() or member.isblk() or member.isfifo() or member.isdev():
                raise ValueError("prebuilt archive contained a special device")
            if member.issym() or member.islnk():
                _validate_link(member, path)
            elif not (member.isfile() or member.isdir()):
                raise ValueError("prebuilt archive contained an unsupported member")
            declared_size += max(member.size, 0)
            if declared_size > MAX_EXTRACTED_BYTES:
                raise ValueError("prebuilt archive expands beyond the size limit")
        bundle.extractall(destination, members=members, filter="data")

    for root, directories, files in os.walk(destination, followlinks=False):
        for name in [*directories, *files]:
            candidate = Path(root, name)
            if candidate.is_symlink():
                resolved = candidate.resolve(strict=True)
                if not resolved.is_relative_to(destination_root):
                    raise ValueError("extracted symlink escaped the destination")

    config_path = destination / ".vercel/output/config.json"
    index_path = destination / ".vercel/output/static/index.html"
    if not config_path.is_file() or not index_path.is_file():
        raise ValueError("prebuilt archive is missing required Vercel output")
    config = json.loads(config_path.read_text(encoding="utf-8"))
    if not isinstance(config.get("routes"), list):
        raise ValueError("prebuilt config is missing routes")
    if '<div id="root"></div>' not in index_path.read_text(encoding="utf-8"):
        raise ValueError("prebuilt output is missing the Vite root shell")


def self_test() -> None:
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        valid = root / "valid.tgz"
        with tarfile.open(valid, "w:gz") as bundle:
            entries = {
                ".vercel/output/config.json": b'{"routes": []}\n',
                ".vercel/output/static/index.html": b'<div id="root"></div>\n',
                ".vercel/output/functions/__server.func/index.js": b"export default {}\n",
            }
            for name, content in entries.items():
                member = tarfile.TarInfo(name)
                member.size = len(content)
                bundle.addfile(member, io.BytesIO(content))
            link = tarfile.TarInfo(".vercel/output/functions/api.func")
            link.type = tarfile.SYMTYPE
            link.linkname = "./__server.func"
            bundle.addfile(link)
        destination = root / "valid-output"
        extract_archive(valid, destination)
        assert (destination / ".vercel/output/functions/api.func").resolve().is_relative_to(destination.resolve())

        malicious = root / "malicious.tgz"
        with tarfile.open(malicious, "w:gz") as bundle:
            member = tarfile.TarInfo("../escape")
            member.size = 1
            bundle.addfile(member, io.BytesIO(b"x"))
        try:
            extract_archive(malicious, root / "malicious-output")
        except ValueError:
            pass
        else:
            raise AssertionError("path traversal archive was accepted")
    print("Vercel prebuilt extractor self-test: passed")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("archive", nargs="?")
    parser.add_argument("destination", nargs="?")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    if not args.archive or not args.destination:
        parser.error("archive and destination are required")
    destination = Path(args.destination)
    if destination.exists():
        shutil.rmtree(destination)
    extract_archive(Path(args.archive), destination)
    print(f"Validated prebuilt output at {destination / '.vercel/output'}")


if __name__ == "__main__":
    main()
