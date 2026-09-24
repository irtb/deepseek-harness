/** Single source of truth for Agent Gateway ↔ Agent Web wire protocol. */
export const SHOTGO_GATEWAY_PROTOCOL_VERSION = '2026-08-26.2' as const
export const SHOTGO_GATEWAY_PREVIOUS_PROTOCOL_VERSION = '2026-08-26.1' as const
export const SHOTGO_GATEWAY_LEGACY_PROTOCOL_VERSION = '2026-08-25.1' as const
export const SHOTGO_GATEWAY_PROTOCOL_HEADER = 'X-ShotGo-Gateway-Protocol-Version' as const

export const SHOTGO_GATEWAY_SUPPORTED_PROTOCOL_VERSIONS = [
  SHOTGO_GATEWAY_PROTOCOL_VERSION,
  SHOTGO_GATEWAY_PREVIOUS_PROTOCOL_VERSION,
  SHOTGO_GATEWAY_LEGACY_PROTOCOL_VERSION,
] as const

export type ShotGoGatewayProtocolVersion = (typeof SHOTGO_GATEWAY_SUPPORTED_PROTOCOL_VERSIONS)[number]

export function isShotGoGatewayProtocolVersion(value: unknown): value is ShotGoGatewayProtocolVersion {
  return (
    typeof value === 'string'
    && (SHOTGO_GATEWAY_SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(value)
  )
}
