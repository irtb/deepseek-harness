/** Stable HTTP-facing failure raised by Gateway Session adapters and parsers. */
export class GatewaySessionError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message = code,
  ) {
    super(message)
    this.name = 'GatewaySessionError'
  }
}
