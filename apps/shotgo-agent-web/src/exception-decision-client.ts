import type { ExceptionDecision } from './exception-decision.ts'

export interface ExceptionDecisionClientOptions {
  apiBaseUrl: string
  accessToken: () => string | undefined
  fetch?: typeof globalThis.fetch
}

export class ExceptionDecisionClientError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/** Sanctum/Bearer client used by the signed-in browser, never by the Agent service identity. */
export class ExceptionDecisionClient {
  private readonly fetch: typeof globalThis.fetch

  constructor(private readonly options: ExceptionDecisionClientOptions) {
    this.fetch = options.fetch ?? globalThis.fetch
  }

  show(decisionId: string, signal?: AbortSignal): Promise<ExceptionDecision> {
    return this.request(decisionId, 'GET', signal)
  }

  approve(decisionId: string, signal?: AbortSignal): Promise<ExceptionDecision> {
    return this.request(decisionId, 'POST', signal, 'approve')
  }

  reject(decisionId: string, signal?: AbortSignal): Promise<ExceptionDecision> {
    return this.request(decisionId, 'POST', signal, 'reject')
  }

  private async request(
    decisionId: string,
    method: 'GET' | 'POST',
    signal?: AbortSignal,
    action?: 'approve' | 'reject',
  ): Promise<ExceptionDecision> {
    const token = this.options.accessToken()
    if (token === undefined || token.length === 0) {
      throw new ExceptionDecisionClientError('AUTH_REQUIRED', 401, '请先登录后处理此决策')
    }
    const suffix = action === undefined ? '' : `/${action}`
    const response = await this.fetch(
      `${this.options.apiBaseUrl.replace(/\/$/, '')}/api/agent/v1/exception-decisions/${encodeURIComponent(decisionId)}${suffix}`,
      {
        method,
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
        ...(signal === undefined ? {} : { signal }),
      },
    )
    const body = await response.json() as Record<string, unknown>
    if (!response.ok) {
      throw new ExceptionDecisionClientError(
        typeof body.code === 'string' ? body.code : 'EXCEPTION_DECISION_REQUEST_FAILED',
        response.status,
        typeof body.message === 'string' ? body.message : '决策请求失败，请稍后重试',
      )
    }
    return body as unknown as ExceptionDecision
  }
}
