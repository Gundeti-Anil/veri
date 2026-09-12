/**
 * VeriRegistrar calldata encoders.
 *
 * All reads go through the subgraph (graph.js).
 * This module only encodes write calldata for the frontend to sign and broadcast.
 */
import { ethers } from "ethers";
import { VERI_REGISTRAR_ABI } from "./abi.js";
import { config } from "./config.js";

export const iface = new ethers.Interface(VERI_REGISTRAR_ABI);

// EIP-712 domain — must match VeriRegistrar.sol constructor
const DOMAIN = {
  name:              "VeriRegistrar",
  version:           "1",
  chainId:           11155111, // Sepolia
  verifyingContract: config.registrarAddress,
};

const ATTESTATION_TYPES = {
  Attestation: [
    { name: "humanId",     type: "bytes32" },
    { name: "userAddress", type: "address" },
    { name: "deadline",    type: "uint256" },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// EIP-712 attestation signing
// Called by /verify-proof after verifying the World proof.
// ─────────────────────────────────────────────────────────────────────────────

export async function signAttestation(humanId, userAddress) {
  if (!config.attestorPrivateKey) {
    throw new Error("ATTESTOR_PRIVATE_KEY is not set");
  }

  const deadline = Math.floor(Date.now() / 1000) + 10 * 60; // 10 min window

  const attestor = new ethers.Wallet(config.attestorPrivateKey);

  // Re-read the verifying contract each time so hot-reloads pick up env changes
  const domain = { ...DOMAIN, verifyingContract: config.registrarAddress };

  const attestation = await attestor.signTypedData(
    domain,
    ATTESTATION_TYPES,
    { humanId, userAddress, deadline: BigInt(deadline) }
  );

  return { attestation, deadline };
}

// ─────────────────────────────────────────────────────────────────────────────
// Calldata encoders
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encode issueAgent() calldata.
 * @param label         Leaf label (e.g. "scanner")
 * @param agentAddress  Agent wallet address
 * @param humanId       bytes32 hex — keccak256(abi.encode(nullifier))
 * @param capabilityIds Array of bytes32 hex capability IDs
 * @param attestation   EIP-712 signature bytes (from signAttestation)
 * @param deadline      Unix timestamp (from signAttestation)
 */
export function encodeIssueAgent(label, agentAddress, humanId, capabilityIds, attestation, deadline) {
  return iface.encodeFunctionData("issueAgent", [
    label,
    agentAddress,
    humanId,
    capabilityIds,
    attestation,
    BigInt(deadline),
  ]);
}

/**
 * Encode grantCapability() calldata.
 */
export function encodeGrantCapability(label, capabilityId) {
  return iface.encodeFunctionData("grantCapability", [label, capabilityId]);
}

/**
 * Encode revokeCapability() calldata.
 */
export function encodeRevokeCapability(label, capabilityId, reason) {
  return iface.encodeFunctionData("revokeCapability", [label, capabilityId, reason]);
}

/**
 * Encode retireAgent() calldata.
 */
export function encodeRetireAgent(label) {
  return iface.encodeFunctionData("retireAgent", [label]);
}
