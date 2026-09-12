import { BigInt, Bytes, log } from "@graphprotocol/graph-ts"

// Generated event types from ABIs
import {
  AgentIssued       as AgentIssuedEvent,
  CapabilityGranted as CapabilityGrantedEvent,
  CapabilityRevoked as CapabilityRevokedEvent,
  AgentRetired      as AgentRetiredEvent,
} from "../generated/VeriRegistrar/VeriRegistrar"

import {
  TokenRegenerated as TokenRegeneratedEvent,
  ExpiryUpdated    as ExpiryUpdatedEvent,
} from "../generated/UserRegistry/UserRegistry"

// Generated schema types
import {
  Agent,
  Capability,
  CapabilityEvent,
  TokenToLabel,
} from "../generated/schema"

import {
  capabilityEntityId,
  capabilityEventId,
  capabilityName,
  getOrCreateHuman,
  getOrCreateProtocol,
  PARENT_NAME,
  registerToken,
  reindexToken,
} from "./utils"

// ─────────────────────────────────────────────────────────────────────────────
// AgentIssued
// Emitted by VeriRegistrar.issueAgent().
// Creates/updates Human, creates Agent, updates Protocol totals.
// ─────────────────────────────────────────────────────────────────────────────

export function handleAgentIssued(event: AgentIssuedEvent): void {
  const labelHash    = event.params.labelHash   // bytes32 → Bytes
  const label        = event.params.label
  const humanId      = event.params.humanId     // bytes32 → Bytes
  const agentAddress = event.params.agentAddress
  const tokenId      = event.params.tokenId
  const expiry       = event.params.expiry      // uint64

  // ── Human ──────────────────────────────────────────────────────────────
  const human = getOrCreateHuman(humanId, event.block.timestamp)
  human.agentCount = human.agentCount + 1
  human.save()

  // ── Agent ───────────────────────────────────────────────────────────────
  // Key is labelHash (Bytes), not tokenId (mutable)
  let agent = new Agent(labelHash)
  agent.label         = label
  agent.name          = label + "." + PARENT_NAME
  agent.human         = humanId
  agent.agentAddress  = agentAddress
  agent.currentTokenId = tokenId
  agent.expiry        = expiry
  agent.active        = true
  agent.context       = ""
  agent.mcpEndpoint   = ""
  agent.issuedAt      = event.block.timestamp
  agent.issuedTx      = event.transaction.hash
  agent.save()

  // ── TokenToLabel index ──────────────────────────────────────────────────
  // Register the tokenId → labelHash mapping so UserRegistry events can
  // resolve back to the correct Agent entity.
  registerToken(tokenId, labelHash)

  // ── Protocol ────────────────────────────────────────────────────────────
  const protocol = getOrCreateProtocol()
  protocol.totalAgents  = protocol.totalAgents + 1
  protocol.activeAgents = protocol.activeAgents + 1
  protocol.save()

  log.info("AgentIssued: {} (tokenId {})", [label, tokenId.toString()])
}

// ─────────────────────────────────────────────────────────────────────────────
// CapabilityGranted
// Emitted by VeriRegistrar.issueAgent() (for each initial cap) and
// VeriRegistrar.grantCapability().
// Creates or updates Capability entity; creates immutable CapabilityEvent.
// ─────────────────────────────────────────────────────────────────────────────

export function handleCapabilityGranted(event: CapabilityGrantedEvent): void {
  const labelHash    = event.params.labelHash
  const capId        = event.params.capabilityId
  const roleBitmap   = event.params.roleBitmap

  // Agent must already exist (AgentIssued fires first in the same tx)
  const agent = Agent.load(labelHash)
  if (agent == null) {
    log.warning("CapabilityGranted: agent not found for labelHash {}", [
      labelHash.toHexString(),
    ])
    return
  }

  // ── Capability ──────────────────────────────────────────────────────────
  const capId_str = capabilityEntityId(labelHash, capId)
  let cap = Capability.load(capId_str)
  if (cap == null) {
    cap = new Capability(capId_str)
    cap.agent        = labelHash
    cap.capabilityId = capId
    cap.name         = capabilityName(capId)
    cap.grantedAt    = event.block.timestamp
  }
  cap.granted    = true
  cap.roleBitmap = roleBitmap
  cap.revokedAt  = null
  cap.revokeReason = null
  cap.save()

  // ── CapabilityEvent (immutable audit log) ──────────────────────────────
  const evId = capabilityEventId(event.transaction.hash, event.logIndex)
  const capEv = new CapabilityEvent(evId)
  capEv.agent        = labelHash
  capEv.capabilityId = capId
  capEv.action       = "GRANTED"
  capEv.reason       = null
  capEv.blockNumber  = event.block.number
  capEv.timestamp    = event.block.timestamp
  capEv.txHash       = event.transaction.hash
  capEv.save()
}

// ─────────────────────────────────────────────────────────────────────────────
// CapabilityRevoked
// Emitted by VeriRegistrar.revokeCapability().
// The key demo moment: after this event the agent's resolver role is gone,
// and any write attempt from the agent reverts with an EAC error from ENS.
// ─────────────────────────────────────────────────────────────────────────────

