export const SHOTGO_PROTOCOL_VERSION = '2026-08-26.1' as const
export const SHOTGO_PREVIOUS_PROTOCOL_VERSION = '2026-08-25.1' as const
export type ShotGoProtocolVersion =
  | typeof SHOTGO_PROTOCOL_VERSION
  | typeof SHOTGO_PREVIOUS_PROTOCOL_VERSION
export const SHOTGO_PROTOCOL_HEADER = 'X-ShotGo-Protocol-Version' as const
export const IDEMPOTENCY_HEADER = 'Idempotency-Key' as const

export function isSupportedShotGoProtocolVersion(value: unknown): value is ShotGoProtocolVersion {
  return value === SHOTGO_PROTOCOL_VERSION || value === SHOTGO_PREVIOUS_PROTOCOL_VERSION
}

export type AgentMode = 'canvas' | 'image' | 'video'
export type AssetKind = 'text' | 'image' | 'video' | 'audio'
export type GenerationKind = 'image' | 'video'
export type InferenceModel = 'deepseek-v4-flash' | 'deepseek-v4-pro'
export type InferenceReasoningEffort = 'off' | 'high' | 'max'
export type InferenceUsageStatus = 'completed' | 'failed' | 'cancelled'
export type AgentSessionCapability =
  | 'agent.session.submit'
  | 'agent.session.events.read'
  | 'agent.session.cancel'
  | 'agent.session.approval.respond'

export interface CanvasContextResponse {
  protocolVersion: ShotGoProtocolVersion
  snapshotVersion: 1
  authorizationContextId: string
  sessionId: string
  spaceId: string
  projectId: string
  projectName: string
  revision: string
  updatedAt: string | null
  counts: { nodes: number; connections: number }
  truncated: { nodes: boolean; connections: boolean }
  nodes: Array<{
    nodeKey: string
    type: string
    toolKey: string | null
    name: string
    status: string | null
    parentKey: string | null
    locked: boolean
  }>
  connections: Array<{ connectionKey: string; sourceKey: string; targetKey: string }>
  locks: Array<{ nodeKey: string; lockedByCurrentUser: boolean }>
  availableCapabilities: string[]
}
export type GenerationState =
  | 'draft'
  | 'creating'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface MutationContext {
  sessionId: string
  runId: string
  actionId: string
  clientRequestId: string
}

export interface Money {
  amount: string
  currency: string
}

export interface AgentGrantCreateRequest {
  sessionId: string
  agentMode: AgentMode
  spaceId?: string | null
  projectId?: string | null
}

export interface AgentGrantCreateResponse {
  protocolVersion: ShotGoProtocolVersion
  grantToken: string
  expiresAt: string
  sessionId: string
  userId: number
  teamId: number | null
  spaceId: string | null
  projectId: string | null
  agentMode: AgentMode
  allowedCapabilities: string[]
}

export interface AgentGrantIntrospectionRequest {
  grantToken: string
  sessionId: string
  requiredCapability: AgentSessionCapability
}

export interface AgentGrantIntrospectionResponse {
  protocolVersion: ShotGoProtocolVersion
  active: true
  authorizationContextId: string
  subjectId: string
  expiresAt: string
  sessionId: string
  userId: number
  teamId: number | null
  spaceId: string | null
  projectId: string | null
  agentMode: AgentMode
  allowedCapabilities: string[]
  inferencePolicy: InferencePolicy
}

export interface GenerationConfigModel {
  id: string
  label: string
  shortLabel?: string
  badge?: string
  duration?: string
  description?: string
  credits?: number
  vip: boolean
  supportedOptions?: Record<string, string[]>
  optionOverrides?: Record<string, Record<string, GenerationOptionOverride>>
  operationOptionConstraints?: Record<string, Record<string, string[]>>
  durationRange?: GenerationRange
  fpsEnabled?: boolean
  fpsRanges?: GenerationFpsRange[]
}

export interface GenerationOption {
  id: string
  label: string
  value?: boolean
  credits?: number
}

export interface GenerationOptionOverride {
  enabled?: boolean
  credits?: number
}

export interface GenerationRange {
  min?: number
  max?: number
  step?: number
  default?: number
  unit?: string
}

export interface GenerationFpsRange {
  minFps: number
  maxFps: number
  credits?: number
}

export interface ImageGenerationParameters {
  qualities: GenerationOption[]
  resolutions: GenerationOption[]
  aspectRatios: GenerationOption[]
}

export interface VideoGenerationParameters {
  aspectRatios: GenerationOption[]
  resolutions: GenerationOption[]
  duration: GenerationRange
  fps: GenerationRange
  audioOptions: GenerationOption[]
  operationTypes: GenerationOption[]
}

interface GenerationConfigReadResponseBase {
  protocolVersion: ShotGoProtocolVersion
  parameterSchemaVersion: 1
  authorizationContextId: string
  sessionId: string
  models: GenerationConfigModel[]
  defaults: Record<string, string | number | boolean>
}

