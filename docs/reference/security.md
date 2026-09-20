# 架构与安全边界

EdgeSSH 让个人管理员通过浏览器访问 SSH，但它不会把 Worker 变成“不可信中转”。理解信任边界，是决定是否保存生产凭据的前提。

## 请求路径

```text
Cloudflare Access
  │ 注入并签名 Access JWT
  ▼
Worker
  ├─ 校验签名、issuer、audience、有效期、sub 与邮箱
  ├─ API：按 Access sub 读取当前身份的数据
  ├─ D1：读取或写入 AES-256-GCM 密文
  └─ 一次性会话票据
        ▼
Durable Object
  ├─ SSH 传输、认证与终端通道
  ├─ SFTP 辅助通道
  └─ 进程与系统信息通道
        ▼
公网 SSH 服务器
```

## 身份边界

EdgeSSH 不信任单独的邮箱请求头。Worker 使用 `jose` 验证 `Cf-Access-Jwt-Assertion`，并检查：

- RS256 签名。
- Issuer 是否属于配置的 Team Domain。
- Audience 是否匹配当前 Access 应用。
- 有效期。
- 用户 `sub` 与邮箱。

主机 API、会话票据和各类 WebSocket 附着都要求有效身份。

## 数据加密

每条主机记录绑定 Access `sub`。Worker 使用 AES-256-GCM 加密完整主机资料，包括地址、密码或私钥、服务器指纹和位置。

- 每次加密使用随机 96-bit IV。
- AAD 绑定账户和记录 ID。
- 数据库存储 `v1.<base64 IV>.<base64 ciphertext + tag>` 格式密文。
- 列表响应不返回连接凭据。

`ENCRYPTION_KEY` 丢失后，现有密文无法恢复。直接替换 Secret 不会自动重加密数据。

## 不是端到端加密

Worker 是 SSH 客户端，需要在内存中处理明文连接凭据。以下主体属于信任边界：

- 可以修改 Worker 代码并部署的人。
- 可以读取或修改 Worker Secret 的人。
- 可以修改 GitHub Actions 部署凭据的人。
- Cloudflare 账户本身。

因此，EdgeSSH 适合部署在个人或明确受控的账户中，不应把未知第三方部署当作凭据保险箱。

## 目标地址限制

Worker 会解析目标主机并拒绝私人、回环、链路本地等非公网地址，降低 SSRF 和 DNS 重绑定风险。地理定位服务只接收服务器公网 IP，不接收 SSH 用户名、密码、私钥或命令。

## 会话边界

每个 SSH 会话由 Durable Object 隔离。浏览器使用一次性票据建立主 WebSocket，辅助通道使用附着令牌，并校验同源请求。

## 操作建议

- Access 策略只允许明确管理员身份。
- SSH 使用低权限专用账号或密钥。
- 定期撤销不再使用的 Cloudflare Token。
- 不在日志、截图、Issue 中泄露凭据或 Access 信息。
- 真实操作前核对服务器指纹。
