# 使用 GitHub Actions 部署

这是推荐的生产部署方式。首次执行会创建或复用 D1、同步运行时 Secret、应用数据库迁移并发布 Worker；以后推送到 `main` 会复用同一批资源更新代码。

## 开始前必须填写的 6 项

正式部署只使用 GitHub 仓库的 `Settings → Secrets and variables → Actions` 作为配置入口。先一次填完下面 6 项，再运行 `Deploy` workflow：

| 名称 | GitHub Actions 类型 | 填写内容 |
| --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Variable | Cloudflare 账户 ID |
| `CUSTOM_DOMAIN` | Variable | EdgeSSH 的自定义域名，只写主机名 |
| `CLOUDFLARE_API_TOKEN` | Secret | 具备 Worker、D1 与目标 Zone 权限的 API Token |
| `ACCESS_TEAM_DOMAIN` | Secret | Zero Trust Team Domain，不带协议或路径 |
| `ACCESS_AUD` | Secret | EdgeSSH Access 应用的 AUD Tag |
| `ENCRYPTION_KEY` | Secret | 固定的 32 字节安全随机数 Base64 |

::: danger 六项缺一不可
本教程的正式部署流程要求 2 个 Variable 与 4 个 Secret 全部存在。运行时 Secret 会由 workflow 自动同步到 Worker；不要再到 Cloudflare Worker 控制台保存一套配置，也不要在控制台手工部署。
:::

## 部署路线图

1. Fork EdgeSSH 仓库。
2. 创建 Cloudflare API Token。
3. 在 Cloudflare Zero Trust 创建 Access 应用。
4. 在 GitHub 保存全部六项正式部署配置。
5. 手动运行一次 `Deploy` workflow。
6. 确认 workflow 已同步三个运行时 Secret。
7. 访问自定义域名并完成验收。

::: tip 一个配置入口
六项正式部署配置全部保存在 GitHub Actions：账户 ID 与自定义域名使用 Variable，API Token、Access 参数与加密密钥使用 Secret。workflow 会通过 Cloudflare API 将三项运行时值同步为 Worker Secret，无需再到 Worker 控制台补填。
:::

## 1. Fork 仓库