export interface ImageGenerationConfigReadResponse extends GenerationConfigReadResponseBase {
  kind: 'image'
  parameters: ImageGenerationParameters
}

export interface VideoGenerationConfigReadResponse extends GenerationConfigReadResponseBase {
  kind: 'video'
  parameters: VideoGenerationParameters
}

export type GenerationConfigReadResponse =
  | ImageGenerationConfigReadResponse
  | VideoGenerationConfigReadResponse

export interface GenerationReferenceAsset {
  mediaLibraryItemId: number
}

export type GenerationQuoteParameters = Record<
  string,
  string | number | boolean | GenerationReferenceAsset[]
>

export interface GenerationQuoteRequest {
  sessionId: string
  kind: GenerationKind
  modelId: string
  parameters: GenerationQuoteParameters
}

export interface GenerationQuoteBreakdownItem {
  key: string
  label: string
  credits: number
}

export interface GenerationQuoteResponse {
  protocolVersion: ShotGoProtocolVersion
  quoteId: string
  quoteVersion: 1
  kind: GenerationKind
  modelId: string
  credits: number
  breakdown: GenerationQuoteBreakdownItem[]
  canAfford: boolean
  userBalance: number
  expiresAt: string
  normalizedParameters: GenerationQuoteParameters
  requiresConfirmation: true
}

export interface GenerationCreateRequest {
  context: MutationContext
  quoteId: string
  quoteVersion: 1
}

export type GenerationAsset = Record<string, string | number> & {
  assetId: string
  kind: 'image' | 'video' | 'audio'
  url: string
  sizeBytes: number
}

export interface GenerationCreateResponse {
  protocolVersion: ShotGoProtocolVersion
  generationId: string
  clientRequestId: string
  operationId: string
  state: GenerationState
  stage: string
  credits: number
  userBalance: number
  replayed: boolean
  createdAt: string
  updatedAt: string
  assets?: GenerationAsset[]
  failureCode?: string
}

export type GenerationResponse = GenerationCreateResponse

export interface GenerationCancelRequest {
  context: MutationContext
}

export interface InferencePolicy {
  protocolVersion: ShotGoProtocolVersion
  policyVersion: string
  provider: 'volcengine-ark'
  allowedModels: InferenceModel[]
  defaultModel: InferenceModel
  defaultReasoningEffort: InferenceReasoningEffort
  maxOutputTokens: number
  sessionTokenBudget: number
  expiresAt: string
}

export interface InferenceRuntimeConfig {
  protocolVersion: ShotGoProtocolVersion
  configurationVersion: string
  provider: 'volcengine-ark'
  baseURL: string
  apiKey: string
  models: Record<InferenceModel, string>
}

export interface InferenceTokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

export interface InferenceUsageReport {
  protocolVersion: typeof SHOTGO_PROTOCOL_VERSION
  llmRequestId: string
  sessionId: string
  runId?: string
  purpose?: string
  provider: 'volcengine-ark'
  model: InferenceModel
  status: InferenceUsageStatus
  startedAt: string
  completedAt: string
  durationMs: number
  usage: InferenceTokenUsage
  providerRequestId?: string
  errorCode?: string
}

export interface ProtocolProblem {
  type: string
  title: string
  status: number
  detail?: string
  instance?: string
  code: string
  retryable: boolean
  requestId: string
  details?: Record<string, unknown>
}

export interface AgentEvent<TPayload = Record<string, unknown>> {
  protocolVersion: ShotGoProtocolVersion
  eventId: string
  projectId: string
  sequence: number
  operationId: string
  occurredAt: string
  type: string
  payload: TPayload
}

const generationTransitions: Readonly<Record<GenerationState, readonly GenerationState[]>> = {
  draft: ['creating', 'cancelled'],
  creating: ['queued', 'failed', 'cancelled'],
  queued: ['processing', 'failed', 'cancelled'],
  processing: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
}

export function canTransitionGeneration(from: GenerationState, to: GenerationState): boolean {
  return generationTransitions[from].includes(to)
}

export function assertMutationHeaders(
  context: MutationContext,
  headers: Readonly<Record<string, string | undefined>>,
): void {
  const idempotencyKey = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === IDEMPOTENCY_HEADER.toLowerCase(),
  )?.[1]

  if (!context.sessionId || !context.runId || !context.actionId || !context.clientRequestId) {
    throw new Error('SHOTGO_MUTATION_CONTEXT_INCOMPLETE')
  }
  if (idempotencyKey !== context.clientRequestId) {
    throw new Error('SHOTGO_IDEMPOTENCY_KEY_MISMATCH')
  }
}

export function isProtocolProblem(value: unknown): value is ProtocolProblem {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ProtocolProblem>
  return (
    typeof candidate.type === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.status === 'number' &&
    typeof candidate.code === 'string' &&
    typeof candidate.retryable === 'boolean' &&
    typeof candidate.requestId === 'string'
  )
}
