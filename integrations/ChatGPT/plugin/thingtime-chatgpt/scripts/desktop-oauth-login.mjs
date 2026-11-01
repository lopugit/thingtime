import { spawn } from 'node:child_process';

const origin = process.env.THINGTIME_ORIGIN || 'https://thingtime.com';
const authorizePattern = new RegExp(`${origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/api/v1/integrations/chatgpt/oauth/authorize\\?[^\\s]+`);

const openInChrome = (url) => {
  const child = process.platform === 'darwin'
    ? spawn('open', ['-a', 'Google Chrome', url], { stdio: 'ignore' })
    : spawn('open', [url], { stdio: 'ignore' });
  child.once('error', () => {
    // Codex still prints the browser URL if the host cannot open it.
    process.stderr.write('Thingtime could not open a browser automatically. Run `codex mcp login thingtime` to receive a fresh login URL.\n');
  });
};

const login = spawn('codex', ['mcp', 'login', 'thingtime'], { stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
let opened = false;

const observe = (chunk) => {
  output += chunk.toString();
  if (opened) return;
  const match = output.match(authorizePattern);
  if (!match) return;
  opened = true;
  openInChrome(match[0]);
  process.stdout.write('Thingtime sign-in opened in Google Chrome. Complete it there; Codex will receive the callback automatically.\n');
};

login.stdout.on('data', observe);
login.stderr.on('data', observe);
login.once('error', () => process.exit(1));
login.once('exit', (code) => {
  if (!opened) process.stderr.write('Thingtime login ended before a browser handoff was created. Try again.\n');
  process.exit(code ?? 1);
});

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => login.kill(signal));
