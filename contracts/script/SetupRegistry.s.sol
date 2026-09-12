// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20}          from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EACBaseRolesLib} from "@ensdomains/contracts-v2/access-control/libraries/EACBaseRolesLib.sol";

/**
 * @title  SetupRegistry
 * @notice One-time setup that must run BEFORE Deploy.s.sol.
 *
 * Steps performed (matching §6 "One-time setup" in VERI_BUILD_SPEC.md):
 *
 *   A. Commit-reveal registration of the parent .eth name (e.g. veri.eth)
 *      on ENSv2 Sepolia via ETHRegistrar, paying with MockUSDC.
 *
 *   B. Deploy a UserRegistry proxy via VerifiableFactory.
 *      Read the proxy address from the ProxyDeployed event in the receipt.
 *
 *   C. setSubregistry() on ETHRegistry so veri.eth → UserRegistry.
 *      Without this, subnames mint but never resolve.
 *
 * Run EACH step separately after confirming the previous one worked.
 * Do NOT run all three in one shot — the ETH Registrar commit-reveal
 * requires waiting at least 1 block (ideally 60 s) between commit and reveal.
 *
 * [VERIFY] all interface signatures against ensdomains/contracts-v2 Sepolia
 *          deployments before running. Addresses are from VERI_BUILD_SPEC.md §4.
 */
