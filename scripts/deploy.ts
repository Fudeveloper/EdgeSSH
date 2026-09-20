import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'smol-toml';
import { ensureDatabase } from './cloudflare-d1.ts';
import { createDeploymentConfig, readDeploymentSettings } from './deployment-config.ts';

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

  const database = await ensureDatabase(settings);
  const config = createDeploymentConfig(template, settings, database);
  // 临时配置放在仓库根目录，保持 assets、main、migrations_dir 的相对路径语义。
  await writeFile(new URL(`../${generatedConfig}`, import.meta.url), stringify(config), 'utf8');
  console.log(`部署 Worker ${settings.workerName}，使用 D1 ${database.name}（${database.uuid}）。`);
  await runWrangler(['d1', 'migrations', 'apply', 'DB', '--remote']);
  // Secret 只通过标准输入发送，不写临时文件或命令行参数；首次部署由 Wrangler 创建草稿 Worker。
  await runWrangler(['secret', 'bulk'], JSON.stringify(settings.secrets));
  await runWrangler(['deploy']);
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
