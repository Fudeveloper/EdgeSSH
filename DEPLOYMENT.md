# EdgeSSH 第一版：部署与验收

## 架构与边界

- 单管理员，无本地用户名、密码、注册、验证码或用户表。身份认证由 Cloudflare Zero Trust Access 完成。
- Access 应用策略只允许管理员的明确邮箱/身份，不能使用**所有人（Everyone）**、**绕过（Bypass）**或允许整个邮箱域的宽泛策略。
- Worker 使用 `jose` 校验 `Cf-Access-Jwt-Assertion` 的 RS256 签名、issuer、audience、有效期、subject 与邮箱。不信任单独的邮箱请求头。所有主机 API、SSH 票据和 WebSocket 附着均需认证。
- D1 中每条主机记录绑定 Access `sub`。AES-256-GCM 加密整个主机资料（包括地址、密码/私钥、指纹和城市），随机 96-bit IV，AAD 绑定账户及记录 ID。
- 密文格式 `v1.<base64 IV>.<base64 ciphertext + tag>`。数据库只明文保存 ID、账户 ID、更新时间。列表响应不包含凭据，连接时才请求解密后的凭据，并仅放在浏览器内存中。
- 当前不是端到端加密：Worker 在 SSH 连接时需要处理明文凭据。具有 Worker 和机密（Secret）管理权限的人属于信任边界。
- 首次保存/修改地址时，Worker 解析公网 IP，优先向 `https://ipwho.is` 查询城市，被 Cloudflare 共享出口限流或超时时回退至 GeoJS，不发送 SSH 用户名、凭据或命令。定位允许 A/AAAA 单类查询失败并在其他公网地址间回退，位置与实际查询 IP 一同存入加密 payload；前端可随时强制重新定位，失败不阻止保存或连接。
- 前端仍为 Vite + TypeScript，工作台继续复用原 SSH/SFTP/进程实现。地球使用 Mappo 的陆地掩码与 Canvas 球面投影，无 Three.js 等大型依赖；进入工作台后停止地球动画。

## 必需配置

| 名称 | 配置位置 | 含义 |
| --- | --- | --- |
| `DB` | `wrangler.toml` 的 D1 binding | 主机资料数据库，优先复用已有资源 |
| `SSH_SESSIONS` | `wrangler.toml` 的 Durable Object binding | SSH 会话隔离，保留现有类名及迁移历史 |
| `ASSETS` | `wrangler.toml` 的静态资源 binding | 前端构建产物，不需要手动创建 |
| `ACCESS_TEAM_DOMAIN` | GitHub Actions 机密（Secret） | 团队域名，例如 `my-team.cloudflareaccess.com`，部署时同步为 Worker 机密 |
| `ACCESS_AUD` | GitHub Actions 机密（Secret） | 此 Access 应用的应用受众 (AUD) 标签（Application Audience (AUD) Tag），部署时同步为 Worker 机密 |
| `ENCRYPTION_KEY` | GitHub Actions 机密（Secret） | 32 字节安全随机数的标准 Base64，部署时同步为 Worker 机密 |
| `CONNECT_TIMEOUT_MS` | 可选普通变量 | 建连超时；仓库默认 `10000`，通常不要额外配置 |

`DB`、`SSH_SESSIONS` 与 `ASSETS` 是绑定，不是环境变量。运行时 Secret 只有 `ACCESS_TEAM_DOMAIN`、`ACCESS_AUD` 与 `ENCRYPTION_KEY` 三项；部署流程还需要账户 ID 和 API Token。工作流不会把三个运行时 Secret 写入临时文件或命令行参数。

## Cloudflare 控制台配置

### 1. 确定资源名称

1. 默认 Worker 名称为 `edgessh`，默认 D1 名称为 `edgessh-accounts`。需要隔离多个实例时，可分别设置 Actions 变量 `WORKER_NAME` 与 `D1_DATABASE_NAME`。
2. 工作流会在目标账户中按名称查找 D1：存在就复用，不存在才创建。后续部署会继续复用同一资源，不需要把账户专属 `database_id` 写入仓库。
3. 只有需要绑定一个已知数据库时才设置可选变量 `D1_DATABASE_ID`；工作流会先确认该 ID 属于目标账户，验证失败时不会另建空库替代。
4. 数据表不需要在控制台手动建立。GitHub Actions 会执行远程 migration，只添加项目所需 schema，不清空已有数据。

### 2. 配置 Zero Trust Access

1. 进入 **Zero Trust > 访问控制（Access controls）> 应用程序（Applications）**，添加一个**自托管和私有应用（Self-hosted and private）**。
2. 应用域名填写最终访问 EdgeSSH 的实际域名。默认可使用 `<WORKER_NAME>.<你的 Workers 子域>.workers.dev`；自定义域名可选，只有设置 Actions 变量 `CUSTOM_DOMAIN` 时才使用它。
3. 添加**允许（Allow）**策略，只包含管理员的明确邮箱或身份。不要使用**所有人（Everyone）**、**绕过（Bypass）**或允许整个邮箱域的宽泛规则。
4. 在 Zero Trust 的团队设置中找到**团队域（Team Domain）**，保存不带 `https://` 和路径的域名，例如 `my-team.cloudflareaccess.com`。
5. 在 Access 应用详情中复制**应用受众 (AUD) 标签（Application Audience (AUD) Tag）**。不要把应用 ID、客户端 ID（Client ID）或策略 ID 当作 AUD。

