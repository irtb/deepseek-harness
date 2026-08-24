# ShotGo Agent Deployment Baseline

English | [中文](README.zh.md)

This baseline deploys only a loopback Gateway with liveness and readiness endpoints. It does not enable Laravel integration, inference, billing, generation, canvas mutation, or public Agent sessions.

## ve-shotgo preflight snapshot

Verified on 2026-08-24: Ubuntu 24.04, Nginx 1.24, Certbot 2.9, Redis and Supervisor are present. Node, pnpm, and Docker are absent. Existing Laravel queue workers and Reverb are active, and `/data/projects/zswx_canvas_api` has local modifications. Do not modify or clean that worktree, and do not restart its workers for this deployment.

## Release layout

- immutable release: `/data/projects/agent.shotgo.cn/releases/<git-sha>`;
- active symlink: `/data/projects/agent.shotgo.cn/current`;
- environment: `/etc/shotgo-agent/shotgo-agent.env`, mode `0600`;
- service account: `shotgo-agent`, with no login shell;
- service: `/etc/systemd/system/shotgo-agent.service`;
- Nginx vhost: `/data/nginx/conf.d/agent.shotgo.cn.conf`;
- application listener: `127.0.0.1:3010` only.

## Safe order

1. Push the reviewed `master` commit to the fork so the server can fetch an immutable SHA.
2. Install a supported Node runtime (`^22.19.0` or `>=24`) without changing PHP, Redis, or Supervisor.
3. Create the service user and release/config directories; never place secrets in the repository.
4. Build and test locally, deploy one immutable release, and point `current` to it.
5. Install the systemd unit with `SHOTGO_ENABLE_TRAFFIC=false`; verify `healthz=200` and `readyz=503` on loopback.
6. Install `agent.shotgo.cn.bootstrap.conf`, create `/var/www/certbot`, validate Nginx, reload, and issue a separate certificate for `agent.shotgo.cn`. HTTP-01 requires public port 80.
7. Only after the certificate files exist, replace the bootstrap vhost with `agent.shotgo.cn.conf`, validate and reload Nginx, then verify certificate SAN, HTTP redirect, headers, and public health.
8. Keep readiness closed until the Laravel v1 client and full end-to-end acceptance pass.

Always back up the active Nginx configuration, run `nginx -t` before reload, and retain the previous `current` symlink target for rollback.
