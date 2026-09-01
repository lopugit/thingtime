import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import { resolveTrustedOrigin } from './appOrigin.ts';

const ENV_KEYS = [
  'APP_URL',
  'VERCEL_URL',
  'VERCEL_BRANCH_URL',
  'VERCEL_PROJECT_PRODUCTION_URL',
  'VERCEL_ENV',
  'VERCEL_TARGET_ENV'
] as const;

// Each case runs against a clean slice of the env so ordering between tests
// can never make a spoof look blocked when it is not.
const withEnv = <T>(env: Partial<Record<(typeof ENV_KEYS)[number], string>>, run: () => T): T => {
  const saved = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
  try {
    return run();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

const origin = (url: string) => resolveTrustedOrigin(new Request(url, { method: 'POST' }));

test('APP_URL wins over everything and loses its trailing slashes', () => {
  withEnv({ APP_URL: 'https://thingtime.com//', VERCEL_URL: 'dep.vercel.app' }, () => {
    assert.equal(origin('https://attacker.example/api/v1/auth/password-reset'), 'https://thingtime.com');
  });
});

test('a spoofed Host can never steer an emailed link', () => {
  withEnv({}, () => {
    // No APP_URL, not on Vercel: an unknown Host falls back to canonical.
    assert.equal(origin('https://attacker.example/x'), 'https://thingtime.com');
    // Suffix/prefix lookalikes must not slip past the thingtime.com pattern.
    assert.equal(origin('https://notthingtime.com/x'), 'https://thingtime.com');
    assert.equal(origin('https://thingtime.com.attacker.example/x'), 'https://thingtime.com');
    assert.equal(origin('https://thingtimeXcom/x'), 'https://thingtime.com');
  });
});

test('the multi-tenant vercel.app namespace is NOT trusted from the Host header', () => {
  // Anyone can deploy attacker-xyz.vercel.app, so a Host in that namespace must
  // not produce an emailed token link — even though our own previews live there.
  withEnv({}, () => {
    assert.equal(origin('https://attacker-xyz.vercel.app/x'), 'https://thingtime.com');
    assert.equal(origin('https://thingtime-git-develop.vercel.app/x'), 'https://thingtime.com');
  });
});

test('on Vercel the platform names the deployment and the Host is ignored entirely', () => {
  withEnv({ VERCEL_ENV: 'preview', VERCEL_BRANCH_URL: 'tt-git-develop.vercel.app', VERCEL_URL: 'tt-abc123.vercel.app' }, () => {
    // Branch URL is preferred: it survives the next push to the same branch.
    assert.equal(origin('https://attacker.example/x'), 'https://tt-git-develop.vercel.app');
  });

  withEnv({ VERCEL_ENV: 'preview', VERCEL_URL: 'tt-abc123.vercel.app' }, () => {
    assert.equal(origin('https://attacker.example/x'), 'https://tt-abc123.vercel.app');
  });

  withEnv(
    {
      VERCEL_ENV: 'production',
      VERCEL_PROJECT_PRODUCTION_URL: 'thingtime.com',
      VERCEL_BRANCH_URL: 'tt-git-main.vercel.app',
      VERCEL_URL: 'tt-abc123.vercel.app'
    },
    () => {
      assert.equal(origin('https://attacker.example/x'), 'https://thingtime.com');
    }
  );

  // VERCEL_TARGET_ENV is the newer signal and must be honoured like VERCEL_ENV.
  withEnv(
    { VERCEL_TARGET_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'thingtime.com', VERCEL_URL: 'tt-abc123.vercel.app' },
    () => {
      assert.equal(origin('https://attacker.example/x'), 'https://thingtime.com');
    }
  );
});

test('platform hostnames are accepted with or without a scheme prefix', () => {
  withEnv({ VERCEL_ENV: 'preview', VERCEL_BRANCH_URL: 'https://tt-git-develop.vercel.app/' }, () => {
    assert.equal(origin('https://attacker.example/x'), 'https://tt-git-develop.vercel.app');
  });
});

test('local dev and our own domain still resolve to the requested origin', () => {
  withEnv({}, () => {
    assert.equal(origin('http://localhost:9999/x'), 'http://localhost:9999');
    assert.equal(origin('http://127.0.0.1:10000/x'), 'http://127.0.0.1:10000');
    assert.equal(origin('http://[::1]:9999/x'), 'http://[::1]:9999');
    assert.equal(origin('https://thingtime.com/x'), 'https://thingtime.com');
    assert.equal(origin('https://www.thingtime.com/x'), 'https://www.thingtime.com');
    assert.equal(origin('https://laptop.tailnet.ts.net/x'), 'https://laptop.tailnet.ts.net');
  });
});
