import {
  SHOTGO_PROTOCOL_HEADER,
  SHOTGO_PROTOCOL_VERSION,
  isSupportedShotGoProtocolVersion,
  type AgentGrantIntrospectionResponse,
  type AgentMode,
  type AgentSessionCapability,
  type InferenceModel,
  type InferencePolicy,
  type InferenceReasoningEffort,
} from '../contracts/laravel-v1.ts'
import { GatewaySessionError } from '../gateway-errors.ts'
import type { AuthorizedGatewaySession, GatewaySessionAuthorizer } from '../gateway-session.ts'

export interface CapabilityGrantAuthorizerOptions {
  baseURL: string
  serviceToken: string
  fetch?: typeof globalThis.fetch
  now?: () => number
}

const modes = new Set<AgentMode>(['canvas', 'image', 'video'])
const models = new Set<InferenceModel>(['deepseek-v4-flash', 'deepseek-v4-pro'])
const reasoningEfforts = new Set<InferenceReasoningEffort>(['off', 'high', 'max'])

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function nullableString(value: unknown): value is string | null {
  return value === null || nonEmptyString(value)
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

function nullablePositiveInteger(value: unknown): value is number | null {
  return value === null || positiveInteger(value)
}

function uniqueNonEmptyStrings(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length > 0
    && value.every(nonEmptyString)
    && new Set(value).size === value.length
}

function isInferencePolicy(value: unknown): value is InferencePolicy {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  const allowedModels = candidate.allowedModels
  return isSupportedShotGoProtocolVersion(candidate.protocolVersion)
    && nonEmptyString(candidate.policyVersion)
    && candidate.provider === 'volcengine-ark'
    && Array.isArray(allowedModels)
    && allowedModels.length > 0
    && allowedModels.every(model => models.has(model as InferenceModel))
    && new Set(allowedModels).size === allowedModels.length
    && models.has(candidate.defaultModel as InferenceModel)
    && allowedModels.includes(candidate.defaultModel)
    && reasoningEfforts.has(candidate.defaultReasoningEffort as InferenceReasoningEffort)
    && positiveInteger(candidate.maxOutputTokens)
    && candidate.maxOutputTokens <= 65_536
    && positiveInteger(candidate.sessionTokenBudget)
    && nonEmptyString(candidate.expiresAt)
    && Number.isFinite(Date.parse(candidate.expiresAt))
}

function isIntrospection(value: unknown): value is AgentGrantIntrospectionResponse {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  const allowed = candidate.allowedCapabilities
  return isSupportedShotGoProtocolVersion(candidate.protocolVersion)
    && candidate.active === true
    && nonEmptyString(candidate.authorizationContextId)
    && nonEmptyString(candidate.subjectId)
    && nonEmptyString(candidate.expiresAt)
    && Number.isFinite(Date.parse(candidate.expiresAt))
    && nonEmptyString(candidate.sessionId)
    && positiveInteger(candidate.userId)
    && nullablePositiveInteger(candidate.teamId)
    && nullableString(candidate.spaceId)
    && nullableString(candidate.projectId)
    && modes.has(candidate.agentMode as AgentMode)
    && uniqueNonEmptyStrings(allowed)
    && isInferencePolicy(candidate.inferencePolicy)
}

function normalizedBaseURL(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    throw new Error('Capability Grant introspection requires HTTPS outside loopback')
  }
  return url.toString().replace(/\/$/, '')
}

function rejectedStatus(status: number): number {
  if (status === 401 || status === 410) return 401
  if (status === 403 || status === 404 || status === 409) return 403
  return 503
}

/** Validate opaque browser grants against Laravel without decoding them locally. */
export class LaravelCapabilityGrantAuthorizer implements GatewaySessionAuthorizer {
  private readonly baseURL: string
  private readonly fetch: typeof globalThis.fetch
  private readonly now: () => number

  constructor(private readonly options: CapabilityGrantAuthorizerOptions) {
    if (options.serviceToken.length === 0) throw new Error('Capability Grant authorizer service token is required')
    this.baseURL = normalizedBaseURL(options.baseURL)
    this.fetch = options.fetch ?? globalThis.fetch
    this.now = options.now ?? Date.now
  }

  async authorize(input: {
    capabilityGrant: string
    sessionId: string
    requiredCapability: AgentSessionCapability
    signal?: AbortSignal
  }): Promise<AuthorizedGatewaySession> {
    if (input.capabilityGrant.length === 0) throw new GatewaySessionError('CAPABILITY_GRANT_REQUIRED', 401)
    let response: Response
    try {
      response = await this.fetch(`${this.baseURL}/api/internal/agent/v1/grants/introspect`, {
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
          requiredCapability: input.requiredCapability,
        }),
        cache: 'no-store',
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      })
    } catch {
      throw new GatewaySessionError('CAPABILITY_INTROSPECTION_UNAVAILABLE', 503)
    }
    if (!isSupportedShotGoProtocolVersion(response.headers.get(SHOTGO_PROTOCOL_HEADER))) {
      throw new GatewaySessionError('LARAVEL_PROTOCOL_VERSION_MISMATCH', 503)
    }
    if (!response.ok) throw new GatewaySessionError('CAPABILITY_GRANT_REJECTED', rejectedStatus(response.status))
    if (!response.headers.get('cache-control')?.toLowerCase().includes('no-store')) {
      throw new GatewaySessionError('CAPABILITY_INTROSPECTION_CACHE_POLICY_INVALID', 503)
    }
    let introspection: unknown
    try {
      introspection = await response.json()
    } catch {
      throw new GatewaySessionError('CAPABILITY_INTROSPECTION_INVALID', 503)
    }
    if (!isIntrospection(introspection)) {
      throw new GatewaySessionError('CAPABILITY_INTROSPECTION_INVALID', 503)
    }
    if (Date.parse(introspection.expiresAt) <= this.now()) {
      throw new GatewaySessionError('CAPABILITY_GRANT_EXPIRED', 401)
    }
    if (Date.parse(introspection.inferencePolicy.expiresAt) <= this.now()) {
      throw new GatewaySessionError('INFERENCE_POLICY_EXPIRED', 401)
    }
    if (introspection.sessionId !== input.sessionId) {
      throw new GatewaySessionError('CAPABILITY_SESSION_MISMATCH', 403)
    }
    if (!introspection.allowedCapabilities.includes(input.requiredCapability)) {
      throw new GatewaySessionError('CAPABILITY_NOT_ALLOWED', 403)
    }
    return {
      authorizationContextId: introspection.authorizationContextId,
      expiresAt: introspection.expiresAt,
      sessionId: introspection.sessionId,
      userId: introspection.userId,
      teamId: introspection.teamId,
      spaceId: introspection.spaceId,
      projectId: introspection.projectId,
      agentMode: introspection.agentMode,
      provider: introspection.inferencePolicy.provider,
      model: introspection.inferencePolicy.defaultModel,
      maxTokens: introspection.inferencePolicy.maxOutputTokens,
      reasoningEffort: introspection.inferencePolicy.defaultReasoningEffort,
    }
  }
}
