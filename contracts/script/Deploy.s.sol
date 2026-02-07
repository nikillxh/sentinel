// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {PolicyGuard} from "../src/PolicyGuard.sol";
import {SentinelWallet} from "../src/SentinelWallet.sol";

/// @title Deploy
/// @notice Deploys PolicyGuard and SentinelWallet to the target network.
///
/// Usage:
///   # Local (Anvil)
///   forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
///
///   # Base Sepolia
///   forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast --verify \
///       --etherscan-api-key $ETHERSCAN_API_KEY
contract Deploy is Script {
    // ---- Configuration ----

    // ERC-4337 EntryPoint v0.7 (deployed at the same address on all chains)
    address constant ENTRYPOINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

    // Base Sepolia USDC
    address constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    // Policy limits
    uint256 constant MAX_SETTLEMENT_USDC = 10_000e6;    // 10,000 USDC
    uint256 constant MAX_SETTLEMENT_ETH  = 5 ether;     // 5 ETH

    // Placeholder policy hash (SHA-256 of default off-chain policy config)
    bytes32 constant POLICY_HASH = keccak256("sentinel-default-policy-v1");

    function run() external {
        uint256 deployerKey = vm.envUint("OPERATOR_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console2.log("=== Sentinel Deployment ===");
        console2.log("Deployer:", deployer);
        console2.log("Chain ID:", block.chainid);

        vm.startBroadcast(deployerKey);

        // 1. Deploy PolicyGuard
        address[] memory allowedTokens = new address[](1);
        allowedTokens[0] = USDC;

        PolicyGuard guard = new PolicyGuard(
            deployer,
            MAX_SETTLEMENT_USDC,
            MAX_SETTLEMENT_ETH,
            allowedTokens,
            POLICY_HASH
        );
        console2.log("PolicyGuard deployed at:", address(guard));

        // 2. Deploy SentinelWallet
        SentinelWallet wallet = new SentinelWallet(
            deployer,
            ENTRYPOINT,
            address(guard)
        );
        console2.log("SentinelWallet deployed at:", address(wallet));

        vm.stopBroadcast();

        // 3. Summary
        console2.log("");
        console2.log("=== Deployment Complete ===");
        console2.log("Add these to your .env:");
        console2.log("  SENTINEL_WALLET_ADDRESS=", address(wallet));
        console2.log("  POLICY_GUARD_ADDRESS=", address(guard));
    }
}
