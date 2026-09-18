import { useState } from 'react'
import type { ExceptionDecisionClient } from './exception-decision-client.ts'
import {
  exceptionalActionLabels,
  type ExceptionDecision,
} from './exception-decision.ts'

export interface ExceptionDecisionCardProps {
  decision: ExceptionDecision
  client: ExceptionDecisionClient
  onChange: (decision: ExceptionDecision) => void
}

const statusText = {
  pending: '等待授权',
  approved: '已授权，正在继续',
  rejected: '已拒绝',
  consumed: '已执行',
} as const

/** Renders one aggregated exceptional-action decision for a Skill Run. */
export function ExceptionDecisionCard({ decision, client, onChange }: ExceptionDecisionCardProps) {
  const [submitting, setSubmitting] = useState<'approve' | 'reject'>()
  const [error, setError] = useState<string>()

  async function decide(action: 'approve' | 'reject') {
    if (submitting !== undefined || decision.status !== 'pending') return
    setSubmitting(action)
    setError(undefined)
    try {
      const next = action === 'approve'
        ? await client.approve(decision.decisionId)
        : await client.reject(decision.decisionId)
      onChange(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '决策请求失败，请稍后重试')
    } finally {
      setSubmitting(undefined)
    }
  }

  return (
    <article className="decision-card" aria-labelledby={`decision-${decision.decisionId}`}>
      <div className="decision-card__eyebrow">例外动作 · {statusText[decision.status]}</div>
      <h2 id={`decision-${decision.decisionId}`}>本次操作需要一次授权</h2>
      <p>普通生成会继续自动执行。以下高风险动作已暂停，不会退化为逐工具确认。</p>
      <ul>
        {decision.actions.map((action, index) => (
          <li key={`${action.type}-${action.targetId}-${index}`}>
            <strong>{exceptionalActionLabels[action.type]}</strong>
            <span>{action.targetLabel}</span>
          </li>
        ))}
      </ul>
      <p className="decision-card__expiry">授权有效期至 {new Date(decision.expiresAt).toLocaleString('zh-CN')}</p>
      {error === undefined ? null : <p className="decision-card__error" role="alert">{error}</p>}
      {decision.status === 'pending' ? (
        <div className="decision-card__actions">
          <button type="button" disabled={submitting !== undefined} onClick={() => void decide('reject')}>
            {submitting === 'reject' ? '正在拒绝…' : '拒绝'}
          </button>
          <button className="primary" type="button" disabled={submitting !== undefined} onClick={() => void decide('approve')}>
            {submitting === 'approve' ? '正在授权…' : '授权并继续'}
          </button>
        </div>
      ) : null}
    </article>
  )
}
