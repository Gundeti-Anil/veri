import { BigInt, ByteArray, Bytes, crypto } from "@graphprotocol/graph-ts"
import { Human, Protocol, TokenToLabel } from "../generated/schema"

// ─────────────────────────────────────────────────────────────────────────────
// Constants — keccak256 of each capability name string
// These must match the constants in VeriRegistrar.sol
// ─────────────────────────────────────────────────────────────────────────────

export const CAP_SELF_DESCRIBE_HEX: string = crypto
  .keccak256(ByteArray.fromUTF8("SELF_DESCRIBE"))
  .toHexString()

export const CAP_ENDPOINT_UPDATE_HEX: string = crypto
  .keccak256(ByteArray.fromUTF8("ENDPOINT_UPDATE"))
  .toHexString()

export const CAP_SUBAGENT_ISSUE_HEX: string = crypto
  .keccak256(ByteArray.fromUTF8("SUBAGENT_ISSUE"))
  .toHexString()

export const CAP_TRANSACT_HEX: string = crypto
  .keccak256(ByteArray.fromUTF8("TRANSACT"))
  .toHexString()

// Parent name used to build the full agent name (e.g. "scanner.veri.eth")
export const PARENT_NAME: string = "veri.eth"

// ─────────────────────────────────────────────────────────────────────────────
// Capability name resolver
// ─────────────────────────────────────────────────────────────────────────────

/** Returns the human-readable name for a known capability ID, or "UNKNOWN". */
export function capabilityName(capId: Bytes): string {
  const hex = capId.toHexString()
  if (hex == CAP_SELF_DESCRIBE_HEX)   return "SELF_DESCRIBE"
  if (hex == CAP_ENDPOINT_UPDATE_HEX) return "ENDPOINT_UPDATE"
  if (hex == CAP_SUBAGENT_ISSUE_HEX)  return "SUBAGENT_ISSUE"
  if (hex == CAP_TRANSACT_HEX)        return "TRANSACT"
  return "UNKNOWN"
}

// ─────────────────────────────────────────────────────────────────────────────
// Protocol singleton
// ─────────────────────────────────────────────────────────────────────────────

export function getOrCreateProtocol(): Protocol {
  let protocol = Protocol.load("veri")
  if (protocol == null) {
    protocol = new Protocol("veri")
    protocol.totalHumans      = 0
    protocol.totalAgents      = 0
    protocol.activeAgents     = 0
    protocol.totalRevocations = 0
  }
  return protocol!
}

// ─────────────────────────────────────────────────────────────────────────────
// Human entity
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load or create a Human entity.
 * humanId must be keccak256(abi.encode(nullifier)) — the raw nullifier is
 * never passed here and must never be stored.
 */
export function getOrCreateHuman(humanId: Bytes, timestamp: BigInt): Human {
  let human = Human.load(humanId)
  if (human == null) {
    human = new Human(humanId)
    human.agentCount  = 0
    human.firstSeenAt = timestamp

    // Increment totalHumans on first appearance
    const protocol = getOrCreateProtocol()
    protocol.totalHumans = protocol.totalHumans + 1
    protocol.save()
  }
  return human!
}

// ─────────────────────────────────────────────────────────────────────────────
// TokenToLabel helper
// Maintains a bidirectional index: tokenId (decimal string) → labelHash.
// Required because UserRegistry events (TokenRegenerated, ExpiryUpdated) only
// carry tokenIds, not labelHashes.
// ─────────────────────────────────────────────────────────────────────────────

export function registerToken(tokenId: BigInt, labelHash: Bytes): void {
  let entry = new TokenToLabel(tokenId.toString())
  entry.labelHash = labelHash
  entry.save()
}

// NOTE: a labelHashForToken(tokenId): Bytes | null helper used to live here. Calling a
// cross-file helper returning Bytes | null from mappings.ts crashes the AssemblyScript compiler
// bundled with graph-cli (assertion failure in compileBinaryOverload, reproduced on graph-cli
// 0.80.1 and 0.98.1). Callers now inline `TokenToLabel.load(tokenId.toString())` directly instead
// — see onTokenRegenerated and handleExpiryUpdated in mappings.ts.

/** Remove the old token mapping and create the new one. */
export function reindexToken(oldTokenId: BigInt, newTokenId: BigInt): void {
  const oldEntry = TokenToLabel.load(oldTokenId.toString())
  if (oldEntry == null) return // not a Veri agent token

  const labelHash = oldEntry.labelHash

  // Delete old entry
  // (The Graph does not have a delete API in AssemblyScript mappings;
  //  zero out the entry and rely on the new one being canonical instead)
  oldEntry.labelHash = Bytes.fromHexString("0x")
  oldEntry.save()

  // Create new entry
  const newEntry = new TokenToLabel(newTokenId.toString())
  newEntry.labelHash = labelHash
  newEntry.save()
}

// ─────────────────────────────────────────────────────────────────────────────
// ID builders
// ─────────────────────────────────────────────────────────────────────────────

/** Capability entity ID: "labelHash-capabilityId" (hex strings, hyphen-separated). */
export function capabilityEntityId(labelHash: Bytes, capId: Bytes): string {
  return labelHash.toHexString() + "-" + capId.toHexString()
}

/** CapabilityEvent entity ID: txHash bytes concatenated with logIndex as 4-byte big-endian. */
export function capabilityEventId(txHash: Bytes, logIndex: BigInt): Bytes {
  return txHash.concatI32(logIndex.toI32())
}
