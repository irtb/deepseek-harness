import type {
  GenerationKind,
  GenerationQuoteParameters,
  GenerationQuoteResponse,
} from './contracts/laravel-v1.ts'

export interface GenerationQuoteReader {
  quote(input: {
    sessionId: string
    kind: GenerationKind
    modelId: string
    parameters: GenerationQuoteParameters
    signal?: AbortSignal
  }): Promise<GenerationQuoteResponse>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    shotgoGenerationQuoteReader: GenerationQuoteReader
  }
}
