# Dedicated Mongo connection canary

- Branch: `codex/gateway-dedicated-canary`
- Worktree: `/Users/lopu/.codex/worktrees/gateway-dedicated-acceptance/thingtime`
- Starting head: `69fb4bd5ea9e32fa33a2ca6dc4ae58d38bef4340` (reviewed PR #1223 continuation base)
- This temporary acceptance branch is based on `codex/gateway-dedicated-connections` and must not be merged into `main`.
- The build-bundled connection policy is `dedicated`; the explicit runtime override remains available. Dedicated mode uses the deployment's configured MongoDB environment and does not provide database isolation.
- Parent task performs live acceptance and closes this canary after verification.
