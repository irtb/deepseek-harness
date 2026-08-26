import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AgentMode } from './contracts/laravel-v1.ts'

export const SHOTGO_GATEWAY_RECOVERY_VERSION = 1 as const
export const SHOTGO_GATEWAY_RUNTIME_VERSION = 'shotgo-gateway-v1' as const

export interface GatewayRecoveryBinding {
  readonly version: typeof SHOTGO_GATEWAY_RECOVERY_VERSION
  readonly runtimeVersion: typeof SHOTGO_GATEWAY_RUNTIME_VERSION
  readonly sessionId: string
  readonly authorizationContextId: string
  readonly userId: number
  readonly teamId: number | null
  readonly spaceId: string | null
  readonly projectId: string | null
  readonly agentMode: AgentMode
  readonly presetId: string
  readonly createdAt: string
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isNullableSafeInteger(value: unknown): value is number | null {
  return value === null || Number.isSafeInteger(value)
}

function parseBinding(value: unknown): GatewayRecoveryBinding {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid recovery binding')
  const binding = value as Record<string, unknown>
  if (
    binding.version !== SHOTGO_GATEWAY_RECOVERY_VERSION
    || binding.runtimeVersion !== SHOTGO_GATEWAY_RUNTIME_VERSION
    || typeof binding.sessionId !== 'string'
    || typeof binding.authorizationContextId !== 'string'
    || !Number.isSafeInteger(binding.userId)
    || !isNullableSafeInteger(binding.teamId)
    || !isNullableString(binding.spaceId)
    || !isNullableString(binding.projectId)
    || !['canvas', 'image', 'video'].includes(String(binding.agentMode))
    || typeof binding.presetId !== 'string'
    || typeof binding.createdAt !== 'string'
  ) throw new Error('invalid recovery binding')
  return binding as unknown as GatewayRecoveryBinding
}

/** Persist model-invisible ShotGo authorization metadata beside Harness sessions. */
export class GatewayRecoveryStore {
  constructor(private readonly root: string) {}

  async read(sessionId: string): Promise<GatewayRecoveryBinding | undefined> {
    try {
      const parsed = JSON.parse(await readFile(this.path(sessionId), 'utf8')) as unknown
      const binding = parseBinding(parsed)
      if (binding.sessionId !== sessionId) throw new Error('recovery binding session id mismatch')
      return binding
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  async write(binding: GatewayRecoveryBinding): Promise<void> {
    const target = this.path(binding.sessionId)
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    const temporary = `${target}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(binding)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    await rename(temporary, target)
  }

  private path(sessionId: string): string {
    return join(this.root, `${createHash('sha256').update(sessionId).digest('hex')}.json`)
  }
}
