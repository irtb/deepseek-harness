import { createGatewayServer, readGatewayConfig } from './gateway.ts'
import { InferenceControlPlaneClient } from './laravel/inference-control-plane.ts'
import { InferenceRuntimeConfigStore } from './laravel/inference-runtime-config.ts'

const config = readGatewayConfig(process.env)
const runtimeConfig = config.laravel === undefined
  ? undefined
  : new InferenceRuntimeConfigStore(new InferenceControlPlaneClient(config.laravel))
if (runtimeConfig !== undefined) {
  await runtimeConfig.refresh().catch(() => {
    process.stderr.write(`${JSON.stringify({ event: 'gateway/inference-runtime-config-unavailable' })}\n`)
  })
}
const refreshInterval = runtimeConfig === undefined
  ? undefined
  : setInterval(() => {
    void runtimeConfig.refresh().catch(() => {
      process.stderr.write(`${JSON.stringify({ event: 'gateway/inference-runtime-config-refresh-failed' })}\n`)
    })
  }, 60_000)
refreshInterval?.unref()

const server = createGatewayServer(config, {
  isInferenceRuntimeReady: () => runtimeConfig?.isReady() === true,
})

server.listen(config.port, config.host, () => {
  process.stdout.write(
    `${JSON.stringify({ event: 'gateway/listening', host: config.host, port: config.port, deploymentId: config.deploymentId })}\n`,
  )
})

function shutdown(signal: NodeJS.Signals): void {
  if (refreshInterval !== undefined) clearInterval(refreshInterval)
  process.stdout.write(`${JSON.stringify({ event: 'gateway/shutdown', signal })}\n`)
  server.close((error) => {
    if (error) {
      process.stderr.write(`${JSON.stringify({ event: 'gateway/shutdown-error', message: error.message })}\n`)
      process.exitCode = 1
    }
  })
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
