import {
  SHOTGO_PROTOCOL_HEADER,
  SHOTGO_PROTOCOL_VERSION,
  type GenerationConfigModel,
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
  return value === undefined || (typeof value === 'number' && Number.isFinite(value))
}

function isModel(value: unknown): value is GenerationConfigModel {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const model = value as Record<string, unknown>
  return nonEmptyString(model.id)
    && nonEmptyString(model.label)
    && optionalString(model.shortLabel)
    && optionalString(model.description)
    && optionalNumber(model.credits)
    && typeof model.vip === 'boolean'
}

function isDefaults(value: unknown): value is Record<string, string | number | boolean> {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.values(value).every(item => ['string', 'number', 'boolean'].includes(typeof item))
}

function isGenerationConfig(value: unknown): value is GenerationConfigReadResponse {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const config = value as Record<string, unknown>
  return config.protocolVersion === SHOTGO_PROTOCOL_VERSION
    && nonEmptyString(config.authorizationContextId)
    && nonEmptyString(config.sessionId)
    && (config.kind === 'image' || config.kind === 'video')
    && Array.isArray(config.models)
    && config.models.every(isModel)
    && isDefaults(config.defaults)
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
    if (response.headers.get(SHOTGO_PROTOCOL_HEADER) !== SHOTGO_PROTOCOL_VERSION) {
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
