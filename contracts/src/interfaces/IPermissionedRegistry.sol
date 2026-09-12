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

    // Matches ensdomains/contracts-v2 IPermissionedRegistry.Status exactly (field order/enum order
    // matter for ABI decoding of getState()).
    enum Status { AVAILABLE, RESERVED, REGISTERED }

    struct State {
        Status  status;
        uint64  expiry;      // absolute Unix timestamp
        address latestOwner; // owner even if the token was later burned
        uint256 tokenId;     // mutable — changes on role grants/revokes and re-registration
        uint256 resource;    // EAC resource ID for this name
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
        uint256         roleBitmap,
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
    function grantRootRoles(uint256 roles, address grantee) external returns (bool);

    /**
     * @notice Revoke roles on the root resource.
     */
    function revokeRootRoles(uint256 roles, address grantee) external returns (bool);

    /**
     * @notice Grant roles scoped to a specific name (unlike the resolver's equivalent, this is
     *         NOT disabled on the registry).
     * @param anyId The labelhash, token ID, or resource of the name to scope the grant to.
     * @dev    Caller must hold the _ADMIN variant of each role being granted, scoped to `anyId`.
     */
    function grantRoles(uint256 anyId, uint256 roleBitmap, address account) external returns (bool);

    /**
     * @notice Revoke roles scoped to a specific name.
     */
    function revokeRoles(uint256 anyId, uint256 roleBitmap, address account) external returns (bool);

    // -------------------------------------------------------------------------
    // Read
    // -------------------------------------------------------------------------

    /**
     * @notice Current state of a label.
     * @param anyId  The labelhash, token ID, or resource — the real registry accepts any of these
     *               interchangeably and resolves internally.
     */
    function getState(uint256 anyId) external view returns (State memory);

    /**
     * @notice Resolver configured for a label.
     * @dev    Real signature takes the label string directly (inherited from IRegistry), NOT a
     *         token ID — always look up at call-time since token IDs are mutable anyway.
     */
    function getResolver(string calldata label) external view returns (address);
}
