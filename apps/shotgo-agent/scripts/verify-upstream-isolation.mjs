/** Fail when ShotGo product work changes an upstream-owned Harness path. */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = resolve(appRoot, '../..')
const lock = readFileSync(resolve(appRoot, 'UPSTREAM.lock'), 'utf8')
const sha = /^sha:\s*([0-9a-f]{40})$/mu.exec(lock)?.[1]
if (sha === undefined) throw new Error('UPSTREAM.lock must contain one full 40-character sha')

function git(...args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
}

git('cat-file', '-e', `${sha}^{commit}`)
const paths = new Set([
  ...git('diff', '--name-only', `${sha}...HEAD`),
  ...git('diff', '--name-only'),
  ...git('diff', '--name-only', '--cached'),
  ...git('ls-files', '--others', '--exclude-standard'),
])

const allowed = path => path.startsWith('apps/shotgo-agent/')
  || path === 'pnpm-lock.yaml'
  || (/^\.agents\/notes\/(implemented|proposed)\/(architecture|process|testing)\/[^/]*shotgo-agent[^/]*\.(md|yaml)$/u).test(path)

const violations = [...paths].filter(path => !allowed(path)).sort()
if (violations.length > 0) {
  throw new Error(`ShotGo upstream isolation rejected:\n${violations.map(path => `- ${path}`).join('\n')}`)
}

process.stdout.write(`verify-upstream-isolation: ${paths.size} changed path(s) stay inside the ShotGo product boundary.\n`)
