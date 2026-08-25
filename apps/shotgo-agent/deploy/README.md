# ShotGo Agent Deployment Baseline

English | [中文](README.zh.md)

This baseline follows the existing `api.shotgo.cn` and `canvas.shotgo.cn` operating model on `ve-shotgo`: projects live directly under `/data/projects`, Nginx configuration and logs live under `/data/nginx`, long-running processes are owned by Supervisor, and application processes run as `www-data`. It does not alter or restart the existing Laravel queue workers or Reverb process.

## Verified host constraints

Verified on 2026-08-24: the Beijing Volcano ECS runs Ubuntu 24.04, Nginx 1.24, Certbot 2.9, Redis, PHP-FPM, and Supervisor. Node, pnpm, and Docker are absent. `/data/projects/zswx_canvas_api` has local modifications and must not be cleaned, replaced, or used as an Agent deployment target.

## Unified layout

- project: `/data/projects/agent.shotgo.cn`, deployed from reviewed `release` commits;
- process: `/etc/supervisor/conf.d/agent-shotgo.conf`, user `www-data`;
- environment: `/etc/shotgo-agent/shotgo-agent.env`, owner `root:www-data`, mode `0640`;
- runtime state and logs: `/data/projects/agent.shotgo.cn/storage`;
- Nginx vhost: `/data/nginx/conf.d/agent.shotgo.cn.conf`;
- Nginx logs: `/data/nginx/logs.d/agent.shotgo.cn.*.log`;
- application listener: loopback-only `127.0.0.1:3010`.

## China-network release policy

Do not run `pnpm install`, GitHub downloads, or a source build as part of the server cutover. Build and test the reviewed commit locally or in CI, produce an artifact containing the Gateway output and its production dependency closure, record the Git SHA and SHA-256, then transfer it over the existing SSH path. Install a checksum-verified Node distribution under `/opt` and point `/opt/node-current` at the accepted version; do not replace it until the new binary passes its version and checksum checks. This keeps releases repeatable without coupling availability to GFW-sensitive registries.

## Safe order

1. Merge a tested feature branch into `master`; promote the exact reviewed commit to `release` without rebuilding from a different checkout.
2. Build, test, package, and checksum the artifact before connecting to `ve-shotgo`.
3. Back up any existing Agent files, place the artifact in `/data/projects/agent.shotgo.cn`, create `storage/logs` and `storage/dsh`, and grant only those runtime directories to `www-data`.
4. Install `/etc/shotgo-agent/shotgo-agent.env` with `SHOTGO_ENABLE_TRAFFIC=false` and the exact `https://canvas.shotgo.cn` browser origin; keep only the Laravel service token outside the repository. Laravel supplies the encrypted-at-rest Ark credential and provider endpoint IDs and introspects opaque browser Grants through no-store internal endpoints.
5. Install the Supervisor program, run `supervisorctl reread` and `supervisorctl update`, then verify `healthz=200` and `readyz=503` on loopback. Do not restart other Supervisor programs.
6. Install the bootstrap Nginx vhost, run `nginx -t`, reload, and issue a certificate for `agent.shotgo.cn`. Only after the certificate exists, install the TLS vhost and revalidate Nginx.
7. Verify the certificate SAN, HTTP redirect, security headers, public health, Supervisor state, and application logs.
8. Keep readiness closed until Laravel runtime configuration, Ark direct inference, Sanctum Grant issuance, service-authenticated introspection, inference policy/usage control planes, Canvas-origin preflight, and full session acceptance pass together.

Rollback restores the backed-up Agent artifact and environment, then restarts only `agent-shotgo`. It never changes the API or Canvas project worktrees or their processes.
