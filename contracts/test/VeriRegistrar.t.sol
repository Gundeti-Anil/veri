// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console}     from "forge-std/Test.sol";
import {VeriRegistrar}     from "../src/VeriRegistrar.sol";
import {IPermissionedRegistry} from "../src/interfaces/IPermissionedRegistry.sol";
import {IPermissionedResolver}  from "../src/interfaces/IPermissionedResolver.sol";

// ─────────────────────────────────────────────────────────────────────────────
// Mock contracts
// ─────────────────────────────────────────────────────────────────────────────

contract MockRegistry is IPermissionedRegistry {
    uint256 private _nextTokenId = 1;

    mapping(uint256 => State)   private _states;    // labelHash → state
    mapping(uint256 => address) private _resolvers; // labelHash → resolver

    function register(
        string calldata label,
        address owner,
        address,          // subregistry (ignored in mock)
        address resolver,
        uint256,           // roleBitmap (ignored in mock)
        uint64 expiry
    ) external override returns (uint256 tokenId) {
        tokenId = _nextTokenId++;
        uint256 labelHash = uint256(keccak256(bytes(label)));
        _states[labelHash] = State({
            status:      Status.REGISTERED,
            expiry:      expiry,
            latestOwner: owner,
            tokenId:     tokenId,
            resource:    labelHash
        });
        _resolvers[labelHash] = resolver;
    }

    function renew(uint256, uint64) external override {}

    function getState(uint256 labelHash) external view override returns (State memory) {
        return _states[labelHash];
    }

    function getResolver(string calldata label) external view override returns (address) {
        return _resolvers[uint256(keccak256(bytes(label)))];
    }

    function grantRootRoles(uint256, address) external override returns (bool) { return true; }
    function revokeRootRoles(uint256, address) external override returns (bool) { return true; }
    function grantRoles(uint256, uint256, address) external override returns (bool) { return true; }
    function revokeRoles(uint256, uint256, address) external override returns (bool) { return true; }

    // Helper: mark a label as taken (for "label not available" tests)
    function setRegistered(string calldata label) external {
        uint256 labelHash = uint256(keccak256(bytes(label)));
        _states[labelHash].status = Status.REGISTERED;
        _states[labelHash].tokenId = _nextTokenId++;
    }
}

