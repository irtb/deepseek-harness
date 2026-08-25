import type { GenerationConfigReadResponse, GenerationKind } from './contracts/laravel-v1.ts'

export interface GenerationConfigReader {
  read(input: {
    kind: GenerationKind
    sessionId: string
    signal?: AbortSignal
  }): Promise<GenerationConfigReadResponse>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    shotgoGenerationConfigReader: GenerationConfigReader
  }
}
