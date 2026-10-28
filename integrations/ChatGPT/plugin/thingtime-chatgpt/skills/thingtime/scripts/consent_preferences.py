#!/usr/bin/env python3
"""Local, scoped Thingtime skill preferences. This cannot waive tool approvals."""

import argparse
import json
import os
import re
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit


ACTIONS = frozenset({"create", "update", "comment", "reaction", "save"})
TARGET = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}\Z")


def store_path():
    return Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex") / "thingtime" / "consent-preferences.json"


def origin(value):
    parsed = urlsplit(value)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
            or parsed.path or parsed.query or parsed.fragment or value != f"https://{parsed.netloc}"):
        raise ValueError("Origin must be an exact HTTPS origin without credentials, path, query, or fragment")
    return value


def nonempty(value, label):
    if not isinstance(value, str) or not value or value.strip() != value or any(ord(c) < 32 for c in value):
        raise ValueError(f"Invalid {label}")
    return value


def scope(actions, targets):
    if not actions or any(action not in ACTIONS for action in actions):
        raise ValueError("Actions must be explicit and limited to create, update, comment, reaction, save")
    if not targets or any(not isinstance(target, str) or not TARGET.fullmatch(target) for target in targets):
        raise ValueError("Targets must be explicit Thing IDs; wildcards are not allowed")
    if len(set(actions)) != len(actions) or len(set(targets)) != len(targets):
        raise ValueError("Duplicate actions or targets are not allowed")
    return actions, targets


def expiry(value):
    if value is None:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        raise ValueError("Expiry must be an ISO 8601 timestamp") from None
    if parsed.tzinfo is None or parsed <= datetime.now(timezone.utc):
        raise ValueError("Expiry must be timezone-aware and in the future")
    return value


def validate(data):
    if not isinstance(data, dict) or set(data) != {"version", "grants"} or data["version"] != 1 or not isinstance(data["grants"], list):
        raise ValueError("Malformed or unsupported consent store")
    ids = set()
    for grant in data["grants"]:
        if not isinstance(grant, dict) or set(grant) != {"id", "origin", "account", "actions", "targets", "expiresAt"}:
            raise ValueError("Malformed consent grant")
        uuid.UUID(nonempty(grant["id"], "grant ID"))
        if grant["id"] in ids:
            raise ValueError("Duplicate consent grant ID")
        ids.add(grant["id"])
        origin(grant["origin"])
        nonempty(grant["account"], "account")
        if not isinstance(grant["actions"], list) or not isinstance(grant["targets"], list):
            raise ValueError("Malformed grant scope")
        scope(grant["actions"], grant["targets"])
        if grant["expiresAt"] is not None:
            try:
                until = datetime.fromisoformat(grant["expiresAt"].replace("Z", "+00:00"))
            except (ValueError, AttributeError):
                raise ValueError("Malformed grant expiry") from None
            if until.tzinfo is None:
                raise ValueError("Grant expiry must be timezone-aware")
    return data


def read(path):
    if path.is_symlink():
        raise ValueError("Consent store must not be a symlink")
    try:
        with path.open("r", encoding="utf-8") as file:
            return validate(json.load(file))
    except FileNotFoundError:
        return {"version": 1, "grants": []}
    except (json.JSONDecodeError, UnicodeError) as error:
        raise ValueError("Malformed consent store") from error


def write(path, data):
    validate(data)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.parent.is_symlink() or path.is_symlink():
        raise ValueError("Consent path must not be a symlink")
    fd, temporary = tempfile.mkstemp(prefix=".consent-", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as file:
            json.dump(data, file, sort_keys=True, separators=(",", ":"))
            file.write("\n")
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary, path)
        os.chmod(path, 0o600)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def allowed(data, requested_origin, account, action, target, now=None):
    origin(requested_origin)
    nonempty(account, "account")
    if action not in ACTIONS or not TARGET.fullmatch(target or ""):
        return False
    current = now or datetime.now(timezone.utc)
    return any(grant["origin"] == requested_origin and grant["account"] == account
               and action in grant["actions"] and target in grant["targets"]
               and (grant["expiresAt"] is None or datetime.fromisoformat(grant["expiresAt"].replace("Z", "+00:00")) > current)
               for grant in data["grants"])


def run(argv=None, path=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    grant = commands.add_parser("grant", help="Save an explicit user-requested global preference")
    grant.add_argument("--user-consented", action="store_true", required=True)
    grant.add_argument("--origin", required=True)
    grant.add_argument("--account", required=True)
    grant.add_argument("--action", action="append", required=True)
    grant.add_argument("--target", action="append", required=True)
    grant.add_argument("--expires-at")
    revoke = commands.add_parser("revoke", help="Remove one grant by ID")
    revoke.add_argument("--id", required=True)
    check = commands.add_parser("check", help="Check one exact operation")
    check.add_argument("--origin", required=True)
    check.add_argument("--account", required=True)
    check.add_argument("--action", required=True)
    check.add_argument("--target", required=True)
    commands.add_parser("list", help="Read back saved grant scopes")
    args = parser.parse_args(argv)
    file = path or store_path()
    try:
        data = read(file)
        if args.command == "grant":
            origin(args.origin)
            nonempty(args.account, "account")
            scope(args.action, args.target)
            expiry(args.expires_at)
            data["grants"].append({"id": str(uuid.uuid4()), "origin": args.origin, "account": args.account,
                                   "actions": args.action, "targets": args.target, "expiresAt": args.expires_at})
            write(file, data)
            print(json.dumps(data["grants"][-1], sort_keys=True))
        elif args.command == "revoke":
            prior = len(data["grants"])
            data["grants"] = [item for item in data["grants"] if item["id"] != args.id]
            if len(data["grants"]) == prior:
                raise ValueError("Grant not found")
            write(file, data)
            print(json.dumps({"revoked": args.id}))
        elif args.command == "check":
            print(json.dumps({"allowed": allowed(data, args.origin, args.account, args.action, args.target)}))
        else:
            print(json.dumps(data, sort_keys=True))
        return 0
    except (ValueError, OSError) as error:
        print(f"Consent preference unavailable: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(run())
