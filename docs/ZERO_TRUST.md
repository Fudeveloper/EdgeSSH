# Cloudflare Zero Trust Access 配置

EdgeSSH **不提供本地用户名 / 密码登录**。为了避免任何人直接打开你的 WebSSH，生产环境必须把访问入口放在 Cloudflare Zero Trust Access 后面。

EdgeSSH 会在 Worker 内再次校验 Cloudflare Access 注入的 `Cf-Access-Jwt-Assertion`，包括签名、Issuer、Audience、有效期、用户 `sub` 和邮箱。因此，仅仅给域名加一个普通登录页还不够：**Access 应用、身份策略、`ACCESS_TEAM_DOMAIN` 和 `ACCESS_AUD` 必须对应同一个应用。**

> [!IMPORTANT]
> 本项目默认按**单管理员**设计。推荐使用“明确邮箱 + Allow”策略。不要使用 `Everyone`、`Bypass`，也不要只限制到整个邮箱域名。

## 推荐方案：指定邮箱 + One-time PIN

对于个人部署，最简单的方案是只允许你的邮箱，并使用 Cloudflare 的邮件验证码登录。

### 1. 启用 One-time PIN（可选）

如果你已经配置 Google、GitHub、Microsoft Entra ID 等标识提供程序（Identity Provider），可以直接跳过这一步。

Cloudflare 新建的 Zero Trust 组织目前不会自动添加 One-time PIN。需要邮件验证码登录时：

1. 打开 Cloudflare Dashboard。
2. 进入 **Zero Trust > Integrations（集成）> Identity providers（标识提供程序）**。
3. 在 **Your identity providers（您的标识提供程序）** 中选择 **Add new identity provider（添加新的标识提供程序）**。
4. 选择 **One-time PIN（一次性 PIN）** 并保存。

<img width="704" height="557" alt="image" src="https://github.com/user-attachments/assets/64d12f4d-4805-4b89-a46e-46f25dce1318" />


Cloudflare 官方说明：
https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/

### 2. 创建 Access 应用

1. 进入 **Zero Trust > Access controls（访问控制）> Applications（应用程序）**。
2. 选择 **Create new application（创建新应用程序）**。
3. 选择 **Self-hosted and private（自托管和私有）**。
4. 选择 **Add public hostname（添加公共主机名）**。
5. **Application name（应用程序名称）** 可填写 `EdgeSSH`。
6. **Public hostname（公共主机名）** 选择 EdgeSSH 实际使用的自定义域名，例如：

   ```text
   ssh.example.com
   ```

7. 不要把另一个无关域名，或未受保护的 `workers.dev` 地址当作正式入口。

Cloudflare 官方说明：
https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/

### 3. 添加身份访问策略

在应用的 **Access policies（Access 策略）** 中创建一条策略：

| 项目 | 推荐值 |
| --- | --- |
| Policy name（策略名称） | `EdgeSSH Admin` |
| Action（操作） | `Allow（允许）` |
| Rule type（规则类型） | `Include（包括）` |
| Selector（选择器） | `Emails（电子邮件）` |
| Value（值） | 你的完整邮箱，例如 `you@example.com` |

如果需要多个管理员，请逐个添加明确邮箱。

> [!WARNING]
> 不要使用 `Include > Everyone`。如果使用 One-time PIN，也不要只写 `Include > Login Methods > One-time PIN`，否则任何能接收邮件验证码的人都可能符合策略。
>
> 本项目也不建议使用 `Emails ending in @example.com` 这类整域授权，除非你明确希望该域下所有可验证用户都能进入 EdgeSSH。

Cloudflare Access 默认拒绝未匹配 Allow 策略的用户。

策略说明：
https://developers.cloudflare.com/cloudflare-one/access-controls/policies/

### 4. 选择登录方式并保存应用

在应用的 **Authentication（身份验证）** 设置中，选择你希望允许的 **Identity Provider（标识提供程序）**。

个人部署通常可以只保留：

```text
One-time PIN
```

如果只启用一个标识提供程序，也可以开启 Cloudflare 的 **Apply instant authentication（应用即时身份验证）**，让用户直接进入对应登录流程。

保存应用后，先打开 EdgeSSH 的自定义域名测试一次。正确情况下，浏览器会先进入 Cloudflare Access 登录，再进入 EdgeSSH。

