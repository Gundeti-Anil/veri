// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @notice Minimal interface for the ENSv2 PermissionedResolverImpl.
 *
 * Matches ensdomains/contracts-v2/contracts/src/resolver/PermissionedResolver.sol.
 *
 * Important: the resolver's generic `grantRoles`/`revokeRoles` (from IEnhancedAccessControl) are
 * DISABLED — they always revert with `EACCannotGrantRoles`/`EACCannotRevokeRoles`. Per-name,
 * per-record-key role changes go through the `authorize*Roles` functions below instead, which
 * derive the EAC resource internally as `keccak256(namehash(toName), part)` — never a token ID.
 */
interface IPermissionedResolver {

    /**
     * @notice Write a text record for `node` (the ENS namehash of the full name, e.g.
     *         `namehash("scanner.veri.eth")`) — NOT a token ID.
     *
     * Requirements: caller must hold `ROLE_SET_TEXT` scoped to `resource(node, partHash(key))`
     *               (granted via `authorizeTextRoles`).
     */
    function setText(
        bytes32        node,
        string calldata key,
        string calldata value
    ) external;

    /**
     * @notice Authorize (or revoke) `setText(key)` permission for `toName` — a DNS-encoded name,
     *         e.g. `NameCoder.encode("scanner.veri.eth")`.
     * @param toName  DNS-encoded name.
     * @param key     The text key to scope the role to.
     * @param account The account to authorize.
     * @param grant   true to grant, false to revoke.
     */
    function authorizeTextRoles(
        bytes  calldata toName,
        string calldata key,
        address         account,
        bool            grant
    ) external returns (bool);

    /**
     * @notice Authorize (or revoke) name-wide roles (e.g. `ROLE_SET_SUBREGISTRY`-equivalent
     *         resolver roles) for `toName` as a whole, not scoped to one record key.
     */
    function authorizeNameRoles(
        bytes  calldata toName,
        uint256         roleBitmap,
        address         account,
        bool            grant
    ) external returns (bool);
}
