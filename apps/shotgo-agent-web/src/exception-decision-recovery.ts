import type { ExceptionDecisionClient } from './exception-decision-client.ts'
import {
  parseExceptionDecisionEvent,
  projectExceptionDecision,
  type ExceptionDecisionState,
} from './exception-decision.ts'

const STORAGE_PREFIX = 'shotgo-agent-exception-decisions:'

export interface ExceptionDecisionRecoveryStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Owns browser projection and Laravel-authoritative recovery for one Agent session. */
export class ExceptionDecisionRecovery {
  private state: ExceptionDecisionState = {}

  constructor(
    private readonly sessionId: string,
    private readonly client: ExceptionDecisionClient,
    private readonly storage: ExceptionDecisionRecoveryStorage,
    private readonly changed: (state: ExceptionDecisionState) => void,
  ) {}

  ingest(value: unknown): void {
    const event = parseExceptionDecisionEvent(value)
    if (event === undefined || event.sessionId !== this.sessionId) return
    this.replace(projectExceptionDecision(this.state, event.payload.exceptionDecision))
  }

  upsert(decision: ExceptionDecisionState[string]): void {
    if (decision.sessionId !== this.sessionId) return
    this.replace(projectExceptionDecision(this.state, decision))
  }

  async recover(signal?: AbortSignal): Promise<void> {
    const ids = this.readIds()
    const decisions = await Promise.all(ids.map(async (decisionId) => {
      try {
        return await this.client.show(decisionId, signal)
      } catch {
        return undefined
      }
    }))
    for (const decision of decisions) {
      if (decision !== undefined) this.upsert(decision)
    }
  }

  private replace(next: ExceptionDecisionState): void {
    if (next === this.state) return
    this.state = next
    this.storage.setItem(`${STORAGE_PREFIX}${this.sessionId}`, JSON.stringify(Object.keys(next)))
    this.changed(next)
  }

  private readIds(): string[] {
    try {
      const value = JSON.parse(this.storage.getItem(`${STORAGE_PREFIX}${this.sessionId}`) ?? '[]') as unknown
      return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
    } catch {
      return []
    }
  }
}
