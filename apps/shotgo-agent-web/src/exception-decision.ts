export type ExceptionDecisionStatus = 'pending' | 'approved' | 'rejected' | 'consumed'

export type ExceptionalActionType =
  | 'delete'
  | 'overwrite'
  | 'cross_project'
  | 'capability_expansion'
  | 'public_share'
  | 'formal_publish'
  | 'hard_budget_override'

export interface ExceptionalAction {
  type: ExceptionalActionType
  targetType: string
  targetId: string
  targetLabel: string
  sourceProjectId?: string
  destinationProjectId?: string
  estimatedCost?: { amount: string; currency: string }
}

export interface ExceptionDecision {
  protocolVersion: string
  decisionId: string
  sessionId: string
  runId: string
  actionId: string
  actionHash: string
  actions: ExceptionalAction[]
  requirements: Array<{
    groupKey: string
    actionIndex: number
    scope: 'target_project' | 'source_project' | 'destination_project' | 'team'
    projectId?: string
    roles: Array<'project_owner' | 'team_owner' | 'publisher' | 'finance_admin'>
  }>
  approvals: Record<string, { actorUserId: number; at: string }>
  status: ExceptionDecisionStatus
  createdAt: string
  expiresAt: string
  resolvedAt: string | null
  consumedAt: string | null
}

export interface GatewayExceptionDecisionEvent {
  cursor: number
  streamEpoch: string
  sessionId: string
  type: 'session.event'
  payload: {
    eventType: 'exception.decision'
    exceptionDecision: ExceptionDecision
  }
}

const statusRank: Record<ExceptionDecisionStatus, number> = {
  pending: 0,
  approved: 1,
  rejected: 1,
  consumed: 2,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStatus(value: unknown): value is ExceptionDecisionStatus {
  return value === 'pending' || value === 'approved' || value === 'rejected' || value === 'consumed'
}

/** Parses only the exceptional-decision event projection accepted by this frontend. */
export function parseExceptionDecisionEvent(value: unknown): GatewayExceptionDecisionEvent | undefined {
  if (!isRecord(value) || value.type !== 'session.event' || !isRecord(value.payload)) return undefined
  if (value.payload.eventType !== 'exception.decision' || !isRecord(value.payload.exceptionDecision)) return undefined
  const decision = value.payload.exceptionDecision
  if (
    typeof value.cursor !== 'number' ||
    typeof value.streamEpoch !== 'string' ||
    typeof value.sessionId !== 'string' ||
    typeof decision.decisionId !== 'string' ||
    typeof decision.sessionId !== 'string' ||
    decision.sessionId !== value.sessionId ||
    !isStatus(decision.status) ||
    !Array.isArray(decision.actions) ||
    !Array.isArray(decision.requirements)
  ) return undefined
  return value as unknown as GatewayExceptionDecisionEvent
}

export type ExceptionDecisionState = Record<string, ExceptionDecision>

/** Upserts replayed decisions without allowing an older status to reopen a resolved card. */
export function projectExceptionDecision(
  state: ExceptionDecisionState,
  incoming: ExceptionDecision,
): ExceptionDecisionState {
  const current = state[incoming.decisionId]
  if (current !== undefined) {
    if (current.actionHash !== incoming.actionHash || current.sessionId !== incoming.sessionId) return state
    if (statusRank[incoming.status] < statusRank[current.status]) return state
    if (current.status !== 'pending' && incoming.status !== current.status && incoming.status !== 'consumed') return state
  }
  if (current === incoming) return state
  return { ...state, [incoming.decisionId]: incoming }
}

export const exceptionalActionLabels: Record<ExceptionalActionType, string> = {
  delete: '删除内容',
  overwrite: '覆盖内容',
  cross_project: '跨项目操作',
  capability_expansion: '扩大权限范围',
  public_share: '公开分享',
  formal_publish: '正式发布',
  hard_budget_override: '突破硬预算上限',
}
