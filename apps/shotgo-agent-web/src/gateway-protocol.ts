/**
 * Re-export Gateway wire protocol from the Agent runtime contract.
 * Do not redefine version literals here — keep a single source of truth.
 */
export {
  SHOTGO_GATEWAY_LEGACY_PROTOCOL_VERSION,
  SHOTGO_GATEWAY_PREVIOUS_PROTOCOL_VERSION,
  SHOTGO_GATEWAY_PROTOCOL_HEADER,
  SHOTGO_GATEWAY_PROTOCOL_VERSION,
  SHOTGO_GATEWAY_SUPPORTED_PROTOCOL_VERSIONS,
  isShotGoGatewayProtocolVersion,
  type ShotGoGatewayProtocolVersion,
} from '../../shotgo-agent/src/contracts/gateway-protocol.ts'
