import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ArtifactCards } from '../src/ArtifactCards.tsx'

describe('ArtifactCards', () => {
  it('shows Chinese processing state and task id', () => {
    render(
      <ArtifactCards
        artifacts={[{ id: '704', mediaType: 'image', status: 'processing' }]}
        generationRefs={[{ generationId: '704', clientRequestId: 'gen-abc' }]}
        scrollOnReveal={false}
      />,
    )
    expect(screen.getAllByText('生成中').length).toBeGreaterThan(0)
    expect(screen.getByText('任务 704')).toBeInTheDocument()
    expect(screen.getByText('图片 · 生成中')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /任务 ID/ })).toBeInTheDocument()
  })

  it('renders completed image with open link', () => {
    render(
      <ArtifactCards
        artifacts={[{ id: '704:701', mediaType: 'image', status: 'succeeded', url: 'http://cdn.example/a.jpg' }]}
        generationRefs={[{ generationId: '704', clientRequestId: 'gen-abc', state: 'completed' }]}
        scrollOnReveal={false}
      />,
    )
    expect(screen.getByAltText('生成结果')).toHaveAttribute('src', 'http://cdn.example/a.jpg')
    expect(screen.getByText('图片 · 已完成')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: '打开成品' }).length).toBeGreaterThan(0)
  })

  it('renders completed video cover without native controls', () => {
    render(
      <ArtifactCards
        artifacts={[{
          id: '718:1',
          mediaType: 'video',
          status: 'succeeded',
          url: 'http://cdn.example/a.mp4',
          thumbnailUrl: 'http://cdn.example/a.jpg',
        }]}
        generationRefs={[{ generationId: '718', clientRequestId: 'gen-cde', state: 'completed' }]}
        scrollOnReveal={false}
      />,
    )
    expect(screen.getByText('视频 · 已完成')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '播放视频' })).toBeInTheDocument()
    expect(document.querySelector('video[controls]')).toBeNull()
    expect(screen.getByRole('link', { name: '打开成品' })).toHaveAttribute('href', 'http://cdn.example/a.mp4')
  })
})
