import {
  SHOTGO_PROTOCOL_HEADER,
  SHOTGO_PROTOCOL_VERSION,
  isSupportedShotGoProtocolVersion,
  type GenerationFpsRange,
  type GenerationConfigModel,
  type GenerationOption,
  type GenerationOptionOverride,
  type GenerationRange,
  type GenerationConfigReadResponse,
  type GenerationKind,
} from '../contracts/laravel-v1.ts'

export interface GenerationConfigClientOptions {
  baseURL: string
  serviceToken: string
  fetch?: typeof globalThis.fetch
}

export interface BoundGenerationConfigRequest {
  capabilityGrant: string
  sessionId: string
  kind: GenerationKind
  signal?: AbortSignal
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || nonEmptyString(value)
}

function optionalNumber(value: unknown): value is number | undefined {
  return value === undefined || nonNegativeNumber(value)
}

function nonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function nonNegativeInteger(value: unknown): value is number {
  return nonNegativeNumber(value) && Number.isInteger(value)
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key))
}

function isStringLists(value: unknown): value is Record<string, string[]> | undefined {
  if (value === undefined) return true
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value).every(items => Array.isArray(items) && items.every(nonEmptyString))
}

function isOptionOverride(value: unknown): value is GenerationOptionOverride {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const override = value as Record<string, unknown>
  return hasOnlyKeys(override, ['enabled', 'credits'])
    && (override.enabled === undefined || typeof override.enabled === 'boolean')
    && optionalNumber(override.credits)
}

function isOptionOverrides(
  value: unknown,
): value is Record<string, Record<string, GenerationOptionOverride>> | undefined {
  if (value === undefined) return true
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value).every(group => group !== null
    && typeof group === 'object'
    && !Array.isArray(group)
    && Object.values(group as Record<string, unknown>).every(isOptionOverride))
}

function isOperationConstraints(value: unknown): value is Record<string, Record<string, string[]>> | undefined {
  if (value === undefined) return true
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value).every(isStringLists)
}

function isRange(value: unknown): value is GenerationRange {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const range = value as Record<string, unknown>
  if (!(hasOnlyKeys(range, ['min', 'max', 'step', 'default', 'unit'])
    && (range.min === undefined || nonNegativeInteger(range.min))
    && (range.max === undefined || nonNegativeInteger(range.max))
    && (range.step === undefined || nonNegativeInteger(range.step))
    && (range.default === undefined || nonNegativeInteger(range.default))
    && optionalString(range.unit))) return false
  if (typeof range.step === 'number' && range.step === 0) return false
  if (typeof range.min === 'number' && typeof range.max === 'number' && range.min > range.max) return false
  if (typeof range.default === 'number') {
    if (typeof range.min === 'number' && range.default < range.min) return false
    if (typeof range.max === 'number' && range.default > range.max) return false
  }
  return true
}

function isFpsRange(value: unknown): value is GenerationFpsRange {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const range = value as Record<string, unknown>
  return hasOnlyKeys(range, ['minFps', 'maxFps', 'credits'])
    && nonNegativeInteger(range.minFps)
    && nonNegativeInteger(range.maxFps)
    && range.minFps <= range.maxFps
    && optionalNumber(range.credits)
}

function isOption(value: unknown): value is GenerationOption {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const option = value as Record<string, unknown>
  return hasOnlyKeys(option, ['id', 'label', 'value', 'credits'])
    && nonEmptyString(option.id)
    && nonEmptyString(option.label)
    && (option.value === undefined || typeof option.value === 'boolean')
    && optionalNumber(option.credits)
}

function isOptions(value: unknown): value is GenerationOption[] {
  return Array.isArray(value)
    && value.every(isOption)
    && new Set(value.map(option => option.id)).size === value.length
}

function isModel(value: unknown, kind: GenerationKind): value is GenerationConfigModel {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const model = value as Record<string, unknown>
  return hasOnlyKeys(model, [
    'id', 'label', 'shortLabel', 'badge', 'duration', 'description', 'credits', 'vip',
    'supportedOptions', 'optionOverrides', 'operationOptionConstraints', 'durationRange',
    'fpsEnabled', 'fpsRanges',
  ])
    && nonEmptyString(model.id)
    && nonEmptyString(model.label)
    && optionalString(model.shortLabel)
    && optionalString(model.badge)
    && optionalString(model.duration)
    && optionalString(model.description)
    && optionalNumber(model.credits)
    && typeof model.vip === 'boolean'
    && isStringLists(model.supportedOptions)
    && isOptionOverrides(model.optionOverrides)
    && isOperationConstraints(model.operationOptionConstraints)
    && (model.durationRange === undefined || isRange(model.durationRange))
    && (model.fpsEnabled === undefined || typeof model.fpsEnabled === 'boolean')
    && (model.fpsRanges === undefined || (Array.isArray(model.fpsRanges) && model.fpsRanges.every(isFpsRange)))
    && (kind === 'image'
      ? model.durationRange === undefined && model.fpsEnabled === undefined && model.fpsRanges === undefined
      : model.operationOptionConstraints === undefined)
}

