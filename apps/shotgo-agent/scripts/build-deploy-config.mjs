import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const appRoot = fileURLToPath(new URL('../', import.meta.url))
const sourceConfig = fileURLToPath(new URL('../config/', import.meta.url))
const targetConfig = fileURLToPath(new URL('../dist/config/', import.meta.url))

await mkdir(targetConfig, { recursive: true })
const base = await readFile(`${sourceConfig}base.cordis.yml`, 'utf8')
await writeFile(`${targetConfig}base.cordis.yml`, base.replace('../src/runtime.ts', '../runtime.js'))
await cp(`${sourceConfig}agent-presets`, `${targetConfig}agent-presets`, { recursive: true, force: true })

for (const mode of ['canvas', 'image', 'video']) {
  const path = `${targetConfig}agent-presets/shotgo-${mode}-v1/agent.cordis.yml`
  const content = await readFile(path, 'utf8')
  await writeFile(path, content.replace('../../../src/tools/generation-config-read.ts', '../../../tools/generation-config-read.js'))
}

process.stdout.write(`Built ShotGo Gateway config under ${targetConfig.replace(appRoot, '')}\n`)
