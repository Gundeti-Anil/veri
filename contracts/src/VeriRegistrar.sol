// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ECDSA}  from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IPermissionedRegistry} from "./interfaces/IPermissionedRegistry.sol";
import {IPermissionedResolver}  from "./interfaces/IPermissionedResolver.sol";

/**
 * @title  VeriRegistrar
 * @notice Permission and reputation layer for human-backed AI agents on ENSv2 Sepolia.
 *
 * ── How it works ──────────────────────────────────────────────────────────────
 * 1. Backend verifies a World ID Selfie Check proof via /api/v4/verify/{rp_id}.
 * 2. Backend derives humanId = keccak256(abi.encode(nullifier)) and signs an
 *    EIP-712 Attestation(humanId, userAddress, deadline) with the attestor key.
 * 3. Human calls issueAgent() — VeriRegistrar verifies the attestation, enforces
 *    the per-human cap, then mints an ENSv2 subname via the UserRegistry.
 * 4. Scoped capabilities are granted as real EAC roles on the resolver — the
 *    ENS protocol enforces what each agent may write, not Veri's own storage.
 * 5. revokeCapability() strips the resolver role; the same write that previously
 *    succeeded now reverts with an EAC error from ENS itself.
 *
 * ── Trust assumption (stated openly) ──────────────────────────────────────────
 * World ID ZK proofs are verified off-chain by the backend. The on-chain World ID
 * verifier does not live on Sepolia; ENSv2 beta exists only on Sepolia. The
 * trust assumption is: the attestor signing key is not compromised. Mitigation:
 * a cross-chain proof relay, or deploy on World Chain once ENSv2 ships there.
 *
 * ── [VERIFY] items ────────────────────────────────────────────────────────────
 * Before deploying, verify against ensdomains/contracts-v2 (Sepolia beta):
 *   • IPermissionedRegistry function signatures
 *   • IPermissionedResolver function signatures (setText, grantRoles, revokeRoles)
 *   • RegistryRolesLib role constant values (ROLE_* below)
 *   • Per-record-key resolver role scoping (vs per-resolver fallback)
 * Source: docs.ens.domains/ensv2/enhanced-access-control
 *         docs.ens.domains/ensv2/permissioned-resolver
 */
