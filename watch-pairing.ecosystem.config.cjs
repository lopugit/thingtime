// Independent Watch pairing web fixture: do not restart another worktree whose
// leaf directory also happens to be named "thingtime".
const path = require('node:path');
const { pm2AppConfig } = require('./remix/scripts/worktree-ports.cjs');
const app = pm2AppConfig(path.join(__dirname, 'remix'));
module.exports = {
  apps: [{
    ...app,
    name: 'tt-watch-pairing-18290',
    autorestart: false,
    env: { ...app.env, TT_WEB_PORT: '18290', TT_HMR_PORT: '18291', TT_API_PORT: '18292' }
  }]
};
