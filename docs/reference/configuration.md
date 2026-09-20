# 配置项

EdgeSSH 的配置分为 GitHub Actions 部署输入、由 workflow 同步的 Cloudflare Worker Secret、普通变量和资源 binding。把它们放在正确位置，才能避免泄漏或同名冲突。

## 正式部署必填

下面 6 项全部保存在 GitHub Actions。2 个 Variable 可见，4 个 Secret 保存后不再显示：

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Variable | 目标 Cloudflare 账户 |
| `CUSTOM_DOMAIN` | Variable | 受 Access 保护的自定义域名纯主机名 |
| `CLOUDFLARE_API_TOKEN` | Secret | Workers、D1、Zone 部署凭据 |
| `ACCESS_TEAM_DOMAIN` | Secret | 同步为 Worker Secret |
| `ACCESS_AUD` | Secret | 同步为 Worker Secret |
| `ENCRYPTION_KEY` | Secret | 同步为 Worker Secret，后续部署必须保持不变 |

## 可选 GitHub Actions Variable

| 名称 | 默认值 | 说明 |
| --- | --- | --- |
| `WORKER_NAME` | `edgessh` | Worker 名称 |
| `D1_DATABASE_NAME` | `<WORKER_NAME>-accounts` | D1 名称 |
| `DOCS_PROJECT_NAME` | `edgessh-docs` | VitePress Pages 项目名，只供 `Deploy docs` 使用 |

## Worker Secret

| 名称 | 必需 | 格式 |
| --- | --- | --- |
| `ACCESS_TEAM_DOMAIN` | 是 | `my-team.cloudflareaccess.com`，无协议或路径 |
| `ACCESS_AUD` | 是 | 当前 Self-hosted Access 应用的 AUD Tag |
| `ENCRYPTION_KEY` | 是 | 解码后 32 字节的标准 Base64 |

生产 Secret 在 GitHub Actions Secrets 中配置，由 `Deploy` workflow 经标准输入同步到 Cloudflare Worker。Worker 的 **Variables and Secrets** 页面只用于核验同步结果；不要在那里维护另一套值，也不要把 Secret 写入 `wrangler.toml` 或源码。

## 普通变量

| 名称 | 默认值 | 范围 | 说明 |
| --- | --- | --- | --- |
| `CONNECT_TIMEOUT_MS` | `10000` | `2000` 至 `30000` | TCP 建连超时，单位毫秒 |

## 资源 binding

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `DB` | D1 | 加密主机资料与 migration 状态 |
| `SSH_SESSIONS` | Durable Object | 每会话 SSH 客户端 |
| `ASSETS` | Static Assets | Vite 构建后的 EdgeSSH 前端 |

这些 binding 由 Wrangler 配置生成，不要在 Variables and Secrets 中创建同名值。

## 本地变量

本地开发把 `.env.example` 复制为 `.dev.vars`，再填入开发值。`.dev.vars` 已被 Git 忽略，不应提交。

本地仍执行 Access JWT 校验，没有匿名开发绕过开关。