contract MockResolver is IPermissionedResolver {
    // Track calls for assertions
    struct TextSet { bytes32 node; string key; string value; }
    struct RoleOp  { bytes toName; string key; address account; bool grant; }

    TextSet[] public textSets;
    RoleOp[]  public textRoleOps;

    function setText(bytes32 node, string calldata key, string calldata value)
        external override
    {
        textSets.push(TextSet(node, key, value));
    }

    function authorizeTextRoles(bytes calldata toName, string calldata key, address account, bool grant)
        external override returns (bool)
    {
        textRoleOps.push(RoleOp(toName, key, account, grant));
        return true;
    }

    function authorizeNameRoles(bytes calldata, uint256, address, bool)
        external pure override returns (bool)
    {
        return true;
    }

    function textCount()   external view returns (uint256) { return textSets.length; }
    function grantCount()  external view returns (uint256) {
        uint256 n;
        for (uint256 i; i < textRoleOps.length; i++) if (textRoleOps[i].grant) n++;
        return n;
    }
    function revokeCount() external view returns (uint256) {
        uint256 n;
        for (uint256 i; i < textRoleOps.length; i++) if (!textRoleOps[i].grant) n++;
        return n;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────────────────────

contract VeriRegistrarTest is Test {

    VeriRegistrar registrar;
    MockRegistry  registry;
    MockResolver  resolver;

    // EIP-712 constants — must match VeriRegistrar
    string  constant DOMAIN_NAME    = "VeriRegistrar";
    string  constant DOMAIN_VERSION = "1";
    bytes32 constant ATTESTATION_TYPEHASH = keccak256(
        "Attestation(bytes32 humanId,address userAddress,uint256 deadline)"
    );

    // Test actors
    uint256 attestorPk  = 0xA11CE;
    uint256 human1Pk    = 0xBEEF1;
    uint256 human2Pk    = 0xBEEF2;

    address attestor;
    address human1;
    address human2;

    // Sample humanIds (simulating keccak256(abi.encode(nullifier)))
    bytes32 humanId1 = keccak256(abi.encode(uint256(111)));
    bytes32 humanId2 = keccak256(abi.encode(uint256(222)));

    function setUp() public {
        attestor = vm.addr(attestorPk);
        human1   = vm.addr(human1Pk);
        human2   = vm.addr(human2Pk);

        registry = new MockRegistry();
        resolver = new MockResolver();

        registrar = new VeriRegistrar(
            address(registry),
            attestor,
            address(resolver),
            address(this) // owner = test contract
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────

    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes(DOMAIN_NAME)),
            keccak256(bytes(DOMAIN_VERSION)),
            block.chainid,
            address(registrar)
        ));
    }

    function _signAttestation(
        uint256 signerPk,
        bytes32 humanId,
        address userAddress,
        uint256 deadline
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(ATTESTATION_TYPEHASH, humanId, userAddress, deadline)
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", _domainSeparator(), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _defaultCaps() internal view returns (bytes32[] memory caps) {
        caps = new bytes32[](2);
        caps[0] = registrar.CAP_SELF_DESCRIBE();
        caps[1] = registrar.CAP_ENDPOINT_UPDATE();
    }

    function _issueAgent(
        string memory label,
        address agentAddress,
        bytes32 humanId,
        address humanWallet,
        bytes32[] memory caps
    ) internal returns (uint256 tokenId) {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signAttestation(attestorPk, humanId, humanWallet, deadline);

        vm.prank(humanWallet);
        tokenId = registrar.issueAgent(label, agentAddress, humanId, caps, sig, deadline);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // issueAgent tests
    // ─────────────────────────────────────────────────────────────────────────

    function test_issueAgent_success() public {
        uint256 tokenId = _issueAgent("scanner", address(0xA1), humanId1, human1, _defaultCaps());

        // Token ID returned
        assertGt(tokenId, 0);

        // State stored
        assertEq(registrar.agentToHuman(keccak256("scanner")), humanId1);
        assertEq(registrar.agentHuman(keccak256("scanner")), human1);
        assertEq(registrar.agentAddr(keccak256("scanner")), address(0xA1));
        assertEq(registrar.agentCount(humanId1), 1);

        // Capabilities recorded
        assertTrue(registrar.hasCapability("scanner", registrar.CAP_SELF_DESCRIBE()));
        assertTrue(registrar.hasCapability("scanner", registrar.CAP_ENDPOINT_UPDATE()));
        assertFalse(registrar.hasCapability("scanner", registrar.CAP_TRANSACT()));

        // Resolver.grantRoles called for the two caps with non-zero role bitmaps
        assertEq(resolver.grantCount(), 2);
    }

    function test_issueAgent_emitsAgentIssued() public {
        bytes32 labelHash = keccak256("scanner");
        uint256 deadline  = block.timestamp + 1 hours;
        bytes memory sig  = _signAttestation(attestorPk, humanId1, human1, deadline);
        bytes32[] memory caps = new bytes32[](0);

        vm.prank(human1);
        vm.expectEmit(true, true, true, false);
        emit VeriRegistrar.AgentIssued(labelHash, "scanner", humanId1, address(0xA1), 0, 0);
        registrar.issueAgent("scanner", address(0xA1), humanId1, caps, sig, deadline);
    }

    function test_issueAgent_invalidAttestation_reverts() public {
        uint256 wrongPk   = 0xBAD;
        uint256 deadline  = block.timestamp + 1 hours;
        bytes memory sig  = _signAttestation(wrongPk, humanId1, human1, deadline);
        bytes32[] memory caps = new bytes32[](0);

        vm.prank(human1);
        vm.expectRevert("VR: invalid attestation");
        registrar.issueAgent("scanner", address(0xA1), humanId1, caps, sig, deadline);
    }

    function test_issueAgent_expiredAttestation_reverts() public {
        uint256 deadline = block.timestamp - 1; // already expired
        bytes memory sig = _signAttestation(attestorPk, humanId1, human1, deadline);
        bytes32[] memory caps = new bytes32[](0);

        vm.prank(human1);
        vm.expectRevert("VR: attestation expired");
        registrar.issueAgent("scanner", address(0xA1), humanId1, caps, sig, deadline);
    }

    function test_issueAgent_wrongUserAddress_reverts() public {
        // Attestation signed for human1 but called by human2
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signAttestation(attestorPk, humanId1, human1, deadline); // signed for human1
        bytes32[] memory caps = new bytes32[](0);

        vm.prank(human2); // called by human2
        vm.expectRevert("VR: invalid attestation");
        registrar.issueAgent("scanner", address(0xA1), humanId1, caps, sig, deadline);
    }

    function test_issueAgent_agentCapReached_reverts() public {
        // Issue MAX_AGENTS_PER_HUMAN agents for human1
        uint8 max = registrar.MAX_AGENTS_PER_HUMAN();
        for (uint8 i = 0; i < max; i++) {
            string memory label = string(abi.encodePacked("agent", i));
            _issueAgent(label, address(uint160(i + 1)), humanId1, human1, new bytes32[](0));
        }

        // The (max+1)-th attempt must fail
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signAttestation(attestorPk, humanId1, human1, deadline);
        bytes32[] memory caps = new bytes32[](0);

        vm.prank(human1);
        vm.expectRevert("VR: agent cap reached");
        registrar.issueAgent("overflow", address(0xFF), humanId1, caps, sig, deadline);
    }

    function test_issueAgent_labelNotAvailable_reverts() public {
        // Make the registry report "scanner" as taken
        registry.setRegistered("scanner");

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signAttestation(attestorPk, humanId1, human1, deadline);
        bytes32[] memory caps = new bytes32[](0);

        vm.prank(human1);
        vm.expectRevert("VR: label not available");
        registrar.issueAgent("scanner", address(0xA1), humanId1, caps, sig, deadline);
    }

    function test_issueAgent_setsTextRecords() public {
        _issueAgent("scanner", address(0xA1), humanId1, human1, new bytes32[](0));
        // Two stub records written: agent-context and agent-endpoint[mcp]
        assertEq(resolver.textCount(), 2);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // grantCapability tests
    // ─────────────────────────────────────────────────────────────────────────

    function test_grantCapability_success() public {
        _issueAgent("scanner", address(0xA1), humanId1, human1, new bytes32[](0));

        bytes32 capTransact = registrar.CAP_TRANSACT();
        vm.prank(human1);
        registrar.grantCapability("scanner", capTransact);

        assertTrue(registrar.hasCapability("scanner", registrar.CAP_TRANSACT()));
    }

    function test_grantCapability_emitsEvent() public {
        _issueAgent("scanner", address(0xA1), humanId1, human1, new bytes32[](0));

        bytes32 capTransact = registrar.CAP_TRANSACT();
        vm.prank(human1);
        vm.expectEmit(true, true, false, false);
        emit VeriRegistrar.CapabilityGranted(keccak256("scanner"), capTransact, 0);
        registrar.grantCapability("scanner", capTransact);
    }

    function test_grantCapability_notGuardian_reverts() public {
        _issueAgent("scanner", address(0xA1), humanId1, human1, new bytes32[](0));

        bytes32 capTransact = registrar.CAP_TRANSACT();
        vm.prank(human2); // wrong caller
        vm.expectRevert("VR: not agent guardian");
        registrar.grantCapability("scanner", capTransact);
    }

    function test_grantCapability_alreadyGranted_reverts() public {
        bytes32[] memory caps = new bytes32[](1);
        caps[0] = registrar.CAP_SELF_DESCRIBE();
        _issueAgent("scanner", address(0xA1), humanId1, human1, caps);

        bytes32 capSelf = registrar.CAP_SELF_DESCRIBE();
        vm.prank(human1);
        vm.expectRevert("VR: already granted");
        registrar.grantCapability("scanner", capSelf);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // revokeCapability tests
    // ─────────────────────────────────────────────────────────────────────────

    function test_revokeCapability_success() public {
        bytes32 capSelf = registrar.CAP_SELF_DESCRIBE();
        bytes32[] memory caps = new bytes32[](1);
        caps[0] = capSelf;
        _issueAgent("scanner", address(0xA1), humanId1, human1, caps);

        assertTrue(registrar.hasCapability("scanner", capSelf));

        vm.prank(human1);
        registrar.revokeCapability("scanner", capSelf, "test revoke");

        assertFalse(registrar.hasCapability("scanner", capSelf));
    }

    function test_revokeCapability_callsResolverRevokeRoles() public {
        bytes32 capSelf = registrar.CAP_SELF_DESCRIBE();
        bytes32[] memory caps = new bytes32[](1);
        caps[0] = capSelf; // has non-zero role bitmap
        _issueAgent("scanner", address(0xA1), humanId1, human1, caps);

        uint256 beforeRevokes = resolver.revokeCount();

        vm.prank(human1);
        registrar.revokeCapability("scanner", capSelf, "revoke");

        assertEq(resolver.revokeCount(), beforeRevokes + 1);
    }

    function test_revokeCapability_emitsEvent() public {
        bytes32 capSelf = registrar.CAP_SELF_DESCRIBE();
        bytes32[] memory caps = new bytes32[](1);
        caps[0] = capSelf;
        _issueAgent("scanner", address(0xA1), humanId1, human1, caps);

        vm.prank(human1);
        vm.expectEmit(true, true, false, true);
        emit VeriRegistrar.CapabilityRevoked(keccak256("scanner"), capSelf, "test");
        registrar.revokeCapability("scanner", capSelf, "test");
    }

    function test_revokeCapability_notGranted_reverts() public {
        _issueAgent("scanner", address(0xA1), humanId1, human1, new bytes32[](0));

        bytes32 capSelf = registrar.CAP_SELF_DESCRIBE();
        vm.prank(human1);
        vm.expectRevert("VR: not granted");
        registrar.revokeCapability("scanner", capSelf, "none");
    }

    function test_revokeCapability_notGuardian_reverts() public {
        bytes32 capSelf = registrar.CAP_SELF_DESCRIBE();
        bytes32[] memory caps = new bytes32[](1);
        caps[0] = capSelf;
        _issueAgent("scanner", address(0xA1), humanId1, human1, caps);

        vm.prank(human2);
        vm.expectRevert("VR: not agent guardian");
        registrar.revokeCapability("scanner", capSelf, "x");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // retireAgent tests
    // ─────────────────────────────────────────────────────────────────────────

    function test_retireAgent_success() public {
        _issueAgent("scanner", address(0xA1), humanId1, human1, new bytes32[](0));
        assertEq(registrar.agentCount(humanId1), 1);

        vm.prank(human1);
        registrar.retireAgent("scanner");

        assertEq(registrar.agentCount(humanId1), 0);
        assertEq(registrar.agentToHuman(keccak256("scanner")), bytes32(0));
    }

    function test_retireAgent_emitsEvent() public {
        _issueAgent("scanner", address(0xA1), humanId1, human1, new bytes32[](0));

        vm.prank(human1);
        vm.expectEmit(true, true, false, false);
        emit VeriRegistrar.AgentRetired(keccak256("scanner"), humanId1);
        registrar.retireAgent("scanner");
    }

    function test_retireAgent_freesSlotForNewAgent() public {
        // Issue 5 agents (cap reached) — use explicit labels so retirement lookup matches
        string[5] memory labels = ["slot0", "slot1", "slot2", "slot3", "slot4"];
        for (uint8 i = 0; i < 5; i++) {
            _issueAgent(labels[i], address(uint160(i + 10)), humanId1, human1, new bytes32[](0));
        }
        assertEq(registrar.agentCount(humanId1), 5);

        // Retire one
        vm.prank(human1);
        registrar.retireAgent("slot0");
        assertEq(registrar.agentCount(humanId1), 4);

        // Now issuing a new one should succeed
        _issueAgent("slot-new", address(0xAA), humanId1, human1, new bytes32[](0));
        assertEq(registrar.agentCount(humanId1), 5);
    }

    function test_retireAgent_notGuardian_reverts() public {
        _issueAgent("scanner", address(0xA1), humanId1, human1, new bytes32[](0));

        vm.prank(human2);
        vm.expectRevert("VR: not agent guardian");
        registrar.retireAgent("scanner");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Admin tests
    // ─────────────────────────────────────────────────────────────────────────

    function test_setAttestor_updatesAttestor() public {
        address newAttestor = address(0xBEEFDEAD);
        registrar.setAttestor(newAttestor);
        assertEq(registrar.attestor(), newAttestor);
    }

    function test_setAttestor_nonOwner_reverts() public {
        vm.prank(human1);
        vm.expectRevert();
        registrar.setAttestor(address(0xBEEFDEAD));
    }

    function test_setCapabilityRole_updatesRole() public {
        uint256 newRole = 1 << 20;
        registrar.setCapabilityConfig(
            registrar.CAP_TRANSACT(), VeriRegistrar.CapabilityTarget.REGISTRY, newRole, ""
        );
        (VeriRegistrar.CapabilityTarget target, uint256 roleBitmap, ) =
            registrar.capabilityConfig(registrar.CAP_TRANSACT());
        assertEq(uint8(target), uint8(VeriRegistrar.CapabilityTarget.REGISTRY));
        assertEq(roleBitmap, newRole);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Multi-human isolation
    // ─────────────────────────────────────────────────────────────────────────

    function test_agentCountsArePerHuman() public {
        _issueAgent("h1agent1", address(0xA1), humanId1, human1, new bytes32[](0));
        _issueAgent("h1agent2", address(0xA2), humanId1, human1, new bytes32[](0));
        _issueAgent("h2agent1", address(0xB1), humanId2, human2, new bytes32[](0));

        assertEq(registrar.agentCount(humanId1), 2);
        assertEq(registrar.agentCount(humanId2), 1);
    }
}
