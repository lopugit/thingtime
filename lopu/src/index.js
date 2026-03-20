console.log("Hi, I'm Lopu!");
// when running on mac you'll get this with this:
// Error: darwin on arm64 not supported
// const speedTest = require('speedtest-net');

async function main() {
  // Your main logic here
  console.log('Lopu: Running main...');
}

async function getInternetSpeed() {
  // Simulate fetching internet speed
  // use the top used npm package for this
  const test = await speedTest({ acceptLicense: true });
  console.log(`Lopu: Internet speed is ${test.download.bandwidth / 125000} Mbps down and ${test.upload.bandwidth / 125000} Mbps up`);

  return test;
}

main();

getInternetSpeed();
