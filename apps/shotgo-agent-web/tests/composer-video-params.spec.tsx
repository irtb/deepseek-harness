import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComposerParamBar } from '../src/GenerationComposer.tsx'
import { defaultGenerationContext, fallbackGenerationConfig } from '../src/generation.ts'

afterEach(() => {
  cleanup()
})

describe('ComposerParamBar video duration', () => {
  it('exposes a selectable duration chip instead of a dead number input', () => {
    const onChange = vi.fn()
    render(
      <ComposerParamBar
        context={defaultGenerationContext('video')}
        config={fallbackGenerationConfig}
        onChange={onChange}
      />,
    )
    const duration = screen.getByLabelText('时长')
    expect(duration.tagName).toBe('SELECT')
    fireEvent.change(duration, { target: { value: '8' } })
    expect(onChange).toHaveBeenCalled()
    const next = onChange.mock.calls[0]?.[0]
    expect(next.parameters.duration).toBe(8)
  })

  it('disables param controls when locked', () => {
    const onChange = vi.fn()
    render(
      <ComposerParamBar
        context={defaultGenerationContext('video')}
        config={fallbackGenerationConfig}
        onChange={onChange}
        disabled
      />,
    )
    expect(screen.getByLabelText('模型')).toBeDisabled()
    expect(screen.getByLabelText('时长')).toBeDisabled()
    expect(screen.getByLabelText('生成音频')).toBeDisabled()
  })
})
