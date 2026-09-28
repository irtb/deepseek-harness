/** Verify that a deployed ShotGo Agent release can take a real durable file lock. */

import { createRequire } from 'node:module'
import { mkdtemp, open, realpath, rm } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const [packageRootInput, probeRootInput] = process.argv.slice(2)
if (packageRootInput === undefined || probeRootInput === undefined) {
  throw new Error('usage: node verify-release-runtime.mjs <package-root> <writable-probe-root>')
}
if (!isAbsolute(packageRootInput) || !isAbsolute(probeRootInput)) {
  throw new Error('release and probe roots must be absolute paths')
}

const packageRoot = resolve(packageRootInput)
const probeRoot = resolve(probeRootInput)

const persistenceManifest = resolve(
  packageRoot,
  'node_modules/@deepseek-ai/dsh-session-persistence-jsonl/package.json',
)
const requireFromPersistence = createRequire(await realpath(persistenceManifest))
const flockEntry = requireFromPersistence.resolve('@deepseek-ai/node-addon-system/flock')
const { tryLockExclusive } = await import(pathToFileURL(flockEntry).href)

const probeDirectory = await mkdtemp(resolve(probeRoot, '.shotgo-durability-probe-'))
const probePath = resolve(probeDirectory, 'lock')
let handle
try {
  handle = await open(probePath, 'wx', 0o600)
  await tryLockExclusive(handle.fd)
} finally {
  await handle?.close()
  await rm(probeDirectory, { recursive: true, force: true })
}

process.stdout.write(`${JSON.stringify({ event: 'release/durability-probe-ok' })}\n`)
