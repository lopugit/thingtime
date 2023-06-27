module.exports = {
  apps: [
    {
      script: 'npm run remix',
      name: 'tt',
      namespace: 'thingtime'
    }
    // {
    // 	script: 'npm run api',
    // 	name: 'tt-api',
    //   namespace: "thingtime",
    // 	watch: ['node', 'node/*/node_modules', 'node/**/node_modules', 'node/node_modules'],
    // 	ignore_watch: [],
    // },
  ]
}
