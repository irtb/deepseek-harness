/** Build one self-contained, checksummed production package without server-side installs. */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = resolve(appRoot, '../..')
const artifactsRoot = resolve(repoRoot, '.artifacts')
const packageRoot = resolve(artifactsRoot, 'shotgo-agent-release')

rmSync(packageRoot, { recursive: true, force: true })
mkdirSync(artifactsRoot, { recursive: true })

execFileSync('pnpm', [
  '--config.inject-workspace-packages=true',
  '--filter',
  '@shotgo/agent-runtime',
  'deploy',
  '--prod',
  packageRoot,
], { cwd: repoRoot, stdio: 'inherit' })

cpSync(resolve(appRoot, 'dist'), resolve(packageRoot, 'dist'), { recursive: true })

const requiredFiles = [
  'dist/gateway-bin.js',
  'dist/config/base.cordis.yml',
  'node_modules/@deepseek-ai/cordis-plugin-group/package.json',
  'node_modules/@deepseek-ai/dsh-agent-presets/package.json',
  'node_modules/@deepseek-ai/dsh-home-paths/package.json',
]
for (const relativePath of requiredFiles) {
  if (!existsSync(resolve(packageRoot, relativePath))) {
    throw new Error(`Release package is missing ${relativePath}`)
  }
}

const revision = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
  cwd: repoRoot,
  encoding: 'utf8',
}).trim()
const archiveName = `shotgo-agent-${revision}.tar.gz`
const archivePath = resolve(artifactsRoot, archiveName)
rmSync(archivePath, { force: true })
execFileSync('tar', [
  '-czf',
  archivePath,
  '-C',
  packageRoot,
  'dist',
  'node_modules',
  'package.json',
], { stdio: 'inherit' })

const digest = createHash('sha256').update(readFileSync(archivePath)).digest('hex')
writeFileSync(`${archivePath}.sha256`, `${digest}  ${archiveName}\n`, { mode: 0o644 })
process.stdout.write(`Built ${archivePath}\nSHA-256 ${digest}\n`)