## 获取 EdgeSSH 需要的两个 Access 参数

### ACCESS_TEAM_DOMAIN

进入 Cloudflare Zero Trust 的 **Settings（设置）**，找到 **Team name（团队名称）/ Team domain（团队域）**。

例如 Cloudflare 显示：
<img width="730" height="583" alt="image" src="https://github.com/user-attachments/assets/6f095c14-5880-42b4-8850-4fc3d9b74386" />


则输入：

```text
my-team.cloudflareaccess.com
```

> [!IMPORTANT]
> `ACCESS_TEAM_DOMAIN` **不要带** `https://`，不要带路径，也不要带末尾斜杠。

### ACCESS_AUD

1. 进入 **Zero Trust > Access controls（访问控制）> Applications（应用程序）**。
2. 找到刚才创建的 EdgeSSH 应用，选择 **Configure（配置）**。
3. 在 **Additional settings（其他设置）** 中找到 **Application Audience (AUD) Tag（应用程序受众 (AUD) 标签）**。
4. 复制完整值。

Cloudflare 官方获取 AUD 的说明：
https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/

## 在 GitHub Actions 保存 Worker Secret

取得 Team Domain 与 AUD 后，在 GitHub 仓库进入 `Settings > Secrets and variables > Actions`：

1. 添加 `ACCESS_TEAM_DOMAIN` Secret，粘贴前面取得的 Team Domain。
2. 添加 `ACCESS_AUD` Secret，粘贴前面取得的 Application Audience (AUD) Tag。
3. 添加 `ENCRYPTION_KEY` Secret。按照[运行时 Secret 指南](https://edgessh-docs.pages.dev/deploy/runtime-secrets#生成-encryption_key)生成 32 字节安全随机数的标准 Base64；首次生成后必须妥善保管，后续部署继续使用同一个值。
4. 确认三项 Secret 均已添加，再手动运行一次 `Deploy` workflow。

workflow 会通过 Wrangler 将这三项值同步为同名 Worker Secret。不要将它们保存成 GitHub Actions Variable，也不要写进仓库、本地命令或日志；生产部署不需要手动执行 Wrangler Secret 或 Worker 部署命令。

## 验证配置

部署完成后建议检查：

1. 未登录时访问正式域名，应先出现 Cloudflare Access，而不是直接进入 EdgeSSH。
2. 不在 Allow 策略中的邮箱不能进入。
3. 使用允许的邮箱登录后，可以正常加载主机列表和 `/api/auth/me`。
4. 直接访问未受 Access 保护的入口，不应能够操作主机或建立 SSH 会话。
5. 不要把 `ACCESS_TEAM_DOMAIN`、`ACCESS_AUD`、Access Token 或登录 Cookie 提交到 Git 仓库。

## 常见问题

### 页面能打开，但 EdgeSSH 提示“管理员尚未配置 Zero Trust Access”

检查：

- `ACCESS_TEAM_DOMAIN` 是否已经保存为 GitHub Actions Secret，并由最新一次 `Deploy` workflow 成功同步。
- Team Domain 是否为 `xxx.cloudflareaccess.com`，且没有 `https://`。
- `ACCESS_AUD` 是否已保存为 GitHub Actions Secret，且值来自当前 Access 应用。

### 登录后提示“Access 登录已失效”

常见原因：

- `ACCESS_AUD` 来自另一个 Access 应用。
- `ACCESS_TEAM_DOMAIN` 属于另一个 Zero Trust 组织。
- 你通过没有受对应 Access 应用保护的域名进入 Worker。

### One-time PIN 收不到邮件

先确认 Access Policy 中的 **Emails** 与登录邮箱完全一致。

Cloudflare 对未被策略允许的邮箱不会发送验证码，但登录页面仍可能显示“验证码已发送”，以避免泄漏访问名单。邮件安全网关或链接扫描器也可能提前消耗验证码。

---

如果你已经有成熟的 Google / GitHub / Entra ID / Okta 等标识系统，可以继续使用现有 IdP；EdgeSSH 并不要求 One-time PIN。关键要求只有两个：

- 用户必须先通过 Cloudflare Access 的身份认证与 Allow 策略。
- EdgeSSH 中配置的 Team Domain 与 AUD 必须与这个 Access 应用一致。
