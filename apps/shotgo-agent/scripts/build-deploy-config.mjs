import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const appRoot = fileURLToPath(new URL('../', import.meta.url))
const sourceConfig = fileURLToPath(new URL('../config/', import.meta.url))
const targetConfig = fileURLToPath(new URL('../dist/config/', import.meta.url))

await mkdir(targetConfig, { recursive: true })
const base = await readFile(`${sourceConfig}base.cordis.yml`, 'utf8')
await writeFile(`${targetConfig}base.cordis.yml`, base.replace('../src/runtime.ts', '../runtime.js'))
await rm(`${targetConfig}agent-presets`, { recursive: true, force: true })
await cp(`${sourceConfig}agent-presets`, `${targetConfig}agent-presets`, { recursive: true, force: true })

const toolModules = [
  'generation-config-read',
  'generation-quote',
  'generation-submit',
  'generation-status',
  'generation-cancel',
]

const presetEntries = await readdir(`${sourceConfig}agent-presets`, { withFileTypes: true })
for (const entry of presetEntries) {
  if (!entry.isDirectory()) continue
  const path = `${targetConfig}agent-presets/${entry.name}/agent.cordis.yml`
  let content = await readFile(path, 'utf8')
  for (const toolModule of toolModules) {
    content = content.replaceAll(
      `../../../src/tools/${toolModule}.ts`,
      `../../../tools/${toolModule}.js`,
    )
  }
  if (content.includes('../../../src/')) {
    throw new Error(`Deployment preset still references source files: ${path}`)
  }
  await writeFile(path, content)
}

process.stdout.write(`Built ShotGo Gateway config under ${targetConfig.replace(appRoot, '')}\n`)
