import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const presetFiles = ['shotgo-image-v1', 'shotgo-video-v1', 'shotgo-canvas-v1']
  .map(name => resolve(process.cwd(), 'config/agent-presets', name, 'agent.cordis.yml'))

describe('ShotGo preset language and presentation policy', () => {
  for (const file of presetFiles) {
    it(`defaults to Simplified Chinese and reserves raw Markdown for explicit requests: ${file}`, async () => {
      const source = await readFile(file, 'utf8')
      const normalized = source.replace(/\s+/g, ' ')
      expect(source).toContain('Reply in Simplified Chinese by default.')
      expect(source).toContain("user's latest explicit request")
      expect(normalized).toContain('applies only to your conversational reasoning and replies')
      expect(normalized).toContain('must never constrain the language, text, subtitles, narration, prompts')
      expect(source).toContain('Do not expose raw Markdown source')
    })
  }
})
