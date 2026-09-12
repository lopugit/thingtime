#!/usr/bin/env python3
"""Read the canonical XcodeGen marketing version as release SemVer."""
from pathlib import Path
import re

project = Path(__file__).resolve().parents[1] / "project.yml"
match = re.search(r'^    MARKETING_VERSION: "([0-9]+\.[0-9]+(?:\.[0-9]+)?)"$', project.read_text(), re.M)
if not match:
    raise SystemExit("Expected one numeric marketing version in the XcodeGen project")
version = match.group(1)
print(version if version.count('.') == 2 else version + '.0')
