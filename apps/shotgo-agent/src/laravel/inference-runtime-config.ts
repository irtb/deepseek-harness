import type { InferenceRuntimeConfig } from '../contracts/laravel-v1.ts'
import type { InferenceControlPlaneClient } from './inference-control-plane.ts'

export class InferenceRuntimeConfigStore {
  private current: InferenceRuntimeConfig | undefined

  constructor(private readonly client: InferenceControlPlaneClient) {}

  async refresh(signal?: AbortSignal): Promise<InferenceRuntimeConfig> {
    try {
      const configuration = await this.client.readRuntimeConfig(signal)
      this.current = Object.freeze({
        ...configuration,
        models: Object.freeze({ ...configuration.models }),
      })
      return this.current
    } catch (error) {
      this.current = undefined
      throw error
    }
  }

  isReady(): boolean {
    return this.current !== undefined
  }

  snapshot(): InferenceRuntimeConfig {
    if (this.current === undefined) throw new Error('INFERENCE_RUNTIME_CONFIG_UNAVAILABLE')
    return this.current
  }
}