contract VeriRegistrar is EIP712, Ownable {
    using ECDSA for bytes32;

    // =========================================================================
    // ENSv2 Registry role constants  [VERIFY] against RegistryRolesLib
    // =========================================================================

    uint96 public constant ROLE_SET_SUBREGISTRY       = 1 << 0;
    uint96 public constant ROLE_SET_SUBREGISTRY_ADMIN = 1 << 1;
    uint96 public constant ROLE_SET_RESOLVER          = 1 << 2;
    uint96 public constant ROLE_SET_RESOLVER_ADMIN    = 1 << 3;
    uint96 public constant ROLE_SET_EXPIRY            = 1 << 4;
    uint96 public constant ROLE_CAN_TRANSFER_ADMIN    = 1 << 5;
    uint96 public constant ROLE_REGISTRAR             = 1 << 6;
    uint96 public constant ROLE_RENEW                 = 1 << 16;

    /// @notice Registry-level roles granted to the agent address on name registration.
    uint96 public constant AGENT_ROLE_BITMAP =
        ROLE_SET_SUBREGISTRY       |
        ROLE_SET_SUBREGISTRY_ADMIN |
        ROLE_SET_RESOLVER          |
        ROLE_SET_RESOLVER_ADMIN    |
        ROLE_CAN_TRANSFER_ADMIN;

    // =========================================================================
    // Capability IDs  (keccak256 of the capability name — these are the novel part)
    // =========================================================================

    /// @notice Agent may write its own `agent-context` text record.
    bytes32 public constant CAP_SELF_DESCRIBE   = keccak256("SELF_DESCRIBE");

    /// @notice Agent may write `agent-endpoint[*]` text records.
    bytes32 public constant CAP_ENDPOINT_UPDATE = keccak256("ENDPOINT_UPDATE");

    /// @notice Agent may set a sub-registry — enabling it to issue its own sub-agents.
    bytes32 public constant CAP_SUBAGENT_ISSUE  = keccak256("SUBAGENT_ISSUE");

    /// @notice Off-chain signal: relying parties may transact with this agent.
    ///         No resolver role is granted — consumed entirely off-chain.
    bytes32 public constant CAP_TRANSACT        = keccak256("TRANSACT");

    // =========================================================================
    // Config constants
    // =========================================================================

    uint8  public constant MAX_AGENTS_PER_HUMAN  = 5;
    uint64 public constant REGISTRATION_DURATION = 365 days;

    bytes32 private constant ATTESTATION_TYPEHASH = keccak256(
        "Attestation(bytes32 humanId,address userAddress,uint256 deadline)"
    );

    // =========================================================================
    // State
    // =========================================================================

    /// @notice Address whose EIP-712 signatures authorise agent issuance.
    ///         This is the backend's signing key — keep it secret.
    address public attestor;

    /// @notice ENSv2 UserRegistry (PermissionedRegistry) for veri.eth subnames.
    IPermissionedRegistry public immutable REGISTRY;

    /// @notice Default resolver for new names — PermissionedResolverImpl for veri.eth.
    ///         Set at deploy time; update with setDefaultResolver() if resolver changes.
    address public defaultResolver;

    /// @dev humanId → number of agents issued so far.
    ///      humanId = keccak256(abi.encode(nullifier)) — raw nullifier never stored.
    mapping(bytes32 => uint8) public agentCount;

    /// @dev labelHash → humanId that issued this agent.
    ///      Keyed on labelHash, NOT tokenId (token IDs are mutable in ENSv2).
    mapping(bytes32 => bytes32) public agentToHuman;

    /// @dev labelHash → human wallet address (msg.sender at issuance).
    ///      This wallet controls grant/revoke/retire for the agent.
    mapping(bytes32 => address) public agentHuman;

    /// @dev labelHash → agent address (holds the ENSv2 ERC-1155 name token).
    mapping(bytes32 => address) public agentAddr;

    /// @dev labelHash → capabilityId → currently granted.
    mapping(bytes32 => mapping(bytes32 => bool)) public capabilities;

    /// @dev capabilityId → resolver role bitmap to grant/revoke.
    ///      Configurable via setCapabilityRole() after verifying actual resolver constants.
    mapping(bytes32 => uint96) public capabilityRoles;

    // =========================================================================
    // Events  — these drive the entire subgraph; do not rename without updating mappings.ts
    // =========================================================================

    event AgentIssued(
        bytes32 indexed labelHash,
        string          label,
        bytes32 indexed humanId,
        address indexed agentAddress,
        uint256         tokenId,
        uint64          expiry
    );

    event CapabilityGranted(
        bytes32 indexed labelHash,
        bytes32 indexed capabilityId,
        uint96          roleBitmap
    );

    event CapabilityRevoked(
        bytes32 indexed labelHash,
        bytes32 indexed capabilityId,
        string          reason
    );

    event AgentRetired(
        bytes32 indexed labelHash,
        bytes32 indexed humanId
    );

    event AttestorUpdated(address indexed previous, address indexed next);
    event DefaultResolverUpdated(address previous, address next);
    event CapabilityRoleSet(bytes32 indexed capabilityId, uint96 roleBitmap);

    // =========================================================================
    // Constructor
    // =========================================================================

    /**
     * @param _registry        ENSv2 UserRegistry proxy for veri.eth (from SetupRegistry.s.sol).
     * @param _attestor        Backend EIP-712 signing address.
     * @param _defaultResolver PermissionedResolverImpl for veri.eth.
     * @param _owner           Contract owner (multisig or deployer EOA).
     */
    constructor(
        address _registry,
        address _attestor,
        address _defaultResolver,
        address _owner
    ) EIP712("VeriRegistrar", "1") Ownable(_owner) {
        require(_registry != address(0), "VR: zero registry");
        require(_attestor != address(0), "VR: zero attestor");

        REGISTRY        = IPermissionedRegistry(_registry);
        attestor        = _attestor;
        defaultResolver = _defaultResolver;

        // Default capability → resolver role bitmap.
        // [VERIFY] these values against PermissionedResolverImpl role constants.
        // Call setCapabilityRole() after confirming the real values.
        capabilityRoles[CAP_SELF_DESCRIBE]   = 1 << 0;  // placeholder: ROLE_SET_TEXT_CONTEXT
        capabilityRoles[CAP_ENDPOINT_UPDATE] = 1 << 1;  // placeholder: ROLE_SET_TEXT_ENDPOINT
        capabilityRoles[CAP_SUBAGENT_ISSUE]  = ROLE_SET_SUBREGISTRY;
        capabilityRoles[CAP_TRANSACT]        = 0;       // off-chain only — no resolver role
    }

    // =========================================================================
    // Core: issueAgent
    // =========================================================================

    /**
     * @notice Issue a new agent subname under veri.eth.
     *
     * @param label         Leaf label only — e.g. "scanner" → scanner.veri.eth.
     *                      No dots. No parent. ASCII recommended.
     * @param _agentAddress Agent's Sepolia address — receives the ENSv2 ERC-1155 token.
     * @param humanId       keccak256(abi.encode(nullifier)) — NEVER the raw nullifier.
     * @param capabilityIds Capability IDs to grant on issuance (may be empty).
     * @param attestation   EIP-712 signature from `attestor` over
     *                      Attestation(humanId, msg.sender, deadline).
     * @param deadline      Unix timestamp after which the attestation is invalid.
     *
     * @return tokenId  ENSv2 token ID for the registered name (do not cache — mutable).
     */
    function issueAgent(
        string    calldata label,
        address            _agentAddress,
        bytes32            humanId,
        bytes32[] calldata capabilityIds,
        bytes     calldata attestation,
        uint256            deadline
    ) external returns (uint256 tokenId) {
        // ── 1. Verify EIP-712 attestation ──────────────────────────────────
        require(block.timestamp <= deadline, "VR: attestation expired");
        bytes32 structHash = keccak256(
            abi.encode(ATTESTATION_TYPEHASH, humanId, msg.sender, deadline)
        );
        address signer = _hashTypedDataV4(structHash).recover(attestation);
        require(signer == attestor, "VR: invalid attestation");

        // ── 2. Enforce per-human agent cap ─────────────────────────────────
        require(agentCount[humanId] < MAX_AGENTS_PER_HUMAN, "VR: agent cap reached");

        // ── 3. Label must be available ─────────────────────────────────────
        bytes32 labelHash = keccak256(bytes(label));
        {
            IPermissionedRegistry.NameState memory st =
                REGISTRY.getState(uint256(labelHash));
            require(
                st.status == IPermissionedRegistry.NameStatus.AVAILABLE,
                "VR: label not available"
            );
        }

        // ── 4. Register via ENSv2 UserRegistry ────────────────────────────
        //    [VERIFY] REGISTRY.register() signature matches IPermissionedRegistry
        uint64 expiry = uint64(block.timestamp) + REGISTRATION_DURATION;
        tokenId = REGISTRY.register(
            label,
            _agentAddress,
            address(0),       // no sub-registry for leaf names
            defaultResolver,
            AGENT_ROLE_BITMAP,
            expiry
        );

        // ── 5. Store Veri state ────────────────────────────────────────────
        unchecked { agentCount[humanId]++; }
        agentToHuman[labelHash] = humanId;
        agentHuman[labelHash]   = msg.sender;   // human wallet controls grant/revoke
        agentAddr[labelHash]    = _agentAddress;

        // ── 6. Write ENSIP-26 stub records ────────────────────────────────
        //    Agent updates these after SELF_DESCRIBE / ENDPOINT_UPDATE are granted.
        _setTextRecord(tokenId, "agent-context",     "");
        _setTextRecord(tokenId, "agent-endpoint[mcp]", "");

        // ── 7. Emit ────────────────────────────────────────────────────────
        emit AgentIssued(labelHash, label, humanId, _agentAddress, tokenId, expiry);

        // ── 8. Grant initial capabilities ──────────────────────────────────
        for (uint256 i; i < capabilityIds.length; ) {
            _grantCapability(labelHash, tokenId, capabilityIds[i], _agentAddress);
            unchecked { ++i; }
        }
    }

    // =========================================================================
    // Capability management  (human guardian only)
    // =========================================================================

    /**
     * @notice Grant a capability to an already-issued agent.
     *         Caller must be the human wallet that originally called issueAgent().
     *
     * @dev Token ID is resolved fresh here — do NOT cache it.
     */
    function grantCapability(string calldata label, bytes32 capabilityId) external {
        bytes32 labelHash = keccak256(bytes(label));
        require(msg.sender == agentHuman[labelHash], "VR: not agent guardian");

        // Resolve tokenId fresh — it changes on every role grant in ENSv2
        uint256 tokenId = REGISTRY.getState(uint256(labelHash)).tokenId;
        _grantCapability(labelHash, tokenId, capabilityId, agentAddr[labelHash]);
    }

    /**
     * @notice Revoke a capability from an agent.
     *         Strips the corresponding EAC resolver role — subsequent writes by
     *         the agent to that record will revert with an EAC error from ENS.
     *         The agent keeps its name and history; only the right is removed.
     */
    function revokeCapability(
        string  calldata label,
        bytes32          capabilityId,
        string  calldata reason
    ) external {
        bytes32 labelHash = keccak256(bytes(label));
        require(msg.sender == agentHuman[labelHash],          "VR: not agent guardian");
        require(capabilities[labelHash][capabilityId],        "VR: not granted");

        capabilities[labelHash][capabilityId] = false;

        uint96 roleBitmap = capabilityRoles[capabilityId];
        if (roleBitmap != 0) {
            // Resolve tokenId fresh
            uint256 tokenId  = REGISTRY.getState(uint256(labelHash)).tokenId;
            address resolver = REGISTRY.getResolver(tokenId);
            if (resolver != address(0)) {
                IPermissionedResolver(resolver).revokeRoles(
                    tokenId, agentAddr[labelHash], roleBitmap
                );
            }
        }

        emit CapabilityRevoked(labelHash, capabilityId, reason);
    }

    /**
     * @notice Returns true if the agent currently holds the given capability.
     */
    function hasCapability(string calldata label, bytes32 capabilityId)
        external view returns (bool)
    {
        return capabilities[keccak256(bytes(label))][capabilityId];
    }

    /**
     * @notice Retire an agent from the Veri registry.
     *
     *         The ENSv2 name is NOT burned — the agent keeps its on-chain identity
     *         and history. Retirement only removes the agent from Veri's registry,
     *         decrements the human's agent count, and emits AgentRetired (which the
     *         subgraph picks up to mark the agent inactive).
     *
     *         This also frees a slot so the human can issue a replacement agent.
     */
    function retireAgent(string calldata label) external {
        bytes32 labelHash = keccak256(bytes(label));
        require(msg.sender == agentHuman[labelHash], "VR: not agent guardian");

        bytes32 humanId = agentToHuman[labelHash];
        require(humanId != bytes32(0), "VR: agent not found");

        if (agentCount[humanId] > 0) {
            unchecked { agentCount[humanId]--; }
        }

        delete agentToHuman[labelHash];
        delete agentHuman[labelHash];
        delete agentAddr[labelHash];

        emit AgentRetired(labelHash, humanId);
    }

    // =========================================================================
    // Admin
    // =========================================================================

    /// @notice Rotate the attestor signing key.
    function setAttestor(address next) external onlyOwner {
        require(next != address(0), "VR: zero attestor");
        emit AttestorUpdated(attestor, next);
        attestor = next;
    }

    /// @notice Update the default resolver (if the veri.eth resolver is migrated).
    function setDefaultResolver(address next) external onlyOwner {
        emit DefaultResolverUpdated(defaultResolver, next);
        defaultResolver = next;
    }

    /**
     * @notice Update the resolver role bitmap for a capability.
     *         Call this after verifying the exact role constants in PermissionedResolverImpl.
     *         The placeholder values set in the constructor are unverified.
     */
    function setCapabilityRole(bytes32 capabilityId, uint96 roleBitmap) external onlyOwner {
        capabilityRoles[capabilityId] = roleBitmap;
        emit CapabilityRoleSet(capabilityId, roleBitmap);
    }

    // =========================================================================
    // Internal
    // =========================================================================

    function _grantCapability(
        bytes32 labelHash,
        uint256 tokenId,
        bytes32 capabilityId,
        address grantee
    ) internal {
        require(!capabilities[labelHash][capabilityId], "VR: already granted");
        capabilities[labelHash][capabilityId] = true;

        uint96 roleBitmap = capabilityRoles[capabilityId];
        if (roleBitmap != 0) {
            address resolver = REGISTRY.getResolver(tokenId);
            if (resolver != address(0)) {
                IPermissionedResolver(resolver).grantRoles(tokenId, grantee, roleBitmap);
            }
        }

        emit CapabilityGranted(labelHash, capabilityId, roleBitmap);
    }

    /**
     * @dev Write a text record on the resolver for a freshly-registered name.
     *      Only called during issueAgent() where tokenId is fresh from register().
     *      [VERIFY] IPermissionedResolver.setText signature.
     */
    function _setTextRecord(
        uint256 tokenId,
        string memory key,
        string memory value
    ) internal {
        address resolver = REGISTRY.getResolver(tokenId);
        if (resolver == address(0)) return;
        // VeriRegistrar must hold the resolver write role for this tokenId.
        // This is granted by the veri.eth resolver admin in SetupRegistry.s.sol.
        IPermissionedResolver(resolver).setText(tokenId, key, value);
    }
}
