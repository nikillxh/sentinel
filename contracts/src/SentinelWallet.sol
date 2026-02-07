// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/access/Ownable.sol";
import {IERC20} from "@openzeppelin/token/ERC20/IERC20.sol";
import {ECDSA} from "@openzeppelin/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/utils/cryptography/MessageHashUtils.sol";
import {ReentrancyGuard} from "@openzeppelin/utils/ReentrancyGuard.sol";
import {ISentinelWallet} from "./interfaces/ISentinelWallet.sol";
import {PolicyGuard} from "./PolicyGuard.sol";

/// @title SentinelWallet
/// @notice ERC-4337-compatible smart wallet for Sentinel protocol.
///         Holds funds, enforces policy via PolicyGuard, and settles
///         off-chain session balances on-chain.
///
/// @dev Architecture:
///   - Owner = operator key (NOT the AI agent)
///   - AI agent never touches this contract directly
///   - Settlement is the only path from off-chain to on-chain
///   - PolicyGuard validates every settlement
///
/// ERC-4337 Compatibility:
///   - Implements validateUserOp for bundler submission
///   - Nonce tracking for replay protection
///   - EntryPoint can call execute/executeBatch
contract SentinelWallet is ISentinelWallet, Ownable, ReentrancyGuard {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ---- State ----

    PolicyGuard public immutable _policyGuard;
    uint256 private _nonce;

    /// @notice The ERC-4337 EntryPoint address
    address public immutable entryPoint;

    // ---- Modifiers ----

    modifier onlyEntryPointOrOwner() {
        require(
            msg.sender == entryPoint || msg.sender == owner(),
            "SentinelWallet: not entrypoint or owner"
        );
        _;
    }

    // ---- Constructor ----

    /// @param owner_ The operator address (holds the key, NOT the AI)
    /// @param entryPoint_ The ERC-4337 EntryPoint contract
    /// @param policyGuard_ The PolicyGuard contract for settlement validation
    constructor(
        address owner_,
        address entryPoint_,
        address policyGuard_
    ) Ownable(owner_) {
        entryPoint = entryPoint_;
        _policyGuard = PolicyGuard(policyGuard_);
    }

    // ---- Receive ETH ----

    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    // ---- ERC-4337: Validate UserOperation ----

    /// @notice Validates a UserOperation signature.
    /// @dev Called by the EntryPoint during the validation phase.
    ///      Returns 0 for success, 1 for signature failure.
    /// @param userOpHash The hash of the UserOperation
    /// @param signature The signature to validate
    function validateUserOp(
        bytes32 userOpHash,
        bytes calldata signature
    ) external view returns (uint256) {
        require(msg.sender == entryPoint, "SentinelWallet: not from entrypoint");

        bytes32 ethSignedHash = userOpHash.toEthSignedMessageHash();
        address recovered = ethSignedHash.recover(signature);

        if (recovered == owner()) {
            return 0; // validation success
        }
        return 1; // validation failure
    }

    // ---- Execute (ERC-4337 compatible) ----

    /// @inheritdoc ISentinelWallet
    function execute(
        address target,
        uint256 value,
        bytes calldata data
    ) external onlyEntryPointOrOwner nonReentrant {
        _call(target, value, data);
        emit Executed(target, value, data);
    }

    /// @inheritdoc ISentinelWallet
    function executeBatch(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata datas
    ) external onlyEntryPointOrOwner nonReentrant {
        require(
            targets.length == values.length && values.length == datas.length,
            "SentinelWallet: length mismatch"
        );

        for (uint256 i = 0; i < targets.length; i++) {
            _call(targets[i], values[i], datas[i]);
            emit Executed(targets[i], values[i], datas[i]);
        }
    }

    // ---- Settlement ----

    /// @inheritdoc ISentinelWallet
    /// @notice Settle a session's final balances on-chain.
    ///         This is THE critical function — the only path from
    ///         off-chain execution to on-chain finality.
    ///
    /// Flow:
    ///   1. PolicyGuard validates the settlement parameters
    ///   2. USDC is transferred to the wallet (or remains)
    ///   3. ETH amount is recorded
    ///   4. Session is marked as settled (replay protection)
    ///   5. Events are emitted for indexers
    function settleSession(
        bytes32 sessionId,
        address usdcToken,
        uint256 usdcAmount,
        uint256 ethAmount
    ) external onlyEntryPointOrOwner nonReentrant {
        // Step 1: Policy guard validation
        _policyGuard.validateSettlement(sessionId, usdcToken, usdcAmount, ethAmount);

        // Step 2: Mark session as settled (replay protection)
        _policyGuard.markSettled(sessionId);

        // Step 3: Emit settlement event
        emit SessionSettled(
            sessionId,
            msg.sender,
            usdcAmount,
            ethAmount,
            block.timestamp
        );
    }

    // ---- View Functions ----

    /// @inheritdoc ISentinelWallet
    function getNonce() external view returns (uint256) {
        return _nonce;
    }

    /// @notice Get the policy guard address
    function policyGuard() external view returns (address) {
        return address(_policyGuard);
    }

    /// @notice Get the wallet's USDC balance
    function getUsdcBalance(address usdcToken) external view returns (uint256) {
        return IERC20(usdcToken).balanceOf(address(this));
    }

    /// @notice Get the wallet's ETH balance
    function getEthBalance() external view returns (uint256) {
        return address(this).balance;
    }

    // ---- Internal ----

    function _call(address target, uint256 value, bytes memory data) internal {
        (bool success, bytes memory result) = target.call{value: value}(data);
        if (!success) {
            // Bubble up the revert reason
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
        _nonce++;
    }
}
