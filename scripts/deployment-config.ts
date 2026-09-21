import type { TomlTable } from 'smol-toml';

export const runtimeSecretNames = ['ENCRYPTION_KEY', 'ACCESS_TEAM_DOMAIN', 'ACCESS_AUD'] as const;
export type RuntimeSecrets = Record<(typeof runtimeSecretNames)[number], string>;

export interface DeploymentSettings {
  accountId: string;
  apiToken: string;
  workerName: string;
  databaseName: string;
  databaseId?: string;
  customDomain?: string;
  secrets: RuntimeSecrets;
}

export interface Database {
  uuid: string;
  name: string;
}

export function readDeploymentSettings(
  template: TomlTable,
  env: NodeJS.ProcessEnv,
): DeploymentSettings {
  const required = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', ...runtimeSecretNames];
  const missing = required.filter((name) => !env[name]?.trim());
  if (missing.length) throw new Error(`缺少部署配置：${missing.join(', ')}。请在 GitHub Actions 中配置。`);

  const accountId = env.CLOUDFLARE_ACCOUNT_ID!.trim();
  if (!/^[a-f0-9]{32}$/i.test(accountId)) throw new Error('CLOUDFLARE_ACCOUNT_ID 必须是 32 位十六进制账户 ID。');
  const workerName = env.WORKER_NAME?.trim() || String(template.name);
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(workerName)) throw new Error('WORKER_NAME 必须是 1–63 位小写字母、数字或连字符，且不能以连字符开头。');

  const databases = template.d1_databases as TomlTable[] | undefined;
  const database = databases?.find((binding) => binding.binding === 'DB');
  if (!database) throw new Error('wrangler.toml 缺少 DB 数据库绑定。');
  // 改 Worker 名时默认隔离数据库；只有显式指定名称或 ID 才复用另一实例的数据。
  const databaseName = env.D1_DATABASE_NAME?.trim()
    || (workerName === template.name ? String(database.database_name) : `${workerName}-accounts`);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(databaseName)) throw new Error('D1_DATABASE_NAME 必须是 1–64 位字母、数字、下划线或连字符，且以字母或数字开头。');
  const databaseId = env.D1_DATABASE_ID?.trim() || (database.database_id as string | undefined);
  if (databaseId && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(databaseId)) {
    throw new Error('D1_DATABASE_ID 必须是有效的数据库 UUID。');
  }
  const customDomain = env.CUSTOM_DOMAIN?.trim();
  if (customDomain && !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(customDomain)) {
    throw new Error('CUSTOM_DOMAIN 只能填写完整域名，不能包含协议、路径或通配符。');
  }
  if (customDomain?.toLowerCase().endsWith('.workers.dev')) {
    throw new Error('CUSTOM_DOMAIN 不能填写 workers.dev 地址；使用 Worker 自带域名时请删除或留空该配置。');
  }

  const secrets = Object.fromEntries(runtimeSecretNames.map((name) => [name, env[name]!.trim()])) as RuntimeSecrets;
  const key = Buffer.from(secrets.ENCRYPTION_KEY, 'base64');
  if (!/^[A-Za-z0-9+/]{43}=?$/.test(secrets.ENCRYPTION_KEY)
    || key.length !== 32
    || key.toString('base64').replace(/=+$/, '') !== secrets.ENCRYPTION_KEY.replace(/=+$/, '')) {
    throw new Error('ENCRYPTION_KEY 必须是 Base64 编码的 32 字节密钥；已有数据时必须继续使用原密钥。');
  }
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(secrets.ACCESS_TEAM_DOMAIN)) {
    throw new Error('ACCESS_TEAM_DOMAIN 必须形如 team.cloudflareaccess.com，不包含 https://。');
  }
  if (runtimeSecretNames.some((name) => name in ((template.vars as TomlTable | undefined) ?? {}))) {
    throw new Error('运行时 Secret 不得放在 wrangler.toml 的 vars 中，请改用 GitHub Actions Secrets。');
  }

  return {
    accountId, apiToken: env.CLOUDFLARE_API_TOKEN!.trim(), workerName,
    databaseName, databaseId, customDomain, secrets,
  };
}

export function createDeploymentConfig(
  template: TomlTable,
  settings: DeploymentSettings,
  database: Database,
): TomlTable {
  return {
    ...template,
    account_id: settings.accountId,
    name: settings.workerName,
    ...(settings.customDomain ? { routes: [{ pattern: settings.customDomain, custom_domain: true }] } : {}),
    d1_databases: (template.d1_databases as TomlTable[]).map((binding) => binding.binding === 'DB'
      ? { ...binding, database_name: database.name, database_id: database.uuid }
      : binding),
  };
}
