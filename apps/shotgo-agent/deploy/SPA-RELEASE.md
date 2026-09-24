# Agent SPA / Gateway standard release (ve-shotgo)

English | [中文](SPA-RELEASE.zh.md)

This document is the **day-to-day production release procedure** for the Agent project: source SHA → clean on-host build → immutable `releases/<shortSHA>` → switch `current`.
It covers Gateway + Agent Web SPA shipped together (including SPA-only UI changes).

> Complements [`README.md`](README.md) (first-time / tar.gz baseline):
> - **Routine releases:** this document (fetch a fixed GitLab SHA on the host, build, switch symlink).
> - **First install / offline artifact era:** `build:release` tar.gz flow in the baseline README.
> On the live host (since 2026-09-23) the runtime directory is **not** a git checkout. Never `git pull` inside `/data/projects/agent.shotgo.cn`.

Production mutations are executed manually on `ve-shotgo`. Agents may prepare commands and perform read-only checks only.

---

## 1. Layout

| Role | Path | Notes |
|------|------|------|
| Source authority | GitLab `master` for `agent.shotgo.cn` | Publish only reviewed full SHAs |
| Host bare repo | `/data/projects/agent.shotgo.cn.git` | Remote name `gitlab` |
| Source worktree | `/data/projects/agent.shotgo.cn-src-<shortSHA>/` | One tree per release build |
| Runtime root | `/data/projects/agent.shotgo.cn/` | **No `.git`**; `current`, `releases/`, `storage/` |
| Immutable release | `…/releases/<shortSHA>/` | Never overwrite an active release in place |
| Current pointer | `…/current` → `releases/<shortSHA>` | Supervisor cwd; Nginx SPA root |
| Durable state | `…/storage/` | Survives release switches |
| Env file | `/etc/shotgo-agent/shotgo-agent.env` | **Do not edit** in this flow |
| Supervisor | `agent-shotgo` | Runs `node apps/shotgo-agent/dist/gateway-bin.js` under `current` |
| Nginx | `/data/nginx/conf.d/agent.shotgo.cn.conf` | `root …/current/web`; `/api/agent/` → `127.0.0.1:3010` |

### Release directory shape (matches production)

```text
releases/<shortSHA>/
├── apps/shotgo-agent/
│   ├── package.json
│   ├── dist/                 # includes gateway-bin.js
│   └── node_modules/         # pnpm deploy --prod closure
├── web/                      # agent-web dist (index.html + assets/)
├── deployment.env            # SHOTGO_DEPLOYMENT_ID=<shortSHA>
└── manifest.json             # {"sourceSha":"<fullSHA>","deploymentId":"<shortSHA>"}
```

Short SHA: first 12 hex characters of the full SHA (older releases may use 10; new ones use 12).

---

## 2. Preconditions

1. Target commit is on GitLab `master` and equals the frozen SHA.
2. The **same SHA** passed focused checks locally/CI (include `pnpm --filter @shotgo/agent-runtime run test:protocol-sync`).
3. Restart **only** `agent-shotgo`. Do not touch Nginx, Laravel queues, Reverb, Canvas, or Console.
4. No `scp` over `current`. No `git init` / `git pull` in the runtime root.
5. Gateway ↔ Web protocol is owned solely by `apps/shotgo-agent/src/contracts/gateway-protocol.ts`; never redefine protocol literals in Web.

Replace `SHA=` below with the frozen full hash.

---

## 3. Full command sequence

### 3.0 Variables and preflight

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

### 3.1 Fetch bare repo and check out a clean source tree

```bash
cd "$BARE"
git remote -v
git fetch gitlab
test "$(git rev-parse gitlab/master)" = "$SHA"
git update-ref refs/heads/master "$SHA"

git worktree add --detach "$SRC" "$SHA"
cd "$SRC"
test "$(git rev-parse HEAD)" = "$SHA"
test -z "$(git status --porcelain)"
```

### 3.2 Build Gateway + SPA

```bash
cd "$SRC"
pnpm install --frozen-lockfile
# Release worktrees whose common dir is bare: lefthook skips (or set CI=true)
# Gateway tsc needs compiled workspace libs (e.g. vendor/cordis/lib)
pnpm run build:lib:host
test -f vendor/cordis/lib/index.js

pnpm --filter @shotgo/agent-runtime run build:gateway
test -f apps/shotgo-agent/dist/gateway-bin.js

pnpm --filter @shotgo/agent-web build
test -f apps/shotgo-agent-web/dist/index.html
```

### 3.3 Assemble immutable release

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

### 3.4 Switch `current` and restart Agent only

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

### 3.5 Acceptance

- Public: `https://agent.shotgo.cn/` and `/ai-tool/image-generator`
- Static assets from `current/web`; API via `/api/agent/`
- SPA-only changes still use a full release switch; do not edit files under a live `current/web`

---

## 4. Rollback

```bash
RUN=/data/projects/agent.shotgo.cn
PREV=releases/REPLACE_PREV_SHORT

ln -sfn "$PREV" "$RUN/current"
readlink -f "$RUN/current"
sudo supervisorctl restart agent-shotgo
curl -sS -o /dev/null -w 'healthz=%{http_code}\n' http://127.0.0.1:3010/healthz
```

Do not delete the new `releases/<shortSHA>` until rollback is confirmed. No production `reset --hard` to unknown commits; no force push.

---

## 5. Hard no

| Do not | Why |
|------|------|
| Run git in the runtime root | Not a repository |
| `scp` / `rsync` over `current` | Breaks immutability and rollback |
| Change Nginx / reload Nginx for routine SPA cuts | Already rooted at `current/web` |
| Restart non-Agent Supervisor programs | Out of scope |
| Build from a dirty local tree | Unauditable SHA/artifact |
| Ship SPA without assembling the full release layout | Production layout is co-packaged |

---

## 6. Revision

| Date | Notes |
|------|------|
| 2026-09-24 | Documented the live ve-shotgo layout (`current` → `releases/<shortSHA>`, `agent.shotgo.cn-src-*`, bare `agent.shotgo.cn.git`) as the routine SPA/Gateway release path, separate from the first-install tar.gz baseline. |
