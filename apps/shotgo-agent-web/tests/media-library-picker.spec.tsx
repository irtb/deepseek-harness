import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { MediaLibraryPicker } from '../src/MediaLibraryPicker.tsx'

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
  fireEvent.click(screen.getByRole('button', { name: '使用 1 张图片' }))
  expect(confirm.mock.calls[0]?.[0][0].id).toBe(1)
  expect(fetchMock.mock.calls[0]?.[0].toString()).toContain('type=image')

  fireEvent.click(screen.getByRole('button', { name: '团队' }))
  await waitFor(() =>{  expect(fetchMock.mock.calls.some(call => call[0].toString().includes('scope=team'))).toBe(true) })
})

it('does not select more than the declared limit', async () => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ code: 0, data: { list: [1, 2].map(id => ({ id, mediaType: 'image', path: `${id}.png`, thumbPath: null, originalName: `图片 ${id}`, visibility: 'private', createdAtMs: 1 })), pagination: { page: 1, per_page: 15, total: 2, last_page: 1 } } }), { status: 200 })))
  render(<MediaLibraryPicker open token="token" isTeam={false} initialIds={[]} maxSelection={1} onClose={() => undefined} onConfirm={() => undefined} />)
  fireEvent.click(await screen.findByRole('button', { name: /图片 1/ }))
  fireEvent.click(screen.getByRole('button', { name: /图片 2/ }))
  expect(screen.getByText('已选 1/1 · 共 2 项')).toBeInTheDocument()
})
