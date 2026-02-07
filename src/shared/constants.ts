// ============================================================
// Sentinel – Protocol Constants
// Single source of truth for all magic numbers and addresses
// ============================================================

import type { Asset, PolicyConfig, TokenInfo } from "./types.js";

// ---- Policy Defaults ----

export const DEFAULT_POLICY: PolicyConfig = {
  /** Max trade size as percent of session balance */
  maxTradePercent: 2,
  /** Max slippage in basis points (50 = 0.5%) */
  maxSlippageBps: 50,
  /** Only Uniswap v4 is allowed */
  allowedDexes: ["uniswap-v4"],
  /** Only USDC and ETH */
  allowedAssets: ["USDC", "ETH"],
} as const;

// ---- Token Registry (Base Sepolia) ----

export const TOKENS: Record<Asset, TokenInfo> = {
  USDC: {
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // Base Sepolia USDC
  },
  ETH: {
    symbol: "ETH",
    name: "Ether",
    decimals: 18,
    address: "0x0000000000000000000000000000000000000000", // native
  },
} as const;

// ---- Chain Config ----

export const CHAIN = {
  name: "Base Sepolia",
  chainId: 84532,
  rpcUrl: "https://sepolia.base.org",
  explorerUrl: "https://sepolia.basescan.org",
} as const;

// ---- Session Defaults ----

export const SESSION = {
  /** Default deposit in USDC (human-readable) */
  defaultDepositUsdc: 1000,
  /** Maximum number of actions per session */
  maxActionsPerSession: 50,
  /** Session timeout in milliseconds (1 hour) */
  timeoutMs: 3_600_000,
} as const;

// ---- Price Feed (mock prices for demo) ----
// STUB: Replace with Chainlink or Uniswap TWAP in production

export const MOCK_PRICES: Record<Asset, number> = {
  USDC: 1.0,
  ETH: 2_500.0,
} as const;

// ---- DEX Identifiers ----

export const DEX = {
  UNISWAP_V4: "uniswap-v4",
} as const;

// ---- ENS ----

export const ENS = {
  agentName: "sentinel-agent.eth",
  policyTextKey: "com.sentinel.policyHash",
} as const;

// ---- Basis Point Helpers ----

export const BPS_DENOMINATOR = 10_000;

export function bpsToPercent(bps: number): number {
  return bps / BPS_DENOMINATOR * 100;
}

export function percentToBps(percent: number): number {
  return percent * BPS_DENOMINATOR / 100;
}
