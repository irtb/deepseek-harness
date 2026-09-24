# Agent SPA / Gateway 标准发布（ve-shotgo）

[English](SPA-RELEASE.md) | 中文

本文描述 **Agent 项目在生产机上的日常发布方式**：源码 SHA → 机上干净树构建 → 不可变 `releases/<短SHA>` → 切换 `current`。
适用于 Gateway + Agent Web SPA 同包上线（含仅改 SPA 的菜单/前端变更）。

> 与 [`README.zh.md`](README.zh.md) 中的「首次上线 / tar.gz 基线」互补：
> - **日常迭代**：用本文（机上从 GitLab 拉固定 SHA 构建并切链）。
> - **首次装机 / 无 Node 时代的离线包**：见基线 README 的 `build:release` tar.gz 流程。
> 现网（2026-09-23 起）运行目录**不是** git 仓库；禁止在 `/data/projects/agent.shotgo.cn` 内 `git pull`。

生产变更由人工在 `ve-shotgo` 执行。AI Agent 只可准备命令与只读核对，不得代操切换或重启。

---

## 1. 目录与角色

| 角色 | 路径 | 说明 |
|------|------|------|
| GitLab 源码权威 | `git.palm-ad.cn:python/agent.shotgo.cn` 的 `master` | 只发布已评审、已推送的完整 SHA |
| 机上 bare | `/data/projects/agent.shotgo.cn.git` | `gitlab` 远程；缓存提交 |
| 源码工作树 | `/data/projects/agent.shotgo.cn-src-<短SHA>/` | 检出固定 SHA 后构建；一棵树对应一次发布 |
| 运行根 | `/data/projects/agent.shotgo.cn/` | **无 `.git`**；只含 `current`、`releases/`、`storage/` |
| 不可变发布 | `…/releases/<短SHA>/` | 一次构建一份，禁止原地覆盖正在使用的目录 |
| 当前指针 | `…/current` → `releases/<短SHA>` | Supervisor 工作目录；Nginx SPA `root` |
| 持久状态 | `…/storage/` | 日志与会话；跨 release 保留 |
| 环境文件 | `/etc/shotgo-agent/shotgo-agent.env` | 本流程**不修改** |
| Supervisor | `agent-shotgo` | `directory=…/current`；`node apps/shotgo-agent/dist/gateway-bin.js` |
| Nginx | `/data/nginx/conf.d/agent.shotgo.cn.conf` | 静态 `root …/current/web`；`/api/agent/` 反代 `127.0.0.1:3010` |

### 单个 release 目录布局（与现网一致）

```text
releases/<短SHA>/
├── apps/shotgo-agent/
│   ├── package.json
│   ├── dist/                 # 含 gateway-bin.js
│   └── node_modules/         # pnpm deploy --prod 闭包
├── web/                      # agent-web 的 dist（index.html + assets/）
├── deployment.env            # SHOTGO_DEPLOYMENT_ID=<短SHA>
└── manifest.json             # {"sourceSha":"<完整SHA>","deploymentId":"<短SHA>"}
```

短 SHA 命名：取完整 SHA 的前 12 位十六进制（现网亦有 10 位历史目录，新发布统一用 12 位）。

---

## 2. 发布前条件

1. 目标提交已在 GitLab `master`（本地已 `git push gitlab master`，且远程 tip 等于目标 SHA）。
2. 本机或 CI 已对**同一 SHA** 做过聚焦测试（至少 agent-web / 相关门禁）。
3. 生产只重启 `agent-shotgo`；**禁止**动 Nginx、Laravel 队列、Reverb、Canvas、Console。
4. **禁止** `scp` 覆盖 `current`；**禁止**在运行根执行 `git init` / `git pull`。

将下方 `SHA=` 换成本次冻结的完整提交哈希。

---

## 3. 完整命令（复制到 ve-shotgo 执行）

### 3.0 变量与预检

```bash
ssh ve-shotgo
export PATH=/opt/node-current/bin:$PATH

SHA=REPLACE_WITH_FULL_GIT_SHA
SHORT=${SHA:0:12}
RUN=/data/projects/agent.shotgo.cn
BARE=/data/projects/agent.shotgo.cn.git
SRC=/data/projects/agent.shotgo.cn-src-${SHORT}
REL=${RUN}/releases/${SHORT}
PREV=$(readlink ${RUN}/current)
echo "SHA=$SHA SHORT=$SHORT PREV=$PREV"

test -d "$RUN/releases"
test -L "$RUN/current"
test ! -e "$REL"
test ! -e "$SRC"
sudo supervisorctl status agent-shotgo
curl -sS -o /dev/null -w 'healthz=%{http_code}\n' http://127.0.0.1:3010/healthz
```

### 3.1 同步 bare 并检出干净源码树