打开 [EdgeSSH GitHub 仓库](https://github.com/aozorae/EdgeSSH)，选择 **Fork**，保留默认分支 `main`。

Fork 完成后，地址通常是：

```text
https://github.com/<你的 GitHub 用户名>/EdgeSSH
```

<ScreenshotPlaceholder
  title="Fork 仓库"
  description="请截取仓库右上角 Fork 入口和创建 Fork 页面。不要让浏览器个人资料菜单出现在画面中。"
  filename="01-fork-repository.png"
  src="/screenshots/01-fork-repository.png"
  alt="GitHub 仓库页面右上角的 Fork 按钮"
  caption="GitHub Fork 入口示例；实际操作时请选择 EdgeSSH 仓库。"
/>

## 2. 创建 Cloudflare API Token

在 Cloudflare 个人资料的 **API Tokens** 页面创建 Token。以官方 **Edit Cloudflare Workers** 模板为起点，并确认 Token 具备：

- Account：Workers Scripts Edit。
- Account：D1 Edit。
- Zone：目标域名所需的 Workers Routes Edit 权限。
- Account Resources：只选择实际部署所用账户。
- Zone Resources：只选择 EdgeSSH 域名所在 Zone。

Token 只会完整显示一次。创建后直接保存到 GitHub Secret，不要粘贴到聊天、Issue、截图或仓库文件。

详细配置见[创建 API Token](/deploy/api-token)。

## 3. 在 GitHub Actions 填写六项配置

进入你的 Fork：

```text
Settings → Secrets and variables → Actions
```

按照页面顶部的必填表，在 **Variables** 页签保存 `CLOUDFLARE_ACCOUNT_ID` 与 `CUSTOM_DOMAIN`，在 **Secrets** 页签保存另外四项。三项运行时 Secret 的值在下一节取得。Variable 的值会显示在设置页，Secret 保存后不会再次显示；不要把四项敏感值错放到 Variable。

### 可选配置

以下 Variable 不影响标准部署，第一次部署通常不要填写：

| 名称 | 默认值 | 用途 |
| --- | --- | --- |
| `WORKER_NAME` | `edgessh` | 自定义 Worker 名称 |
| `D1_DATABASE_NAME` | `<WORKER_NAME>-accounts` | 自定义 D1 数据库名称 |

`DOCS_PROJECT_NAME` 只属于文档站的 `Deploy docs` workflow，不是 EdgeSSH 应用部署的必填项。

<ScreenshotPlaceholder
  title="GitHub Actions 变量与 Secret"
  description="请截取 Repository variables 列表和 Repository secrets 名称列表，不要展示任何 Secret 值。画面需能看清六项正式部署配置的名称。"
  filename="03-github-actions-variables.png"
  src="/screenshots/03-github-actions-variables.png"
  alt="GitHub Actions Secrets and variables 设置页面"
  caption="GitHub Actions 配置入口示例；具体名称与类型以上方六项必填表为准。"
/>

## 4. 配置 Zero Trust Access

在运行 Action 前，先为 `CUSTOM_DOMAIN` 中的同一域名创建 Self-hosted Access 应用，并添加只允许明确管理员邮箱的 Allow 策略。

你需要从这个应用取得两个值：

- `ACCESS_TEAM_DOMAIN`：例如 `my-team.cloudflareaccess.com`。
- `ACCESS_AUD`：Application Audience (AUD) Tag。

再按[运行时 Secret](/deploy/runtime-secrets)中的方式生成一次 `ENCRYPTION_KEY`，回到 GitHub Actions Secrets 保存这三项值。加密密钥在后续部署中必须保持不变。

完整点击路径见[配置 Zero Trust Access](/deploy/zero-trust)。

## 5. 首次运行 Deploy

进入 Fork 的：

```text
Actions → Deploy → Run workflow
```

选择 `main` 后运行。workflow 会依次：

1. 检出仓库并安装锁定版本依赖。
2. 执行类型检查、自动化测试、文档构建与 Wrangler dry-run。
3. 按 `D1_DATABASE_NAME` 精确查找 D1，不存在时创建一次。
4. 生成只存在于 runner 内的临时 Wrangler 配置，写入真实 D1 ID。
5. 从 GitHub Actions 读取三项运行时 Secret，并经标准输入同步给 Wrangler。
6. 对远程 D1 执行 migration。
7. 创建或更新 Worker，并绑定必填配置中的自定义域名。

<ScreenshotPlaceholder
  title="手动运行 Deploy workflow"
  description="请截取 Actions 页面的 Deploy 工作流和 Run workflow 菜单，画面需能看清 main 分支选择。"
  filename="04-run-deploy-workflow.png"
  src="/screenshots/04-run-deploy-workflow.png"
  alt="GitHub Actions 的 Run workflow 菜单和 main 分支选择"
  caption="Run workflow 菜单示例；请在 EdgeSSH 的 Deploy workflow 中选择 main。"
/>

### 怎样判断成功

等待运行记录显示绿色成功标记，并展开 **Prepare Cloudflare resources**、**Sync Worker secrets** 与对应的部署步骤。资源准备日志中应能看到：

```text
已创建 D1 数据库：edgessh-accounts
```

或后续部署中的：

```text
已复用 D1 数据库：edgessh-accounts
```

日志还应显示 Worker 名称和自定义域名，但不应出现 API Token、Access 参数或加密密钥。

<ScreenshotPlaceholder
  title="Deploy 成功记录"
  description="请截取成功的 workflow 摘要和关键部署步骤。隐藏仓库外的私人信息，确认日志中没有任何 Token、Secret 或 Cookie。"
  filename="05-deploy-success.png"
/>

::: info 缺少 Secret 会直接停止部署
workflow 会在发布 Worker 前校验三项运行时 Secret。任一项缺失时部署会失败，不会留下一个需要去控制台补配置的版本。
:::

## 6. 确认运行时 Secret 已同步

成功的运行记录中，**Sync Worker secrets** 步骤会列出已处理的 Secret 名称，但不会显示值。三项值仅经标准输入交给 Wrangler，不进入命令参数、临时配置或日志。

如需核验，可在 Cloudflare Worker 的 Variables and Secrets 页面确认三个名称存在；该页面不是配置入口，也不需要再次保存或部署。生成与保管加密密钥的规则见[Worker 运行时 Secret](/deploy/runtime-secrets)。

## 7. 完成首次验收

访问 `https://你的自定义域名`。正确顺序是：

1. 浏览器先进入 Cloudflare Access 登录页。
2. 只有 Allow 策略中的邮箱可以完成登录。
3. 登录后显示 EdgeSSH 主机总览，而不是配置错误。
4. 新建一台测试主机，核对首次连接指纹，再验收终端、SFTP 与进程面板。

不要只看到首页就宣布部署完成。使用[部署后验收清单](/deploy/verification)逐项检查。

## 后续更新

以后将更新合并或推送到 `main` 即可。Action 会复用同名 D1，并从 GitHub Actions Secrets 幂等同步 Worker Secret；不需要在本地运行 Wrangler，也不需要重复创建资源。

保持 `WORKER_NAME` 和 `D1_DATABASE_NAME` 稳定。修改数据库名称会切换到另一个数据库，不会自动迁移旧数据。
