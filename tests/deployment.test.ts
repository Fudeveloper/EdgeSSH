import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  deploymentSettings,
  ensureDatabase,
  renderWranglerConfig,
} from '../scripts/prepare-deployment.mjs';
import { deploymentSecrets } from '../scripts/sync-worker-secrets.mjs';

const encryptionKey = Buffer.alloc(32, 7).toString('base64');

const settings = deploymentSettings({
  CLOUDFLARE_ACCOUNT_ID: 'account-id',
  CLOUDFLARE_API_TOKEN: 'api-token',
  WORKER_NAME: 'my-edgessh',
  D1_DATABASE_NAME: 'my-edgessh-accounts',
  CUSTOM_DOMAIN: 'ssh.example.com',
});

function cloudflareResponse(result: unknown, status = 200): Response {
  return Response.json({ success: status < 400, result, errors: [] }, { status });
}

test('deployment settings use stable defaults and optional workers.dev deployment', () => {
  assert.deepEqual(
    deploymentSettings({ CLOUDFLARE_ACCOUNT_ID: 'account-id', CLOUDFLARE_API_TOKEN: 'api-token' }),
    {
      accountId: 'account-id',
      apiToken: 'api-token',
      workerName: 'edgessh',
      databaseName: 'edgessh-accounts',
      customDomain: '',
    },
  );
});

test('deployment secrets are read from the Actions environment', () => {
  assert.deepEqual(
    deploymentSecrets({
      ACCESS_TEAM_DOMAIN: ' team.cloudflareaccess.com ',
      ACCESS_AUD: ' access-audience ',
      ENCRYPTION_KEY: ` ${encryptionKey} `,
    }),
    {
      ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
      ACCESS_AUD: 'access-audience',
      ENCRYPTION_KEY: encryptionKey,
    },
  );
  assert.throws(() => deploymentSecrets({}), /缺少 ACCESS_TEAM_DOMAIN/);
  assert.throws(() => deploymentSecrets({
    ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com',
    ACCESS_AUD: 'access-audience',
    ENCRYPTION_KEY: encryptionKey,
  }), /ACCESS_TEAM_DOMAIN 必须/);
  assert.throws(() => deploymentSecrets({
    ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
    ACCESS_AUD: 'access-audience',
    ENCRYPTION_KEY: 'not-a-32-byte-key',
  }), /ENCRYPTION_KEY 必须/);
});

test('existing D1 database is reused without a create request', async () => {
  const requests: Array<{ url: string; method: string }> = [];
  const result = await ensureDatabase(settings, async (input, init) => {
    requests.push({ url: String(input), method: init?.method || 'GET' });
    return cloudflareResponse([{ name: settings.databaseName, uuid: 'existing-database-id' }]);
  });

  assert.deepEqual(result, { id: 'existing-database-id', created: false });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'GET');
});

test('missing D1 database is created once', async () => {
  const methods: string[] = [];
  const result = await ensureDatabase(settings, async (_input, init) => {
    const method = init?.method || 'GET';
    methods.push(method);
    return method === 'POST'
      ? cloudflareResponse({ name: settings.databaseName, uuid: 'new-database-id' })
      : cloudflareResponse([]);
  });

  assert.deepEqual(result, { id: 'new-database-id', created: true });
  assert.deepEqual(methods, ['GET', 'POST']);
});

test('generated Wrangler config contains resolved resources and custom domain', async () => {
  const baseConfig = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');
  const config = renderWranglerConfig(baseConfig, settings, 'resolved-database-id');

  assert.match(config, /^name = "my-edgessh"$/m);
  assert.match(config, /^database_name = "my-edgessh-accounts"$/m);
  assert.match(config, /^database_id = "resolved-database-id"$/m);
  assert.match(config, /pattern = "ssh\.example\.com", custom_domain = true/);
});

test('public Wrangler config never contains maintainer resources', async () => {
  const baseConfig = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');

  assert.match(baseConfig, /^database_id = "00000000-0000-0000-0000-000000000000"$/m);
  assert.doesNotMatch(baseConfig, /^routes\s*=|custom_domain\s*=|ssh\.dltwcnm\.ccwu\.cc/m);
});
