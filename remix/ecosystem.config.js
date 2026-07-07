// Worktree-aware: in the main checkout this keeps the canonical
// tt-nitro-react-router-9999 app on 9999/10000; in a linked git worktree it
// derives a unique app name and port trio so worktree stacks can run beside
// the main one. The app name carries a clock-time suffix (e.g. -1005am) via
// the shared pm2AppConfig helper. See scripts/worktree-ports.cjs (TT_* env
// vars override). Prefer `npm run web-pms` over a raw `pm2 restart` here, so
// the previous timestamped app is cleaned up instead of duplicated.
const { pm2AppConfig } = require('./scripts/worktree-ports.cjs');

module.exports = {
  apps: [pm2AppConfig(__dirname)]
};
