# EdgeSSH 第一版：部署与验收

面向部署者的最新分步教程、截图占位与故障排查统一维护在 [EdgeSSH 文档网站](https://edgessh-docs.pages.dev/deploy/actions)。本文件保留架构边界和维护者验收记录。

## 架构与边界

- 单管理员，无本地用户名、密码、注册、验证码或用户表。身份认证由 Cloudflare Zero Trust Access 完成。
- Access 应用策略只允许管理员的明确邮箱/身份，不能使用 Everyone、Bypass 或允许整个邮箱域的宽泛策略。
- Worker 使用 `jose` 校验 `Cf-Access-Jwt-Assertion` 的 RS256 签名、issuer、audience、有效期、subject 与邮箱。不信任单独的邮箱请求头。所有主机 API、SSH 票据和 WebSocket 附着均需认证。
- D1 中每条主机记录绑定 Access `sub`。AES-256-GCM 加密整个主机资料（包括地址、密码/私钥、指纹和城市），随机 96-bit IV，AAD 绑定账户及记录 ID。
- 密文格式 `v1.<base64 IV>.<base64 ciphertext + tag>`。数据库只明文保存 ID、账户 ID、更新时间。列表响应不包含凭据，连接时才请求解密后的凭据，并仅放在浏览器内存中。
- 当前不是端到端加密：Worker 在 SSH 连接时需要处理明文凭据。具有 Worker 和 Secret 管理权限的人属于信任边界。
- 首次保存/修改地址时，Worker 解析公网 IP，优先向 `https://ipwho.is` 查询城市，被 Cloudflare 共享出口限流或超时时回退至 GeoJS，不发送 SSH 用户名、凭据或命令。定位允许 A/AAAA 单类查询失败并在其他公网地址间回退，位置与实际查询 IP 一同存入加密 payload；前端可随时强制重新定位，失败不阻止保存或连接。
- 前端仍为 Vite + TypeScript，工作台继续复用原 SSH/SFTP/进程实现。地球使用 Mappo 的陆地掩码与 Canvas 球面投影，无 Three.js 等大型依赖；进入工作台后停止地球动画。

## 必需配置

| 名称 | 配置位置 | 含义 |
| --- | --- | --- |
| `DB` | workflow 生成的 D1 binding | 主机资料数据库，首次自动创建、后续按名称复用 |
| `SSH_SESSIONS` | `wrangler.toml` 的 Durable Object binding | SSH 会话隔离，保留现有类名及迁移历史 |
| `ASSETS` | `wrangler.toml` 的静态资源 binding | 前端构建产物，不需要手动创建 |
| `ACCESS_TEAM_DOMAIN` | GitHub Actions Secret，同步为 Worker Secret | 团队域名，例如 `my-team.cloudflareaccess.com`，不含协议或路径 |
| `ACCESS_AUD` | GitHub Actions Secret，同步为 Worker Secret | 此 Access 应用的 Application Audience (AUD) Tag |
| `ENCRYPTION_KEY` | GitHub Actions Secret，同步为 Worker Secret | 32 字节安全随机数的标准 Base64 |
| `CONNECT_TIMEOUT_MS` | 可选普通变量 | 建连超时；仓库默认 `10000`，通常不要额外配置 |

`DB`、`SSH_SESSIONS` 与 `ASSETS` 是绑定，不是环境变量。三项运行时值由 GitHub Actions 在部署时同步为 Worker Secret，无需进入 Worker 控制台重复填写。

### 用户填写总览

使用自定义域名完成正式部署时，一共填写 **6 个值**：

| 名称 | 填写位置 | 来源 |
| --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub Actions Variable | Cloudflare 账户概览或 Worker 概览 |
| `CUSTOM_DOMAIN` | GitHub Actions Variable | 已接入当前 Cloudflare 账户的自定义域名 |
| `CLOUDFLARE_API_TOKEN` | GitHub Actions Secret | Cloudflare API Tokens 页面创建 |
| `ACCESS_TEAM_DOMAIN` | GitHub Actions Secret | Zero Trust Settings 中的 Team Domain |
| `ACCESS_AUD` | GitHub Actions Secret | Self-hosted Access 应用的 AUD Tag |
| `ENCRYPTION_KEY` | GitHub Actions Secret | 本机或可信密码管理器生成的 32 字节随机数 Base64 |

以上 6 项是正式部署的完整必填清单。`WORKER_NAME` 和 `D1_DATABASE_NAME` 是可选的 GitHub Actions Variable，默认分别为 `edgessh` 和 `<WORKER_NAME>-accounts`。D1 数据库、数据库 ID、数据表、Worker 及 Custom Domain route 均由 workflow 创建或更新，不要求用户编辑 `wrangler.toml`。

## 准备 Cloudflare 身份与凭据

Cloudflare 控制台只用于创建 API Token 与 Zero Trust Access 应用。不要在控制台手工创建 D1、部署 Worker 或维护另一套 Worker Secret。

### 1. D1 自动初始化

无需在控制台创建 D1，也不要修改 `wrangler.toml` 中的占位 ID。workflow 会使用 `D1_DATABASE_NAME`，或默认的 `<WORKER_NAME>-accounts`，在目标账户中按精确名称查找数据库：

1. 已存在同名数据库时，读取其 ID 并继续复用。
2. 不存在时，通过 Cloudflare API 创建一次，再把新 ID 写入 runner 内的临时 Wrangler 配置。
3. 使用该临时配置执行远程 migration，只添加项目所需 schema，不清空已有数据。

数据库 ID 不会写回仓库。改变 `D1_DATABASE_NAME` 会改用或创建另一个数据库，因此日常部署应保持名称稳定。

### 2. 配置 Zero Trust Access

1. 进入 `Zero Trust > Access > Applications`，添加一个 `Self-hosted` 应用。
2. 应用域名填写最终访问 EdgeSSH 的自定义域名，并保证该域名与 GitHub Actions 的 `CUSTOM_DOMAIN` Variable 一致。
3. 添加 Allow 策略，只包含管理员的明确邮箱或身份。不要使用 `Everyone`、`Bypass` 或允许整个邮箱域的宽泛规则。
4. 在 Zero Trust 的团队设置中找到 Team Domain，保存不带 `https://` 和路径的域名，例如 `my-team.cloudflareaccess.com`。
5. 在 Access 应用详情中复制 Application Audience (AUD) Tag。不要把应用 ID、Client ID 或策略 ID 当作 AUD。

### 3. 创建部署用 API Token

1. 在 Cloudflare 个人资料的 `API Tokens` 页面创建 Token，选择官方 `Edit Cloudflare Workers` 模板作为起点。
2. 在模板权限之外补充 Account 的 `D1: Edit`，供 workflow 执行远程 migration。
3. 保留模板中的 Worker 与目标 Zone 权限，用于部署脚本及 `custom_domain = true` 的自定义域名；不需要添加 KV、R2 等本项目未使用资源的额外权限。
4. Account Resources 和 Zone Resources 都只选择实际部署所用的账户与域名，不要使用全账户、全站点范围。
5. Token 创建后只会完整显示一次，将它直接保存为 GitHub Actions Secret，不要写进仓库或 Cloudflare Worker 变量。

Cloudflare 账户 ID 可在 Dashboard 的账户概览或 Worker 概览中复制。它不是 Secret，可保存为 GitHub Actions Variable。

### 4. 配置 GitHub Actions

在 GitHub 仓库进入 `Settings > Secrets and variables > Actions`：

| 名称 | GitHub 类型 | 值 |
| --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Variable | Cloudflare 账户 ID |
| `CUSTOM_DOMAIN` | Variable | 自定义域名的纯主机名 |
| `CLOUDFLARE_API_TOKEN` | Secret | 上一步创建的最小权限 API Token |
| `ACCESS_TEAM_DOMAIN` | Secret | Zero Trust Team Domain，不带协议或路径 |
| `ACCESS_AUD` | Secret | Self-hosted Access 应用的 AUD Tag |
| `ENCRYPTION_KEY` | Secret | 固定的 32 字节安全随机数 Base64 |

可选项放在必填项之后，第一次部署通常不要填写：

| 名称 | GitHub 类型 | 默认值 |
| --- | --- | --- |
| `WORKER_NAME` | 可选 Variable | `edgessh` |
| `D1_DATABASE_NAME` | 可选 Variable | `<WORKER_NAME>-accounts` |

六项必填配置全部保存后，进入 `Actions > Deploy > Run workflow` 完成首次部署。workflow 会安装依赖、检查项目、创建或复用 D1、同步运行时 Secret、执行 migration，并创建或更新 Worker 与自定义域名。

### 5. 生成并保存运行时 Secret

在首次部署前，将以下三项添加到 GitHub Actions 的 **Secrets**，不要添加到 Variables：

| 名称 | 填写内容 |
| --- | --- |
| `ACCESS_TEAM_DOMAIN` | Zero Trust Team Domain，不带协议和路径 |
| `ACCESS_AUD` | Access 应用详情中的 Application Audience (AUD) Tag |
| `ENCRYPTION_KEY` | 32 字节安全随机数的标准 Base64，只在首次部署前生成 |

workflow 会校验三项 Secret 是否存在，并通过标准输入调用 Wrangler 的批量 Secret API；Secret 不会进入命令参数、临时配置或日志。不要为 `DB`、`SSH_SESSIONS` 或 `ASSETS` 创建同名变量。`CONNECT_TIMEOUT_MS` 已由 `wrangler.toml` 设置为 `10000`，只有确实需要调整 2,000 至 30,000 毫秒的建连超时时才在配置中修改。

`ENCRYPTION_KEY` 应由可信的密码管理器或本机安全随机数工具生成，解码后必须正好为 32 字节。不要使用普通密码、UUID、示例值或在线随机字符串网页。密钥丢失将无法解密现有资料；当前版本不支持直接轮换，后续部署必须复用原值。

可在本机运行 `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` 生成一次；只把输出保存到 Secret，命令本身不会把密钥写入项目文件。

## 部署顺序

1. 确定自定义域名；如需覆盖默认值，再确定稳定的 Worker 名称与 D1 名称。同一 Cloudflare 账户内不要与无关项目重名。
2. 配置 Access 与最小权限 API Token，再将部署凭据、三项运行时 Secret 和可选名称统一保存到 GitHub Actions。
3. 手动运行一次 `Deploy` workflow，让 GitHub Actions 自动创建或复用 D1、同步 Worker Secret、执行 migration，并创建或更新 Worker。
4. 以后只需推送到 `main`；workflow 会复用现有资源，并以 GitHub Actions 中的固定 Secret 自动发布，不需要再进入 Worker 控制台或在本地执行 Wrangler 命令。
5. 通过实际 Access 入口验收。所有账号、主机与连接 API 均需 Access 保护；缺少 Access Secret 时部署会直接失败，不会发布一个待补配置的版本。

密钥丢失将无法解密现有资料。更换密钥必须设计旧密钥解密、新密钥重加密的迁移，不可直接覆盖 Secret。当前版本不提供自动轮换。更换 Access 团队或身份导致 `sub` 改变时，也需要显式的数据迁移。

### GitHub Actions

`.github/workflows/deploy.yml` 在推送到 `main` 或手动触发时依次执行安装、项目检查、D1 幂等初始化、远程 migration 与 Worker 部署。生产部署使用并发锁串行执行，避免初始化、迁移和 Worker 版本交错。

`Deploy` workflow 使用“用户填写总览”中的 6 项必填配置。资源名称仍是可选 Variable：

| 名称 | 默认值 |
| --- | --- |
| `WORKER_NAME` | `edgessh` |
| `D1_DATABASE_NAME` | `<WORKER_NAME>-accounts` |

三个运行时 Secret 只保存在 GitHub Actions Secrets 与 Cloudflare Worker Secrets 中。workflow 每次部署都会从 Actions 环境读取并幂等同步，用户无需打开 Cloudflare Worker 的 `Variables and Secrets` 页面；不要把本地 `.dev.vars` 或手动 `wrangler secret put` 作为普通用户的生产配置流程。

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

## 部署后验收

- 仓库中的 `wrangler.toml` 只包含 D1 占位 ID，不包含维护者账户的资源 ID 或固定自定义域名。
- workflow 按 `D1_DATABASE_NAME` 在部署者自己的账户内查找或创建 D1，把真实 ID 仅写入 runner 内已忽略的 `wrangler.deploy.toml`，再执行 migration 与 Worker 部署。
- workflow 使用必填的 `CUSTOM_DOMAIN`，为部署者自己的域名创建或更新 Custom Domain。
- 首次部署后确认 D1 中存在 `hosts` 与 `d1_migrations` 表，再通过 Access 登录，完成主机新增、刷新后恢复、编辑和删除验收。
- 账号、主机、凭据与 SSH 接口始终校验 Access JWT；`workers.dev` 不能绕过应用层认证。
