import type { AgentMode, GenerationContext } from './agent-session.ts'

export interface GenerationOption {
  id: string
  label: string
  enabled?: boolean
}
export interface GenerationConfig {
  image: {
    models: GenerationOption[]
    qualities: GenerationOption[]
    resolutions: GenerationOption[]
    aspectRatios: GenerationOption[]
    defaults: { modelId: string; qualityId: string; resolutionId: string; aspectRatioId: string }
  }
  video: {
    models: GenerationOption[]
    resolutions: GenerationOption[]
    aspectRatios: GenerationOption[]
    duration: { min: number; max: number; step: number; default: number }
    defaults: { modelId: string; resolutionId: string; aspectRatioId: string; duration: number; audio: boolean }
  }
}

export const fallbackGenerationConfig: GenerationConfig = {
  image: {
    models: [{ id: 'lib-image', label: 'Lib Image' }],
    qualities: [{ id: 'standard', label: '标准画质' }],
    resolutions: [{ id: '2K', label: '2K' }],
    aspectRatios: [
      { id: 'auto', label: '自适应' },
      { id: '1:1', label: '1:1' },
      { id: '16:9', label: '16:9' },
      { id: '9:16', label: '9:16' },
    ],
    defaults: { modelId: 'lib-image', qualityId: 'standard', resolutionId: '2K', aspectRatioId: 'auto' },
  },
  video: {
    models: [{ id: 'seedance-2-mini', label: 'Seedance 2.0 Mini' }],
    resolutions: [{ id: '720P', label: '720P' }],
    aspectRatios: [
      { id: '16:9', label: '16:9' },
      { id: '9:16', label: '9:16' },
      { id: '1:1', label: '1:1' },
    ],
    duration: { min: 1, max: 15, step: 1, default: 5 },
    defaults: { modelId: 'seedance-2-mini', resolutionId: '720P', aspectRatioId: '16:9', duration: 5, audio: true },
  },
}

export function defaultGenerationContext(mode: AgentMode, config = fallbackGenerationConfig): GenerationContext {
  if (mode === 'image') {
    const defaults = config.image.defaults
    return {
      schemaVersion: 1,
      kind: mode,
      modelId: defaults.modelId,
      parameters: {
        qualityId: defaults.qualityId,
        resolutionId: defaults.resolutionId,
        aspectRatioId: defaults.aspectRatioId,
      },
    }
  }
  const defaults = config.video.defaults
  return {
    schemaVersion: 1,
    kind: mode,
    modelId: defaults.modelId,
    parameters: {
      resolutionId: defaults.resolutionId,
      aspectRatioId: defaults.aspectRatioId,
      duration: defaults.duration,
      audio: defaults.audio,
    },
  }
}

export async function fetchGenerationConfig(token: string, signal?: AbortSignal): Promise<GenerationConfig> {
  const base = String(import.meta.env.VITE_SHOTGO_API_BASE_URL ?? 'https://api.shotgo.cn').replace(/\/$/, '')
  const response = await fetch(`${base}/api/canvas/generation-config`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    ...(signal === undefined ? {} : { signal }),
  })
  if (!response.ok) throw new Error('生成配置加载失败')
  return response.json() as Promise<GenerationConfig>
}

export function addReference(context: GenerationContext, id: number): GenerationContext {
  if (context.kind !== 'image') return context
  const current = context.parameters.referenceAssets ?? []
  if (
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    current.some(item => item.mediaLibraryItemId === id) ||
    current.length >= 9
  )
    return context
  return {
    ...context,
    parameters: { ...context.parameters, referenceAssets: [...current, { mediaLibraryItemId: id }] },
  }
}
