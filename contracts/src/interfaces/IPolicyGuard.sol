// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IPolicyGuard
/// @notice Interface for the on-chain policy enforcement contract
interface IPolicyGuard {
    // ---- Events ----

    /// @notice Emitted when a settlement passes policy checks
    event SettlementApproved(
        bytes32 indexed sessionId,
        uint256 usdcAmount,
        uint256 ethAmount,
        bytes32 policyHash
    );

    /// @notice Emitted when a settlement is rejected by policy
    event SettlementRejected(
        bytes32 indexed sessionId,
        string reason
    );

    /// @notice Emitted when the policy configuration is updated
    event PolicyUpdated(
        bytes32 oldPolicyHash,
        bytes32 newPolicyHash,
        uint256 timestamp
    );

    // ---- Errors ----

    error ExceedsMaxSettlement(uint256 amount, uint256 max);
    error AssetNotAllowed(address token);
    error PolicyHashMismatch(bytes32 expected, bytes32 actual);
    error Unauthorized();

    // ---- Structs ----

    struct PolicyConfig {
        /// @notice Maximum USDC that can be settled in a single session
        uint256 maxSettlementUsdc;
        /// @notice Maximum ETH that can be settled in a single session
        uint256 maxSettlementEth;
        /// @notice List of allowed ERC-20 token addresses
        address[] allowedTokens;
        /// @notice SHA-256 hash of the off-chain policy config
        bytes32 policyHash;
    }

    // ---- Functions ----

    /// @notice Validate a settlement against on-chain policy rules
    function validateSettlement(
        bytes32 sessionId,
        address usdcToken,
        uint256 usdcAmount,
        uint256 ethAmount
    ) external view returns (bool);

    /// @notice Get the current policy configuration
    function getPolicy() external view returns (PolicyConfig memory);

    /// @notice Update the policy configuration (owner only)
    function updatePolicy(PolicyConfig calldata newPolicy) external;

    /// @notice Check if a token is allowed
    function isTokenAllowed(address token) external view returns (bool);
}
