import type { GenerationCreateResponse } from './contracts/laravel-v1.ts'

export interface GenerationSubmitter {
  submit(input: {
    sessionId: string
    actionId: string
    quoteId: string
    quoteVersion: 1
    signal?: AbortSignal
  }): Promise<GenerationCreateResponse>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    shotgoGenerationSubmitter: GenerationSubmitter
  }
}