contract SetupRegistry is Script {

    // ── ENSv2 Sepolia system contracts ──────────────────────────────────────
    // [VERIFY] against ensdomains/contracts-v2/contracts/deployments/sepolia/
    address constant ETH_REGISTRY      = 0xBDC85dD5b15D7ecb354cd7cb6f2c50b4f2c4F0E2;
    address constant ETH_REGISTRAR     = 0xa88553F454b77203B0D036A05c894d555EAAa2Cc;
    address constant USER_REGISTRY_IMPL= 0x624a25d67B59D587752EbEc8DdeD8827dAe52050;
    address constant RESOLVER_IMPL     = 0x9EAe5C2730a7dD16BDD1DeE6421a1B91e3B0365e;
    address constant VERIFIABLE_FACTORY= 0x10dC6333CDFe1FCEf624c6e0a8221b91804Cd7ef;
    address constant MOCK_USDC         = 0x768F42455A2D082E23ceeF7d51e5787C82d67a39;

    // Parent label to register (without .eth)
    string constant PARENT_LABEL = "veri";

    // Registration duration for the parent name (1 year)
    uint64 constant DURATION = 365 days;

    // ─────────────────────────────────────────────────────────────────────────
    // Step A-1: Commit to the name (run first, then wait ≥ 60 s)
    // ─────────────────────────────────────────────────────────────────────────
    function commitName() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        bytes32 secret = keccak256(abi.encodePacked("veri-secret-change-me"));

        // Full makeCommitment signature from IETHRegistrar:
        //   (label, owner, secret, subregistry, resolver, duration, referrer)
        bytes32 commitment = IETHRegistrar(ETH_REGISTRAR).makeCommitment(
            PARENT_LABEL,
            deployer,
            secret,
            address(0),   // subregistry — set later via setSubregistry()
            address(0),   // resolver    — set later if needed
            DURATION,
            bytes32(0)    // referrer
        );

        vm.startBroadcast(pk);
        IETHRegistrar(ETH_REGISTRAR).commit(commitment);
        vm.stopBroadcast();

        console.log("Committed. Secret (save this):");
        console.logBytes32(secret);
        console.log("Wait >= 60 seconds then run registerName()");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step A-2: Reveal / register the name (run after waiting ≥ 60 s)
    // ─────────────────────────────────────────────────────────────────────────
    function registerName() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        bytes32 secret = keccak256(abi.encodePacked("veri-secret-change-me"));

        // getRegisterPrice(label, duration, paymentToken)
        (uint256 base, uint256 premium) = IETHRegistrar(ETH_REGISTRAR).getRegisterPrice(
            PARENT_LABEL, DURATION, IERC20(MOCK_USDC)
        );
        uint256 price = base + premium;
        console.log("Registration price (MockUSDC units):", price);

        vm.startBroadcast(pk);

        // Approve MockUSDC — ENSv2 fees are NOT paid in ETH
        IERC20(MOCK_USDC).approve(ETH_REGISTRAR, price);

        // Full register signature from IETHRegistrar:
        //   (label, owner, secret, subregistry, resolver, duration, paymentToken, referrer)
        IETHRegistrar(ETH_REGISTRAR).register(
            PARENT_LABEL,
            deployer,
            secret,
            address(0),         // subregistry — pointed to UserRegistry in Step C
            address(0),         // resolver
            DURATION,
            IERC20(MOCK_USDC),  // payment token
            bytes32(0)          // referrer
        );

        vm.stopBroadcast();
        console.log("Registered veri.eth. Now run deployUserRegistry()");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step B: Deploy UserRegistry proxy via VerifiableFactory
    // ─────────────────────────────────────────────────────────────────────────
    function deployUserRegistry() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        // Role bitmap for initialize():
        // Must include ROLE_REGISTRAR_ADMIN and ROLE_RENEW_ADMIN so we can
        // grant those roles to VeriRegistrar in a later step.
        // [VERIFY] exact admin role values from RegistryRolesLib
        uint256 initRoles = _registrarAdminRole() | _renewAdminRole();

        vm.startBroadcast(pk);

        // [VERIFY] VerifiableFactory.deployProxy signature
        // ProxyDeployed event in the receipt contains the new proxy address.
        IVerifiableFactory(VERIFIABLE_FACTORY).deployProxy(
            USER_REGISTRY_IMPL,
            uint256(keccak256(abi.encodePacked(deployer, block.timestamp))),
            abi.encodeWithSignature(
                "initialize(address,uint256)",
                deployer,   // initial admin
                initRoles
            )
        );

        vm.stopBroadcast();
        console.log("UserRegistry proxy deployed.");
        console.log("Read USER_REGISTRY_ADDRESS from the ProxyDeployed event in the receipt.");
        console.log("Add it to .env, then run setSubregistry()");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step B2: Deploy PermissionedResolver proxy via VerifiableFactory
    // ─────────────────────────────────────────────────────────────────────────
    function deployResolver() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        // Grant the deployer every root-resource role (including all _ADMIN variants) so it can
        // bootstrap by authorizing VeriRegistrar afterwards via authorizeNameRoles().
        // initialize(address admin, uint256 roleBitmap, bytes[] setters)
        vm.startBroadcast(pk);
        IVerifiableFactory(VERIFIABLE_FACTORY).deployProxy(
            RESOLVER_IMPL,
            uint256(keccak256(abi.encodePacked(deployer, block.timestamp, "resolver"))),
            abi.encodeWithSignature(
                "initialize(address,uint256,bytes[])",
                deployer,
                EACBaseRolesLib.ALL_ROLES,
                new bytes[](0)
            )
        );
        vm.stopBroadcast();

        console.log("PermissionedResolver proxy deployed.");
        console.log("Read RESOLVER_ADDRESS from the ProxyDeployed event in the receipt.");
        console.log("Add it to .env, then run Deploy.s.sol, then authorizeVeriRegistrarOnResolver()");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step E (after Deploy.s.sol): grant VeriRegistrar the resolver roles it needs
    //         to write text records and authorize agent capabilities on any name.
    // ─────────────────────────────────────────────────────────────────────────
    function authorizeVeriRegistrarOnResolver() external {
        uint256 pk                = vm.envUint("PRIVATE_KEY");
        address resolverAddr      = vm.envAddress("RESOLVER_ADDRESS");
        address veriRegistrarAddr = vm.envAddress("VERI_REGISTRAR_ADDRESS");

        // ROLE_SET_TEXT = 1 << 4, ROLE_SET_TEXT_ADMIN = ROLE_SET_TEXT << 128 (PermissionedResolverLib)
        uint256 roleSetText      = 1 << 4;
        uint256 roleSetTextAdmin = roleSetText << 128;

        vm.startBroadcast(pk);
        // NameCoder.encode("") == hex"00" == the root name, equivalent to grantRootRoles().
        IPermissionedResolverAuth(resolverAddr).authorizeNameRoles(
            hex"00",
            roleSetText | roleSetTextAdmin,
            veriRegistrarAddr,
            true
        );
        vm.stopBroadcast();

        console.log("VeriRegistrar authorized to set/authorize text roles on any name.");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step C: Point veri.eth → UserRegistry
    // ─────────────────────────────────────────────────────────────────────────
    function setSubregistry() external {
        uint256 pk               = vm.envUint("PRIVATE_KEY");
        address userRegistryAddr = vm.envAddress("USER_REGISTRY_ADDRESS");

        // labelHash for "veri"
        uint256 labelHash = uint256(keccak256(bytes(PARENT_LABEL)));

        vm.startBroadcast(pk);

        // [VERIFY] setSubregistry signature on ETHRegistry (PermissionedRegistry)
        IETHRegistry(ETH_REGISTRY).setSubregistry(labelHash, userRegistryAddr);

        vm.stopBroadcast();

        console.log("setSubregistry done.");
        console.log("veri.eth subnames now resolve through UserRegistry at:", userRegistryAddr);
        console.log("Run Deploy.s.sol next.");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers — [VERIFY] role constant values
    // ─────────────────────────────────────────────────────────────────────────
    // RegistryRolesLib.ROLE_REGISTRAR_ADMIN = ROLE_REGISTRAR (1 << 0) << 128
    function _registrarAdminRole() internal pure returns (uint256) { return uint256(1) << 128; }
    // RegistryRolesLib.ROLE_RENEW_ADMIN = ROLE_RENEW (1 << 16) << 128
    function _renewAdminRole()     internal pure returns (uint256) { return uint256(1) << 144; }
}

// ── Minimal interfaces for setup scripts only ────────────────────────────────

interface IETHRegistrar {
    function makeCommitment(
        string calldata label,
        address owner,
        bytes32 secret,
        address subregistry,
        address resolver,
        uint64  duration,
        bytes32 referrer
    ) external pure returns (bytes32);

    function commit(bytes32 commitment) external;

    function getRegisterPrice(string calldata label, uint64 duration, IERC20 paymentToken)
        external view returns (uint256 base, uint256 premium);

    function register(
        string  memory label,
        address        owner,
        bytes32        secret,
        address        subregistry,
        address        resolver,
        uint64         duration,
        IERC20         paymentToken,
        bytes32        referrer
    ) external returns (uint256 tokenId);
}

interface IETHRegistry {
    function setSubregistry(uint256 labelHash, address subregistry) external;
}

interface IVerifiableFactory {
    function deployProxy(address impl, uint256 salt, bytes calldata initData) external returns (address proxy);
}

interface IPermissionedResolverAuth {
    function authorizeNameRoles(bytes calldata toName, uint256 roleBitmap, address account, bool grant)
        external returns (bool);
}