### 3. 创建部署用 API 令牌（API Token）

1. 在 Cloudflare 个人资料的**API 令牌（API Tokens）**页面创建令牌（Token），选择官方**编辑 Cloudflare Workers（Edit Cloudflare Workers）**模板作为起点。
2. 在模板权限之外补充**账户（Account）**的 `D1: Edit` 权限，供工作流（workflow）执行远程迁移（migration）。
3. 保留模板中的 Worker 权限；只使用 `workers.dev` 时无需为自定义域名增加目标**区域（Zone）**权限。设置 `CUSTOM_DOMAIN` 时才保留相应区域权限。
4. **账户资源（Account Resources）**只选择实际部署账户；如使用自定义域名，**区域资源（Zone Resources）**也只选择对应域名，不要使用全账户、全站点范围。
5. 令牌（Token）创建后只会完整显示一次，将它直接保存为 GitHub Actions 机密（Secret），不要写进仓库或 Cloudflare Worker 变量。

Cloudflare 账户 ID 可在控制面板（Dashboard）的账户概览或 Worker 概览中复制。它不是机密（Secret），可保存为 GitHub Actions 变量（Variable）。

### 4. 配置 GitHub Actions

在 GitHub 仓库进入**设置（Settings）> 机密和变量（Secrets and variables）> Actions**：

| 名称 | GitHub 类型 | 值 |
| --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | 变量（Variable） | Cloudflare 账户 ID |
| `CLOUDFLARE_API_TOKEN` | 机密（Secret） | 上一步创建的最小权限 API 令牌（API Token） |
| `ACCESS_TEAM_DOMAIN` | 机密（Secret） | Zero Trust 团队域（Team Domain），不带协议和路径 |
| `ACCESS_AUD` | 机密（Secret） | 实际访问域名对应 Access 应用的 AUD |
| `ENCRYPTION_KEY` | 机密（Secret） | 32 字节安全随机数的标准 Base64，只在首次部署时生成 |

可选变量为 `WORKER_NAME`、`D1_DATABASE_NAME`、`D1_DATABASE_ID` 与 `CUSTOM_DOMAIN`。不填写 `CUSTOM_DOMAIN` 时，Worker 直接发布到该账户的 `workers.dev` 域名；这不会影响 D1、Durable Object 或 Access JWT 校验。

进入 **Actions > Deploy > 运行工作流（Run workflow）** 完成首次部署。工作流（workflow）会校验配置、检查项目、创建或复用 D1、应用迁移、通过标准输入同步 Worker 机密，并创建或更新 Worker。

<a id="worker-runtime-secrets"></a>

### 5. 生成并保管加密密钥

`ENCRYPTION_KEY` 应由可信的密码管理器或本机安全随机数工具生成，解码后必须正好为 32 字节。将它与 `ACCESS_TEAM_DOMAIN`、`ACCESS_AUD` 一起保存为 GitHub Actions 机密（Secret）。工作流负责同步它们；不要为 `DB`、`SSH_SESSIONS` 或 `ASSETS` 创建同名变量。`CONNECT_TIMEOUT_MS` 已由 `wrangler.toml` 设置为 `10000`，只有确实需要调整 2,000 至 30,000 毫秒的建连超时时才在配置中修改。

不要使用普通密码、UUID、示例值或在线随机字符串网页作为 `ENCRYPTION_KEY`。密钥丢失将无法解密现有资料；当前版本不支持直接轮换，后续部署必须复用原值。

## 部署顺序

1. 确定 Worker、D1 名称与实际访问域名；自定义域名可选，默认使用 `workers.dev`。
2. 为实际访问域名配置 Access 与最小权限 API 令牌（API Token），再将必需变量和机密保存到 GitHub Actions。
3. 手动运行一次 `Deploy` 工作流（workflow），让 GitHub Actions 自动创建或复用 D1、迁移数据库、同步机密并创建或更新 Worker。
4. 以后只需推送到 `main`；工作流会按相同名称复用远端资源并自动发布，不需要在本地执行 Wrangler 部署命令。
5. 通过实际 Access 入口验收。所有账号、主机与连接 API 均需 Access 保护；缺少 Access 机密（Secret）时部署会在创建资源前失败。

密钥丢失将无法解密现有资料。更换密钥必须设计旧密钥解密、新密钥重加密的迁移，不可直接覆盖机密（Secret）。当前版本不提供自动轮换。更换 Access 团队或身份导致 `sub` 改变时，也需要显式的数据迁移。

### GitHub Actions

