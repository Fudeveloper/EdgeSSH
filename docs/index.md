---
layout: home

hero:
  name: EdgeSSH
  text: 从 Fork 到上线，可逐项核对
  tagline: 使用 GitHub Actions 创建或复用 Cloudflare 资源。无需手写 D1 ID，也无需在本地执行生产部署命令。
  actions:
    - theme: brand
      text: 使用 Actions 部署
      link: /deploy/actions
    - theme: alt
      text: 先了解 EdgeSSH
      link: /guide/overview
---

<section class="home-workbench">
  <figure class="home-capture">
    <img src="/images/edgessh-dashboard-demo.png" alt="EdgeSSH 主机总览与地球视图" width="1600" height="1000" fetchpriority="high" />
    <figcaption>主机资料加密保存在 D1；从总览进入终端、SFTP 和进程面板。</figcaption>
  </figure>
  <div class="home-workbench__note">
    <strong>打开浏览器，连接你的服务器。</strong>
    <p>EdgeSSH 运行于 Cloudflare Workers。浏览器只连接 Worker，由独立 Durable Object 会话通过 TCP Socket 连接公网 SSH 服务。</p>
    <a class="home-link" href="/reference/security">查看安全边界</a>
  </div>
</section>

<section class="home-path">
  <h2>一条可以重复执行的部署路径</h2>
  <div class="deploy-track">
    <div>
      <span>01</span>
      <strong>准备 Cloudflare</strong>
      <p>接入域名，创建最小权限 API Token，并配置 Access 应用。</p>
    </div>
    <div>
      <span>02</span>
      <strong>填写 GitHub</strong>
      <p>保存账户 ID、自定义域名与四项 Secret，名称通常保持默认。</p>
    </div>
    <div>
      <span>03</span>
      <strong>运行 Deploy</strong>
      <p>Action 自动检查项目、创建或复用 D1、执行迁移并发布 Worker。</p>
    </div>
    <div>
      <span>04</span>
      <strong>验证自动同步</strong>
      <p>确认 Action 已同步 Access 参数与固定加密密钥，再完成验收。</p>
    </div>
  </div>
</section>

<section class="home-boundary">
  <div>
    <h2>先明确边界，再保存凭据</h2>
  </div>
  <div>
    <p>EdgeSSH 面向个人管理员，不提供本地注册或匿名入口。Cloudflare Access 负责身份认证，Worker 在应用内再次校验 Access JWT。它不是端到端加密：Worker 在建立 SSH 会话时会处理明文凭据，因此 Cloudflare 账户和 Worker Secret 管理权限都属于信任边界。</p>
    <a class="home-link" href="/deploy/actions">开始完整部署</a>
  </div>
</section>
