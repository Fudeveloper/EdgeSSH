import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { parse, stringify } from 'smol-toml';
import { CloudflareApi } from '../scripts/cloudflare-api.ts';
import { administratorAccountId } from '../scripts/administrator.ts';
import { prepareAuthentication, requiredAuthSecrets } from '../scripts/deployment-auth.ts';
import { createDeploymentConfig, readDeploymentSettings } from '../scripts/deployment-config.ts';

const template = parse(await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8'));
const environment = {
  CLOUDFLARE_API_TOKEN: 'cf-token', AUTH_PROVIDER: 'github',
  GITHUB_CLIENT_ID: 'test-client', GITHUB_CLIENT_SECRET: 'test-client-secret', GITHUB_ADMIN: 'admin',
};
const settings = readDeploymentSettings(template, environment);
const database = { uuid: 'test-db', name: settings.databaseName };
const json = (result: unknown) => Response.json({ success: true, result });

test('each deployment mode validates only its own inputs', () => {
  assert.deepEqual(settings.identityProviderIds, []);
  assert.equal(readDeploymentSettings(template, { ...environment, ADMIN_EMAIL: 'invalid', ACCESS_TEAM_DOMAIN: 'invalid', ACCESS_IDP_IDS: 'invalid' }).authProvider, 'github');
  assert.equal(readDeploymentSettings(template, { CLOUDFLARE_API_TOKEN: 'token', AUTH_PROVIDER: 'cloudflare', GITHUB_ADMIN: 'invalid value' }).authProvider, 'cloudflare');
  for (const field of ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_ADMIN']) {
    assert.throws(() => readDeploymentSettings(template, { ...environment, [field]: '' }), new RegExp(field));
  }
  assert.throws(() => readDeploymentSettings(template, { ...environment, AUTH_PROVIDER: 'other' }), /AUTH_PROVIDER/);
});

test('GitHub deployment uses no Zero Trust API and resolves a stable numeric administrator ID', async () => {
  const cloudflare = new CloudflareApi('token', async () => { throw Error('must not call Zero Trust'); });
  const prepared = await prepareAuthentication(cloudflare, settings, 'ssh.example.com', new Set(), async (url) => {
    assert.equal(String(url), 'https://api.github.com/users/admin');
    return Response.json({ id: 123, type: 'User' });
  });
  assert.equal(prepared.githubAdminId, '123');
  assert.deepEqual(prepared.secrets, { GITHUB_CLIENT_SECRET: environment.GITHUB_CLIENT_SECRET });
  assert.deepEqual(requiredAuthSecrets('github'), ['GITHUB_CLIENT_SECRET']);
  const config = createDeploymentConfig(template, settings, database, { hostname: 'ssh.example.com', adminAccountId: 'old-owner', githubAdminId: '123' });
  const vars = config.vars as Record<string, string>;
  assert.equal(vars.AUTH_PROVIDER, 'github');
  assert.equal(vars.ADMIN_ACCOUNT_ID, 'old-owner');
  assert.equal(vars.APP_ORIGIN, 'https://ssh.example.com');
  assert.equal(vars.GITHUB_ADMIN_ID, '123');
  assert.equal(stringify(config).includes(environment.GITHUB_CLIENT_SECRET), false);
});

test('organization names and unresolved GitHub administrators are rejected', async () => {
  const cloudflare = new CloudflareApi('token');
  for (const response of [new Response('', { status: 404 }), Response.json({ id: 123, type: 'Organization' })]) {
    await assert.rejects(prepareAuthentication(cloudflare, settings, 'ssh.example.com', new Set(), async () => response), /GITHUB_ADMIN/);
  }
});

test('a mode switch stops rather than leaving GitHub behind an existing Access login', async () => {
  const cloudflare = new CloudflareApi('token', async () => { throw Error('must not mutate Access'); });
  await assert.rejects(prepareAuthentication(cloudflare, settings, 'ssh.example.com', new Set(['ACCESS_AUD']), async () =>
    new Response(null, { status: 302, headers: { Location: 'https://team.cloudflareaccess.com/cdn-cgi/access/login' } })), /解除/);
});

test('legacy Cloudflare secrets are retained without requiring GitHub values', async () => {
  const cf = readDeploymentSettings(template, { CLOUDFLARE_API_TOKEN: 'token' });
  const api = new CloudflareApi('token', async () => { throw Error('must not overwrite existing Access'); });
  assert.deepEqual(await prepareAuthentication(api, cf, 'ssh.example.com', new Set(['ACCESS_AUD', 'ACCESS_TEAM_DOMAIN'])), { secrets: {} });
});

test('single administrator keeps the original owner ID across provider switches without any data writes', async () => {
  for (const owners of [[], [{ account_id: 'legacy-sub' }], [{ account_id: 'admin' }]]) {
    const api = new CloudflareApi('token', async (_url, init) => {
      const { sql } = JSON.parse(String(init?.body));
      assert.ok(sql.startsWith('SELECT '));
      return json([{ success: true, results: sql.includes('sqlite_master') ? [{ name: 'hosts' }] : owners }]);
    });
    assert.equal(await administratorAccountId(api, settings, database), owners[0]?.account_id || 'admin');
  }
  const empty = new CloudflareApi('token', async () => json([{ success: true, results: [] }]));
  assert.equal(await administratorAccountId(empty, settings, database), 'admin');
});

test('multiple previous owners are never silently merged into an administrator', async () => {
  const api = new CloudflareApi('token', async (_url, init) => {
    const { sql } = JSON.parse(String(init?.body));
    return json([{ success: true, results: sql.includes('sqlite_master') ? [{ name: 'hosts' }] : [{ account_id: 'first' }, { account_id: 'second' }] }]);
  });
  await assert.rejects(administratorAccountId(api, settings, database), /多个资料所有者/);
});
