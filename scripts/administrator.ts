import type { CloudflareApi } from './cloudflare-api.ts';
import type { Database, DeploymentSettings } from './deployment-config.ts';

export async function administratorAccountId(api: CloudflareApi, settings: DeploymentSettings, database: Database): Promise<string> {
  const path = `/accounts/${settings.accountId}/d1/database/${database.uuid}/query`;
  const tables = await api.request<{ success: boolean; results: { name: string }[] }[]>(path, 'POST', {
    sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'hosts'",
  });
  if (!tables[0].success) throw new Error('无法读取管理员资料归属，请重试。');
  if (!tables[0].results.length) return 'admin';
  const result = await api.request<{ success: boolean; results: { account_id: string }[] }[]>(path, 'POST', {
    sql: 'SELECT DISTINCT account_id FROM hosts LIMIT 2',
  });
  if (!result[0].success) throw new Error('无法读取管理员资料归属，请重试。');
  const owners = result[0].results;
  // 沿用旧库唯一所有者，既不搬数据，也不改变 AES-GCM 的 AAD；新库统一使用 admin。
  // 发现多所有者时不猜测，更不能把本来隔离的数据自动交给一个账号。
  if (owners.length > 1) throw new Error('数据库存在多个资料所有者，无法自动转为单管理员；请先明确资料归属。');
  return owners[0]?.account_id || 'admin';
}
