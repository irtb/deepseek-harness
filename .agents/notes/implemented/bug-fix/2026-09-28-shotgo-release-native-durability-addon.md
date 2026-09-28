# ShotGo release packages verify the native durability addon

English | [中文](2026-09-28-shotgo-release-native-durability-addon.zh.md)

## Problem

The production Gateway could pass `/healthz` and `/readyz` while the first accepted message failed with
`SESSION_DURABILITY_CHECKPOINT_FAILED`. The release assembled the pnpm production dependency graph but did not build
the host-native `flock` addon used by JSONL Session persistence. The missing binary is loaded lazily, so process boot
did not expose the incomplete release.

## Decision

- Production release packaging is Linux x64 only and builds the current host's Node-API `flock` addon before
  `pnpm deploy`.
- The artifact requires the glibc addon file and carries a small release verifier.
- The verifier resolves `flock` through the packaged persistence dependency, creates an owner-local disposable probe,
  acquires the real native lock, and removes the probe.
- Offline packaging extracts the final archive to a different directory and runs the verifier there. The routine live
  release procedure runs the same verifier as `www-data` against `storage/sessions` before switching `current`.

This changes no Session, billing, generation, Laravel, or Gateway protocol behavior. It moves a lazy first-message
failure into the pre-cutover release gate.
