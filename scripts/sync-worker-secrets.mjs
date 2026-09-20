import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRANGLER_BIN = path.join(PROJECT_ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

function requireSecret(value, name) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`缺少 ${name}`);
  return normalized;
}

function accessTeamDomain(value) {
  const domain = requireSecret(value, 'ACCESS_TEAM_DOMAIN').toLowerCase();
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain)) {
    throw new Error('ACCESS_TEAM_DOMAIN 必须是 Cloudflare Access Team Domain，且不含协议或路径');
  }
  return domain;
}

function encryptionKey(value) {
  const key = requireSecret(value, 'ENCRYPTION_KEY');
  const decoded = Buffer.from(key, 'base64');
  if (decoded.length !== 32 || decoded.toString('base64') !== key) {
    throw new Error('ENCRYPTION_KEY 必须是 32 字节安全随机数的标准 Base64');
  }
  return key;
}

export function deploymentSecrets(env = process.env) {
  return {
    ACCESS_TEAM_DOMAIN: accessTeamDomain(env.ACCESS_TEAM_DOMAIN),
    ACCESS_AUD: requireSecret(env.ACCESS_AUD, 'ACCESS_AUD'),
    ENCRYPTION_KEY: encryptionKey(env.ENCRYPTION_KEY),
  };
}

export function syncWorkerSecrets(env = process.env) {
  const secrets = deploymentSecrets(env);
  const deployConfigPath = env.WRANGLER_DEPLOY_CONFIG || path.join(PROJECT_ROOT, 'wrangler.deploy.toml');

  // Secret 仅经标准输入交给 Wrangler，避免在命令参数、配置文件或日志中留下明文。
  const result = spawnSync(
    process.execPath,
    [WRANGLER_BIN, 'secret', 'bulk', '--config', deployConfigPath],
    {
      cwd: PROJECT_ROOT,
      env,
      input: JSON.stringify(secrets),
      stdio: ['pipe', 'inherit', 'inherit'],
    },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Wrangler Secret 同步失败，退出码：${result.status}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    syncWorkerSecrets();
  } catch (error) {
    console.error(`Worker Secret 同步失败：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
