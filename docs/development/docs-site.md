# 部署文档站到 Cloudflare Pages

VitePress 文档通过独立的 `Deploy docs` GitHub Actions workflow 发布到 Cloudflare Pages。它不会写入 EdgeSSH Worker 的 `dist/`，也不会访问 D1 或运行时 Secret。

## 首次部署

文档 workflow 复用两个部署凭据：

- GitHub Variable `CLOUDFLARE_ACCOUNT_ID`。
- GitHub Secret `CLOUDFLARE_API_TOKEN`。

API Token 需要 Account `Cloudflare Pages: Edit`。可选 Variable `DOCS_PROJECT_NAME` 控制 Pages 项目名，默认 `edgessh-docs`。

进入：

```text
Actions → Deploy docs → Run workflow
```

首次运行会按名称检查 Pages 项目，不存在时创建，存在时直接复用。随后构建 `docs/.vitepress/dist` 并发布到生产分支 `main`。

## 添加多个自定义域名

首次成功后打开 Cloudflare Dashboard：

```text
Workers & Pages → edgessh-docs → Custom domains
```

选择 **Set up a custom domain**，逐个添加文档域名。Pages 项目与 EdgeSSH Worker 相互独立，因此可以为文档站绑定多个域名，而不修改 Worker 的 `CUSTOM_DOMAIN`。

<ScreenshotPlaceholder
  title="Cloudflare Pages 自定义域名"
  description="请截取 Pages 项目的 Custom domains 页面和添加入口。隐藏与文档站无关的其他项目和域名。"
  filename="11-pages-custom-domain.png"
/>

## 自动触发

推送到 `main` 且改动以下路径时，文档 workflow 自动运行：

- `docs/**`
- `package.json` 或 `package-lock.json`
- 文档部署 workflow 与 Pages 准备脚本

应用 Worker 的 `Deploy` workflow 与文档的 `Deploy docs` workflow 使用不同并发锁和不同产物目录，不会互相覆盖。纯 `docs/**`、文档 workflow 或 Pages 准备脚本改动也被 Worker workflow 排除，不会顺带发布生产 EdgeSSH 应用。

## 本地预览

```bash
npm run docs:dev
```

生产构建检查：

```bash
npm run docs:build
npm run docs:preview
```
