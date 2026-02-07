// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {SentinelWallet} from "../src/SentinelWallet.sol";
import {ISentinelWallet} from "../src/interfaces/ISentinelWallet.sol";
import {PolicyGuard} from "../src/PolicyGuard.sol";
import {IPolicyGuard} from "../src/interfaces/IPolicyGuard.sol";

contract SentinelWalletTest is Test {
    SentinelWallet public wallet;
    PolicyGuard public guard;

    address public owner;
    uint256 public ownerKey;
    address public entryPoint = makeAddr("entrypoint");
    address public usdc = makeAddr("usdc");
    address public attacker = makeAddr("attacker");

    bytes32 public policyHash = keccak256("sentinel-policy-v1");

    function setUp() public {
        (owner, ownerKey) = makeAddrAndKey("owner");

        // Deploy PolicyGuard
        address[] memory allowedTokens = new address[](1);
        allowedTokens[0] = usdc;

        guard = new PolicyGuard(
            owner,
            10_000e6,
            10 ether,
            allowedTokens,
            policyHash
        );

        // Deploy Wallet
        wallet = new SentinelWallet(owner, entryPoint, address(guard));

        // Fund the wallet with ETH
        vm.deal(address(wallet), 100 ether);
    }

    // ---- Constructor ----

    function test_constructor() public view {
        assertEq(wallet.owner(), owner);
        assertEq(wallet.entryPoint(), entryPoint);
        assertEq(wallet.policyGuard(), address(guard));
        assertEq(wallet.getNonce(), 0);
    }

    // ---- Receive ETH ----

    function test_receive_eth() public {
        vm.expectEmit(true, false, false, true);
        emit ISentinelWallet.Received(address(this), 1 ether);

        (bool success,) = address(wallet).call{value: 1 ether}("");
        assertTrue(success);
        assertEq(wallet.getEthBalance(), 101 ether);
    }

    // ---- Execute ----

    function test_execute_owner() public {
        address target = makeAddr("target");
        vm.deal(address(wallet), 10 ether);

        vm.prank(owner);
        vm.expectEmit(true, false, false, true);
        emit ISentinelWallet.Executed(target, 1 ether, "");

        wallet.execute(target, 1 ether, "");
        assertEq(target.balance, 1 ether);
        assertEq(wallet.getNonce(), 1);
    }

    function test_execute_entrypoint() public {
        address target = makeAddr("target");

        vm.prank(entryPoint);
        wallet.execute(target, 1 ether, "");
        assertEq(target.balance, 1 ether);
    }

    function test_execute_revert_unauthorized() public {
        vm.prank(attacker);
        vm.expectRevert("SentinelWallet: not entrypoint or owner");
        wallet.execute(makeAddr("target"), 0, "");
    }

    // ---- Execute Batch ----

    function test_executeBatch() public {
        address target1 = makeAddr("target1");
        address target2 = makeAddr("target2");

        address[] memory targets = new address[](2);
        targets[0] = target1;
        targets[1] = target2;

        uint256[] memory values = new uint256[](2);
        values[0] = 1 ether;
        values[1] = 2 ether;

        bytes[] memory datas = new bytes[](2);
        datas[0] = "";
        datas[1] = "";

        vm.prank(owner);
        wallet.executeBatch(targets, values, datas);

        assertEq(target1.balance, 1 ether);
        assertEq(target2.balance, 2 ether);
        assertEq(wallet.getNonce(), 2);
    }

    function test_executeBatch_revert_lengthMismatch() public {
        address[] memory targets = new address[](2);
        uint256[] memory values = new uint256[](1); // mismatch
        bytes[] memory datas = new bytes[](2);

        vm.prank(owner);
        vm.expectRevert("SentinelWallet: length mismatch");
        wallet.executeBatch(targets, values, datas);
    }

    // ---- Settle Session ----

    function test_settleSession_success() public {
        bytes32 sessionId = keccak256("session-1");

        vm.prank(owner);
        vm.expectEmit(true, true, false, true);
        emit ISentinelWallet.SessionSettled(
            sessionId,
            owner,
            1000e6,
            0.5 ether,
            block.timestamp
        );

        wallet.settleSession(sessionId, usdc, 1000e6, 0.5 ether);

        // Session should be marked as settled
        assertTrue(guard.settledSessions(sessionId));
    }

    function test_settleSession_revert_exceeds_max() public {
        bytes32 sessionId = keccak256("session-big");

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(IPolicyGuard.ExceedsMaxSettlement.selector, 20_000e6, 10_000e6)
        );
        wallet.settleSession(sessionId, usdc, 20_000e6, 0);
    }

    function test_settleSession_revert_replay() public {
        bytes32 sessionId = keccak256("session-replay");

        vm.prank(owner);
        wallet.settleSession(sessionId, usdc, 100e6, 0);

        // Replay should fail
        vm.prank(owner);
        vm.expectRevert("Session already settled");
        wallet.settleSession(sessionId, usdc, 100e6, 0);
    }

    function test_settleSession_revert_unauthorized() public {
        bytes32 sessionId = keccak256("session-hack");

        vm.prank(attacker);
        vm.expectRevert("SentinelWallet: not entrypoint or owner");
        wallet.settleSession(sessionId, usdc, 100e6, 0);
    }

    // ---- ValidateUserOp ----

    function test_validateUserOp_validSignature() public {
        bytes32 userOpHash = keccak256("userop-1");

        // Sign with owner key
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(
            ownerKey,
            keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", userOpHash))
        );
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(entryPoint);
        uint256 result = wallet.validateUserOp(userOpHash, signature);
        assertEq(result, 0); // success
    }

    function test_validateUserOp_invalidSignature() public {
        bytes32 userOpHash = keccak256("userop-1");

        // Sign with wrong key
        (, uint256 wrongKey) = makeAddrAndKey("wrong");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(
            wrongKey,
            keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", userOpHash))
        );
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(entryPoint);
        uint256 result = wallet.validateUserOp(userOpHash, signature);
        assertEq(result, 1); // failure
    }

    function test_validateUserOp_revert_notEntryPoint() public {
        vm.prank(attacker);
        vm.expectRevert("SentinelWallet: not from entrypoint");
        wallet.validateUserOp(bytes32(0), "");
    }

    // ---- Nonce ----

    function test_nonce_increments() public {
        assertEq(wallet.getNonce(), 0);

        vm.prank(owner);
        wallet.execute(makeAddr("t"), 0, "");
        assertEq(wallet.getNonce(), 1);

        vm.prank(owner);
        wallet.execute(makeAddr("t2"), 0, "");
        assertEq(wallet.getNonce(), 2);
    }
}
