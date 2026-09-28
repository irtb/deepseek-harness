import { describe, expect, it, vi } from 'vitest'
import {
  createSpace,
  DEFAULT_SPACE_NAME,
  preferredSpace,
} from '../src/project-context.ts'

describe('preferredSpace', () => {
  it('prefers 默认项目 over the first entry', () => {
    expect(preferredSpace([
      { uuid: 'a', name: '广告项目', firstProjectUuid: 'p1', canvasCount: 1 },
      { uuid: 'b', name: DEFAULT_SPACE_NAME, firstProjectUuid: 'p2', canvasCount: 1 },
    ])?.uuid).toBe('b')
  })

  it('falls back to the first Space when 默认项目 is absent', () => {
    expect(preferredSpace([
      { uuid: 'a', name: '广告项目', firstProjectUuid: 'p1', canvasCount: 1 },
    ])?.uuid).toBe('a')
  })

  it('returns undefined for an empty list', () => {
    expect(preferredSpace([])).toBeUndefined()
  })
})

describe('createSpace', () => {
  it('maps Laravel store payload into a SpaceSummary', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      code: 0,
      data: {
        space: { id: 1, uuid: 'space-1', name: DEFAULT_SPACE_NAME },
        defaultProject: { uuid: 'project-1', name: '画布 1' },
      },
    }), { status: 200 })))
    try {
      await expect(createSpace('token', DEFAULT_SPACE_NAME)).resolves.toEqual({
        uuid: 'space-1',
        name: DEFAULT_SPACE_NAME,
        firstProjectUuid: 'project-1',
        canvasCount: 1,
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
