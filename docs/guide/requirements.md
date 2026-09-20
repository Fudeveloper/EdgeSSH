# 部署前准备

先完成本页清单，再打开多个控制台操作。这样可以避免部署到一半才发现域名、权限或 SSH 目标不满足要求。

## 必备资源

- 一个 GitHub 账户，用于 Fork 仓库和运行 Actions。
- 一个可使用 Workers、Durable Objects、D1 与 Pages 的 Cloudflare 账户。
- 一个已经接入同一 Cloudflare 账户的域名，例如 `example.com`。
- 一个准备分配给 EdgeSSH 的子域名，例如 `ssh.example.com`。
- 一台你有权访问、能够从公网连接的 SSH 服务器。
- 一个可以接收 Cloudflare Access 登录邮件的管理员邮箱，或已有的身份提供程序。

::: info Node.js 只影响本地开发
只用 GitHub Actions 部署时，不需要在自己的电脑安装 Node.js。需要本地开发时，使用 Node.js 22.12.0 或更高版本。
:::

## 域名要求

正式入口应使用受 Cloudflare Access 保护的自定义域名。后续教程统一使用：

```text
ssh.example.com
```

替换为你自己的域名即可。填写 GitHub Variable 时只写主机名，不要带 `https://`、端口、路径或末尾斜杠。

## SSH 目标要求

目标必须解析到公网 IP。EdgeSSH 会拒绝回环地址、私有地址、链路本地地址和其他不应从公网访问的目标，以降低 SSRF 与 DNS 重绑定风险。

建议为验收准备一个专用的低权限 SSH 账号，并确认：

- SSH 服务监听公网可达端口。
- 防火墙允许 Cloudflare Workers 发起连接。
- 你已准备密码或一个受支持的未加密 OpenSSH 私钥。
- 你知道首次连接时应该核对的服务器指纹。

## 正式部署必须填写的 6 个值

这 6 项全部在 GitHub 仓库的 **Secrets and variables → Actions** 中填写。完成之前不要运行 `Deploy` workflow：

| 名称 | 保存位置 | 是否敏感 |
| --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub Actions Variable | 否 |
| `CUSTOM_DOMAIN` | GitHub Actions Variable | 否 |
| `CLOUDFLARE_API_TOKEN` | GitHub Actions Secret | 是 |
| `ACCESS_TEAM_DOMAIN` | GitHub Actions Secret，自动同步为 Worker Secret | 是 |
| `ACCESS_AUD` | GitHub Actions Secret，自动同步为 Worker Secret | 是 |
| `ENCRYPTION_KEY` | GitHub Actions Secret，自动同步为 Worker Secret | 是 |

`WORKER_NAME` 与 `D1_DATABASE_NAME` 是可选项，通常不要填写。默认名称分别是 `edgessh` 与 `edgessh-accounts`。

## 不要提前做的事

- 不要手动创建 D1。Action 会按名称创建或复用数据库。
- 不要修改 `wrangler.toml` 中的全零 D1 ID。它是版本库中的安全占位值。
- 不要把运行时 Secret 保存为 GitHub Variable，也不要写入源码、`wrangler.toml` 或 Issue。
- 不要先生成多个 `ENCRYPTION_KEY`。首次确定后要长期复用同一个值。

准备完成后，进入[GitHub Actions 完整部署流程](/deploy/actions)。
