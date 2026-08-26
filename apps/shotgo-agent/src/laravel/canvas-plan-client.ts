import {
  IDEMPOTENCY_HEADER,
  SHOTGO_PROTOCOL_HEADER,
  SHOTGO_PROTOCOL_VERSION,
  isSupportedShotGoProtocolVersion,
  type CanvasPlanApplyResponse,
  type CanvasPlanDependencyInput,
  type CanvasPlanNodeInput,
  type CanvasPlanQuoteResponse,
} from '../contracts/laravel-v1.ts'

function baseURL(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(url.hostname)) throw new Error('Canvas plan client requires HTTPS outside loopback')
  return url.toString().replace(/\/$/, '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key))
}

export class LaravelCanvasPlanClient {
  private readonly baseURL: string
  private readonly fetch: typeof globalThis.fetch

  constructor(options: { baseURL: string; fetch?: typeof globalThis.fetch }) {
    this.baseURL = baseURL(options.baseURL)
    this.fetch = options.fetch ?? globalThis.fetch
  }

  async quote(input: {
    capabilityGrant: string
    sessionId: string
    revision: string
    summary: string
    nodes: CanvasPlanNodeInput[]
    dependencies: CanvasPlanDependencyInput[]
    signal?: AbortSignal
  }): Promise<CanvasPlanQuoteResponse> {
    const response = await this.fetch(`${this.baseURL}/api/agent/v1/canvas-plan-quotes`, {
      method: 'POST', headers: this.headers(input.capabilityGrant), cache: 'no-store',
      body: JSON.stringify({
        sessionId: input.sessionId,
        revision: input.revision,
        summary: input.summary,
        nodes: input.nodes,
        dependencies: input.dependencies,
      }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })
    const value: unknown = await response.json()
    if (!response.ok) throw new Error(`CANVAS_PLAN_QUOTE_REJECTED:${response.status}`)
    if (!isSupportedShotGoProtocolVersion(response.headers.get(SHOTGO_PROTOCOL_HEADER)) || !isCanvasPlanQuote(value)) {
      throw new Error('CANVAS_PLAN_QUOTE_RESPONSE_INVALID')
    }
    return value
  }

  async apply(input: {
    capabilityGrant: string
    sessionId: string
    runId: string
    actionId: string
    clientRequestId: string
    quoteId: string
    quoteVersion: 1
    signal?: AbortSignal
  }): Promise<CanvasPlanApplyResponse> {
    const response = await this.fetch(`${this.baseURL}/api/agent/v1/canvas-plans`, {
      method: 'POST', headers: this.headers(input.capabilityGrant, input.clientRequestId), cache: 'no-store',
      body: JSON.stringify({
        context: {
          sessionId: input.sessionId,
          runId: input.runId,
          actionId: input.actionId,
          clientRequestId: input.clientRequestId,
        },
        quoteId: input.quoteId,
        quoteVersion: input.quoteVersion,
      }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })
    const value: unknown = await response.json()
    if (!response.ok) throw new Error(`CANVAS_PLAN_APPLY_REJECTED:${response.status}`)
    if (!isSupportedShotGoProtocolVersion(response.headers.get(SHOTGO_PROTOCOL_HEADER)) || !isCanvasPlanApply(value)) {
      throw new Error('CANVAS_PLAN_APPLY_RESPONSE_INVALID')
    }
    return value
  }

  private headers(grant: string, idempotencyKey?: string): Record<string, string> {
    return {
      Accept: 'application/json', Authorization: `Bearer ${grant}`, 'Content-Type': 'application/json',
      [SHOTGO_PROTOCOL_HEADER]: SHOTGO_PROTOCOL_VERSION,
      ...(idempotencyKey === undefined ? {} : { [IDEMPOTENCY_HEADER]: idempotencyKey }),
    }
  }
}

function isCanvasPlanQuote(value: unknown): value is CanvasPlanQuoteResponse {
  if (!isRecord(value)) return false
  const nodes = Array.isArray(value.nodes) ? value.nodes : []
  const dependencies = Array.isArray(value.dependencies) ? value.dependencies : []
  return hasOnlyKeys(value, ['protocolVersion', 'quoteId', 'quoteVersion', 'quoteKind', 'authorizationContextId', 'sessionId', 'userId', 'teamId', 'spaceId', 'projectId', 'planId', 'revision', 'summary', 'nodes', 'dependencies', 'credits', 'billingMode', 'expiresAt', 'requiresConfirmation'])
    && isSupportedShotGoProtocolVersion(value.protocolVersion) && value.quoteKind === 'canvas-plan'
    && typeof value.quoteId === 'string' && value.quoteVersion === 1 && typeof value.planId === 'string'
    && typeof value.authorizationContextId === 'string' && typeof value.sessionId === 'string'
    && Number.isSafeInteger(value.userId) && (value.teamId === null || Number.isSafeInteger(value.teamId))
    && typeof value.spaceId === 'string' && typeof value.projectId === 'string'
    && typeof value.revision === 'string' && typeof value.summary === 'string' && nodes.length >= 1 && nodes.length <= 12
    && nodes.every(node => isRecord(node) && hasOnlyKeys(node, ['tempId', 'nodeKey', 'name', 'kind']) && typeof node.tempId === 'string' && typeof node.nodeKey === 'string'
      && typeof node.name === 'string' && ['text', 'image', 'video', 'audio'].includes(String(node.kind)))
    && dependencies.length <= 24 && dependencies.every(edge => isRecord(edge) && hasOnlyKeys(edge, ['connectionKey', 'from', 'to', 'sourceKey', 'targetKey']) && typeof edge.from === 'string'
      && typeof edge.to === 'string' && typeof edge.connectionKey === 'string'
      && typeof edge.sourceKey === 'string' && typeof edge.targetKey === 'string')
    && value.credits === 1 && value.billingMode === 'virtual'
    && typeof value.expiresAt === 'string' && Date.parse(value.expiresAt) > Date.now() && value.requiresConfirmation === true
}

function isCanvasPlanApply(value: unknown): value is CanvasPlanApplyResponse {
  return isRecord(value) && hasOnlyKeys(value, ['protocolVersion', 'planId', 'projectId', 'nodeKeys', 'connectionKeys', 'credits', 'billingMode', 'replayed'])
    && isSupportedShotGoProtocolVersion(value.protocolVersion)
    && typeof value.planId === 'string' && typeof value.projectId === 'string'
    && Array.isArray(value.nodeKeys) && value.nodeKeys.length >= 1 && value.nodeKeys.length <= 12 && value.nodeKeys.every(item => typeof item === 'string')
    && Array.isArray(value.connectionKeys) && value.connectionKeys.length <= 24 && value.connectionKeys.every(item => typeof item === 'string')
    && value.credits === 1 && value.billingMode === 'virtual' && typeof value.replayed === 'boolean'
}
