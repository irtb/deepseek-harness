import {
  assertMutationHeaders,
  IDEMPOTENCY_HEADER,
  isProtocolProblem,
  SHOTGO_PROTOCOL_HEADER,
  SHOTGO_PROTOCOL_VERSION,
  isSupportedShotGoProtocolVersion,
  type GenerationCreateRequest,
  type GenerationCreateResponse,
} from '../contracts/laravel-v1.ts'
import { isGenerationResponse } from './generation-response.ts'

export interface GenerationSubmitClientOptions {
  baseURL: string
  fetch?: typeof fetch
}

export interface BoundGenerationSubmitRequest extends GenerationCreateRequest {
  capabilityGrant: string
  signal?: AbortSignal
}

export class LaravelGenerationSubmitClient {
  private readonly fetch: typeof fetch
  private readonly baseURL: URL

  constructor(options: GenerationSubmitClientOptions) {
    this.baseURL = new URL(options.baseURL)
    if (this.baseURL.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(this.baseURL.hostname)) {
      throw new Error('SHOTGO_LARAVEL_BASE_URL_REQUIRES_HTTPS')
    }
    this.fetch = options.fetch ?? globalThis.fetch
  }

  async submit(input: BoundGenerationSubmitRequest): Promise<GenerationCreateResponse> {
    const headers = {
      Authorization: `Bearer ${input.capabilityGrant}`,
      'Content-Type': 'application/json',
      [IDEMPOTENCY_HEADER]: input.context.clientRequestId,
      [SHOTGO_PROTOCOL_HEADER]: SHOTGO_PROTOCOL_VERSION,
    }
    assertMutationHeaders(input.context, headers)
    const response = await this.fetch(new URL('/api/agent/v1/generations', this.baseURL), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        context: input.context,
        quoteId: input.quoteId,
        quoteVersion: input.quoteVersion,
      } satisfies GenerationCreateRequest),
      cache: 'no-store',
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })
    const value: unknown = await response.json()
    if (!response.ok) {
      if (isProtocolProblem(value)) throw new Error(value.code)
      throw new Error(`GENERATION_SUBMIT_HTTP_${response.status}`)
    }
    if (!isSupportedShotGoProtocolVersion(response.headers.get(SHOTGO_PROTOCOL_HEADER)) || !isGenerationResponse(value)) {
      throw new Error('GENERATION_SUBMIT_PROTOCOL_INVALID')
    }
    return value
  }
}
