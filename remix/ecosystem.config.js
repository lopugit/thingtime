// Worktree-aware: in the main checkout this keeps the canonical
// tt-nitro-react-router-9999 app on 9999/10000; in a linked git worktree it
// derives a unique app name and port trio so worktree stacks can run beside
// the main one. See scripts/worktree-ports.cjs (TT_* env vars override).
const { resolveDevContext } = require('./scripts/worktree-ports.cjs');

const devContext = resolveDevContext(__dirname);

module.exports = {
  apps: [
    {
      script: 'npm run dev',
      cwd: __dirname,
      name: devContext.pm2Name,
      namespace: 'thingtime',
      watch: ['ecosystem.config.js'],
      env: {
        TT_WEB_PORT: String(devContext.ports.web),
        TT_HMR_PORT: String(devContext.ports.hmr),
        TT_API_PORT: String(devContext.ports.api)
      }
    }
    // {
    //   script: 'npm run dev -- --port 1337',
    //   name: 'tt-remix-1337',
    //   namespace: 'thingtime',
    //   watch: ['ecosystem.config.js']
    // },
    // {
    //   script: 'npm run dev -- --port 1234',
    //   name: 'tt-remix-1234',
    //   namespace: 'thingtime',
    //   watch: ['ecosystem.config.js']
    // }

    // {
    // 	script: 'npm run api',
    // 	name: 'tt-api',
    //   namespace: "thingtime",
    // 	watch: ['node', 'node/*/node_modules', 'node/**/node_modules', 'node/node_modules'],
    // 	ignore_watch: [],
    // },
  ]
};
