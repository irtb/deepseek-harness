import type { GenerationConfigReadResponse, GenerationKind } from './contracts/laravel-v1.ts'

export interface GenerationConfigReader {
  read(kind: GenerationKind, signal?: AbortSignal): Promise<GenerationConfigReadResponse>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    shotgoGenerationConfigReader: GenerationConfigReader
  }
}
