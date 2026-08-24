import { createGatewayServer, readGatewayConfig } from './gateway.ts'

const config = readGatewayConfig(process.env)
const server = createGatewayServer(config)

server.listen(config.port, config.host, () => {
  process.stdout.write(
    `${JSON.stringify({ event: 'gateway/listening', host: config.host, port: config.port, deploymentId: config.deploymentId })}\n`,
  )
})

function shutdown(signal: NodeJS.Signals): void {
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
