import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ensurePagesProject,
  pagesProjectSettings,
} from '../scripts/prepare-pages-project.mjs';

const settings = pagesProjectSettings({
  CLOUDFLARE_ACCOUNT_ID: 'account-id',
  CLOUDFLARE_API_TOKEN: 'api-token',
  DOCS_PROJECT_NAME: 'my-edgessh-docs',
});

function cloudflareResponse(result: unknown, status = 200): Response {
  return Response.json(
    { success: status < 400, result, errors: status < 400 ? [] : [{ message: 'not found' }] },
    { status },
  );
}

test('Pages settings use a stable default project name', () => {
  assert.deepEqual(
    pagesProjectSettings({ CLOUDFLARE_ACCOUNT_ID: 'account-id', CLOUDFLARE_API_TOKEN: 'api-token' }),
    { accountId: 'account-id', apiToken: 'api-token', projectName: 'edgessh-docs' },
  );
});

test('an existing Pages project is reused', async () => {
  const methods: string[] = [];
  const result = await ensurePagesProject(settings, async (_input, init) => {
    methods.push(init?.method || 'GET');
    return cloudflareResponse({ name: settings.projectName });
  });

  assert.equal(result.created, false);
  assert.equal(result.project.name, settings.projectName);
  assert.deepEqual(methods, ['GET']);
});

test('a missing Pages project is created with main as production branch', async () => {
  const requests: Array<{ method: string; body?: string }> = [];
  const result = await ensurePagesProject(settings, async (_input, init) => {
    const method = init?.method || 'GET';
    requests.push({ method, body: init?.body ? String(init.body) : undefined });
    return method === 'GET'
      ? cloudflareResponse(null, 404)
      : cloudflareResponse({ name: settings.projectName, production_branch: 'main' });
  });

  assert.equal(result.created, true);
  assert.deepEqual(requests.map(({ method }) => method), ['GET', 'POST']);
  assert.deepEqual(JSON.parse(requests[1].body || '{}'), {
    name: settings.projectName,
    production_branch: 'main',
  });
});