export function handleCapabilityRevoked(event: CapabilityRevokedEvent): void {
  const labelHash = event.params.labelHash
  const capId     = event.params.capabilityId
  const reason    = event.params.reason

  const capId_str = capabilityEntityId(labelHash, capId)
  const cap = Capability.load(capId_str)
  if (cap == null) {
    log.warning("CapabilityRevoked: capability {} not found", [capId_str])
    return
  }

  cap.granted      = false
  cap.revokedAt    = event.block.timestamp
  cap.revokeReason = reason
  cap.save()

  // ── CapabilityEvent ─────────────────────────────────────────────────────
  const evId = capabilityEventId(event.transaction.hash, event.logIndex)
  const capEv = new CapabilityEvent(evId)
  capEv.agent        = labelHash
  capEv.capabilityId = capId
  capEv.action       = "REVOKED"
  capEv.reason       = reason
  capEv.blockNumber  = event.block.number
  capEv.timestamp    = event.block.timestamp
  capEv.txHash       = event.transaction.hash
  capEv.save()

  // ── Protocol ────────────────────────────────────────────────────────────
  const protocol = getOrCreateProtocol()
  protocol.totalRevocations = protocol.totalRevocations + 1
  protocol.save()

  log.info("CapabilityRevoked: {} reason: {}", [capId_str, reason])
}

// ─────────────────────────────────────────────────────────────────────────────
// AgentRetired
// Emitted by VeriRegistrar.retireAgent().
// Marks the agent inactive; decrements human agentCount and Protocol.activeAgents.
// The ENS name is NOT burned — only the Veri registry entry is removed.
// ─────────────────────────────────────────────────────────────────────────────

export function handleAgentRetired(event: AgentRetiredEvent): void {
  const labelHash = event.params.labelHash
  const humanId   = event.params.humanId

  const agent = Agent.load(labelHash)
  if (agent == null) {
    log.warning("AgentRetired: agent not found for labelHash {}", [
      labelHash.toHexString(),
    ])
    return
  }

  agent.active = false
  agent.save()

  // ── Human agentCount ────────────────────────────────────────────────────
  const human = getOrCreateHuman(humanId, event.block.timestamp)
  if (human.agentCount > 0) {
    human.agentCount = human.agentCount - 1
  }
  human.save()

  // ── Protocol ────────────────────────────────────────────────────────────
  const protocol = getOrCreateProtocol()
  if (protocol.activeAgents > 0) {
    protocol.activeAgents = protocol.activeAgents - 1
  }
  protocol.save()

  log.info("AgentRetired: {}", [labelHash.toHexString()])
}

// ─────────────────────────────────────────────────────────────────────────────
// TokenRegenerated (UserRegistry)
// ENSv2 emits this whenever a name's token ID changes — on every role grant
// or revoke, and on re-registration after expiry.
// Updates Agent.currentTokenId and reindexes the TokenToLabel map.
//
// NOTE: renamed from `handleTokenRegenerated` for clarity across handlers; keep subgraph.yaml's
// handler entry in sync with this name. The real bug fixed here was calling the
// labelHashForToken() helper (in utils.ts, returns Bytes | null) from mappings.ts — that
// cross-file nullable-return call crashes the AssemblyScript compiler bundled with graph-cli
// (assertion failure in compileBinaryOverload, reproduced on graph-cli 0.80.1 and 0.98.1)
// regardless of function name or call-site count. Fixed by inlining the TokenToLabel.load()
// lookup directly instead of calling the shared helper (see handleExpiryUpdated below, same fix).
// ─────────────────────────────────────────────────────────────────────────────

export function onTokenRegenerated(event: TokenRegeneratedEvent): void {
  const oldTokenId = event.params.oldTokenId
  const newTokenId = event.params.newTokenId

  // Look up the labelHash for the old token. Inlined rather than calling the
  // labelHashForToken() helper in utils.ts — see NOTE above onTokenRegenerated's declaration.
  const entry = TokenToLabel.load(oldTokenId.toString())
  if (entry == null) {
    // Not a Veri agent — ignore
    return
  }

  const agent = Agent.load(entry.labelHash)
  if (agent == null) return

  agent.currentTokenId = newTokenId
  agent.save()

  // Reindex: old tokenId → new tokenId
  reindexToken(oldTokenId, newTokenId)

  log.info("TokenRegenerated: {} -> {}", [
    oldTokenId.toString(),
    newTokenId.toString(),
  ])
}

// ─────────────────────────────────────────────────────────────────────────────
// ExpiryUpdated (UserRegistry)
// Emitted on renewal. Updates Agent.expiry.
// ─────────────────────────────────────────────────────────────────────────────

// NOTE: inlines the TokenToLabel lookup rather than calling labelHashForToken() — see the NOTE
// above onTokenRegenerated for why calling that helper from mappings.ts crashes the compiler.
export function handleExpiryUpdated(event: ExpiryUpdatedEvent): void {
  const tokenId  = event.params.tokenId
  const newExpiry = event.params.newExpiry

  const entry = TokenToLabel.load(tokenId.toString())
  if (entry == null) return // not a Veri agent

  const agent = Agent.load(entry.labelHash)
  if (agent == null) return

  agent.expiry = newExpiry
  agent.save()

  log.info("ExpiryUpdated: tokenId {} new expiry {}", [
    tokenId.toString(),
    newExpiry.toString(),
  ])
}
