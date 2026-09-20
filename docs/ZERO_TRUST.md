# Cloudflare Zero Trust Access 配置

EdgeSSH **不提供本地用户名 / 密码登录**。为了避免任何人直接打开你的 WebSSH，生产环境必须把访问入口放在 Cloudflare Zero Trust Access 后面。

EdgeSSH 会在 Worker 内再次校验 Cloudflare Access 注入的 `Cf-Access-Jwt-Assertion`，包括签名、Issuer、Audience、有效期、用户 `sub` 和邮箱。因此，仅仅给域名加一个普通登录页还不够：**Access 应用、身份策略、`ACCESS_TEAM_DOMAIN` 和 `ACCESS_AUD` 必须对应同一个应用。**

> [!IMPORTANT]
> 本项目默认按**单管理员**设计。推荐使用“明确邮箱 + 允许（Allow）”策略。不要使用**所有人（Everyone）**、**绕过（Bypass）**，也不要只限制到整个邮箱域名。

## 推荐方案：指定邮箱 + 一次性 PIN（One-time PIN）

对于个人部署，最简单的方案是只允许你的邮箱，并使用 Cloudflare 的邮件验证码登录。

### 1. 启用一次性 PIN（One-time PIN，可选）

如果你已经配置 Google、GitHub、Microsoft Entra ID 等标识提供程序（Identity Provider），可以直接跳过这一步。

Cloudflare 新建的 Zero Trust 组织目前不会自动添加一次性 PIN（One-time PIN）。需要邮件验证码登录时：

1. 打开 Cloudflare 控制面板（Dashboard）。
2. 进入 **Zero Trust > 集成（Integrations）> 标识提供程序（Identity providers）**。
3. 在 **您的标识提供程序（Your identity providers）** 中选择 **添加新的标识提供程序（Add new identity provider）**。
4. 选择 **一次性 PIN（One-time PIN）** 并保存。

<img width="704" height="557" alt="image" src="https://github.com/user-attachments/assets/64d12f4d-4805-4b89-a46e-46f25dce1318" />


Cloudflare 官方说明：
https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/

### 2. 创建 Access 应用

1. 进入 **Zero Trust > 访问控制（Access controls）> 应用程序（Applications）**。
2. 选择 **创建新应用程序（Create new application）**。
3. 选择 **自托管和私有应用（Self-hosted and private）**。
4. 选择 **添加公共主机名（Add public hostname）**。
5. **应用程序名称（Application name）** 可填写 `EdgeSSH`。
6. **公共主机名（Public hostname）** 选择 EdgeSSH 实际使用的自定义域名，例如：

   ```text
   ssh.example.com
   ```

7. 不要把另一个无关域名，或未受保护的 `workers.dev` 地址当作正式入口。

Cloudflare 官方说明：
https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/

### 3. 添加身份访问策略

在应用的**访问策略（Access policies）**中创建一条策略：

| 项目 | 推荐值 |
| --- | --- |
| 策略名称（Policy name） | `EdgeSSH Admin` |
| 操作（Action） | `允许（Allow）` |
| 规则类型（Rule type） | `包括（Include）` |
| 选择器（Selector） | `电子邮件（Emails）` |
| 值（Value） | 你的完整邮箱，例如 `you@example.com` |

如果需要多个管理员，请逐个添加明确邮箱。

> [!WARNING]
> 不要使用**包括（Include）> 所有人（Everyone）**。如果使用一次性 PIN（One-time PIN），也不要只写**包括（Include）> 登录方式（Login Methods）> 一次性 PIN（One-time PIN）**，否则任何能接收邮件验证码的人都可能符合策略。
>
> 本项目也不建议使用**电子邮件以 @example.com 结尾（Emails ending in @example.com）**这类整域授权，除非你明确希望该域下所有可验证用户都能进入 EdgeSSH。

Cloudflare Access 默认拒绝未匹配允许（Allow）策略的用户。

策略说明：
https://developers.cloudflare.com/cloudflare-one/access-controls/policies/

### 4. 选择登录方式并保存应用

在应用的**身份验证（Authentication）**设置中，选择你希望允许的**标识提供程序（Identity Provider）**。

个人部署通常可以只保留：

```text
一次性 PIN（One-time PIN）
```

如果只启用一个标识提供程序，也可以开启 Cloudflare 的**应用即时身份验证（Apply instant authentication）**，让用户直接进入对应登录流程。

保存应用后，先打开 EdgeSSH 的自定义域名测试一次。正确情况下，浏览器会先进入 Cloudflare Access 登录，再进入 EdgeSSH。

## 获取 EdgeSSH 需要的两个 Access 参数

### ACCESS_TEAM_DOMAIN

进入 Cloudflare Zero Trust 的**设置（Settings）**，找到**团队名称（Team name）/ 团队域（Team domain）**。

