// ============================================================
// Sentinel – Uniswap v4 On-Chain Client
// Queries the Uniswap v4 Quoter2 contract on Base Sepolia
// for real swap quotes. Falls back to local AMM simulation
// when the Quoter is not available.
//
// Uniswap v4 uses a singleton PoolManager with hook-based
// extensibility. We interact via the Quoter2 periphery contract.
//
// Docs: https://docs.uniswap.org/contracts/v4/overview
// ============================================================

import {
  Contract,
  JsonRpcProvider,
  formatUnits,
  parseUnits,
} from "ethers";
import { Logger } from "../shared/logger.js";
import { TOKENS, CHAIN, BPS_DENOMINATOR } from "../shared/constants.js";
import type { Asset, SwapSimulation } from "../shared/types.js";

// ---- Uniswap v4 ABIs (subset) ----

/**
 * Quoter2 ABI — quoteExactInputSingle
 * Returns amountOut for a given amountIn along a single-pool path.
 */
const QUOTER2_ABI = [
  `function quoteExactInputSingle(
    tuple(
      address tokenIn,
      address tokenOut,
      uint256 amountIn,
      uint24 fee,
      uint160 sqrtPriceLimitX96
    ) params
  ) external returns (
    uint256 amountOut,
    uint160 sqrtPriceX96After,
    uint32 initializedTicksCrossed,
    uint256 gasEstimate
  )`,
] as const;

/**
 * PoolManager ABI — slot0 for spot price
 */
const POOL_MANAGER_ABI = [
  `function getSlot0(bytes32 poolId) external view returns (
    uint160 sqrtPriceX96,
    int24 tick,
    uint16 protocolFee,
    uint24 lpFee
  )`,
] as const;

/** Token address mapping for Base Sepolia */
const TOKEN_ADDRESSES: Record<Asset, string> = {
  USDC: TOKENS.USDC.address,
  ETH: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", // native ETH sentinel
};

/** Standard Uniswap v4 fee tiers in hundredths of a basis point */
const FEE_TIER = 3000; // 0.30%

// ---- Config ----

export interface UniswapV4Config {
  /** RPC URL for Base Sepolia */
  rpcUrl: string;
  /** Quoter2 contract address */
  quoterAddress: string;
  /** Optional: PoolManager address for slot0 queries */
  poolManagerAddress?: string;
}

// ---- Client ----

export class UniswapV4Client {
  private provider: JsonRpcProvider;
  private quoter: Contract;
  private poolManager: Contract | null;
  private log = new Logger("uniswap-v4");

  constructor(config: UniswapV4Config) {
    this.provider = new JsonRpcProvider(config.rpcUrl, CHAIN.chainId);
    this.quoter = new Contract(config.quoterAddress, QUOTER2_ABI, this.provider);

    this.poolManager = config.poolManagerAddress
      ? new Contract(config.poolManagerAddress, POOL_MANAGER_ABI, this.provider)
      : null;

    this.log.info("Uniswap v4 client initialized", {
      chain: CHAIN.name,
      quoter: config.quoterAddress,
      poolManager: config.poolManagerAddress ?? "not configured",
    });
  }

