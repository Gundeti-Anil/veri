// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @notice Minimal interface for the ENSv2 PermissionedResolverImpl.
 *
 * [VERIFY] every signature against ensdomains/contracts-v2 before deploying.
 *         Specifically:
 *           - Does setText use (bytes32 node, ...) or (uint256 tokenId, ...)?
 *           - Does grantRoles use (uint256 tokenId, address, uint96) or different params?
 *           - What are the exact resolver-side role constants for text record writes?
 *         Read: docs.ens.domains/ensv2/permissioned-resolver
 *               docs.ens.domains/ensv2/enhanced-access-control
 */
interface IPermissionedResolver {

    /**
     * @notice Write a text record for a name.
     *
     * [VERIFY] whether the first param is bytes32 node (ENSv1 namehash style)
     *         or uint256 tokenId (ENSv2 token style).
     *         Current assumption: uint256 tokenId — update if wrong.
     *
     * Requirements: Caller must hold the text-write role for this tokenId
     *               (granted via grantRoles).
     */
    function setText(
        uint256        tokenId,
        string calldata key,
        string calldata value
    ) external;

    /**
     * @notice Grant resolver-level roles for a specific name to a grantee.
     *
     * These are the per-capability roles that Veri maps to — e.g.:
     *   ROLE_SET_TEXT_AGENT_CONTEXT   → grantee can write "agent-context"
     *   ROLE_SET_TEXT_AGENT_ENDPOINT  → grantee can write "agent-endpoint[*]"
     *   ROLE_SET_SUBREGISTRY          → grantee can set a sub-registry
     *
     * [VERIFY] exact role constants from RegistryRolesLib / resolver docs.
     *
     * Requirements: Caller must hold the _ADMIN variant of each role for this tokenId.
     */
    function grantRoles(
        uint256 tokenId,
        address grantee,
        uint96  roles
    ) external;

    /**
     * @notice Revoke resolver-level roles for a specific name from a grantee.
     */
    function revokeRoles(
        uint256 tokenId,
        address grantee,
        uint96  roles
    ) external;
}
