// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {VeriRegistrar}   from "../src/VeriRegistrar.sol";

/**
 * @title  Deploy
 * @notice Deploys VeriRegistrar and grants it the roles it needs on the UserRegistry.
 *
 * Prerequisites (must be done first — see SetupRegistry.s.sol):
 *   1. veri.eth is registered on ENSv2 Sepolia.
 *   2. A UserRegistry proxy is deployed and set as the sub-registry for veri.eth.
 *   3. .env contains USER_REGISTRY_ADDRESS, RESOLVER_ADDRESS, ATTESTOR_ADDRESS.
 *
 * What this script does:
 *   1. Deploy VeriRegistrar.
 *   2. Grant it ROLE_REGISTRAR | ROLE_RENEW on the UserRegistry so it can
 *      call register() and renew() on behalf of humans.
 *
 * After running, save VERI_REGISTRAR_ADDRESS to .env for use by the backend
 * and the Seed script.
 *
 * Verify on Etherscan:
 *   forge verify-contract <address> VeriRegistrar \
 *     --chain sepolia \
 *     --constructor-args $(cast abi-encode "constructor(address,address,address,address)" \
 *         $USER_REGISTRY_ADDRESS $ATTESTOR_ADDRESS $RESOLVER_ADDRESS $DEPLOYER)
 */
contract Deploy is Script {

    // VeriRegistrar role constants — must match the values in VeriRegistrar.sol
    uint96 constant ROLE_REGISTRAR = 1 << 6;
    uint96 constant ROLE_RENEW     = 1 << 16;

    function run() external {
        uint256 pk              = vm.envUint("PRIVATE_KEY");
        address deployer        = vm.addr(pk);
        address userRegistry    = vm.envAddress("USER_REGISTRY_ADDRESS");
        address attestor        = vm.envAddress("ATTESTOR_ADDRESS");
        address resolver        = vm.envAddress("RESOLVER_ADDRESS");

        console.log("Deployer:        ", deployer);
        console.log("UserRegistry:    ", userRegistry);
        console.log("Attestor:        ", attestor);
        console.log("DefaultResolver: ", resolver);

        vm.startBroadcast(pk);

        // 1. Deploy VeriRegistrar
        VeriRegistrar registrar = new VeriRegistrar(
            userRegistry,
            attestor,
            resolver,
            deployer   // owner — replace with multisig after testing
        );
        console.log("VeriRegistrar deployed at:", address(registrar));

        // 2. Grant VeriRegistrar roles on the UserRegistry
        //    [VERIFY] grantRootRoles signature on IPermissionedRegistry
        //    Caller (deployer) must hold ROLE_REGISTRAR_ADMIN | ROLE_RENEW_ADMIN
        //    (granted during UserRegistry initialize() in SetupRegistry.s.sol)
        IGrantable(userRegistry).grantRootRoles(
            ROLE_REGISTRAR | ROLE_RENEW,
            address(registrar)
        );
        console.log("Granted ROLE_REGISTRAR | ROLE_RENEW to registrar.");

        vm.stopBroadcast();

        console.log("");
        console.log("=== NEXT STEPS ===");
        console.log("1. Add to .env:  VERI_REGISTRAR_ADDRESS=", address(registrar));
        console.log("2. Verify capability role bitmaps:");
        console.log("   forge script script/Deploy.s.sol:PrintCapabilityRoles --rpc-url $RPC_URL");
        console.log("3. Run Seed.s.sol to issue test agents.");
        console.log("4. Verify contract on Etherscan (see script comment).");
    }

    /**
     * @notice Helper: print the capability IDs so you can cross-check them in the subgraph.
     */
    function printCapabilityIds() external pure {
        console.log("CAP_SELF_DESCRIBE:  ");
        console.logBytes32(keccak256("SELF_DESCRIBE"));
        console.log("CAP_ENDPOINT_UPDATE:");
        console.logBytes32(keccak256("ENDPOINT_UPDATE"));
        console.log("CAP_SUBAGENT_ISSUE: ");
        console.logBytes32(keccak256("SUBAGENT_ISSUE"));
        console.log("CAP_TRANSACT:       ");
        console.logBytes32(keccak256("TRANSACT"));
    }
}

interface IGrantable {
    function grantRootRoles(uint96 roles, address grantee) external;
}
