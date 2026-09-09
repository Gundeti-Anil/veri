// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console}  from "forge-std/Script.sol";
import {MessageHashUtils}  from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {VeriRegistrar}     from "../src/VeriRegistrar.sol";

/**
 * @title  Seed
 * @notice Issues test agents on Sepolia so the subgraph and directory look alive.
 *
 * Prerequisites:
 *   - VeriRegistrar is deployed and VERI_REGISTRAR_ADDRESS is in .env
 *   - ATTESTOR_PRIVATE_KEY is in .env (used to sign attestations here in-script)
 *
 * What it does:
 *   - Issues 3 agents across 2 simulated humans.
 *   - Grants different capability combinations.
 *   - Revokes one capability to demonstrate the revoke flow.
 *
 * Extend with more agents (up to ~8 per §12 scope cuts) for a realistic demo.
 *
 * Run:
 *   forge script script/Seed.s.sol:Seed --rpc-url $RPC_URL --broadcast
 */
contract Seed is Script {
    using MessageHashUtils for bytes32;

    // EIP-712 domain separator fields — must match VeriRegistrar constructor
    string constant DOMAIN_NAME    = "VeriRegistrar";
    string constant DOMAIN_VERSION = "1";
    uint256 constant CHAIN_ID      = 11155111; // Sepolia

    bytes32 constant ATTESTATION_TYPEHASH = keccak256(
        "Attestation(bytes32 humanId,address userAddress,uint256 deadline)"
    );

    struct AgentSpec {
        string  label;
        address agentAddress;
        bytes32 humanId;        // keccak256(abi.encode(fakeNullifier)) for seeding
        bytes32[] capabilities;
    }

    function run() external {
        uint256 deployerPk  = vm.envUint("PRIVATE_KEY");
        uint256 attestorPk  = vm.envUint("ATTESTOR_PRIVATE_KEY");
        address deployer    = vm.addr(deployerPk);
        address registrarAddr = vm.envAddress("VERI_REGISTRAR_ADDRESS");

        VeriRegistrar registrar = VeriRegistrar(registrarAddr);

        // EIP-712 domain separator
        bytes32 domainSeparator = _buildDomainSeparator(registrarAddr);

        // Two simulated humans
        bytes32 human1 = keccak256(abi.encode(uint256(1001))); // fake nullifier hash
        bytes32 human2 = keccak256(abi.encode(uint256(1002)));

        uint256 deadline = block.timestamp + 1 hours;

        console.log("Seeding agents from deployer:", deployer);

        vm.startBroadcast(deployerPk);

        // ── Agent 1: research agent for human1 ────────────────────────────
        {
            bytes32[] memory caps = new bytes32[](2);
            caps[0] = registrar.CAP_SELF_DESCRIBE();
            caps[1] = registrar.CAP_ENDPOINT_UPDATE();

            bytes memory sig = _signAttestation(
                attestorPk, domainSeparator, human1, deployer, deadline
            );

            uint256 tokenId = registrar.issueAgent(
                "research",                // label
                deployer,                  // agentAddress (using deployer for seeding)
                human1,
                caps,
                sig,
                deadline
            );
            console.log("Issued research.veri.eth, tokenId:", tokenId);
        }

        // ── Agent 2: trading agent for human1 (same human, second agent) ──
        {
            bytes32[] memory caps = new bytes32[](1);
            caps[0] = registrar.CAP_TRANSACT();

            bytes memory sig = _signAttestation(
                attestorPk, domainSeparator, human1, deployer, deadline
            );

            uint256 tokenId = registrar.issueAgent(
                "trading",
                deployer,
                human1,
                caps,
                sig,
                deadline
            );
            console.log("Issued trading.veri.eth, tokenId:", tokenId);
        }

        // ── Agent 3: assistant agent for human2 ───────────────────────────
        {
            bytes32[] memory caps = new bytes32[](3);
            caps[0] = registrar.CAP_SELF_DESCRIBE();
            caps[1] = registrar.CAP_ENDPOINT_UPDATE();
            caps[2] = registrar.CAP_TRANSACT();

            bytes memory sig = _signAttestation(
                attestorPk, domainSeparator, human2, deployer, deadline
            );

            uint256 tokenId = registrar.issueAgent(
                "assistant",
                deployer,
                human2,
                caps,
                sig,
                deadline
            );
            console.log("Issued assistant.veri.eth, tokenId:", tokenId);
        }

        // ── Demo: revoke SELF_DESCRIBE from research agent ────────────────
        // This is the key demo moment: after revocation, the agent can no
        // longer write its agent-context record (ENSv2 EAC rejects it).
        registrar.revokeCapability(
            "research",
            registrar.CAP_SELF_DESCRIBE(),
            "Demo revocation: human withdrew self-describe right"
        );
        console.log("Revoked CAP_SELF_DESCRIBE from research.veri.eth");

        vm.stopBroadcast();

        console.log("");
        console.log("Seed complete. Verify agents on Etherscan, then check the subgraph.");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal EIP-712 helpers
    // ─────────────────────────────────────────────────────────────────────────

    function _buildDomainSeparator(address registrar) internal view returns (bytes32) {
        return keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes(DOMAIN_NAME)),
            keccak256(bytes(DOMAIN_VERSION)),
            CHAIN_ID,
            registrar
        ));
    }

    function _signAttestation(
        uint256 signerPk,
        bytes32 domainSeparator,
        bytes32 humanId,
        address userAddress,
        uint256 deadline
    ) internal pure returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(ATTESTATION_TYPEHASH, humanId, userAddress, deadline)
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", domainSeparator, structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, digest);
        return abi.encodePacked(r, s, v);
    }
}
