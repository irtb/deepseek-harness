import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { MediaLibraryPicker } from '../src/MediaLibraryPicker.tsx'
import { MAX_LIBRARY_UPLOAD_BYTES, mediaTypeFromFile } from '../src/media-library.ts'

beforeEach(() => vi.restoreAllMocks())

it('loads image assets, changes team scope and returns selected items', async () => {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = String(input)
    const name = url.includes('scope=team') ? '团队图片' : '个人图片'
    const id = url.includes('scope=team') ? 2 : 1
    return new Response(JSON.stringify({ code: 0, msg: 'ok', data: { list: [{ id, mediaType: 'image', path: `resource/${id}.png`, thumbPath: null, originalName: name, visibility: url.includes('scope=team') ? 'team' : 'private', createdAtMs: 1 }], pagination: { page: 1, per_page: 15, total: 1, last_page: 1 } } }), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  const confirm = vi.fn()
  render(<MediaLibraryPicker open token="token" isTeam initialIds={[]} maxSelection={9} onClose={() => undefined} onConfirm={confirm} />)
  fireEvent.click(await screen.findByRole('button', { name: /个人图片/ }))
  fireEvent.click(screen.getByRole('button', { name: '使用 1 项' }))
  expect(confirm.mock.calls[0]?.[0][0].id).toBe(1)
  expect(fetchMock.mock.calls[0]?.[0].toString()).toContain('type=image')

  fireEvent.click(screen.getByRole('button', { name: '团队' }))
  await waitFor(() => {
    expect(fetchMock.mock.calls.some(call => call[0].toString().includes('scope=team'))).toBe(true)
  })
})

it('does not select more than the declared limit', async () => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ code: 0, data: { list: [1, 2].map(id => ({ id, mediaType: 'image', path: `${id}.png`, thumbPath: null, originalName: `图片 ${id}`, visibility: 'private', createdAtMs: 1 })), pagination: { page: 1, per_page: 15, total: 2, last_page: 1 } } }), { status: 200 })))
  render(<MediaLibraryPicker open token="token" isTeam={false} initialIds={[]} maxSelection={1} onClose={() => undefined} onConfirm={() => undefined} />)
  fireEvent.click(await screen.findByRole('button', { name: /图片 1/ }))
  fireEvent.click(screen.getByRole('button', { name: /图片 2/ }))
  expect(screen.getByText('已选 1/1 · 共 2 项 · 单文件不超过 30MB')).toBeInTheDocument()
})

it('lists videos when the video tab is selected', async () => {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = String(input)
    const isVideo = url.includes('type=video')
    return new Response(JSON.stringify({
      code: 0,
      data: {
        list: isVideo
          ? [{ id: 9, mediaType: 'video', path: 'resource/9.mp4', thumbPath: null, originalName: '参考视频', visibility: 'private', createdAtMs: 1 }]
          : [],
        pagination: { page: 1, per_page: 15, total: isVideo ? 1 : 0, last_page: 1 },
      },
    }), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  render(<MediaLibraryPicker open token="token" isTeam={false} initialIds={[]} maxSelection={9} onClose={() => undefined} onConfirm={() => undefined} />)
  fireEvent.click(await screen.findByRole('button', { name: '视频库' }))
  expect(await screen.findByRole('button', { name: /参考视频/ })).toBeInTheDocument()
  expect(fetchMock.mock.calls.some(call => call[0].toString().includes('type=video'))).toBe(true)
})

it('uploads an image to the personal library and selects it', async () => {
  const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
    if (init?.method === 'POST') {
      return new Response(JSON.stringify({
        code: 0,
        data: { id: 51, mediaType: 'image', path: 'resource/51.png', thumbPath: null, originalName: 'cat.png', visibility: 'private', createdAtMs: 1 },
      }), { status: 200 })
    }
    return new Response(JSON.stringify({
      code: 0,
      data: {
        list: [{ id: 51, mediaType: 'image', path: 'resource/51.png', thumbPath: null, originalName: 'cat.png', visibility: 'private', createdAtMs: 1 }],
        pagination: { page: 1, per_page: 15, total: 1, last_page: 1 },
      },
    }), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  const confirm = vi.fn()
  render(<MediaLibraryPicker open token="token" isTeam={false} initialIds={[]} maxSelection={9} onClose={() => undefined} onConfirm={confirm} />)
  await screen.findByRole('dialog', { name: '选择参考素材' })
  const input = screen.getByLabelText('上传图片或视频')
  fireEvent.change(input, { target: { files: [new File(['png'], 'cat.png', { type: 'image/png' })] } })
  await waitFor(() => {
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes('/api/media/library/upload'))).toBe(true)
  })
  fireEvent.click(await screen.findByRole('button', { name: '使用 1 项' }))
  expect(confirm.mock.calls[0]?.[0][0]).toMatchObject({ id: 51, originalName: 'cat.png' })
})

it('rejects files over 30MB without calling upload', async () => {
  const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
    code: 0,
    data: { list: [], pagination: { page: 1, per_page: 15, total: 0, last_page: 1 } },
  }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  render(<MediaLibraryPicker open token="token" isTeam={false} initialIds={[]} maxSelection={9} onClose={() => undefined} onConfirm={() => undefined} />)
  await screen.findByText('当前范围暂无图片素材')
  const oversized = new File([new Uint8Array(8)], 'huge.mp4', { type: 'video/mp4' })
  Object.defineProperty(oversized, 'size', { value: MAX_LIBRARY_UPLOAD_BYTES + 1 })
  fireEvent.change(screen.getByLabelText('上传图片或视频'), { target: { files: [oversized] } })
  expect(await screen.findByRole('alert')).toHaveTextContent('请上传小于 30MB 的文件')
  expect(fetchMock.mock.calls.every(call => call[1]?.method !== 'POST')).toBe(true)
})

it('classifies image and video filenames', () => {
  expect(mediaTypeFromFile(new File([], 'a.PNG', { type: '' }))).toBe('image')
  expect(mediaTypeFromFile(new File([], 'clip.mov', { type: '' }))).toBe('video')
  expect(mediaTypeFromFile(new File([], 'notes.txt', { type: 'text/plain' }))).toBeUndefined()
})
