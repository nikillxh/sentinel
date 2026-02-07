// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/access/Ownable.sol";
import {IERC20} from "@openzeppelin/token/ERC20/IERC20.sol";
import {IPolicyGuard} from "./interfaces/IPolicyGuard.sol";

/// @title PolicyGuard
/// @notice On-chain policy enforcement for Sentinel settlement.
///         This is the final safety net — even if the off-chain policy
///         engine is compromised, settlements must pass these checks.
/// @dev Deployed independently, referenced by SentinelWallet.
contract PolicyGuard is IPolicyGuard, Ownable {
    // ---- State ----

    uint256 public maxSettlementUsdc;
    uint256 public maxSettlementEth;
    bytes32 public policyHash;

    mapping(address => bool) private _allowedTokens;
    address[] private _allowedTokenList;

    /// @notice Track settled sessions to prevent replay
    mapping(bytes32 => bool) public settledSessions;

    // ---- Constructor ----

    constructor(
        address owner_,
        uint256 maxUsdc_,
        uint256 maxEth_,
        address[] memory allowedTokens_,
        bytes32 policyHash_
    ) Ownable(owner_) {
        maxSettlementUsdc = maxUsdc_;
        maxSettlementEth = maxEth_;
        policyHash = policyHash_;

        for (uint256 i = 0; i < allowedTokens_.length; i++) {
            _allowedTokens[allowedTokens_[i]] = true;
        }
        _allowedTokenList = allowedTokens_;

        emit PolicyUpdated(bytes32(0), policyHash_, block.timestamp);
    }

    // ---- Core: Validate Settlement ----

    /// @inheritdoc IPolicyGuard
    function validateSettlement(
        bytes32 sessionId,
        address usdcToken,
        uint256 usdcAmount,
        uint256 ethAmount
    ) external view returns (bool) {
        // Rule 1: Session must not have been settled before
        require(!settledSessions[sessionId], "Session already settled");

        // Rule 2: USDC amount within limits
        if (usdcAmount > maxSettlementUsdc) {
            revert ExceedsMaxSettlement(usdcAmount, maxSettlementUsdc);
        }

        // Rule 3: ETH amount within limits
        if (ethAmount > maxSettlementEth) {
            revert ExceedsMaxSettlement(ethAmount, maxSettlementEth);
        }

        // Rule 4: Token must be allowed
        if (usdcAmount > 0 && !_allowedTokens[usdcToken]) {
            revert AssetNotAllowed(usdcToken);
        }

        return true;
    }

    /// @notice Mark a session as settled (called by SentinelWallet)
    function markSettled(bytes32 sessionId) external {
        // In production, restrict to only the SentinelWallet
        settledSessions[sessionId] = true;
    }

    // ---- Policy Management ----

    /// @inheritdoc IPolicyGuard
    function updatePolicy(PolicyConfig calldata newPolicy) external onlyOwner {
        bytes32 oldHash = policyHash;

        maxSettlementUsdc = newPolicy.maxSettlementUsdc;
        maxSettlementEth = newPolicy.maxSettlementEth;
        policyHash = newPolicy.policyHash;

        // Reset allowed tokens
        for (uint256 i = 0; i < _allowedTokenList.length; i++) {
            _allowedTokens[_allowedTokenList[i]] = false;
        }
        delete _allowedTokenList;

        for (uint256 i = 0; i < newPolicy.allowedTokens.length; i++) {
            _allowedTokens[newPolicy.allowedTokens[i]] = true;
        }
        _allowedTokenList = newPolicy.allowedTokens;

        emit PolicyUpdated(oldHash, newPolicy.policyHash, block.timestamp);
    }

    // ---- View Functions ----

    /// @inheritdoc IPolicyGuard
    function getPolicy() external view returns (PolicyConfig memory) {
        return PolicyConfig({
            maxSettlementUsdc: maxSettlementUsdc,
            maxSettlementEth: maxSettlementEth,
            allowedTokens: _allowedTokenList,
            policyHash: policyHash
        });
    }

    /// @inheritdoc IPolicyGuard
    function isTokenAllowed(address token) external view returns (bool) {
        return _allowedTokens[token];
    }
}
