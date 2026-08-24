# ShotGo Agent 部署基线

[English](README.md) | 中文

该基线与 `ve-shotgo` 上现有 `api.shotgo.cn`、`canvas.shotgo.cn` 的运维方式统一：项目直接位于 `/data/projects`，Nginx 配置和日志位于 `/data/nginx`，常驻进程由 Supervisor 管理，应用进程使用 `www-data` 运行。部署不得修改或重启现有 Laravel 队列 Worker 与 Reverb。

## 已核验的服务器约束

2026-08-24 已核验：北京火山云 ECS 运行 Ubuntu 24.04、Nginx 1.24、Certbot 2.9、Redis、PHP-FPM 和 Supervisor；尚未安装 Node、pnpm 和 Docker。`/data/projects/zswx_canvas_api` 存在本地改动，禁止清理、替换该工作树，也禁止把它作为 Agent 发布目录。

## 统一目录

- 项目：`/data/projects/agent.shotgo.cn`，只部署已评审的 `release` 提交；
- 进程：`/etc/supervisor/conf.d/agent-shotgo.conf`，运行用户 `www-data`；
- 环境文件：`/etc/shotgo-agent/shotgo-agent.env`，属主 `root:www-data`，权限 `0640`；
- 运行状态与日志：`/data/projects/agent.shotgo.cn/storage`；
- Nginx 虚拟主机：`/data/nginx/conf.d/agent.shotgo.cn.conf`；
- Nginx 日志：`/data/nginx/logs.d/agent.shotgo.cn.*.log`；
- 应用只监听回环地址：`127.0.0.1:3010`。

## 中国网络发布策略

服务器切换期间不得现场执行 `pnpm install`、GitHub 下载或源码构建。本地或 CI 对已评审提交完成构建与测试，生成包含 Gateway 产物及生产依赖闭包的发布包，记录 Git SHA 和 SHA-256，再通过现有 SSH 通道传输。必须安装 Node 时，使用可信中国境内镜像，并在启用前核对上游校验和。这样发布结果不会依赖易受 GFW 影响的海外仓库可用性。

## 安全顺序

1. 功能分支测试通过后合并到 `master`，再将完全相同的已评审提交提升到 `release`，不得从其他工作树重新构建。
2. 连接 `ve-shotgo` 前完成构建、测试、打包和校验和生成。
3. 备份已有 Agent 文件，将发布包放入 `/data/projects/agent.shotgo.cn`，创建 `storage/logs`、`storage/dsh`，仅把运行目录授权给 `www-data`。
4. 以 `SHOTGO_ENABLE_TRAFFIC=false` 安装环境文件；`ARK_API_KEY` 与 Laravel 服务令牌必须留在仓库之外。
5. 安装 Supervisor 配置，执行 `supervisorctl reread`、`supervisorctl update`，然后在回环地址验证 `healthz=200`、`readyz=503`。禁止重启其他 Supervisor 进程。
6. 安装 Nginx bootstrap 配置，执行 `nginx -t`、重载并为 `agent.shotgo.cn` 申请证书。证书存在后才能安装 TLS 虚拟主机，并再次校验 Nginx。
7. 核查证书 SAN、HTTP 跳转、安全 Header、公网健康检查、Supervisor 状态和应用日志。
8. 方舟直连推理、Laravel 策略/用量控制面与完整会话联合验收通过前，保持 readiness 关闭。

回滚时恢复已备份的 Agent 发布包和环境文件，并且只重启 `agent-shotgo`；不得修改 API、Canvas 项目工作树或它们的进程。
