import { parseCreativeRevisionLifecycle, parseCreativeWorkflow, type AgentMode, type AgentSessionRecord } from './agent-session.ts'

const PREFIX = 'shotgo-agent-sessions:'

export function sessionScope(userId: number, teamId: number | null | undefined, mode: AgentMode): string {
  return `${PREFIX}${userId}:${teamId ?? 'personal'}:${mode}`
}

export function readSessions(storage: Storage, scope: string): AgentSessionRecord[] {
  try {
    const value = JSON.parse(storage.getItem(scope) ?? '[]') as unknown
    if (!Array.isArray(value)) return []
    return value.filter((item): item is AgentSessionRecord => {
      if (typeof item !== 'object' || item === null) return false
      const session = item as Partial<AgentSessionRecord>
      const revisionValid = session.revision === undefined || parseCreativeRevisionLifecycle(session.revision) !== undefined
      return typeof session.sessionId === 'string' && Array.isArray(session.messages) && typeof session.updatedAt === 'string' && (session.workflow === undefined || parseCreativeWorkflow(session.workflow) !== undefined) && revisionValid
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  } catch {
    return []
  }
}

export function writeSessions(storage: Storage, scope: string, sessions: AgentSessionRecord[]): void {
  storage.setItem(scope, JSON.stringify(sessions.slice(0, 50)))
}

export function newSession(mode: AgentMode): AgentSessionRecord {
  const now = new Date().toISOString()
  return { sessionId: crypto.randomUUID(), mode, title: '新创作', messages: [], cursor: 0, streamEpoch: null, createdAt: now, updatedAt: now }
}
