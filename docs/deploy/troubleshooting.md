# 常见部署问题

先找到失败发生在哪一层：GitHub Action、Cloudflare 资源、Access 身份、Worker Secret，还是 SSH 目标。不要通过关闭认证或放宽网络限制来绕过问题。

## Action 找不到账户或认证失败

检查：

- `CLOUDFLARE_ACCOUNT_ID` 是否保存为 GitHub Variable。
- `CLOUDFLARE_API_TOKEN` 是否保存为 GitHub Secret。
- Token 的 Account Resources 是否包含该账户。
- Token 是否过期、撤销或复制不完整。

## D1 创建或 migration 失败

常见原因：

- Token 缺少 Account `D1: Edit`。
- `D1_DATABASE_NAME` 含不支持字符。
- 同一账户中存在名称冲突但权限不足以读取。
- 上一次并发部署仍在运行。

不要手工把某个 D1 ID写进 `wrangler.toml`。部署脚本会按数据库名称解析 ID，并只写入 runner 的临时配置。

## 自定义域名绑定失败

确认：

- `CUSTOM_DOMAIN` 只有纯主机名。
- 域名所在 Zone 已接入同一个 Cloudflare 账户。
- Token 的 Zone Resources 包含这个 Zone。
- Access 应用与 `CUSTOM_DOMAIN` 使用相同主机名。

## Action 成功，但打开后返回 503

确认最新一次 `Deploy` 包含并成功执行 **Sync Worker secrets**，然后检查：

- GitHub Actions Secrets 中存在 `ACCESS_TEAM_DOMAIN`、`ACCESS_AUD`、`ENCRYPTION_KEY`。
- 三项名称拼写完全一致，且没有误存为 Variable。
- Team Domain 和 AUD 来自当前自定义域名对应的 Access 应用。

Cloudflare Worker 的 Variables and Secrets 页面只用于核验三个名称是否已同步，不要在那里维护另一套值。

## 页面先登录，之后提示 Access 已失效

通常是 `ACCESS_AUD` 来自另一个应用，或 `ACCESS_TEAM_DOMAIN` 属于另一个 Zero Trust 组织。重新从当前自定义域名对应的 Self-hosted 应用复制 AUD。

## 主机能保存但连接超时

检查目标层：

- 主机名是否解析到公网地址。
- SSH 服务端口是否正确。
- 目标防火墙是否允许外部连接。
- 云服务商安全组是否开放对应端口。
- 目标是否只允许固定来源 IP。Cloudflare Workers 出站地址不适合传统固定 IP 白名单。

不要把 `CONNECT_TIMEOUT_MS` 调得很大来掩盖网络不可达。默认 10 秒足以区分正常连接与大多数路由问题。

## 私钥认证失败

当前只支持未加密 OpenSSH 格式的 Ed25519、RSA、ECDSA P-256/P-384/P-521 私钥。不支持：

- 带 passphrase 的加密私钥。
- PEM 或 PKCS#8 私钥。
- SSH Agent。
- 需要多轮交互的 MFA 登录。

先在受信任终端用同一账号和密钥验证目标，再核对私钥格式。

## 怎样提交有效 Issue

提供：

- 失败所在步骤。
- Action 步骤名称与脱敏错误信息。
- 浏览器、操作系统和目标 SSH 服务类型。
- 能稳定复现的最少步骤。

不要提供密码、私钥、API Token、Access JWT、Cookie、Team Domain、AUD、未脱敏 IP 或完整 Action 日志。