例如 Cloudflare 显示：
<img width="730" height="583" alt="image" src="https://github.com/user-attachments/assets/6f095c14-5880-42b4-8850-4fc3d9b74386" />


则输入：

```text
my-team.cloudflareaccess.com
```

> [!IMPORTANT]
> `ACCESS_TEAM_DOMAIN` **不要带** `https://`，不要带路径，也不要带末尾斜杠。

### ACCESS_AUD

1. 进入 **Zero Trust > 访问控制（Access controls）> 应用程序（Applications）**。
2. 找到刚才创建的 EdgeSSH 应用，选择**配置（Configure）**。
3. 在**其他设置（Additional settings）**中找到**应用受众 (AUD) 标签（Application Audience (AUD) Tag）**。
4. 复制完整值。

Cloudflare 官方获取 AUD 的说明：
https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/

## 在 Cloudflare 控制台保存 Worker 机密（Secret）

先按 [部署指南](../DEPLOYMENT.md) 配置 GitHub Actions，并手动运行一次 `Deploy` 工作流（workflow）。首次部署完成、Worker 出现在 Cloudflare 后：

1. 打开 Cloudflare 控制面板（Dashboard），进入 **Workers 与 Pages（Workers & Pages）**。
2. 选择你的 EdgeSSH Worker（默认名称为 `edgessh`）。
3. 进入**设置（Settings）> 变量与机密（Variables and Secrets）**。
4. 添加 `ACCESS_TEAM_DOMAIN`，类型选择**机密（Secret）**，粘贴前面取得的团队域（Team Domain）。
5. 添加 `ACCESS_AUD`，类型选择**机密（Secret）**，粘贴前面取得的应用受众 (AUD) 标签（Application Audience (AUD) Tag）。
6. 按控制台提示保存并部署新版本。

不要把这两个值保存为 GitHub Actions 机密（Secret）。GitHub Actions 只需要 `CLOUDFLARE_ACCOUNT_ID` 和 `CLOUDFLARE_API_TOKEN` 两项部署凭据；Access 参数属于 Worker 运行时机密（Secret），应始终留在 Cloudflare 中。

EdgeSSH 还需要一个 `ENCRYPTION_KEY` Worker 机密（Secret）。它与上述两项在同一个控制台页面配置，生成要求和密钥保管注意事项见[部署指南](../DEPLOYMENT.md#worker-runtime-secrets)。生产部署不需要在本地执行 Wrangler 机密（Secret）或 Worker 部署命令。

## 验证配置

部署完成后建议检查：

1. 未登录时访问正式域名，应先出现 Cloudflare Access，而不是直接进入 EdgeSSH。
2. 不在允许（Allow）策略中的邮箱不能进入。
3. 使用允许的邮箱登录后，可以正常加载主机列表和 `/api/auth/me`。
4. 直接访问未受 Access 保护的入口，不应能够操作主机或建立 SSH 会话。
5. 不要把 `ACCESS_TEAM_DOMAIN`、`ACCESS_AUD`、Access 令牌（Token）或登录 Cookie 提交到 Git 仓库。

## 常见问题

### 页面能打开，但 EdgeSSH 提示“管理员尚未配置 Zero Trust Access”

检查：

- `ACCESS_TEAM_DOMAIN` 是否已经在 Worker 的**变量与机密（Variables and Secrets）**页面保存为**机密（Secret）**，并部署到当前版本。
- 团队域（Team Domain）是否为 `xxx.cloudflareaccess.com`，且没有 `https://`。
- `ACCESS_AUD` 是否已在同一页面保存为**机密（Secret）**，且值来自当前 Access 应用。

### 登录后提示“Access 登录已失效”

常见原因：

- `ACCESS_AUD` 来自另一个 Access 应用。
- `ACCESS_TEAM_DOMAIN` 属于另一个 Zero Trust 组织。
- 你通过没有受对应 Access 应用保护的域名进入 Worker。

### 一次性 PIN（One-time PIN）收不到邮件

先确认 Access 策略（Policy）中的**电子邮件（Emails）**与登录邮箱完全一致。

Cloudflare 对未被策略允许的邮箱不会发送验证码，但登录页面仍可能显示“验证码已发送”，以避免泄漏访问名单。邮件安全网关或链接扫描器也可能提前消耗验证码。

---

如果你已经有成熟的 Google / GitHub / Entra ID / Okta 等标识系统，可以继续使用现有标识提供程序（IdP）；EdgeSSH 并不要求一次性 PIN（One-time PIN）。关键要求只有两个：

- 用户必须先通过 Cloudflare Access 的身份认证与允许（Allow）策略。
- EdgeSSH 中配置的团队域（Team Domain）与 AUD 必须与这个 Access 应用一致。
