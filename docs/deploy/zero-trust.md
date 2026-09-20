# 配置 Cloudflare Zero Trust Access

EdgeSSH 不提供本地用户名、密码或注册系统。生产入口必须先经过 Cloudflare Access，Worker 还会再次验证 Access 注入的 JWT。

::: warning 使用明确身份
推荐“明确邮箱 + Allow”。不要使用 `Everyone`、`Bypass`，也不要只按登录方式放行所有能够接收验证码的人。
:::

## 1. 准备登录方式

个人部署可以使用 One-time PIN 邮件验证码。若 Zero Trust 组织中没有该选项：

1. 进入 **Zero Trust → Integrations → Identity providers**。
2. 选择 **Add new identity provider**。
3. 添加 **One-time PIN** 并保存。

如果已经配置 Google、GitHub、Microsoft Entra ID 或其他身份提供程序，可以继续使用已有方式。

## 2. 创建 Self-hosted 应用

1. 进入 **Zero Trust → Access controls → Applications**。
2. 选择 **Create new application**。
3. 选择 **Self-hosted and private**。
4. 添加 Public hostname。
5. Application name 填写 `EdgeSSH`。
6. Public hostname 填写与 GitHub `CUSTOM_DOMAIN` 完全相同的域名。

<ScreenshotPlaceholder
  title="EdgeSSH Access 应用"
  description="请截取应用名称、Self-hosted 类型和 Public hostname。隐藏 Team Domain 之外的组织信息。"
  filename="06-zero-trust-application.png"
/>

## 3. 添加 Allow 策略

在应用的 Access policies 中创建策略：

| 项目 | 推荐值 |
| --- | --- |
| Policy name | `EdgeSSH Admin` |
| Action | `Allow` |
| Rule type | `Include` |
| Selector | `Emails` |
| Value | 你的完整管理员邮箱 |

需要多名管理员时，逐个添加明确邮箱。只有在你确实希望整个企业邮箱域都能管理服务器时，才使用整域授权。

<ScreenshotPlaceholder
  title="仅允许管理员邮箱的 Access 策略"
  description="请截取 Action、Include、Emails 三项。邮箱地址请打码，只保留结构可辨认。"
  filename="07-zero-trust-policy.png"
/>

## 4. 获取 Team Domain

进入 Zero Trust 设置，找到 Team name 或 Team domain。保存为 GitHub Actions Secret `ACCESS_TEAM_DOMAIN` 时只保留域名：

```text
my-team.cloudflareaccess.com
```

不要带 `https://`、路径或末尾斜杠。

## 5. 获取 Application Audience

1. 回到 **Access controls → Applications**。
2. 打开刚创建的 EdgeSSH 应用。
3. 在 Additional settings 中找到 **Application Audience (AUD) Tag**。
4. 复制完整值，后续保存为 `ACCESS_AUD`。

不要把应用 ID、Client ID 或策略 ID 当成 AUD。

## 6. 验证 Access 本身

在运行 `Deploy` workflow 前，也可以先访问自定义域名验证外层策略：

- 未登录时应先出现 Cloudflare Access 登录页。
- 不在 Allow 策略内的邮箱不能进入。
- 允许的邮箱能够完成认证。

<ScreenshotPlaceholder
  title="正式域名的 Access 登录页"
  description="请截取浏览器地址栏中的 EdgeSSH 自定义域名和 Access 登录界面。邮箱、验证码、Cookie 与重定向参数必须隐藏。"
  filename="09-access-login.png"
/>

## 常见问题

### One-time PIN 收不到邮件

先确认策略中的 Emails 与登录邮箱完全一致。Cloudflare 不会向未被策略允许的邮箱发送验证码，但页面可能仍显示已发送，避免泄露访问名单。

### 登录后提示 Access 登录已失效

通常是以下三项没有对应同一个应用：

- 正在访问的自定义域名。
- `ACCESS_TEAM_DOMAIN` 所属 Zero Trust 组织。
- `ACCESS_AUD` 所属 Self-hosted 应用。

### 页面没有出现 Access 登录

确认 Access 应用 Public hostname 与 `CUSTOM_DOMAIN` 完全一致。不要把 `workers.dev` 诊断地址当作正式入口。
