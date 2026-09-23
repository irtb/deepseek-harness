import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as videoPoster from '../src/video-poster.ts'
import { VideoArtifactPreview } from '../src/VideoArtifactPreview.tsx'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('VideoArtifactPreview', () => {
  it('shows cover play control without native controls attribute', async () => {
    vi.spyOn(videoPoster, 'captureVideoFrame').mockResolvedValue({ poster: 'data:image/jpeg;base64,aaa' })
    render(<VideoArtifactPreview url="https://cdn.example/clip.mp4" />)
    expect(await screen.findByRole('button', { name: '播放视频' })).toBeInTheDocument()
    expect(document.querySelector('video[controls]')).toBeNull()
  })

  it('enters playing state when cover play is clicked', async () => {
    render(
      <VideoArtifactPreview
        url="https://cdn.example/clip.mp4"
        thumbnailUrl="https://cdn.example/p.jpg"
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '播放视频' }))
    await waitFor(() => {
      const video = document.querySelector('video')
      expect(video).not.toBeNull()
      expect(video?.hasAttribute('controls')).toBe(false)
    })
  })

  it('enters playing state when the cover surface is clicked', async () => {
    render(
      <VideoArtifactPreview
        url="https://cdn.example/clip.mp4"
        thumbnailUrl="https://cdn.example/p.jpg"
      />,
    )
    const cover = document.querySelector('.video-preview')
    expect(cover).not.toBeNull()
    fireEvent.click(cover as Element)
    await waitFor(() => {
      expect(document.querySelector('video')).not.toBeNull()
    })
  })
})
