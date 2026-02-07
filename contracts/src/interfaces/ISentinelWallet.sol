// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ISentinelWallet
/// @notice Interface for the Sentinel ERC-4337 compatible smart wallet
interface ISentinelWallet {
    // ---- Events ----

    /// @notice Emitted when a session is settled on-chain
    event SessionSettled(
        bytes32 indexed sessionId,
        address indexed operator,
        uint256 usdcDelta,
        uint256 ethDelta,
        uint256 timestamp
    );

    /// @notice Emitted when a UserOperation is executed
    event UserOpExecuted(address indexed sender, uint256 nonce, bool success);

    /// @notice Emitted when the wallet executes a call
    event Executed(address indexed target, uint256 value, bytes data);

    /// @notice Emitted when ETH is received
    event Received(address indexed sender, uint256 amount);

    // ---- Core Functions ----

    /// @notice Execute a single call from the wallet
    function execute(address target, uint256 value, bytes calldata data) external;

    /// @notice Execute a batch of calls from the wallet
    function executeBatch(address[] calldata targets, uint256[] calldata values, bytes[] calldata datas) external;

    /// @notice Settle a session's final balances on-chain
    function settleSession(
        bytes32 sessionId,
        address usdcToken,
        uint256 usdcAmount,
        uint256 ethAmount
    ) external;

    /// @notice Get the wallet nonce (ERC-4337)
    function getNonce() external view returns (uint256);
}
