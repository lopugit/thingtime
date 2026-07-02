module.exports = {
  apps: [
    {
      script: 'npm run dev',
      cwd: __dirname,
      name: 'tt-nitro-react-router-9999',
      namespace: 'thingtime',
      watch: ['ecosystem.config.js']
    },
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
