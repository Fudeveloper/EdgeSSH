import { spawn } from 'node:child_process';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'smol-toml';
import { ensureDatabase } from './cloudflare-d1.ts';
import { createDeploymentConfig, readDeploymentSettings } from './deployment-config.ts';
import { CloudflareApi, resolveAccountId } from './cloudflare-api.ts';
import { ensureAccess, resolveWorkerHostname } from './cloudflare-access.ts';
import { maskSecrets, prepareEncryptionSecret, readWorkerSecretNames } from './deployment-secrets.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const generatedConfig = '.wrangler.generated.toml';
const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));

async function runWrangler(args: string[], input?: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [wrangler, ...args, '--config', generatedConfig], {
      cwd: root,
      env: { ...process.env, CI: 'true' },
      stdio: [input === undefined ? 'ignore' : 'pipe', 'inherit', 'inherit'],
    });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`Wrangler ${args[0]} 失败（退出码 ${code}）。`)));
    if (input !== undefined) {
      child.stdin!.on('error', reject);
      child.stdin!.end(input);
    }
  });
}

async function main(): Promise<void> {
  const template = parse(await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8'));
  const settings = readDeploymentSettings(template, process.env);
  if (process.argv.includes('--validate-only')) {
    console.log('部署配置校验通过。');
    return;
  }

  const api = new CloudflareApi(settings.apiToken);
  settings.accountId = await resolveAccountId(api, settings.accountId);
  process.env.CLOUDFLARE_ACCOUNT_ID = settings.accountId;
  const existingSecrets = await readWorkerSecretNames(api, settings);
  const hostname = settings.customDomain || await resolveWorkerHostname(api, settings);
  // 旧部署可能由 Zone 级 Access 管理。未提供邮箱且已有两个 Access Secret 时保留原认证，
  // 不擅自新建账户级应用覆盖它；新用户仍只需输入邮箱即可走完整自动配置。
  const preserveAccess = !settings.adminEmail
    && existingSecrets.has('ACCESS_TEAM_DOMAIN') && existingSecrets.has('ACCESS_AUD');
  if (!preserveAccess && !settings.adminEmail) {
    throw new Error('首次部署需要 ADMIN_EMAIL，请在 Run workflow 输入管理员邮箱，或保存为 Actions 变量。');
  }
  const accessSecrets = preserveAccess ? {} : await ensureAccess(api, settings, hostname);
  console.log(preserveAccess ? '保留已有 Access 认证配置。' : 'Access 应用、身份提供程序与邮箱策略已就绪。');
  const database = await ensureDatabase(settings);
  const secrets = { ...accessSecrets, ...await prepareEncryptionSecret(api, settings, database, existingSecrets) };
  maskSecrets(secrets);
  const config = createDeploymentConfig(template, settings, database);
  // 临时配置放在仓库根目录，保持 assets、main、migrations_dir 的相对路径语义。
  await writeFile(new URL(`../${generatedConfig}`, import.meta.url), stringify(config), 'utf8');
  console.log(`部署 Worker ${settings.workerName}，使用 D1 ${database.name}（${database.uuid}）。`);
  await runWrangler(['d1', 'migrations', 'apply', 'DB', '--remote']);
  // Secret 只通过标准输入发送，不写临时文件或命令行参数；首次部署由 Wrangler 创建草稿 Worker。
  if (Object.keys(secrets).length) await runWrangler(['secret', 'bulk'], JSON.stringify(secrets));
  await runWrangler(['deploy']);
  // Wrangler 默认保留既有 Secret；部署后再次核对名称，避免把缺少认证的版本当作成功。
  const deployedSecrets = await readWorkerSecretNames(api, settings);
  for (const name of ['ENCRYPTION_KEY', 'ACCESS_TEAM_DOMAIN', 'ACCESS_AUD']) {
    if (!deployedSecrets.has(name)) throw new Error(`部署后缺少 Worker Secret：${name}。`);
  }
  console.log(`部署完成：https://${hostname}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY,
      `## EdgeSSH 部署完成\n\n入口：https://${hostname}\n\nD1 已迁移，运行时 Secret 已保存在 Cloudflare。后续部署保留原加密密钥。\n`);
  }
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
