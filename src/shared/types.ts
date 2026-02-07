// ============================================================
// Sentinel – Shared Type Definitions
// All core types used across the protocol
// ============================================================

// ---- Assets & Tokens ----

/** Supported assets in the Sentinel protocol */
export type Asset = "USDC" | "ETH";

/** Token metadata keyed by asset symbol */
export interface TokenInfo {
  symbol: Asset;
  name: string;
  decimals: number;
  /** Contract address on target chain (zero address for native ETH) */
  address: `0x${string}`;
}

// ---- Swap Types ----

/** A swap proposal submitted by the AI agent via MCP */
export interface SwapProposal {
  id: string;
  tokenIn: Asset;
  tokenOut: Asset;
  amountIn: number;
  /** Estimated output from simulation */
  estimatedAmountOut: number;
  /** Slippage in basis points (e.g. 50 = 0.5%) */
  maxSlippageBps: number;
  /** Target DEX for execution */
  dex: string;
  /** ISO timestamp of proposal creation */
  timestamp: string;
}

/** Result of a swap simulation (pre-policy) */
export interface SwapSimulation {
  tokenIn: Asset;
  tokenOut: Asset;
  amountIn: number;
  estimatedAmountOut: number;
  priceImpactBps: number;
  route: string;
  /** Gas estimate if on-chain (0 for off-chain) */
  estimatedGas: bigint;
}

/** Result after swap execution */
export interface SwapResult {
  proposalId: string;
  success: boolean;
  amountIn: number;
  amountOut: number;
  executedPrice: number;
  /** "offchain" during session, "onchain" at settlement */
  executionType: "offchain" | "onchain";
  timestamp: string;
}

// ---- Policy Types ----

/** A rule evaluated by the policy engine */
export interface PolicyRule {
  id: string;
  name: string;
  description: string;
}

/** Result of a single policy rule evaluation */
export interface PolicyRuleResult {
  rule: PolicyRule;
  passed: boolean;
  /** Human-readable reason for rejection */
  reason?: string;
  /** The checked value vs the limit */
  details?: {
    value: number | string;
    limit: number | string;
  };
}

/** Aggregate decision from the policy engine */
export interface PolicyDecision {
  approved: boolean;
  /** All rule evaluations (both passed and failed) */
  results: PolicyRuleResult[];
  /** ISO timestamp of evaluation */
  evaluatedAt: string;
  /** Hash of the policy config used (for ENS anchoring) */
  policyHash: string;
}

/** The full policy configuration */
export interface PolicyConfig {
  maxTradePercent: number;
  maxSlippageBps: number;
  allowedDexes: string[];
  allowedAssets: Asset[];
}

// ---- Session Types ----

/** Current state of a Yellow/Nitrolite session */
export type SessionStatus =
  | "opening"
  | "active"
  | "closing"
  | "settled"
  | "error";

/** Balance of a single asset in the session */
export interface SessionBalance {
  asset: Asset;
  /** Current balance (human-readable units) */
  amount: number;
  /** Balance at session open */
  initialAmount: number;
  /** Net change since session open */
  pnl: number;
}

/** Full session state */
export interface SessionState {
  sessionId: string;
  status: SessionStatus;
  balances: Map<Asset, SessionBalance>;
  /** Ordered list of executed swaps */
  history: SwapResult[];
  /** Session open timestamp */
  openedAt: string;
  /** Session close timestamp (if closed) */
  closedAt?: string;
  /** On-chain settlement tx hash (if settled) */
  settlementTxHash?: string;
}

// ---- On-Chain Types ----

/** Settlement record emitted as an event */
export interface SettlementRecord {
  sessionId: string;
  wallet: `0x${string}`;
  balances: { asset: Asset; amount: number }[];
  txHash: `0x${string}`;
  blockNumber: number;
  timestamp: string;
}

// ---- ENS Types ----

export interface AgentIdentity {
  ensName: string;
  resolvedAddress?: `0x${string}`;
  policyHash?: string;
  /** Text records stored on ENS */
  metadata: Record<string, string>;
}

// ---- MCP Tool Responses ----

export interface ToolResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  /** Policy decision attached to every action */
  policyDecision?: PolicyDecision;
  timestamp: string;
}