function isDefaults(
  value: unknown,
  kind: GenerationKind,
  models: readonly GenerationConfigModel[],
  parameters: Record<string, unknown>,
): value is Record<string, string | number | boolean> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const defaults = value as Record<string, unknown>
  const allowed = kind === 'image'
    ? ['modelId', 'qualityId', 'resolutionId', 'aspectRatioId']
    : ['modelId', 'aspectRatioId', 'resolutionId', 'duration', 'audio']
  if (!hasOnlyKeys(defaults, allowed)) return false
  if (defaults.modelId !== undefined
    && (!nonEmptyString(defaults.modelId) || !models.some(model => model.id === defaults.modelId))) return false
  const optionKeys = kind === 'image'
    ? { qualityId: 'qualities', resolutionId: 'resolutions', aspectRatioId: 'aspectRatios' }
    : { aspectRatioId: 'aspectRatios', resolutionId: 'resolutions' }
  for (const [defaultKey, parameterKey] of Object.entries(optionKeys)) {
    const defaultValue = defaults[defaultKey]
    if (defaultValue === undefined) continue
    const options = parameters[parameterKey]
    if (!nonEmptyString(defaultValue)
      || !Array.isArray(options)
      || !options.some(option => isOption(option) && option.id === defaultValue)) return false
  }
  if (kind === 'video') {
    if (defaults.duration !== undefined && !nonNegativeInteger(defaults.duration)) return false
    if (typeof defaults.duration === 'number') {
      const duration = parameters.duration
      if (!isRange(duration)) return false
      if (duration.min !== undefined && defaults.duration < duration.min) return false
      if (duration.max !== undefined && defaults.duration > duration.max) return false
    }
    if (defaults.audio !== undefined && typeof defaults.audio !== 'boolean') return false
  }
  return true
}

function isParameters(value: unknown, kind: GenerationKind): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const parameters = value as Record<string, unknown>
  if (kind === 'image') {
    return hasOnlyKeys(parameters, ['qualities', 'resolutions', 'aspectRatios'])
      && isOptions(parameters.qualities)
      && isOptions(parameters.resolutions)
      && isOptions(parameters.aspectRatios)
  }
  return hasOnlyKeys(parameters, [
    'aspectRatios', 'resolutions', 'duration', 'fps', 'audioOptions', 'operationTypes',
  ])
    && isOptions(parameters.aspectRatios)
    && isOptions(parameters.resolutions)
    && isRange(parameters.duration)
    && isRange(parameters.fps)
    && isOptions(parameters.audioOptions)
    && isOptions(parameters.operationTypes)
}

function isGenerationConfig(value: unknown): value is GenerationConfigReadResponse {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const config = value as Record<string, unknown>
  if (config.kind !== 'image' && config.kind !== 'video') return false
  const kind = config.kind
  return hasOnlyKeys(config, [
    'protocolVersion', 'parameterSchemaVersion', 'authorizationContextId', 'sessionId',
    'kind', 'models', 'parameters', 'defaults',
  ])
    && isSupportedShotGoProtocolVersion(config.protocolVersion)
    && config.parameterSchemaVersion === 1
    && nonEmptyString(config.authorizationContextId)
    && nonEmptyString(config.sessionId)
    && Array.isArray(config.models)
    && config.models.every(model => isModel(model, kind))
    && new Set(config.models.map(model => model.id)).size === config.models.length
    && isParameters(config.parameters, kind)
    && isDefaults(
      config.defaults,
      kind,
      config.models,
      config.parameters as Record<string, unknown>,
    )
}

function normalizedBaseURL(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    throw new Error('Generation config client requires HTTPS outside loopback')
  }
  return url.toString().replace(/\/$/, '')
}

export class LaravelGenerationConfigClient {
  private readonly baseURL: string
  private readonly fetch: typeof globalThis.fetch

  constructor(private readonly options: GenerationConfigClientOptions) {
    if (options.serviceToken.length === 0) throw new Error('Generation config client service token is required')
    this.baseURL = normalizedBaseURL(options.baseURL)
    this.fetch = options.fetch ?? globalThis.fetch
  }

  bind(binding: { capabilityGrant: () => string; sessionId: string }): {
    read(kind: GenerationKind, signal?: AbortSignal): Promise<GenerationConfigReadResponse>
  } {
    return {
      read: async (kind, signal) => await this.read({
        capabilityGrant: binding.capabilityGrant(),
        sessionId: binding.sessionId,
        kind,
        ...(signal === undefined ? {} : { signal }),
      }),
    }
  }

  async read(input: BoundGenerationConfigRequest): Promise<GenerationConfigReadResponse> {
    const response = await this.fetch(`${this.baseURL}/api/internal/agent/v1/generation/config`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.options.serviceToken}`,
        'Content-Type': 'application/json',
        [SHOTGO_PROTOCOL_HEADER]: SHOTGO_PROTOCOL_VERSION,
      },
      body: JSON.stringify({
        grantToken: input.capabilityGrant,
        sessionId: input.sessionId,
        kind: input.kind,
      }),
      cache: 'no-store',
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })
    if (!isSupportedShotGoProtocolVersion(response.headers.get(SHOTGO_PROTOCOL_HEADER))) {
      throw new Error('LARAVEL_PROTOCOL_VERSION_MISMATCH')
    }
    if (!response.ok) throw new Error(`GENERATION_CONFIG_READ_REJECTED:${response.status}`)
    if (!response.headers.get('cache-control')?.toLowerCase().includes('no-store')) {
      throw new Error('GENERATION_CONFIG_CACHE_POLICY_INVALID')
    }
    const value: unknown = await response.json()
    if (!isGenerationConfig(value)
      || value.sessionId !== input.sessionId
      || value.kind !== input.kind
    ) {
      throw new Error('GENERATION_CONFIG_RESPONSE_INVALID')
    }
    return value
  }
}
