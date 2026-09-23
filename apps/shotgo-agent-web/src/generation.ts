import type { AgentMode, GenerationContext } from './agent-session.ts'

export interface GenerationOption {
  id: string
  label: string
  enabled?: boolean
}

export type SupportedOptionGroup = 'quality' | 'resolution' | 'aspect_ratio'

export interface GenerationModelOption extends GenerationOption {
  supportedOptions?: Partial<Record<SupportedOptionGroup, string[]>>
  /** Optional per-model video duration bounds; falls back to config.video.duration. */
  durationRange?: { min: number; max: number; step: number; default: number }
}

export interface GenerationConfig {
  image: {
    models: GenerationModelOption[]
    qualities: GenerationOption[]
    resolutions: GenerationOption[]
    aspectRatios: GenerationOption[]
    defaults: { modelId: string; qualityId: string; resolutionId: string; aspectRatioId: string }
  }
  video: {
    models: GenerationModelOption[]
    resolutions: GenerationOption[]
    aspectRatios: GenerationOption[]
    duration: { min: number; max: number; step: number; default: number }
    defaults: { modelId: string; resolutionId: string; aspectRatioId: string; duration: number; audio: boolean }
  }
}

export function optionSupport(
  model: GenerationModelOption | undefined,
  group: SupportedOptionGroup,
): 'unrestricted' | 'none' | readonly string[] {
  if (model?.supportedOptions === undefined) return 'unrestricted'
  const list = model.supportedOptions[group]
  if (list === undefined) return 'unrestricted'
  if (list.length === 0) return 'none'
  return list
}

export function isOptionSupported(
  model: GenerationModelOption | undefined,
  group: SupportedOptionGroup,
  optionId: string,
): boolean {
  const support = optionSupport(model, group)
  if (support === 'unrestricted') return true
  if (support === 'none') return false
  return support.includes(optionId)
}

export function optionsForModel(
  options: GenerationOption[],
  model: GenerationModelOption | undefined,
  group: SupportedOptionGroup,
): GenerationOption[] {
  return options.filter(option => option.enabled !== false && isOptionSupported(model, group, option.id))
}

export function firstSupportedOptionId(
  options: GenerationOption[],
  model: GenerationModelOption | undefined,
  group: SupportedOptionGroup,
  preferred?: string,
): string | undefined {
  const selectable = optionsForModel(options, model, group)
  if (selectable.length === 0) return undefined
  if (preferred !== undefined && selectable.some(option => option.id === preferred)) return preferred
  return selectable[0]?.id
}

function findModel(config: GenerationConfig, kind: AgentMode, modelId: string | undefined): GenerationModelOption | undefined {
  const models = config[kind].models
  return models.find(item => item.id === modelId)
    ?? models.find(item => item.id === config[kind].defaults.modelId)
    ?? models[0]
}

export function durationRangeForModel(
  config: GenerationConfig,
  model: GenerationModelOption | undefined,
): { min: number; max: number; step: number; default: number } {
  return model?.durationRange ?? config.video.duration
}

/** Discrete duration chips for video (native number inputs are invisible under opacity:0 styling). */
export function durationOptions(
  range: { min: number; max: number; step: number; default: number },
): GenerationOption[] {
  const options: GenerationOption[] = []
  const step = range.step > 0 ? range.step : 1
  for (let value = range.min; value <= range.max + 1e-9; value += step) {
    const rounded = Math.round(value * 1000) / 1000
    options.push({ id: String(rounded), label: `${rounded}s` })
  }
  if (options.length === 0) options.push({ id: String(range.default), label: `${range.default}s` })
  return options
}

export function clampDuration(
  value: unknown,
  range: { min: number; max: number; step: number; default: number },
): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : range.default
  const clamped = Math.min(range.max, Math.max(range.min, numeric))
  const step = range.step > 0 ? range.step : 1
  return range.min + Math.round((clamped - range.min) / step) * step
}

function assignOrDelete(
  parameters: GenerationContext['parameters'],
  key: 'qualityId' | 'resolutionId' | 'aspectRatioId',
  value: string | undefined,
): void {
  if (value === undefined) {
    if (key === 'qualityId') delete parameters.qualityId
    else if (key === 'resolutionId') delete parameters.resolutionId
    else delete parameters.aspectRatioId
    return
  }
  if (key === 'qualityId') parameters.qualityId = value
  else if (key === 'resolutionId') parameters.resolutionId = value
  else parameters.aspectRatioId = value
}

export function normalizeGenerationContext(
  kind: AgentMode,
  config: GenerationConfig,
  previous?: GenerationContext,
): GenerationContext {
  const section = config[kind]
  const model = findModel(config, kind, previous?.kind === kind ? previous.modelId : undefined)
  const modelId = model?.id ?? section.defaults.modelId

  if (kind === 'image') {
    const image = config.image
    const preferred = previous?.kind === 'image' ? previous.parameters : undefined
    const parameters: GenerationContext['parameters'] = {
      ...(preferred?.referenceAssets === undefined ? {} : { referenceAssets: preferred.referenceAssets }),
    }
    assignOrDelete(
      parameters,
      'aspectRatioId',
      firstSupportedOptionId(image.aspectRatios, model, 'aspect_ratio', preferred?.aspectRatioId ?? image.defaults.aspectRatioId),
    )
    assignOrDelete(
      parameters,
      'resolutionId',
      firstSupportedOptionId(image.resolutions, model, 'resolution', preferred?.resolutionId ?? image.defaults.resolutionId),
    )
    assignOrDelete(
      parameters,
      'qualityId',
      firstSupportedOptionId(image.qualities, model, 'quality', preferred?.qualityId ?? image.defaults.qualityId),
    )
    return { schemaVersion: 1, kind, modelId, parameters }
  }

  const video = config.video
  const preferred = previous?.kind === 'video' ? previous.parameters : undefined
  const durationRange = durationRangeForModel(config, model)
  const parameters: GenerationContext['parameters'] = {
    duration: clampDuration(preferred?.duration ?? video.defaults.duration, durationRange),
    audio: preferred?.audio ?? video.defaults.audio,
    ...(preferred?.referenceAssets === undefined ? {} : { referenceAssets: preferred.referenceAssets }),
  }
  assignOrDelete(
    parameters,
    'aspectRatioId',
    firstSupportedOptionId(video.aspectRatios, model, 'aspect_ratio', preferred?.aspectRatioId ?? video.defaults.aspectRatioId),
  )
  assignOrDelete(
    parameters,
    'resolutionId',
    firstSupportedOptionId(video.resolutions, model, 'resolution', preferred?.resolutionId ?? video.defaults.resolutionId),
  )
  return { schemaVersion: 1, kind, modelId, parameters }
}

export function updateGenerationContext(
  current: GenerationContext,
  patch: { modelId?: string; parameters?: Partial<GenerationContext['parameters']> },
  config: GenerationConfig,
): GenerationContext {
  return normalizeGenerationContext(current.kind, config, {
    ...current,
    ...(patch.modelId === undefined ? {} : { modelId: patch.modelId }),
    parameters: { ...current.parameters, ...patch.parameters },
  })
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
  return normalizeGenerationContext(mode, config)
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
