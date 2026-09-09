// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @notice Minimal interface for the ENSv2 UserRegistry (PermissionedRegistry).
 *
 * [VERIFY] every signature against ensdomains/contracts-v2 before deploying.
 *         ENSv2 is in beta on Sepolia — function signatures may change.
 *         Source of truth: contracts-v2/contracts/src/registry/
 */
interface IPermissionedRegistry {

    enum NameStatus { AVAILABLE, REGISTERED, EXPIRED }

    struct NameState {
        NameStatus status;
        uint256    tokenId;   // mutable — changes on role grants/revokes and re-registration
        uint64     expiry;    // absolute Unix timestamp
        address    owner;
    }

    // -------------------------------------------------------------------------
    // Write
    // -------------------------------------------------------------------------

    /**
     * @notice Register a leaf label under this registry.
     *
     * @param label       Leaf label string — no dots, no parent.
     * @param owner       Address to receive the ERC-1155 name token.
     * @param subregistry Sub-registry for further delegation. Pass address(0) for leaf names.
     * @param resolver    Resolver for this name. Use the veri.eth PermissionedResolverImpl.
     * @param roleBitmap  EAC roles granted to `owner` on registration.
     * @param expiry      Absolute Unix timestamp when this registration expires.
     * @return tokenId    The ERC-1155 token ID minted for this name.
     *
     * Requirements:
     *   - Caller must hold ROLE_REGISTRAR (granted via grantRootRoles).
     *   - Label must not already be REGISTERED or in EXPIRED grace period.
     */
    function register(
        string calldata label,
        address         owner,
        address         subregistry,
        address         resolver,
        uint96          roleBitmap,
        uint64          expiry
    ) external returns (uint256 tokenId);

    /**
     * @notice Renew a registered name.
     * @param tokenId   Current token ID (resolve fresh — token IDs are mutable).
     * @param newExpiry New absolute expiry timestamp.
     *
     * Requirements: Caller must hold ROLE_RENEW.
     */
    function renew(uint256 tokenId, uint64 newExpiry) external;

    /**
     * @notice Grant roles on the root resource (the registry itself).
     * @dev    Caller must hold the _ADMIN variant of each role being granted.
     *         e.g. to grant ROLE_REGISTRAR, caller needs ROLE_REGISTRAR_ADMIN.
     */
    function grantRootRoles(uint96 roles, address grantee) external;

    /**
     * @notice Revoke roles on the root resource.
     */
    function revokeRootRoles(uint96 roles, address grantee) external;

    // -------------------------------------------------------------------------
    // Read
    // -------------------------------------------------------------------------

    /**
     * @notice Current state of a label.
     * @param labelHash  uint256(keccak256(bytes(label)))
     */
    function getState(uint256 labelHash) external view returns (NameState memory);

    /**
     * @notice Resolver configured for a token ID.
     * @dev    Always look up at call-time — token IDs are mutable.
     */
    function getResolver(uint256 tokenId) external view returns (address);
}
