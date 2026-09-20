import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRANGLER_BIN = path.join(PROJECT_ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

function requireValue(value, name) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`缺少 ${name}`);
  return normalized;
}

export function pagesProjectSettings(env = process.env) {
  const projectName = env.DOCS_PROJECT_NAME?.trim() || 'edgessh-docs';
  if (!/^[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/.test(projectName)) {
    throw new Error(`DOCS_PROJECT_NAME 格式无效：${projectName}`);
  }

  return {
    accountId: requireValue(env.CLOUDFLARE_ACCOUNT_ID, 'CLOUDFLARE_ACCOUNT_ID'),
    apiToken: requireValue(env.CLOUDFLARE_API_TOKEN, 'CLOUDFLARE_API_TOKEN'),
    projectName,
  };
}

async function parseCloudflareResponse(response) {
  const payload = await response.json();
  if (!response.ok || !payload.success) {
    const message = payload.errors?.map((error) => error.message).filter(Boolean).join('; ') || response.statusText;
    throw new Error(`Cloudflare Pages API 请求失败（${response.status}）：${message}`);
  }
  return payload.result;
}

export async function ensurePagesProject(settings, fetchImpl = fetch) {
  const endpoint = `${CLOUDFLARE_API}/accounts/${settings.accountId}/pages/projects/${settings.projectName}`;
  const headers = { Authorization: `Bearer ${settings.apiToken}`, 'Content-Type': 'application/json' };
  const existing = await fetchImpl(endpoint, { headers });

  if (existing.ok) {
    return { project: await parseCloudflareResponse(existing), created: false };
  }
  if (existing.status !== 404) await parseCloudflareResponse(existing);

  const created = await fetchImpl(`${CLOUDFLARE_API}/accounts/${settings.accountId}/pages/projects`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: settings.projectName, production_branch: 'main' }),
  });
  return { project: await parseCloudflareResponse(created), created: true };
}

export async function preparePagesProject(env = process.env, fetchImpl = fetch) {
  const settings = pagesProjectSettings(env);
  const result = await ensurePagesProject(settings, fetchImpl);
  console.log(`${result.created ? '已创建' : '已复用'} Cloudflare Pages 项目：${settings.projectName}`);
  return { settings, ...result };
}

function deployPages(settings, env = process.env) {
  const result = spawnSync(
    process.execPath,
    [
      WRANGLER_BIN,
      'pages',
      'deploy',
      '.vitepress/dist',
      '--project-name',
      settings.projectName,
      '--branch',
      'main',
      '--commit-dirty=true',
    ],
    { cwd: path.join(PROJECT_ROOT, 'docs'), env, stdio: 'inherit' },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Cloudflare Pages 部署失败，退出码：${result.status}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  preparePagesProject()
    .then(({ settings }) => {
      if (process.argv.includes('--deploy')) deployPages(settings);
    })
    .catch((error) => {
      console.error(`文档站部署准备失败：${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
}
