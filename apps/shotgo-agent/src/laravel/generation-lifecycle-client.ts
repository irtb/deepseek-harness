import {
  assertMutationHeaders,
  IDEMPOTENCY_HEADER,
  isProtocolProblem,
  SHOTGO_PROTOCOL_HEADER,
  SHOTGO_PROTOCOL_VERSION,
  type GenerationCancelRequest,
  type GenerationResponse,
  type MutationContext,
} from '../contracts/laravel-v1.ts'
import { isGenerationResponse } from './generation-response.ts'

export interface GenerationLifecycleClientOptions {
  baseURL: string
  fetch?: typeof fetch
}

export class LaravelGenerationLifecycleClient {
  private readonly fetch: typeof fetch
  private readonly baseURL: URL

  constructor(options: GenerationLifecycleClientOptions) {
    this.baseURL = new URL(options.baseURL)
    if (this.baseURL.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(this.baseURL.hostname)) {
      throw new Error('SHOTGO_LARAVEL_BASE_URL_REQUIRES_HTTPS')
    }
    this.fetch = options.fetch ?? globalThis.fetch
  }

  async read(input: { capabilityGrant: string; generationId: string; signal?: AbortSignal }): Promise<GenerationResponse> {
    return await this.get(`/api/agent/v1/generations/${encodeURIComponent(input.generationId)}`, input)
  }

  async recover(input: { capabilityGrant: string; clientRequestId: string; signal?: AbortSignal }): Promise<GenerationResponse> {
    return await this.get(`/api/agent/v1/generations/by-client-request/${encodeURIComponent(input.clientRequestId)}`, input)
  }

  async cancel(input: {
    capabilityGrant: string
    generationId: string
    context: MutationContext
    signal?: AbortSignal
  }): Promise<GenerationResponse> {
    const headers = this.headers(input.capabilityGrant, input.context.clientRequestId)
    assertMutationHeaders(input.context, headers)
    const response = await this.fetch(new URL(
      `/api/agent/v1/generations/${encodeURIComponent(input.generationId)}/cancel`,
      this.baseURL,
    ), {
      method: 'POST',
      headers,
      body: JSON.stringify({ context: input.context } satisfies GenerationCancelRequest),
      cache: 'no-store',
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })
    return await this.response(response, 'GENERATION_CANCEL')
  }

  private async get(
    path: string,
    input: { capabilityGrant: string; signal?: AbortSignal },
  ): Promise<GenerationResponse> {
    const response = await this.fetch(new URL(path, this.baseURL), {
      method: 'GET',
      headers: this.headers(input.capabilityGrant),
      cache: 'no-store',
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })
    return await this.response(response, 'GENERATION_STATUS')
  }

  private headers(capabilityGrant: string, idempotencyKey?: string): Record<string, string> {
    return {
      Authorization: `Bearer ${capabilityGrant}`,
      'Content-Type': 'application/json',
      [SHOTGO_PROTOCOL_HEADER]: SHOTGO_PROTOCOL_VERSION,
      ...(idempotencyKey === undefined ? {} : { [IDEMPOTENCY_HEADER]: idempotencyKey }),
    }
  }

  private async response(response: Response, prefix: string): Promise<GenerationResponse> {
    const value: unknown = await response.json()
    if (!response.ok) {
      if (isProtocolProblem(value)) throw new Error(value.code)
      throw new Error(`${prefix}_HTTP_${response.status}`)
    }
    if (response.headers.get(SHOTGO_PROTOCOL_HEADER) !== SHOTGO_PROTOCOL_VERSION || !isGenerationResponse(value)) {
      throw new Error(`${prefix}_PROTOCOL_INVALID`)
    }
    return value
  }
}
