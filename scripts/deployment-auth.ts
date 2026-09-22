import { ensureAccess } from './cloudflare-access.ts';
import type { CloudflareApi } from './cloudflare-api.ts';
import type { DeploymentSettings, RuntimeSecrets } from './deployment-config.ts';

export function requiredAuthSecrets(provider: DeploymentSettings['authProvider']): string[] {
  return provider === 'github' ? ['GITHUB_CLIENT_SECRET'] : ['ACCESS_TEAM_DOMAIN', 'ACCESS_AUD'];
}

export async function prepareAuthentication(
  api: CloudflareApi,
  settings: DeploymentSettings,
  hostname: string,
  existing: Set<string>,
  fetcher: typeof fetch = fetch,
): Promise<{ secrets: Partial<RuntimeSecrets>; githubAdminId?: string }> {
  if (settings.authProvider === 'cloudflare') {
    const preserve = !settings.adminEmail && requiredAuthSecrets('cloudflare').every((name) => existing.has(name));
    if (preserve) {
      console.log('保留已有 Cloudflare Access 认证配置。');
      return { secrets: {} };
    }
    if (!settings.adminEmail) throw new Error('首次配置 Cloudflare 登录需要 ADMIN_EMAIL。');
    return { secrets: await ensureAccess(api, settings, hostname) };
  }
  // GitHub 新部署完全不调用 Zero Trust API。旧域名若仍在 Access 后面，明确停止，
  // 不擅自删除用户的安全配置，也不把“双重登录”误报为部署成功。
  if (existing.has('ACCESS_AUD')) {
    const response = await fetcher(`https://${hostname}/api/auth/me`, { redirect: 'manual', signal: AbortSignal.timeout(30_000) });
    const location = response.headers.get('Location');
    if (location && new URL(location, `https://${hostname}`).hostname.endsWith('.cloudflareaccess.com')) {
      throw new Error('当前域名仍由 Cloudflare Access 保护。请先在 Access 解除该域名的保护，再切换 GitHub；不会删除主机资料或加密密钥。');
    }
  }
  const response = await fetcher(`https://api.github.com/users/${settings.githubAdmin}`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'EdgeSSH' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`无法确认 GITHUB_ADMIN（HTTP ${response.status}），请检查用户名或稍后重试。`);
  const user = await response.json() as { id: number; type: string };
  if (user.type !== 'User' || !Number.isSafeInteger(user.id) || user.id <= 0) {
    throw new Error('GITHUB_ADMIN 必须是个人 GitHub 账号，不能是组织。');
  }
  return { githubAdminId: String(user.id), secrets: { GITHUB_CLIENT_SECRET: settings.secrets.GITHUB_CLIENT_SECRET! } };
}