`.github/workflows/deploy.yml` 在推送到 `main` 或手动触发时依次执行安装、项目检查、远程 D1 迁移与 Worker 部署。生产部署使用并发锁串行执行，避免迁移和 Worker 版本交错。

仓库必须配置五个 Actions 值：

| 名称 | 配置位置 | 要求 |
| --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Actions 变量（Variable） | 目标 Cloudflare 账户 ID |
| `CLOUDFLARE_API_TOKEN` | Actions 机密（Secret） | 限定到目标账户，并具备 Workers 部署与 D1 迁移权限 |
| `ACCESS_TEAM_DOMAIN` | Actions 机密（Secret） | Zero Trust 团队域（Team Domain） |
| `ACCESS_AUD` | Actions 机密（Secret） | 实际访问域名对应 Access 应用的 AUD |
| `ENCRYPTION_KEY` | Actions 机密（Secret） | 首次生成后长期复用的加密密钥 |

可选 Actions 变量包括 `WORKER_NAME`、`D1_DATABASE_NAME`、`D1_DATABASE_ID` 与 `CUSTOM_DOMAIN`。三个运行时机密由工作流通过标准输入同步到 Worker；不要把本地 `.dev.vars` 或 `wrangler secret put` 作为普通用户的生产配置流程。

## 验收清单（5.6 SOL 执行）

- `npm run typecheck`、`npm test`、`npm run build:web`、Wrangler dry-run。
- Access：无 JWT、伪造 JWT、错误签名、错误 audience、错误 issuer、过期令牌均不能访问主机、票据和三种 WebSocket。
- 两个不同 `sub` 的测试身份不能读取、修改、删除或解密彼此主机；DO 票据及辅助通道绑定相同账户。
- 拒绝跨站 Origin；写操作缺少 Origin 也应拒绝；错误不泄露堆栈、凭据或数据库内容。
- D1 新增/修改/删除、刷新后恢复、空密码语义、私钥保存、留空保留凭据、切换认证方式、指纹持久化。
- AES-GCM 随机 IV、错误密钥/账户/主机 ID/篡改密文均不能解密，直接检查 D1 中不存在主机明文和凭据。
- 定位失败不阻塞保存；私人地址不会被拿来发 HTTP 请求；城市标签与实际记录对应。
- 地球点位和列表均可进入工作台；返回总览断开会话；工作台不显示/运行地球；刷新后主机仍存在。
- 空列表、错误态、编辑/删除确认、搜索、分组、键盘操作；截图检查桌面及 320/375/414/768px，无水平溢出。
- 用真实获授权的 SSH 测试目标验收握手、主机指纹、终端、SFTP 与进程面板。若未提供目标凭据，不得声称真实 SSH 验收通过。
- 测试数据只用明确测试身份和测试主机，完成后清除自己创建的测试记录；不得清空生产表。

## 第一版限制

- 每个身份最多 200 台主机；无团队共享、后台密码登录、账号找回或旧浏览器记录自动导入。
- 地球位置不等于在线状态，没有伪造的在线数、延迟和会话历史。
- 同一城市的多个点可能接近，列表为完整可访问入口。
- 首页为中文；原 SSH 工作台保留中英文切换。
- 国旗使用本地 `flag-icons` SVG（MIT，许可证随静态资源部署），在 Windows 上也显示实际旗帜，不依赖 emoji 字体。

## 2026-09-19 线上部署记录

- 正式入口：`https://ssh.dltwcnm.ccwu.cc`
- D1：`edgessh-accounts`（`2c1b7a95-a5d6-4a72-a8d2-4132b74aa268`）
- D1 schema：`hosts`、`d1_migrations`；记录数分别为 0、1
- 活动版本：由 GitHub Actions 的 `Deploy` 工作流（workflow）自动发布，当前状态以 Actions 运行记录与 Cloudflare 控制台为准
- 机密（Secret）名称：`ENCRYPTION_KEY`、`ACCESS_TEAM_DOMAIN`、`ACCESS_AUD`；本次部署未读取或覆盖任何运行时机密
- 无会话冒烟检查（Smoke）：正式入口 `/` 与 `/api/auth/me` 均返回 Access 302，TLS 正常；未记录重定向地址、团队域（Team Domain）、AUD、JWT、Cookie 或机密（Secret）值
- 诊断入口：`workers.dev` 已开启，仅额外公开固定 `8.8.8.8` 的定位链路检查；账号、主机、凭据与 SSH 等接口仍必须通过 Access JWT 校验
- 待验收：需要用户登录 Access 后验收账号 API，并使用真实授权 SSH 目标验收终端、SFTP 与进程面板

## 访问域名

- 公共模板默认启用 `workers.dev`，不要求用户拥有自定义域名。
- 当前项目实例另行设置了自定义正式入口 `https://ssh.dltwcnm.ccwu.cc`；这不是其他部署者的必需配置。
- 无论使用 `workers.dev` 还是自定义域名，都必须为实际入口配置对应的 Access 应用。Worker 还会在应用层校验所有账号与连接 API 的 Access JWT。
