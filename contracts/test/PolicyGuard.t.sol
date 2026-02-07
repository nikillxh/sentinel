// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {PolicyGuard} from "../src/PolicyGuard.sol";
import {IPolicyGuard} from "../src/interfaces/IPolicyGuard.sol";

contract PolicyGuardTest is Test {
    PolicyGuard public guard;
    address public owner = makeAddr("owner");
    address public usdc = makeAddr("usdc");
    address public weth = makeAddr("weth");
    bytes32 public policyHash = keccak256("sentinel-policy-v1");

    function setUp() public {
        address[] memory allowedTokens = new address[](2);
        allowedTokens[0] = usdc;
        allowedTokens[1] = weth;

        vm.prank(owner);
        guard = new PolicyGuard(
            owner,
            10_000e6,   // max 10,000 USDC settlement
            10 ether,   // max 10 ETH settlement
            allowedTokens,
            policyHash
        );
    }

    // ---- Initialization ----

    function test_constructor() public view {
        assertEq(guard.owner(), owner);
        assertEq(guard.maxSettlementUsdc(), 10_000e6);
        assertEq(guard.maxSettlementEth(), 10 ether);
        assertEq(guard.policyHash(), policyHash);
        assertTrue(guard.isTokenAllowed(usdc));
        assertTrue(guard.isTokenAllowed(weth));
    }

    function test_getPolicy() public view {
        IPolicyGuard.PolicyConfig memory config = guard.getPolicy();
        assertEq(config.maxSettlementUsdc, 10_000e6);
        assertEq(config.maxSettlementEth, 10 ether);
        assertEq(config.allowedTokens.length, 2);
        assertEq(config.policyHash, policyHash);
    }

    // ---- Validate Settlement ----

    function test_validateSettlement_valid() public view {
        bytes32 sessionId = keccak256("session-1");
        bool valid = guard.validateSettlement(sessionId, usdc, 1000e6, 0.5 ether);
        assertTrue(valid);
    }

    function test_validateSettlement_revert_exceedsMaxUsdc() public {
        bytes32 sessionId = keccak256("session-1");
        vm.expectRevert(
            abi.encodeWithSelector(IPolicyGuard.ExceedsMaxSettlement.selector, 20_000e6, 10_000e6)
        );
        guard.validateSettlement(sessionId, usdc, 20_000e6, 0);
    }

    function test_validateSettlement_revert_exceedsMaxEth() public {
        bytes32 sessionId = keccak256("session-1");
        vm.expectRevert(
            abi.encodeWithSelector(IPolicyGuard.ExceedsMaxSettlement.selector, 20 ether, 10 ether)
        );
        guard.validateSettlement(sessionId, usdc, 0, 20 ether);
    }

    function test_validateSettlement_revert_tokenNotAllowed() public {
        bytes32 sessionId = keccak256("session-1");
        address badToken = makeAddr("bad-token");
        vm.expectRevert(
            abi.encodeWithSelector(IPolicyGuard.AssetNotAllowed.selector, badToken)
        );
        guard.validateSettlement(sessionId, badToken, 1000e6, 0);
    }

    function test_validateSettlement_revert_sessionAlreadySettled() public {
        bytes32 sessionId = keccak256("session-1");

        // First settlement passes
        guard.validateSettlement(sessionId, usdc, 1000e6, 0);
        guard.markSettled(sessionId);

        // Second attempt should revert
        vm.expectRevert("Session already settled");
        guard.validateSettlement(sessionId, usdc, 1000e6, 0);
    }

    function test_validateSettlement_zeroAmounts() public view {
        bytes32 sessionId = keccak256("session-zero");
        // Zero amounts should be valid (no-op settlement)
        bool valid = guard.validateSettlement(sessionId, usdc, 0, 0);
        assertTrue(valid);
    }

    // ---- Mark Settled ----

    function test_markSettled() public {
        bytes32 sessionId = keccak256("session-1");
        assertFalse(guard.settledSessions(sessionId));

        guard.markSettled(sessionId);
        assertTrue(guard.settledSessions(sessionId));
    }

    // ---- Policy Update ----

    function test_updatePolicy() public {
        address newToken = makeAddr("new-token");
        address[] memory newTokens = new address[](1);
        newTokens[0] = newToken;

        bytes32 newHash = keccak256("sentinel-policy-v2");

        IPolicyGuard.PolicyConfig memory newConfig = IPolicyGuard.PolicyConfig({
            maxSettlementUsdc: 50_000e6,
            maxSettlementEth: 50 ether,
            allowedTokens: newTokens,
            policyHash: newHash
        });

        vm.prank(owner);
        guard.updatePolicy(newConfig);

        assertEq(guard.maxSettlementUsdc(), 50_000e6);
        assertEq(guard.maxSettlementEth(), 50 ether);
        assertEq(guard.policyHash(), newHash);
        assertTrue(guard.isTokenAllowed(newToken));
        assertFalse(guard.isTokenAllowed(usdc)); // old token removed
    }

    function test_updatePolicy_revert_notOwner() public {
        address attacker = makeAddr("attacker");
        address[] memory tokens = new address[](0);

        IPolicyGuard.PolicyConfig memory newConfig = IPolicyGuard.PolicyConfig({
            maxSettlementUsdc: 999_999e6,
            maxSettlementEth: 999 ether,
            allowedTokens: tokens,
            policyHash: bytes32(0)
        });

        vm.prank(attacker);
        vm.expectRevert();
        guard.updatePolicy(newConfig);
    }

    // ---- Events ----

    function test_emits_PolicyUpdated_on_deploy() public {
        address[] memory tokens = new address[](1);
        tokens[0] = usdc;
        bytes32 hash = keccak256("new-deploy");

        vm.expectEmit(false, false, false, true);
        emit IPolicyGuard.PolicyUpdated(bytes32(0), hash, block.timestamp);

        new PolicyGuard(owner, 1000e6, 1 ether, tokens, hash);
    }
}
