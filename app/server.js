const https = require('https');
const httpProxy = require('http-proxy');
const ws = require('ws');
const fs = require('fs');
const port = 3001

console.log('running')

const options = {
  key: fs.readFileSync('localhost-key.pem'),
  cert: fs.readFileSync('localhost.pem')
};

const proxy = httpProxy.createProxyServer({
  target: 'http://0.0.0.0:3000'
});

const server = https.createServer(options, (req, res) => {
  proxy.web(req, res);
});

const wssProxy = new ws.Server({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  console.log(req.url)
  if (req.url.startsWith('/_next/webpack-hmr')) {
    wssProxy.handleUpgrade(req, socket, head, (ws) => {
      proxy.ws(req, ws, head);
    });
  } else {
    socket.destroy();
  }
});

server.listen(port)