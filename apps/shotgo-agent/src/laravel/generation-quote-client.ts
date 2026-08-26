import {
  SHOTGO_PROTOCOL_HEADER,
  SHOTGO_PROTOCOL_VERSION,
  isSupportedShotGoProtocolVersion,
  type GenerationQuoteParameters,
  type GenerationQuoteRequest,
  type GenerationQuoteResponse,
} from '../contracts/laravel-v1.ts'

export interface GenerationQuoteClientOptions {
  baseURL: string
  fetch?: typeof globalThis.fetch
}

export interface BoundGenerationQuoteRequest extends GenerationQuoteRequest {
  capabilityGrant: string
  signal?: AbortSignal
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key))
}

function isParameters(value: unknown): value is GenerationQuoteParameters {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.entries(value).every(([key, item]) => key === 'referenceAssets'
      ? isReferenceAssets(item)
      : ['string', 'number', 'boolean'].includes(typeof item))
}

function isReferenceAssets(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > 9) return false
  const seen = new Set<number>()
  return value.every((item) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return false
    const reference = item as Record<string, unknown>
    if (!hasOnlyKeys(reference, ['mediaLibraryItemId'])) return false
    const mediaLibraryItemId = Number(reference.mediaLibraryItemId)
    if (!Number.isSafeInteger(reference.mediaLibraryItemId)
      || mediaLibraryItemId <= 0
      || seen.has(mediaLibraryItemId)
    ) return false
    seen.add(mediaLibraryItemId)
    return true
  })
}

function isQuote(value: unknown): value is GenerationQuoteResponse {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const quote = value as Record<string, unknown>
  if (!hasOnlyKeys(quote, [
    'protocolVersion', 'quoteId', 'quoteVersion', 'kind', 'modelId', 'credits', 'breakdown',
    'canAfford', 'userBalance', 'expiresAt', 'normalizedParameters', 'requiresConfirmation',
  ])) return false
  return isSupportedShotGoProtocolVersion(quote.protocolVersion)
    && nonEmptyString(quote.quoteId)
    && quote.quoteVersion === 1
    && (quote.kind === 'image' || quote.kind === 'video')
    && nonEmptyString(quote.modelId)
    && nonNegativeInteger(quote.credits)
    && Array.isArray(quote.breakdown)
    && quote.breakdown.every((item) => {
      if (item === null || typeof item !== 'object' || Array.isArray(item)) return false
      const entry = item as Record<string, unknown>
      return hasOnlyKeys(entry, ['key', 'label', 'credits'])
        && nonEmptyString(entry.key)
        && nonEmptyString(entry.label)
        && nonNegativeInteger(entry.credits)
    })
    && typeof quote.canAfford === 'boolean'
    && nonNegativeInteger(quote.userBalance)
    && nonEmptyString(quote.expiresAt)
    && Number.isFinite(Date.parse(quote.expiresAt))
    && Date.parse(quote.expiresAt) > Date.now()
    && isParameters(quote.normalizedParameters)
    && quote.requiresConfirmation === true
}

function normalizedBaseURL(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    throw new Error('Generation quote client requires HTTPS outside loopback')
  }
  return url.toString().replace(/\/$/, '')
}

export class LaravelGenerationQuoteClient {
  private readonly baseURL: string
  private readonly fetch: typeof globalThis.fetch

  constructor(options: GenerationQuoteClientOptions) {
    this.baseURL = normalizedBaseURL(options.baseURL)
    this.fetch = options.fetch ?? globalThis.fetch
  }

  async quote(input: BoundGenerationQuoteRequest): Promise<GenerationQuoteResponse> {
    const response = await this.fetch(`${this.baseURL}/api/agent/v1/generation-quotes`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${input.capabilityGrant}`,
        'Content-Type': 'application/json',
        [SHOTGO_PROTOCOL_HEADER]: SHOTGO_PROTOCOL_VERSION,
      },
      body: JSON.stringify({
        sessionId: input.sessionId,
        kind: input.kind,
        modelId: input.modelId,
        parameters: input.parameters,
      }),
      cache: 'no-store',
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })
    if (!isSupportedShotGoProtocolVersion(response.headers.get(SHOTGO_PROTOCOL_HEADER))) {
      throw new Error('LARAVEL_PROTOCOL_VERSION_MISMATCH')
    }
    if (!response.ok) throw new Error(`GENERATION_QUOTE_REJECTED:${response.status}`)
    if (!response.headers.get('cache-control')?.toLowerCase().includes('no-store')) {
      throw new Error('GENERATION_QUOTE_CACHE_POLICY_INVALID')
    }
    const value: unknown = await response.json()
    if (!isQuote(value)
      || value.kind !== input.kind
      || value.modelId !== input.modelId
    ) {
      throw new Error('GENERATION_QUOTE_RESPONSE_INVALID')
    }
    return value
  }
}
