# 通过 GitHub Actions 配置 Worker 运行时 Secret

三个运行时 Secret 统一保存在 GitHub Actions Secrets 中。`Deploy` workflow 会在发布前将它们同步到 Worker，不需要进入 Cloudflare Worker 控制台补填。

## 打开配置页

在 GitHub 仓库进入：

```text
Settings → Secrets and variables → Actions → Secrets
```

## 添加三项 Secret

| 名称 | 值 | 来源 |
| --- | --- | --- |
| `ACCESS_TEAM_DOMAIN` | `my-team.cloudflareaccess.com` | Zero Trust Settings |
| `ACCESS_AUD` | 一串 Audience Tag | EdgeSSH Access 应用 |
| `ENCRYPTION_KEY` | 32 字节随机数的标准 Base64 | 本机安全随机数工具 |

三项都创建为 Repository Secret，不要保存为 Repository Variable。配置完成后运行 `Deploy` workflow，**Sync Worker secrets** 步骤会通过 Wrangler 批量同步它们。

<ScreenshotPlaceholder
  title="GitHub Actions Secrets"
  description="请截取三项运行时 Secret 的名称列表。不要展示任何值，也不要展开编辑面板。"
  filename="08-github-actions-secrets.png"
  src="/screenshots/08-github-actions-secrets.png"
  alt="GitHub Actions Repository secrets 设置入口"
  caption="Repository secrets 配置入口示例；请按上表分别创建三项运行时 Secret。"
/>

## 生成 ENCRYPTION_KEY

在可信的本机终端运行下列任一命令。

### Node.js

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### OpenSSL

```bash
openssl rand -base64 32
```

输出应是标准 Base64，解码后正好 32 字节。把它直接保存为 GitHub Actions Secret `ENCRYPTION_KEY`，不要使用普通密码、UUID、示例值或在线随机字符串网页。

::: danger 加密密钥必须长期保管
首次生成后，将 `ENCRYPTION_KEY` 保存到可信密码管理器。丢失密钥会导致 D1 中已有主机资料无法解密。当前版本不支持直接轮换，后续部署必须复用原值。
:::

## 哪些值不是环境变量

不要手动创建以下同名变量：

- `DB`：D1 binding，由部署配置生成。
- `SSH_SESSIONS`：Durable Object binding。
- `ASSETS`：Worker 静态资源 binding。

`CONNECT_TIMEOUT_MS` 是普通变量，仓库默认值为 `10000`。除非确实需要调整 2,000 至 30,000 毫秒的建连超时，否则保持默认。

## 保存后的检查

1. GitHub Actions Secrets 列表中能看到三个 Secret 名称。
2. 最新一次 `Deploy` 的 **Sync Worker secrets** 步骤成功。
3. 访问正式域名并通过 Access 登录。
4. 主机列表接口不再返回“管理员尚未配置 Zero Trust Access”。

运行时 Secret 不需要在每次 Action 中重填。workflow 会把 GitHub 中的固定值幂等同步给 Worker；尤其不要直接替换 `ENCRYPTION_KEY`，否则已有主机资料将无法解密。
