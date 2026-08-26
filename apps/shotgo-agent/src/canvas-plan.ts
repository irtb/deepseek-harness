import type {
  CanvasPlanApplyResponse,
  CanvasPlanDependencyInput,
  CanvasPlanNodeInput,
  CanvasPlanQuoteResponse,
} from './contracts/laravel-v1.ts'

export interface CanvasPlanQuoteReader {
  quote(input: {
    sessionId: string
    revision: string
    summary: string
    nodes: CanvasPlanNodeInput[]
    dependencies: CanvasPlanDependencyInput[]
    signal?: AbortSignal
  }): Promise<CanvasPlanQuoteResponse>
}

export interface CanvasPlanSubmitter {
  apply(input: {
    sessionId: string
    actionId: string
    quoteId: string
    quoteVersion: 1
    signal?: AbortSignal
  }): Promise<CanvasPlanApplyResponse>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    shotgoCanvasPlanQuoteReader: CanvasPlanQuoteReader
    shotgoCanvasPlanSubmitter: CanvasPlanSubmitter
  }
}
