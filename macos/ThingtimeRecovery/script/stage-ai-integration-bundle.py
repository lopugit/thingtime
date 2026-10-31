#!/usr/bin/env python3
"""Package the canonical Thingtime integration as data in Recovery's signature."""
import hashlib
import json
from pathlib import Path
import shutil
import sys

source = Path(__file__).resolve().parents[3] / "integrations/ChatGPT/plugin/thingtime-chatgpt"
destination = Path(sys.argv[1])
if destination.exists():
    raise SystemExit("Integration staging destination must be new")
destination.mkdir(parents=True)
files = [source / ".codex-plugin/plugin.json", source / ".mcp.json"]
files.extend(p for p in (source / "skills/thingtime").rglob("*") if p.is_file())
hashes = {}
for item in sorted(files):
    if item.is_symlink() or any(p.is_symlink() for p in item.parents if p != source.parent):
        raise SystemExit("Integration source contains a symbolic link")
    relative = item.relative_to(source)
    target = destination / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(item, target)
    target.chmod(0o644)
    hashes[str(relative)] = hashlib.sha256(target.read_bytes()).hexdigest()
version = json.loads((destination / ".codex-plugin/plugin.json").read_text())["version"]
(destination / "bundle-manifest.json").write_text(json.dumps({"version": version, "sha256": hashes}, indent=2) + "\n")
