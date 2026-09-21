# EdgeSSH 部署与验收

## 三项准备

1. 在 Cloudflare **启用 Zero Trust**，完成团队域名与计划初始化。组织开通涉及账户确认，不由脚本代办。
2. Fork 本仓库，启用 GitHub Actions，在 **Settings > Secrets and variables > Actions** 保存 `CLOUDFLARE_API_TOKEN` Secret。
3. 在 **Actions > Deploy > Run workflow** 输入管理员邮箱，运行并等待摘要给出访问地址。可将邮箱保存为 `ADMIN_EMAIL` Variable，省去重复输入。

无需手动创建 Access 应用、OTP、D1，也无需抄录 Account ID、Team Domain 或 AUD。默认入口是 `https://edgessh.<账户子域>.workers.dev`。没有自定义域名也能使用。

## API Token 权限

以 Cloudflare **Edit Cloudflare Workers** 模板为起点，保留部署所需权限，并补齐以下账户权限。控制台的 Edit/Read 对应 API 文档的 Write/Read。

| 账户权限 | 级别 | 用途 |
| --- | --- | --- |
| Workers Scripts | Edit | Worker、Durable Object、Secret 和子域部署 |
| Workers KV Storage | Edit | 保留官方 Workers 模板的部署权限 |
| Account Settings | Read | 自动发现账户 |
| D1 | Edit | 查找/创建数据库、检查旧数据与执行迁移 |
| Access: Apps and Policies | Edit | 查找/创建 Access 应用及邮箱策略 |
| Access: Organizations, Identity Providers, and Groups | Edit | 获取团队域名、查找/创建 OTP |

账户资源只选择实际部署账户。若 Token 可访问多个账户，设置 Actions Variable `CLOUDFLARE_ACCOUNT_ID`，脚本不会猜测目标账户。

只用 `workers.dev` 不需要自定义域名的 Zone 权限。使用 `CUSTOM_DOMAIN` 时，还需模板的 **Zone > Workers Routes: Edit、Zone: Read**，并将区域范围限定到该域名所在 Zone。域名必须已经由同账户的 Cloudflare 管理。

API Token 只存 GitHub Secret，不放普通变量、代码或命令行输入框。不要将 Token 填到 Run workflow 的邮箱字段。

## 自动执行顺序

1. 校验本地配置，运行类型检查、测试、前端构建和 Wrangler dry-run。
2. 自动发现唯一账户（显式账户 ID 优先），读取现有 Worker Secret **名称**，不尝试读取密钥明文。
3. 默认读取账户 `workers.dev` 子域；未注册时自动注册确定性名称。已有子域不改名，避免影响其他 Worker。
4. 读取 Zero Trust 团队域；按精确 hostname 复用 Access 自托管应用，或创建应用及明确邮箱的 Allow 策略。
5. 新应用默认复用/创建 One-time PIN；存在的应用不重写登录方式和人工策略。
6. 按 ID 或名称复用 D1，不存在才创建；指定 ID 不存在时直接失败，不用新空库替代。
7. 已有 `ENCRYPTION_KEY` 则保留；没有密钥且 D1 没有主机资料时，用安全随机数生成 32 字节密钥。
8. 执行远程 migration，仅应用增量 schema，不清空数据。
9. 新增 Secret 只通过标准输入交给 Wrangler；部署 Worker，复核三个运行时 Secret 的名称，并将入口写入运行摘要。

生产任务通过 concurrency 串行运行，失败可修正原因后重跑，已创建的资源会复用。请勿用多个仓库同时管理同一个 Worker。

设置自定义域名时关闭备用 `workers.dev` 入口，所有部署关闭 preview URL。Worker 内仍校验 JWT 的签名、issuer、audience、期限、subject 与邮箱；缺少认证不降级为匿名 SSH。

## 可选配置

| 名称 | GitHub 位置 | 默认/示例 |
| --- | --- | --- |
| `ADMIN_EMAIL` | Variable，兼容 Secret | `you@example.com`；Run workflow 输入优先 |
| `CLOUDFLARE_ACCOUNT_ID` | Variable，兼容 Secret | 仅多账户 Token 需要指定 |
| `WORKER_NAME` | Variable | `edgessh` |
| `D1_DATABASE_NAME` | Variable | `<Worker 名>-accounts` |
| `D1_DATABASE_ID` | Variable | 指定已有 D1 UUID，不填则按名称查找 |
| `CUSTOM_DOMAIN` | Variable，兼容 Secret | `ssh.example.com`；Secret 优先；`*.workers.dev` 不可填 |
| `ACCESS_IDP_IDS` | Variable | 新应用采用的 IdP UUID，多个用逗号分隔 |
| `ENCRYPTION_KEY` | Secret，仅恢复/迁移使用 | 仅 Worker 尚无密钥时使用；已有密钥不会覆盖 |

