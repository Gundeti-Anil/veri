/**
 * VeriRegistrar ABI — keep in sync with contracts/src/VeriRegistrar.sol.
 * Only includes the functions and events the backend needs to encode calldata for.
 */
export const VERI_REGISTRAR_ABI = [
  // ── Write functions ────────────────────────────────────────────────────────
  `function issueAgent(
      string  calldata label,
      address          agentAddress,
      bytes32          humanId,
      bytes32[] calldata capabilityIds,
      bytes   calldata attestation,
      uint256          deadline
    ) external returns (uint256 tokenId)`,

  `function grantCapability(
      string  calldata label,
      bytes32          capabilityId
    ) external`,

  `function revokeCapability(
      string  calldata label,
      bytes32          capabilityId,
      string  calldata reason
    ) external`,

  `function retireAgent(string calldata label) external`,

  // ── Read functions ─────────────────────────────────────────────────────────
  `function hasCapability(
      string  calldata label,
      bytes32          capabilityId
    ) external view returns (bool)`,

  `function agentCount(bytes32 humanId) external view returns (uint8)`,

  `function agentToHuman(bytes32 labelHash) external view returns (bytes32)`,

  `function agentHuman(bytes32 labelHash) external view returns (address)`,

  `function agentAddr(bytes32 labelHash) external view returns (address)`,

  // ── Events (for event listener / backfill) ─────────────────────────────────
  `event AgentIssued(
      bytes32 indexed labelHash,
      string          label,
      bytes32 indexed humanId,
      address indexed agentAddress,
      uint256         tokenId,
      uint64          expiry
    )`,

  `event CapabilityGranted(
      bytes32 indexed labelHash,
      bytes32 indexed capabilityId,
      uint256         roleBitmap
    )`,

  `event CapabilityRevoked(
      bytes32 indexed labelHash,
      bytes32 indexed capabilityId,
      string          reason
    )`,

  `event AgentRetired(
      bytes32 indexed labelHash,
      bytes32 indexed humanId
    )`,
];

// ── Capability IDs (keccak256 of the name) ──────────────────────────────────
// Must match VeriRegistrar.sol constants exactly.
import { ethers } from "ethers";

export const CAP = {
  SELF_DESCRIBE:   ethers.keccak256(ethers.toUtf8Bytes("SELF_DESCRIBE")),
  ENDPOINT_UPDATE: ethers.keccak256(ethers.toUtf8Bytes("ENDPOINT_UPDATE")),
  SUBAGENT_ISSUE:  ethers.keccak256(ethers.toUtf8Bytes("SUBAGENT_ISSUE")),
  TRANSACT:        ethers.keccak256(ethers.toUtf8Bytes("TRANSACT")),
};

// Human-readable reverse lookup
export const CAP_NAMES = {
  [CAP.SELF_DESCRIBE]:   "SELF_DESCRIBE",
  [CAP.ENDPOINT_UPDATE]: "ENDPOINT_UPDATE",
  [CAP.SUBAGENT_ISSUE]:  "SUBAGENT_ISSUE",
  [CAP.TRANSACT]:        "TRANSACT",
};
