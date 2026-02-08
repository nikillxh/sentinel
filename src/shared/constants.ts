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

// ---- ENS (Ethereum Mainnet) ----

export const ENS = {
  agentName: "sentinel-agent.eth",
  policyTextKey: "com.sentinel.policyHash",
  /** ENS Registry — same on mainnet + most chains */
  registryAddress: "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e",
} as const;

// ---- Uniswap v4 (Base Sepolia) ----
// From: https://github.com/Uniswap/sdks/blob/main/sdks/sdk-core/src/addresses.ts

export const UNISWAP_V4 = {
  /** Singleton PoolManager contract */
  poolManagerAddress: "0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408",
  /** V4Quoter for quoting swaps */
  quoterAddress: "0x4a6513c898fe1b2d0e78d3b0e0a4a151589b1cba",
  /** StateView for reading pool state */
  stateViewAddress: "0x571291b572ed32ce6751a2cb2486ebee8defb9b4",
  /** PositionManager for liquidity management */
  positionManagerAddress: "0x4b2c77d209d3405f41a037ec6c77f7f5b8e2ca80",
  /** SwapRouter02 */
  swapRouter02Address: "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4",
  /** V3 Quoter (fallback) */
  v3QuoterAddress: "0xC5290058841028F1614F3A6F0F5816cAd0df5E27",
} as const;

// ---- Nitrolite / Yellow Network (Base Sepolia) ----
// From: https://github.com/layer-3/clearsync/tree/main/deployments

export const NITROLITE = {
  /** Custody contract — deposits go here */
  custodyAddress: "0x019B65A265EB3363822f2752141b3dF16131b262",
  /** SimpleConsensus adjudicator — dispute resolution */
  adjudicatorAddress: "0x7c7ccbc98469190849BCC6c926307794fDfB11F2",
  /** ClearNode WebSocket endpoint */
  clearNodeUrl: "wss://clearnet.yellow.com/ws",
  /** Yellow Network app for channel creation */
  appUrl: "https://apps.yellow.com",
} as const;

// ---- Basis Point Helpers ----

export const BPS_DENOMINATOR = 10_000;

export function bpsToPercent(bps: number): number {
  return bps / BPS_DENOMINATOR * 100;
}

export function percentToBps(percent: number): number {
  return percent * BPS_DENOMINATOR / 100;
}
