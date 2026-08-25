import type { GenerationResponse } from './contracts/laravel-v1.ts'

export interface GenerationLifecycle {
  read(input: { sessionId: string; generationId: string; signal?: AbortSignal }): Promise<GenerationResponse>
  recover(input: { sessionId: string; clientRequestId: string; signal?: AbortSignal }): Promise<GenerationResponse>
  cancel(input: {
    sessionId: string
    actionId: string
    generationId: string
    signal?: AbortSignal
  }): Promise<GenerationResponse>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    shotgoGenerationLifecycle: GenerationLifecycle
  }
}
