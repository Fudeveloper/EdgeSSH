# 本地开发

本地开发需要 Node.js 22.12.0 或更高版本，以及 npm。

## 安装依赖

```bash
git clone https://github.com/aozorae/EdgeSSH.git
cd EdgeSSH
npm ci
```

## 准备本地变量

```bash
cp .env.example .dev.vars
```

在 `.dev.vars` 中填写开发用的 `ACCESS_TEAM_DOMAIN`、`ACCESS_AUD` 与 `ENCRYPTION_KEY`。本地仍会执行真实 Access 身份校验，不提供匿名绕过。

初始化本地 D1：

```bash
npx wrangler d1 migrations apply DB --local
```

## 启动 Worker

```bash
npm run dev
```

Wrangler 会按 `wrangler.toml` 构建前端并启动本地 Worker。

需要前端热更新时，在另一个终端运行：

```bash
npm run dev:web
```

Vite 默认位于 `http://localhost:5173`，并把 `/api` 代理到本地 Worker 的 `8787` 端口。

## 启动文档站

```bash
npm run docs:dev
```

VitePress 会输出本地地址。文档站不需要 D1、Access 或 SSH 目标。

## 检查命令

| 命令 | 用途 |
| --- | --- |
| `npm run typecheck` | 检查 Worker 与前端类型 |
| `npm test` | 运行 Node 测试 |
| `npm run build:web` | 构建 EdgeSSH 前端 |
| `npm run docs:build` | 构建 VitePress 文档 |
| `npm run check` | 类型、测试、文档与 Wrangler dry-run |

涉及连接、SFTP 或进程面板的改动，最终仍要使用真实且已授权的 SSH 目标验收。
