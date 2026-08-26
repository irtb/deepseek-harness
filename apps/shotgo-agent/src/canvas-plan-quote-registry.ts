import type { Context } from '@deepseek-ai/cordis'
import type { CanvasPlanQuoteResponse } from './contracts/laravel-v1.ts'

const MAX_QUOTES = 512
const MAX_QUOTES_PER_SESSION = 16

export interface CanvasPlanQuoteRegistry {
  record(sessionId: string, quote: CanvasPlanQuoteResponse): void
  take(sessionId: string, quoteId: string): CanvasPlanQuoteResponse | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Context { shotgoCanvasPlanQuoteRegistry: CanvasPlanQuoteRegistry }
}

export const name = 'shotgo-canvas-plan-quote-registry'

export function apply(ctx: Context): void {
  const quotes = new Map<string, Map<string, CanvasPlanQuoteResponse>>()
  const quoteCount = (): number => [...quotes.values()].reduce((count, session) => count + session.size, 0)
  const pruneExpired = (): void => {
    const now = Date.now()
    for (const [sessionId, session] of quotes) {
      for (const [quoteId, quote] of session) {
        if (Date.parse(quote.expiresAt) <= now) session.delete(quoteId)
      }
      if (session.size === 0) quotes.delete(sessionId)
    }
  }
  ctx.effect(() => {
    const stop = ctx.provide('shotgoCanvasPlanQuoteRegistry', {
      record(sessionId, quote) {
        if (!Number.isFinite(Date.parse(quote.expiresAt))) throw new Error('CANVAS_PLAN_QUOTE_EXPIRY_INVALID')
        pruneExpired()
        const session = quotes.get(sessionId) ?? new Map<string, CanvasPlanQuoteResponse>()
        quotes.delete(sessionId)
        quotes.set(sessionId, session)
        session.delete(quote.quoteId)
        session.set(quote.quoteId, structuredClone(quote))
        while (session.size > MAX_QUOTES_PER_SESSION) {
          const oldestQuoteId = session.keys().next().value
          if (oldestQuoteId !== undefined) session.delete(oldestQuoteId)
        }
        while (quoteCount() > MAX_QUOTES) {
          const oldestSessionId = quotes.keys().next().value
          if (oldestSessionId !== undefined) quotes.delete(oldestSessionId)
        }
      },
      take(sessionId, quoteId) {
        pruneExpired()
        const session = quotes.get(sessionId)
        const quote = session?.get(quoteId)
        if (quote === undefined) return undefined
        session?.delete(quoteId)
        if (session?.size === 0) quotes.delete(sessionId)
        return quote
      },
    })
    return () => { stop(); quotes.clear() }
  })
}