`DB`、`SSH_SESSIONS`、`ASSETS` 是资源绑定，不是需要用户创建的变量。`CONNECT_TIMEOUT_MS` 已有默认值 `10000`。

<a id="worker-runtime-secrets"></a>

## 密钥生命周期与旧版升级

- 运行时 `ENCRYPTION_KEY`、`ACCESS_TEAM_DOMAIN`、`ACCESS_AUD` 的持久化来源是 **Cloudflare Worker Secrets**。不要保存为 Variable 或明文配置。
- 新部署不需要 GitHub 写 Secrets 权限或额外 GitHub Token。生成的值不写入文件、命令行参数或 Actions artifact。
- 重跑、推送新代码时保留原加密密钥。GitHub 中遗留的同名密钥不会替换 Worker 中的密钥。
- **已有 D1 主机资料但缺少密钥时停止部署。** 必须恢复原密钥，不能生成新密钥假装修复。Cloudflare API 不提供 Secret 明文读回，自动生成的密钥也不会显示给用户；不要删除 Worker/Secret。需要独立灾备时，可在首次部署前自行生成并安全备份 32 字节 Base64 密钥，再保存为 `ENCRYPTION_KEY` GitHub Secret。
- 旧部署已有三个 Worker Secrets 时，无需重新输入邮箱即可部署，也不要求复制 Secret 回 GitHub；脚本保留既有 Access 配置。这兼容人工管理的 Zone 级 Access 应用。
- 若需要自动创建/管理 Access，或更换 hostname，请提供 `ADMIN_EMAIL`。自动管理使用账户级 Access API；原有 Zone 级应用请先核对，不要在同一 hostname 叠加应用。
- 更换密钥、Zero Trust 组织或导致用户 `sub` 改变的身份迁移需要单独的数据迁移方案，不包含在普通 Deploy 中。

## 登录方式扩展：GitHub OAuth

认证与授权分开：

- **登录方式（IdP）**：默认 OTP；未来可用 Cloudflare Access 的 GitHub OAuth，仍由 Access 向 Worker 签发 JWT。
- **授权策略（Policy）**：默认明确管理员邮箱。添加 GitHub 登录不会自动把整个 GitHub 组织或所有用户加入允许名单。

有现成 GitHub IdP 时，首次创建应用可通过 `ACCESS_IDP_IDS` 指定它；未设置时自动配置 OTP。多 IdP 新应用不启用单一 IdP 自动跳转。

已部署应用请在 Zero Trust 控制台添加 GitHub IdP、将其加入应用允许的登录方式，并在需要显示多种方式时关闭 instant authentication。后续 Deploy **不覆盖**这些设置，`ACCESS_IDP_IDS` 只控制新应用的默认配置。

脚本只更新名为 `EdgeSSH <Worker 名> administrator` 的自动邮箱策略。改用 GitHub 组织/团队等授权时，可将这条策略改名后自行管理；其他人工策略保持不变。管理员 GitHub 身份的邮箱仍需匹配邮箱策略。不要直接新增 Everyone、Bypass 或整域邮箱授权。

未来如果要实现不经过 Access 的原生 GitHub OAuth，则还需设计回调、会话与身份映射；本次没有混入第二套登录系统。

## 排障

- **403**：检查 Token 权限及账户/Zone 范围，不是重新生成加密密钥。
- **找不到唯一账户**：限定 Token 到一个账户，或配置 `CLOUDFLARE_ACCOUNT_ID`。
- **组织读取失败**：先完成 Zero Trust 开通和团队域设置。
- **首次部署缺少邮箱**：在 Run workflow 输入，或设置 `ADMIN_EMAIL`。
- **既有策略被人工修改**：脚本不会覆盖额外 require/exclude 等条件；在控制台维护，或改名后重跑。
- **更换域名后无法登录**：带邮箱重新运行以配置新 hostname 的应用；不要仅改路由而沿用旧 AUD。
- **OTP 未收到**：确认输入邮箱完全匹配 Allow 策略，检查垃圾邮件。GitHub 等其他 IdP 的账户邮箱同样必须匹配授权。
- 手工配置、截图与 Access JWT 排查见 [Zero Trust 指南](docs/ZERO_TRUST.md)。

## 验收清单

- `npm run check`：类型检查、测试、前端构建与部署 dry-run。
- 空账户 bootstrap 与重复部署：只创建一次应用/OTP/D1，密钥不轮换，不覆盖 GitHub IdP。
- 未登录访问入口应跳转 Access；未授权邮箱不可进入。
- 登录后 `/api/auth/me` 与主机列表可用；无 JWT、伪造/过期 JWT 不可访问主机、票据或 WebSocket。
- 加密资料跨部署保持可解密；测试不得清空生产 D1。
- 真实 SSH、SFTP 与进程面板必须使用已获授权目标；未提供目标和登录会话时不声称验收完成。