```bash
cd "$BARE"
git remote -v
# 期望存在：gitlab -> https://git.palm-ad.cn/python/agent.shotgo.cn.git

git fetch gitlab
test "$(git rev-parse gitlab/master)" = "$SHA"
git update-ref refs/heads/master "$SHA"

git worktree add --detach "$SRC" "$SHA"
cd "$SRC"
test "$(git rev-parse HEAD)" = "$SHA"
test -z "$(git status --porcelain)"
```

### 3.2 干净树构建 Gateway + SPA

```bash
cd "$SRC"
pnpm install --frozen-lockfile
pnpm --filter @shotgo/agent-runtime run build:gateway
test -f apps/shotgo-agent/dist/gateway-bin.js

pnpm --filter @shotgo/agent-web build
test -f apps/shotgo-agent-web/dist/index.html
```

### 3.3 组装不可变 release

```bash
mkdir -p "$REL/apps"

pnpm --config.inject-workspace-packages=true \
  --filter @shotgo/agent-runtime deploy --prod "$REL/apps/shotgo-agent"
rm -rf "$REL/apps/shotgo-agent/dist"
cp -a "$SRC/apps/shotgo-agent/dist" "$REL/apps/shotgo-agent/dist"

rm -rf "$REL/web"
cp -a "$SRC/apps/shotgo-agent-web/dist" "$REL/web"

printf 'SHOTGO_DEPLOYMENT_ID=%s\n' "$SHORT" > "$REL/deployment.env"
printf '{"sourceSha":"%s","deploymentId":"%s"}\n' "$SHA" "$SHORT" > "$REL/manifest.json"
chown -R www-data:www-data "$REL"

test -f "$REL/apps/shotgo-agent/dist/gateway-bin.js"
test -f "$REL/apps/shotgo-agent/package.json"
test -d "$REL/apps/shotgo-agent/node_modules"
test -f "$REL/web/index.html"
test -d "$REL/web/assets"
cat "$REL/deployment.env"
cat "$REL/manifest.json"
```

### 3.4 切换 current 并重启 Agent

```bash
echo "PREV=$PREV"
ln -sfn "releases/${SHORT}" "$RUN/current"
test "$(readlink "$RUN/current")" = "releases/${SHORT}"
readlink -f "$RUN/current"

sudo supervisorctl restart agent-shotgo
sudo supervisorctl status agent-shotgo
curl -sS -o /dev/null -w 'healthz=%{http_code}\n' http://127.0.0.1:3010/healthz
curl -sS -o /dev/null -w 'readyz=%{http_code}\n' http://127.0.0.1:3010/readyz
```

### 3.5 验收

- 公网：`https://agent.shotgo.cn/`、`https://agent.shotgo.cn/ai-tool/image-generator`
- SPA 资源来自 `current/web`；API 仍走 `/api/agent/`
- 仅改前端时，也应走完整 release 切链，禁止手改 `current/web` 内散文件

---

## 4. 回滚

```bash
RUN=/data/projects/agent.shotgo.cn
# 将 PREV 换成切换前记录的值，例如 releases/1cb8bc06db
PREV=releases/REPLACE_PREV_SHORT

ln -sfn "$PREV" "$RUN/current"
readlink -f "$RUN/current"
sudo supervisorctl restart agent-shotgo
curl -sS -o /dev/null -w 'healthz=%{http_code}\n' http://127.0.0.1:3010/healthz
```

回滚成功前不要删除新 `releases/<短SHA>`。禁止对生产做不明目标的 `git reset --hard` / force push。

---

## 5. 禁止事项

| 禁止 | 原因 |
|------|------|
| 在运行根 `/data/projects/agent.shotgo.cn` 执行 git | 该目录不是仓库 |
| `scp` / `rsync` 覆盖 `current` | 破坏不可变发布与回滚 |
| 改 Nginx / `nginx reload`（日常 SPA 发布） | 已指向 `current/web`；静态切链即可 |
| 重启 Laravel 队列、Reverb、Canvas、Console | 超出 Agent 发布范围 |
| 使用本机 dirty 工作树作为生产构建源 | SHA 与产物不可审计 |
| 只改 SPA 时跳过 Gateway 组装 | 现网 release 为同包布局；保持一致 |

---

## 6. 与 Supervisor / Nginx 的对应关系（只读备查）

Supervisor（节选语义）：

- `directory=/data/projects/agent.shotgo.cn/current`
- `command=… source /etc/shotgo-agent/shotgo-agent.env` 与 `./deployment.env` 后执行
  `/opt/node-current/bin/node apps/shotgo-agent/dist/gateway-bin.js`
- `user=www-data`

Nginx（节选语义）：

- `location /` → `root …/current/web; try_files … /index.html`
- `location ^~ /api/agent/` → `proxy_pass` Gateway `127.0.0.1:3010`

---

## 7. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-09-24 | 根据 ve-shotgo 现网布局（`current` → `releases/<短SHA>`、源码树 `agent.shotgo.cn-src-*`、bare `agent.shotgo.cn.git`）整理日常 SPA/Gateway 发布命令；与首次装机 tar.gz 基线文档分离。 |