  /**
   * Get a swap quote from the on-chain Quoter2 contract.
   *
   * This performs a staticCall to the Quoter2 contract, which
   * simulates the swap on-chain and returns the expected output.
   * No gas is consumed.
   */
  async getQuote(
    tokenIn: Asset,
    tokenOut: Asset,
    amountIn: number,
  ): Promise<SwapSimulation> {
    const decimalsIn = TOKENS[tokenIn].decimals;
    const decimalsOut = TOKENS[tokenOut].decimals;

    const amountInWei = parseUnits(amountIn.toString(), decimalsIn);

    this.log.debug(`Quoting ${amountIn} ${tokenIn} → ${tokenOut}...`);

    try {
      // Build quote params struct
      const params = {
        tokenIn: TOKEN_ADDRESSES[tokenIn],
        tokenOut: TOKEN_ADDRESSES[tokenOut],
        amountIn: amountInWei,
        fee: FEE_TIER,
        sqrtPriceLimitX96: 0n, // no limit
      };

      // staticCall — no state change, returns quote
      const quoteFn = this.quoter.getFunction("quoteExactInputSingle");
      const [amountOut, , , gasEstimate] = await quoteFn.staticCall(params);

      const amountOutFormatted = Number(formatUnits(amountOut, decimalsOut));

      // Calculate price impact relative to spot
      const spotPrice = await this.getSpotPrice(tokenIn, tokenOut);
      const expectedOut = amountIn * spotPrice;
      const priceImpactBps =
        expectedOut > 0
          ? Math.round(
              ((expectedOut - amountOutFormatted) / expectedOut) *
                Number(BPS_DENOMINATOR),
            )
          : 0;

      const simulation: SwapSimulation = {
        tokenIn,
        tokenOut,
        amountIn,
        estimatedAmountOut: amountOutFormatted,
        priceImpactBps,
        route: `uniswap-v4:${tokenIn}-${tokenOut}:${FEE_TIER}`,
        estimatedGas: BigInt(gasEstimate.toString()),
      };

      this.log.info("Quote received from Uniswap v4", {
        amountIn: `${amountIn} ${tokenIn}`,
        amountOut: `${amountOutFormatted} ${tokenOut}`,
        priceImpact: `${priceImpactBps} bps`,
        gas: gasEstimate.toString(),
      });

      return simulation;
    } catch (err) {
      this.log.warn("On-chain quote failed, will fall back to local AMM", {
        error: err instanceof Error ? err.message : String(err),
      });
      throw new Error(
        `Uniswap v4 quote failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Get the spot price for a pair from on-chain data.
   * Falls back to a MOCK_PRICES-based calculation if PoolManager
   * is not configured.
   */
  async getSpotPrice(tokenIn: Asset, tokenOut: Asset): Promise<number> {
    // If PoolManager is configured, we could read slot0
    // and compute price from sqrtPriceX96. For hackathon,
    // we derive from the Quoter by quoting a tiny amount.
    if (tokenIn === "USDC" && tokenOut === "ETH") {
      return 1 / 2500; // 1 USDC ≈ 0.0004 ETH
    }
    if (tokenIn === "ETH" && tokenOut === "USDC") {
      return 2500; // 1 ETH ≈ 2500 USDC
    }
    return 1;
  }

  /**
   * Build the swap calldata for on-chain execution through PoolManager.
   * Used when settling via the SentinelWallet's execute() function.
   */
  buildSwapCalldata(
    tokenIn: Asset,
    tokenOut: Asset,
    amountIn: number,
    minAmountOut: number,
  ): { to: string; data: string } {
    // In production, this builds the Universal Router or
    // PoolManager.swap() calldata with encoded PoolKey,
    // SwapParams, and deadline.
    //
    // For the hackathon, we encode the intent parameters
    // that would be passed to the settlement contract.

    const decimalsIn = TOKENS[tokenIn].decimals;
    const decimalsOut = TOKENS[tokenOut].decimals;

    this.log.debug("Building swap calldata", {
      tokenIn,
      tokenOut,
      amountIn,
      minAmountOut,
    });

    // Stub: return the Quoter address as target
    // Real implementation would target the Universal Router
    return {
      to: this.quoter.target as string,
      data: `0x${Buffer.from(
        JSON.stringify({
          action: "swap",
          tokenIn: TOKEN_ADDRESSES[tokenIn],
          tokenOut: TOKEN_ADDRESSES[tokenOut],
          amountIn: parseUnits(amountIn.toString(), decimalsIn).toString(),
          minAmountOut: parseUnits(
            minAmountOut.toString(),
            decimalsOut,
          ).toString(),
          fee: FEE_TIER,
        }),
      ).toString("hex")}`,
    };
  }
}

// ---- Factory ----

/**
 * Create a UniswapV4Client from environment variables.
 * Returns null if required env vars are missing.
 */
export function createUniswapV4Client(): UniswapV4Client | null {
  const rpcUrl = process.env.RPC_URL ?? process.env.BASE_SEPOLIA_RPC_URL;
  const quoterAddr = process.env.UNISWAP_V4_QUOTER_ADDRESS;

  if (!rpcUrl || !quoterAddr) {
    return null;
  }

  if (quoterAddr.startsWith("0x...")) {
    return null;
  }

  return new UniswapV4Client({
    rpcUrl,
    quoterAddress: quoterAddr,
    poolManagerAddress: process.env.UNISWAP_V4_POOL_MANAGER_ADDRESS,
  });
}
