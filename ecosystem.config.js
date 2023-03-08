module.exports = {
  apps: [
    {
      script: 'npm run app',
      name: "thingtime-app",
      namespace: "thingtime"
    },
    {
			script: 'npm run api',
			name: 'thingtime-api',
      namespace: "thingtime",
			watch: ['node', 'node/*/node_modules', 'node/**/node_modules', 'node/node_modules'],
			ignore_watch: [],
		},
  ],
};
