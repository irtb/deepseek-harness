/** In-memory registry of Laravel-authoritative quotes awaiting one-shot approval. */

import type { Context } from '@deepseek-ai/cordis'
import type { GenerationQuoteResponse } from './contracts/laravel-v1.ts'

const MAX_QUOTES = 512
const MAX_QUOTES_PER_SESSION = 16

export interface GenerationQuoteRegistry {
  /** Record one validated Laravel quote for the owning Harness Session. */
  record(sessionId: string, quote: GenerationQuoteResponse): void
  /** Consume one unexpired quote without accepting model-supplied display fields. */
  take(sessionId: string, quoteId: string): GenerationQuoteResponse | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    shotgoGenerationQuoteRegistry: GenerationQuoteRegistry
  }
}

export const name = 'shotgo-generation-quote-registry'

/** Provide the process-local pending quote registry. */
export function apply(ctx: Context): void {
  const quotes = new Map<string, Map<string, GenerationQuoteResponse>>()
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
    const stop = ctx.provide('shotgoGenerationQuoteRegistry', {
      record(sessionId, quote) {
        if (!Number.isFinite(Date.parse(quote.expiresAt))) throw new Error('GENERATION_QUOTE_EXPIRY_INVALID')
        pruneExpired()
        const session = quotes.get(sessionId) ?? new Map<string, GenerationQuoteResponse>()
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
    return () => {
      stop()
      quotes.clear()
    }
  })
}
