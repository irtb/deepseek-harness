/** Build one self-contained, checksummed production package without server-side installs. */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
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
  'dist/tools/generation-config-read.js',
  'dist/tools/generation-quote.js',
  'dist/tools/generation-submit.js',
  'dist/tools/generation-status.js',
  'dist/tools/generation-cancel.js',
  'dist/tools/canvas-context-read.js',
  'dist/tools/canvas-plan-preview.js',
  'dist/tools/canvas-plan-quote.js',
  'dist/tools/canvas-ops-apply.js',
  'node_modules/@deepseek-ai/cordis-plugin-group/package.json',
  'node_modules/@deepseek-ai/dsh-agent-presets/package.json',
  'node_modules/@deepseek-ai/dsh-home-paths/package.json',
]
for (const relativePath of requiredFiles) {
  if (!existsSync(resolve(packageRoot, relativePath))) {
    throw new Error(`Release package is missing ${relativePath}`)
  }
}

const expectedToolReferences = new Set([
  '../../../tools/generation-config-read.js',
  '../../../tools/generation-quote.js',
  '../../../tools/generation-submit.js',
  '../../../tools/generation-status.js',
  '../../../tools/generation-cancel.js',
])
const canvasToolReferences = new Set([
  ...expectedToolReferences,
  '../../../tools/canvas-context-read.js',
  '../../../tools/canvas-plan-preview.js',
  '../../../tools/canvas-plan-quote.js',
  '../../../tools/canvas-ops-apply.js',
])
const presetsRoot = resolve(packageRoot, 'dist/config/agent-presets')
const presetEntries = readdirSync(presetsRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
if (presetEntries.length === 0) {
  throw new Error('Release package contains no Agent presets')
}

for (const entry of presetEntries) {
  const relativePath = `dist/config/agent-presets/${entry.name}/agent.cordis.yml`
  const configPath = resolve(packageRoot, relativePath)
  if (!existsSync(configPath)) {
    throw new Error(`Release preset is missing its Cordis config: ${relativePath}`)
  }
  const content = readFileSync(configPath, 'utf8')
  const relativeNames = [...content.matchAll(/^\s*name:\s*['"]?(\.[^'"\s]+)['"]?\s*$/gm)]
    .map(match => match[1])
  const actualToolReferences = new Set(relativeNames)
  const expectedReferences = entry.name === 'shotgo-canvas-v1'
    ? canvasToolReferences
    : expectedToolReferences
  if (
    actualToolReferences.size !== expectedReferences.size
    || [...expectedReferences].some(reference => !actualToolReferences.has(reference))
  ) {
    throw new Error(`Release preset has an unexpected compiled tool set: ${relativePath}`)
  }
  for (const toolReference of actualToolReferences) {
    if (!toolReference.endsWith('.js') || toolReference.includes('/src/')) {
      throw new Error(`Release preset references a source-only or non-JavaScript tool: ${relativePath}`)
    }
    const toolPath = resolve(dirname(configPath), toolReference)
    const packageRelativePath = relative(packageRoot, toolPath)
    if (packageRelativePath === '..' || packageRelativePath.startsWith(`..${sep}`)) {
      throw new Error(`Release preset tool escapes the package root: ${relativePath}`)
    }
    if (!existsSync(toolPath) || !statSync(toolPath).isFile()) {
      throw new Error(`Release preset tool does not resolve to a packaged file: ${toolReference}`)
    }
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
