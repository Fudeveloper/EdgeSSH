# EdgeSSH 第一版：部署与验收

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

| 名称 | 配置方式 | 含义 |
| --- | --- | --- |
| `DB` | D1 binding | `edgessh-accounts` 数据库，优先复用已有资源 |
| `ACCESS_TEAM_DOMAIN` | **Worker Secret** | 团队域名，例如 `my-team.cloudflareaccess.com`，不含协议或路径 |
| `ACCESS_AUD` | **Worker Secret** | 此 Access 应用的 Application Audience (AUD) Tag |
| `ENCRYPTION_KEY` | **Worker Secret** | 32 字节安全随机数的标准 Base64 |
| `SSH_SESSIONS` | Durable Object binding | 保留上游 DO 类及迁移历史 |

### 部署顺序

1. 检查 Cloudflare 已有 Worker、D1；确认目标应用为本项目，避免覆盖其他项目。不自动读取或配置 Zero Trust。
2. 复用或创建 `edgessh-accounts`，将目标环境的真实 `database_id` 写入 `wrangler.toml`；仓库当前配置的是线上数据库。
3. Zero Trust 应用、域名及单管理员 Allow 策略由用户自行配置，本项目部署过程不代为创建或修改。
4. 用户配置 Access 后，分别通过 `wrangler secret put ACCESS_TEAM_DOMAIN` 与 `wrangler secret put ACCESS_AUD` 注入。所有账号、主机与连接 API 均需 Access 保护；`workers.dev` 只允许固定测试 IP 的无敏感信息诊断。缺少这两个 Secret 时可先部署，但受保护 API 会返回 503，不能操作主机或连接 SSH。
5. **只在首次部署时生成密钥**，通过标准输入执行 `wrangler secret put ENCRYPTION_KEY` 注入。不要在命令参数、源码、日志或明文配置里输出密钥。已有 Secret 必须复用，不可随意覆盖。
6. 执行 `npx wrangler d1 migrations apply DB --remote`，仅添加 schema，不清空或重置数据。
7. 执行 `npm run check`，然后 `npm run deploy`，通过实际 Access 入口验收。

密钥丢失将无法解密现有资料。更换密钥必须设计旧密钥解密、新密钥重加密的迁移，不可直接覆盖 Secret。当前版本不提供自动轮换。更换 Access 团队或身份导致 `sub` 改变时，也需要显式的数据迁移。

### GitHub Actions

`.github/workflows/deploy.yml` 在推送到 `main` 或手动触发时依次执行安装、项目检查、远程 D1 迁移与 Worker 部署。生产部署使用并发锁串行执行，避免迁移和 Worker 版本交错。

仓库只需配置两个 Actions 值：

| 名称 | 配置位置 | 要求 |
| --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Actions Variable | 目标 Cloudflare 账户 ID |
| `CLOUDFLARE_API_TOKEN` | Actions Secret | 限定到目标账户，并具备 Workers 部署与 D1 迁移权限 |

三个运行时 Worker Secret 不进入 GitHub Actions。首次部署或主动轮换时仍使用 `wrangler secret put` 单独管理；日常自动部署只复用 Cloudflare 中已有值。

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
- 活动版本：`e587a233-7767-4a3d-ba67-0ba8fa255285`
- Secret 名称：`ENCRYPTION_KEY`、`ACCESS_TEAM_DOMAIN`、`ACCESS_AUD`；本次部署未读取或覆盖任何运行时 Secret
- 无会话 Smoke：正式入口 `/` 与 `/api/auth/me` 均返回 Access 302，TLS 正常；未记录重定向地址、Team Domain、AUD、JWT、Cookie 或 Secret 值
- 诊断入口：`workers.dev` 已开启，仅额外公开固定 `8.8.8.8` 的定位链路检查；账号、主机、凭据与 SSH 等接口仍必须通过 Access JWT 校验
- 待验收：需要用户登录 Access 后验收账号 API，并使用真实授权 SSH 目标验收终端、SFTP 与进程面板

## 自定义域名

- 正式入口：`https://ssh.dltwcnm.ccwu.cc`
- `workers.dev` 作为诊断入口保留；Worker 仍在应用层强制校验所有生产账号与连接 API，不允许绕过自定义域名上的 Access 策略。
- Access 应用与策略由用户在 Cloudflare 控制台维护；部署流程只注入 Team Domain 与应用 AUD。
