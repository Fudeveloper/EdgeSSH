import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function requireValue(value, name) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`缺少 ${name}`);
  return normalized;
}

function validateName(value, name, pattern) {
  if (!pattern.test(value)) throw new Error(`${name} 格式无效：${value}`);
  return value;
}

function normalizeDomain(value) {
  const domain = value?.trim().toLowerCase();
  if (!domain) return '';

  const parsed = new URL(`https://${domain}`);
  if (parsed.hostname !== domain || parsed.port || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error(`CUSTOM_DOMAIN 必须是纯域名，不能包含协议、端口或路径：${domain}`);
  }
  return domain;
}

export function deploymentSettings(env = process.env) {
  const workerName = validateName(
    env.WORKER_NAME?.trim() || 'edgessh',
    'WORKER_NAME',
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
  );
  const databaseName = validateName(
    env.D1_DATABASE_NAME?.trim() || `${workerName}-accounts`,
    'D1_DATABASE_NAME',
    /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,62}[A-Za-z0-9])?$/,
  );

  return {
    accountId: requireValue(env.CLOUDFLARE_ACCOUNT_ID, 'CLOUDFLARE_ACCOUNT_ID'),
    apiToken: requireValue(env.CLOUDFLARE_API_TOKEN, 'CLOUDFLARE_API_TOKEN'),
    workerName,
    databaseName,
    customDomain: normalizeDomain(env.CUSTOM_DOMAIN),
  };
}

async function cloudflareRequest(settings, pathname, init, fetchImpl) {
  const response = await fetchImpl(`${CLOUDFLARE_API}/accounts/${settings.accountId}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${settings.apiToken}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  const payload = await response.json();
  if (!response.ok || !payload.success) {
    const message = payload.errors?.map((error) => error.message).filter(Boolean).join('; ') || response.statusText;
    throw new Error(`Cloudflare API 请求失败（${response.status}）：${message}`);
  }
  return payload.result;
}

async function findDatabase(settings, fetchImpl) {
  const query = new URLSearchParams({ name: settings.databaseName, per_page: '100' });
  const databases = await cloudflareRequest(settings, `/d1/database?${query}`, undefined, fetchImpl);
  return databases.find((database) => database.name === settings.databaseName);
}

export async function ensureDatabase(settings, fetchImpl = fetch) {
  const existing = await findDatabase(settings, fetchImpl);
  if (existing) return { id: existing.uuid, created: false };

  try {
    const created = await cloudflareRequest(
      settings,
      '/d1/database',
      { method: 'POST', body: JSON.stringify({ name: settings.databaseName }) },
      fetchImpl,
    );
    return { id: created.uuid, created: true };
  } catch (error) {
    // 并行部署可能在查询后率先创建同名数据库，重新查询即可继续复用该资源。
    const concurrentlyCreated = await findDatabase(settings, fetchImpl);
    if (concurrentlyCreated) return { id: concurrentlyCreated.uuid, created: false };
    throw error;
  }
}

function replaceOnce(source, pattern, replacement, label) {
  if (!pattern.test(source)) throw new Error(`wrangler.toml 缺少 ${label} 配置`);
  return source.replace(pattern, replacement);
}

export function renderWranglerConfig(baseConfig, settings, databaseId) {
  let config = replaceOnce(baseConfig, /^name = ".*"$/m, `name = ${JSON.stringify(settings.workerName)}`, 'Worker name');
  config = replaceOnce(
    config,
    /^database_name = ".*"$/m,
    `database_name = ${JSON.stringify(settings.databaseName)}`,
    'D1 database_name',
  );
  config = replaceOnce(
    config,
    /^database_id = ".*"$/m,
    `database_id = ${JSON.stringify(databaseId)}`,
    'D1 database_id',
  );

  if (settings.customDomain) {
    const routes = `routes = [\n  { pattern = ${JSON.stringify(settings.customDomain)}, custom_domain = true }\n]`;
    config = replaceOnce(config, /^preview_urls = false$/m, `preview_urls = false\n\n${routes}`, 'preview_urls');
  }
  return config;
}

export async function prepareDeployment(env = process.env, fetchImpl = fetch) {
  const settings = deploymentSettings(env);
  const baseConfigPath = env.WRANGLER_BASE_CONFIG || path.join(PROJECT_ROOT, 'wrangler.toml');
  const deployConfigPath = env.WRANGLER_DEPLOY_CONFIG || path.join(PROJECT_ROOT, 'wrangler.deploy.toml');
  const database = await ensureDatabase(settings, fetchImpl);
  const baseConfig = await readFile(baseConfigPath, 'utf8');
  const deployConfig = renderWranglerConfig(baseConfig, settings, database.id);

  await mkdir(path.dirname(deployConfigPath), { recursive: true });
  await writeFile(deployConfigPath, deployConfig, 'utf8');

  console.log(`${database.created ? '已创建' : '已复用'} D1 数据库：${settings.databaseName}`);
  console.log(`Worker：${settings.workerName}`);
  console.log(settings.customDomain ? `自定义域名：${settings.customDomain}` : '自定义域名：未配置，仅发布 workers.dev');
  return { settings, database, deployConfigPath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareDeployment().catch((error) => {
    console.error(`部署准备失败：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
