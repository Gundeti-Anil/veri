// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ECDSA}  from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {NameCoder} from "@ens/contracts/utils/NameCoder.sol";
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

    // Nybble-packed per RegistryRolesLib: role N lives at bit (4*N), admin counterpart at bit (4*N + 128).
    uint256 public constant ROLE_SET_SUBREGISTRY       = 1 << 20;
    uint256 public constant ROLE_SET_SUBREGISTRY_ADMIN = 1 << 148;
    uint256 public constant ROLE_SET_RESOLVER          = 1 << 24;
    uint256 public constant ROLE_SET_RESOLVER_ADMIN    = 1 << 152;
    uint256 public constant ROLE_CAN_TRANSFER_ADMIN    = 1 << 156;
    uint256 public constant ROLE_REGISTRAR             = 1 << 0;
    uint256 public constant ROLE_RENEW                 = 1 << 16;

    /// @notice Registry-level roles granted to the agent address on name registration.
    uint256 public constant AGENT_ROLE_BITMAP =
        ROLE_SET_SUBREGISTRY       |
        ROLE_SET_SUBREGISTRY_ADMIN |
        ROLE_SET_RESOLVER          |
        ROLE_SET_RESOLVER_ADMIN    |
        ROLE_CAN_TRANSFER_ADMIN;

    // =========================================================================
    // Resolver role constants — from PermissionedResolverLib (nybble-packed, same scheme as
    // RegistryRolesLib above but on the resolver contract, scoped per-name via `resource()`).
    // =========================================================================

    uint256 public constant ROLE_SET_TEXT = 1 << 4;

    /// @notice The parent name every agent is registered under.
    string public constant PARENT_NAME = "veri.eth";

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

    /// @notice Where a capability's role lives: nowhere (off-chain only), the registry
    ///         (name-scoped EAC role), or a specific resolver text record.
    enum CapabilityTarget { NONE, REGISTRY, RESOLVER_TEXT }

    struct CapabilityConfig {
        CapabilityTarget target;
        uint256          roleBitmap; // ignored when target == NONE
        string           textKey;    // only used when target == RESOLVER_TEXT
    }

    /// @dev capabilityId → where/what role to grant or revoke.
    ///      Configurable via setCapabilityConfig() after verifying actual resolver constants.
    mapping(bytes32 => CapabilityConfig) public capabilityConfig;

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
        uint256         roleBitmap
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
    event CapabilityRoleSet(bytes32 indexed capabilityId, uint256 roleBitmap);

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

        // Default capability → target + role bitmap + (for resolver text roles) record key.
        // CAP_SELF_DESCRIBE / CAP_ENDPOINT_UPDATE are per-text-key resolver roles, scoped via
        // authorizeTextRoles() — see PermissionedResolver.sol. CAP_SUBAGENT_ISSUE is a
        // registry-level role, granted directly via REGISTRY.grantRoles(). CAP_TRANSACT is
        // off-chain only.
        capabilityConfig[CAP_SELF_DESCRIBE] = CapabilityConfig({
            target:     CapabilityTarget.RESOLVER_TEXT,
            roleBitmap: ROLE_SET_TEXT,
            textKey:    "agent-context"
        });
        capabilityConfig[CAP_ENDPOINT_UPDATE] = CapabilityConfig({
            target:     CapabilityTarget.RESOLVER_TEXT,
            roleBitmap: ROLE_SET_TEXT,
            textKey:    "agent-endpoint[mcp]"
        });
        capabilityConfig[CAP_SUBAGENT_ISSUE] = CapabilityConfig({
            target:     CapabilityTarget.REGISTRY,
            roleBitmap: ROLE_SET_SUBREGISTRY,
            textKey:    ""
        });
        capabilityConfig[CAP_TRANSACT] = CapabilityConfig({
            target:     CapabilityTarget.NONE,
            roleBitmap: 0,
            textKey:    ""
        });
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
            IPermissionedRegistry.State memory st =
                REGISTRY.getState(uint256(labelHash));
            require(
                st.status == IPermissionedRegistry.Status.AVAILABLE,
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
        _setTextRecord(label, "agent-context",     "");
        _setTextRecord(label, "agent-endpoint[mcp]", "");

        // ── 7. Emit ────────────────────────────────────────────────────────
        emit AgentIssued(labelHash, label, humanId, _agentAddress, tokenId, expiry);

        // ── 8. Grant initial capabilities ──────────────────────────────────
        for (uint256 i; i < capabilityIds.length; ) {
            _grantCapability(label, labelHash, tokenId, capabilityIds[i], _agentAddress);
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
        _grantCapability(label, labelHash, tokenId, capabilityId, agentAddr[labelHash]);
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

        CapabilityConfig memory cfg = capabilityConfig[capabilityId];
        if (cfg.target == CapabilityTarget.REGISTRY) {
            // Resolve tokenId fresh — it changes on every role grant in ENSv2
            uint256 tokenId = REGISTRY.getState(uint256(labelHash)).tokenId;
            REGISTRY.revokeRoles(tokenId, cfg.roleBitmap, agentAddr[labelHash]);
        } else if (cfg.target == CapabilityTarget.RESOLVER_TEXT) {
            address resolver = REGISTRY.getResolver(label);
            if (resolver != address(0)) {
                IPermissionedResolver(resolver).authorizeTextRoles(
                    NameCoder.encode(_fullName(label)), cfg.textKey, agentAddr[labelHash], false
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
     * @notice Update the target/role/text-key config for a capability.
     *         Call this after verifying the exact role constants in PermissionedResolverImpl.
     */
    function setCapabilityConfig(
        bytes32          capabilityId,
        CapabilityTarget target,
        uint256          roleBitmap,
        string calldata  textKey
    ) external onlyOwner {
        capabilityConfig[capabilityId] = CapabilityConfig(target, roleBitmap, textKey);
        emit CapabilityRoleSet(capabilityId, roleBitmap);
    }

    // =========================================================================
    // Internal
    // =========================================================================

    function _grantCapability(
        string  memory label,
        bytes32 labelHash,
        uint256 tokenId,
        bytes32 capabilityId,
        address grantee
    ) internal {
        require(!capabilities[labelHash][capabilityId], "VR: already granted");
        capabilities[labelHash][capabilityId] = true;

        CapabilityConfig memory cfg = capabilityConfig[capabilityId];
        if (cfg.target == CapabilityTarget.REGISTRY) {
            REGISTRY.grantRoles(tokenId, cfg.roleBitmap, grantee);
        } else if (cfg.target == CapabilityTarget.RESOLVER_TEXT) {
            address resolver = REGISTRY.getResolver(label);
            if (resolver != address(0)) {
                IPermissionedResolver(resolver).authorizeTextRoles(
                    NameCoder.encode(_fullName(label)), cfg.textKey, grantee, true
                );
            }
        }

        emit CapabilityGranted(labelHash, capabilityId, cfg.roleBitmap);
    }

    /**
     * @dev Write a text record on the resolver for a freshly-registered name.
     *      Only called during issueAgent() where tokenId is fresh from register().
     */
    function _setTextRecord(
        string memory label,
        string memory key,
        string memory value
    ) internal {
        address resolver = REGISTRY.getResolver(label);
        if (resolver == address(0)) return;
        // VeriRegistrar must hold the resolver write role for this node/key.
        // This is granted by the veri.eth resolver admin in SetupRegistry.s.sol.
        bytes32 node = NameCoder.namehash(NameCoder.encode(_fullName(label)), 0);
        IPermissionedResolver(resolver).setText(node, key, value);
    }

    /// @dev Full DNS name for a leaf label, e.g. "scanner" → "scanner.veri.eth".
    function _fullName(string memory label) internal pure returns (string memory) {
        return string.concat(label, ".", PARENT_NAME);
    }
}
