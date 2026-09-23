import { expect, it, vi } from 'vitest'
import { uploadMediaLibraryFile } from '../src/media-library.ts'

it('uploads a video with media_type=video', async () => {
  const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
    const body = init?.body
    expect(body).toBeInstanceOf(FormData)
    expect((body as FormData).get('media_type')).toBe('video')
    return new Response(JSON.stringify({
      code: 0,
      data: { id: 88, mediaType: 'video', path: 'resource/88.mp4', thumbPath: null, originalName: 'clip.mp4', visibility: 'private', createdAtMs: 1 },
    }), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  const item = await uploadMediaLibraryFile({
    token: 'token',
    file: new File(['mp4'], 'clip.mp4', { type: 'video/mp4' }),
  })
  expect(item).toMatchObject({ id: 88, mediaType: 'video' })
})

it('surfaces Laravel file-upload validation instead of a generic failure', async () => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
    message: 'validation.uploaded',
    errors: { file: ['validation.uploaded'] },
  }), { status: 422 })))
  await expect(uploadMediaLibraryFile({
    token: 'token',
    file: new File(['mp4'], 'clip.mp4', { type: 'video/mp4' }),
  })).rejects.toThrow('文件超过服务器上传限制，请压缩到 30MB 以内后重试')
})
