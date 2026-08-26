import type { CanvasContextResponse } from './contracts/laravel-v1.ts'

export interface CanvasContextReader {
  read(input: { sessionId: string; signal?: AbortSignal }): Promise<CanvasContextResponse>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    shotgoCanvasContextReader: CanvasContextReader
  }
}
