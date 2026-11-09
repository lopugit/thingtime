#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "${SCRIPT_DIR}/../../.." && pwd)"
cargo test --locked --manifest-path "${REPO_ROOT}/filesystem-indexer/Cargo.toml"
cargo build --locked --manifest-path "${REPO_ROOT}/filesystem-indexer/Cargo.toml" -p commander-indexer
export THINGTIME_TEST_COMMANDER_INDEXER="${REPO_ROOT}/filesystem-indexer/target/debug/commander-indexer"
swift test --package-path "${REPO_ROOT}/apple/FileSync" --filter 'CommanderBackupCaptureTests|MobileFolderInventoryTests|PhotoLibraryTests'
swift test --package-path "${REPO_ROOT}/macos/ThingtimeNode" --filter 'MacFolderSyncTests|MacPhotosSyncTests|RemoteFilesystemTests'
