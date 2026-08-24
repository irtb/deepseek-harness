import {
  IDEMPOTENCY_HEADER,
  SHOTGO_PROTOCOL_HEADER,
  SHOTGO_PROTOCOL_VERSION,
  type InferencePolicy,
  type InferenceUsageReport,
} from '../contracts/laravel-v1.ts'

export interface InferenceControlPlaneOptions {
  baseURL: string
  serviceToken: string
  fetch?: typeof globalThis.fetch
  now?: () => number
}

export class InferenceControlPlaneError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'InferenceControlPlaneError'
  }
}

const forbiddenUsageFields = new Set(['apiKey', 'prompt', 'messages', 'completion', 'response'])

function assertUsagePayloadIsMetadataOnly(value: unknown, path = 'usageReport'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertUsagePayloadIsMetadataOnly(item, `${path}[${index}]`)
    })
    return
  }
  if (value === null || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenUsageFields.has(key)) {
      throw new InferenceControlPlaneError(`${path}.${key} is forbidden`, 'FORBIDDEN_USAGE_FIELD')
    }
    assertUsagePayloadIsMetadataOnly(child, `${path}.${key}`)
  }
}

function isInferencePolicy(value: unknown): value is InferencePolicy {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return candidate.protocolVersion === SHOTGO_PROTOCOL_VERSION
    && candidate.provider === 'volcengine-ark'
    && Array.isArray(candidate.allowedModels)
    && candidate.allowedModels.length > 0
    && candidate.allowedModels.every(model => model === 'deepseek-v4-flash' || model === 'deepseek-v4-pro')
    && (candidate.defaultModel === 'deepseek-v4-flash' || candidate.defaultModel === 'deepseek-v4-pro')
    && candidate.allowedModels.includes(candidate.defaultModel)
    && typeof candidate.policyVersion === 'string'
    && candidate.policyVersion.length > 0
    && (candidate.defaultReasoningEffort === 'off' || candidate.defaultReasoningEffort === 'high' || candidate.defaultReasoningEffort === 'max')
    && Number.isSafeInteger(candidate.maxOutputTokens)
    && (candidate.maxOutputTokens as number) > 0
    && Number.isSafeInteger(candidate.sessionTokenBudget)
    && (candidate.sessionTokenBudget as number) > 0
    && typeof candidate.expiresAt === 'string'
    && Number.isFinite(Date.parse(candidate.expiresAt))
}

function assertProtocolVersion(response: Response): void {
  const actual = response.headers.get(SHOTGO_PROTOCOL_HEADER)
  if (actual !== SHOTGO_PROTOCOL_VERSION) {
    throw new InferenceControlPlaneError(
      `Laravel protocol mismatch: expected ${SHOTGO_PROTOCOL_VERSION}, received ${actual ?? 'missing'}`,
      'PROTOCOL_VERSION_MISMATCH',
      response.status,
    )
  }
}

function normalizedBaseURL(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    throw new Error('Inference control plane requires HTTPS outside loopback')
  }
  return url.toString().replace(/\/$/, '')
}

export class InferenceControlPlaneClient {
  private readonly baseURL: string
  private readonly fetch: typeof globalThis.fetch
  private readonly now: () => number

  constructor(private readonly options: InferenceControlPlaneOptions) {
    if (options.serviceToken.length === 0) throw new Error('Inference control-plane service token is required')
    this.baseURL = normalizedBaseURL(options.baseURL)
    this.fetch = options.fetch ?? globalThis.fetch
    this.now = options.now ?? Date.now
  }

  async readPolicy(capabilityGrant: string, signal?: AbortSignal): Promise<InferencePolicy> {
    if (capabilityGrant.length === 0) throw new Error('Capability grant is required')
    const response = await this.fetch(`${this.baseURL}/api/agent/v1/inference-policy`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${capabilityGrant}`,
        [SHOTGO_PROTOCOL_HEADER]: SHOTGO_PROTOCOL_VERSION,
      },
      ...(signal === undefined ? {} : { signal }),
    })
    assertProtocolVersion(response)
    if (!response.ok) {
      throw new InferenceControlPlaneError('Laravel rejected inference policy request', 'POLICY_REQUEST_FAILED', response.status)
    }
    const policy: unknown = await response.json()
    if (!isInferencePolicy(policy)) {
      throw new InferenceControlPlaneError('Laravel returned an invalid inference policy', 'INVALID_INFERENCE_POLICY')
    }
    if (Date.parse(policy.expiresAt) <= this.now()) {
      throw new InferenceControlPlaneError('Laravel inference policy has expired', 'INFERENCE_POLICY_EXPIRED')
    }
    return policy
  }

  async reportUsage(report: InferenceUsageReport, signal?: AbortSignal): Promise<void> {
    assertUsagePayloadIsMetadataOnly(report)
    const response = await this.fetch(`${this.baseURL}/api/internal/agent/v1/inference-usage`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.options.serviceToken}`,
        'Content-Type': 'application/json',
        [IDEMPOTENCY_HEADER]: report.llmRequestId,
        [SHOTGO_PROTOCOL_HEADER]: SHOTGO_PROTOCOL_VERSION,
      },
      body: JSON.stringify(report),
      ...(signal === undefined ? {} : { signal }),
    })
    assertProtocolVersion(response)
    if (response.status !== 202) {
      throw new InferenceControlPlaneError('Laravel rejected inference usage report', 'USAGE_REPORT_FAILED', response.status)
    }
  }
}
