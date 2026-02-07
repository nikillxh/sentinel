// ============================================================
// Sentinel – Contract ABIs
// Extracted from Foundry compilation output.
// These are the minimal ABIs needed for TypeScript interaction.
// ============================================================

export const SENTINEL_WALLET_ABI = [
  // Events
  "event SessionSettled(bytes32 indexed sessionId, address indexed operator, uint256 usdcDelta, uint256 ethDelta, uint256 timestamp)",
  "event UserOpExecuted(address indexed sender, uint256 nonce, bool success)",
  "event Executed(address indexed target, uint256 value, bytes data)",
  "event Received(address indexed sender, uint256 amount)",

  // Core functions
  "function execute(address target, uint256 value, bytes calldata data) external",
  "function executeBatch(address[] calldata targets, uint256[] calldata values, bytes[] calldata datas) external",
  "function settleSession(bytes32 sessionId, address usdcToken, uint256 usdcAmount, uint256 ethAmount) external",
  "function validateUserOp(bytes32 userOpHash, bytes calldata signature) external view returns (uint256)",

  // View functions
  "function owner() external view returns (address)",
  "function entryPoint() external view returns (address)",
  "function policyGuard() external view returns (address)",
  "function getNonce() external view returns (uint256)",
  "function getUsdcBalance(address usdcToken) external view returns (uint256)",
  "function getEthBalance() external view returns (uint256)",
] as const;

export const POLICY_GUARD_ABI = [
  // Events
  "event SettlementApproved(bytes32 indexed sessionId, uint256 usdcAmount, uint256 ethAmount, bytes32 policyHash)",
  "event SettlementRejected(bytes32 indexed sessionId, string reason)",
  "event PolicyUpdated(bytes32 oldPolicyHash, bytes32 newPolicyHash, uint256 timestamp)",

  // Core functions
  "function validateSettlement(bytes32 sessionId, address usdcToken, uint256 usdcAmount, uint256 ethAmount) external view returns (bool)",
  "function markSettled(bytes32 sessionId) external",
  "function updatePolicy(tuple(uint256 maxSettlementUsdc, uint256 maxSettlementEth, address[] allowedTokens, bytes32 policyHash) newPolicy) external",

  // View functions
  "function owner() external view returns (address)",
  "function maxSettlementUsdc() external view returns (uint256)",
  "function maxSettlementEth() external view returns (uint256)",
  "function policyHash() external view returns (bytes32)",
  "function settledSessions(bytes32) external view returns (bool)",
  "function isTokenAllowed(address token) external view returns (bool)",
  "function getPolicy() external view returns (tuple(uint256 maxSettlementUsdc, uint256 maxSettlementEth, address[] allowedTokens, bytes32 policyHash))",
] as const;

export const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
] as const;
