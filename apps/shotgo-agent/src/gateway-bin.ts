import type { Context } from '@deepseek-ai/cordis'
import { boot, installFailLoud } from '@deepseek-ai/dsh-app-boot'
import { fileURLToPath } from 'node:url'
import { HarnessGatewaySessionService } from './gateway-session.ts'
import { createGatewayServer, readGatewayConfig } from './gateway.ts'
import { LaravelCapabilityGrantAuthorizer } from './laravel/capability-grant-authorizer.ts'
import { InferenceControlPlaneClient } from './laravel/inference-control-plane.ts'
import { InferenceRuntimeConfigStore } from './laravel/inference-runtime-config.ts'

const NAME = 'shotgo-agent-gateway'
const config = readGatewayConfig(process.env)
if (config.laravel === undefined) throw new Error('SHOTGO_LARAVEL_RUNTIME_CONFIG_REQUIRED')

const uninstallFailLoud = installFailLoud(NAME)
const configPath = fileURLToPath(new URL(
  process.env.NODE_ENV === 'production' ? './config/base.cordis.yml' : '../config/base.cordis.yml',
  import.meta.url,
))
let ctx: Context | undefined

try {
  ctx = await boot(NAME, configPath)
  const runtimeEntry = [...ctx.loader.entries()].find(entry => entry.options.id === 'shotgo-agent-host')
  if (runtimeEntry === undefined) throw new Error(`${NAME}: shotgo-agent-host entry is not mounted`)
  if (runtimeEntry.ctx.get('agentPresets') === undefined) {
    throw new Error(`${NAME}: trusted ShotGo Agent presets are not mounted`)
  }

  const controlPlane = new InferenceControlPlaneClient(config.laravel)
  const runtimeConfig = new InferenceRuntimeConfigStore(controlPlane)
  await runtimeConfig.refresh().catch(() => {
    process.stderr.write(`${JSON.stringify({ event: 'gateway/inference-runtime-config-unavailable' })}\n`)
  })
  const refreshInterval = setInterval(() => {
    void runtimeConfig.refresh().catch(() => {
      process.stderr.write(`${JSON.stringify({ event: 'gateway/inference-runtime-config-refresh-failed' })}\n`)
    })
  }, 60_000)
  refreshInterval.unref()

  const authorizer = new LaravelCapabilityGrantAuthorizer(config.laravel)
  const sessions = new HarnessGatewaySessionService(runtimeEntry.ctx, authorizer)
  const server = createGatewayServer(config, {
    isInferenceRuntimeReady: () => runtimeConfig.isReady(),
  }, sessions)

  server.listen(config.port, config.host, () => {
    process.stdout.write(
      `${JSON.stringify({ event: 'gateway/listening', host: config.host, port: config.port, deploymentId: config.deploymentId })}\n`,
    )
  })

  let closing = false
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (closing) return
    closing = true
    clearInterval(refreshInterval)
    process.stdout.write(`${JSON.stringify({ event: 'gateway/shutdown', signal })}\n`)
    await sessions.dispose()
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error === undefined) resolve()
        else reject(error)
      })
    })
    await ctx?.fiber.dispose()
    ctx = undefined
    uninstallFailLoud()
  }

  const requestShutdown = (signal: NodeJS.Signals): void => {
    void shutdown(signal).catch((error: unknown) => {
      process.stderr.write(`${JSON.stringify({
        event: 'gateway/shutdown-error',
        message: error instanceof Error ? error.message : 'unknown shutdown error',
      })}\n`)
      process.exitCode = 1
    })
  }
  process.once('SIGINT', requestShutdown)
  process.once('SIGTERM', requestShutdown)
} catch (error) {
  await ctx?.fiber.dispose()
  uninstallFailLoud()
  throw error
}
