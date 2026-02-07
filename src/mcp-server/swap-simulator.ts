// ============================================================
// Sentinel – Swap Simulator
// Simulates Uniswap v4 swap output using a constant-product
// AMM model. Provides price impact and routing info.
//
// When a UniswapV4Client is provided, quotes are fetched from
// the on-chain Quoter2 contract. Falls back to the local AMM
// model when the client is unavailable or the quote fails.
// ============================================================

import { Logger } from "../shared/logger.js";
import { MOCK_PRICES, DEX } from "../shared/constants.js";
import type { Asset, SwapSimulation } from "../shared/types.js";
import type { UniswapV4Client } from "./uniswap-client.js";

/**
 * Simulated liquidity pool reserves.
 * In production these would come from the Uniswap v4 pool state.
 */
const POOL_RESERVES: Record<string, { reserveA: number; reserveB: number }> = {
  "USDC/ETH": { reserveA: 2_500_000, reserveB: 1_000 }, // $2500 per ETH
  "ETH/USDC": { reserveA: 1_000, reserveB: 2_500_000 },
};

const FEE_BPS = 30; // 0.3% Uniswap fee tier

export class SwapSimulator {
  private log = new Logger("uniswap");
  private v4Client: UniswapV4Client | null;

  constructor(v4Client?: UniswapV4Client | null) {
    this.v4Client = v4Client ?? null;
    if (this.v4Client) {
      this.log.info("Swap simulator initialized with Uniswap v4 on-chain quotes ✓");
    } else {
      this.log.info("Swap simulator initialized (local AMM mode)");
    }
  }

  /**
   * Simulate a swap and return the expected output.
   *
   * When a UniswapV4Client is available, first attempts an on-chain
   * quote. Falls back to the local constant-product AMM model.
   */
  async simulate(tokenIn: Asset, tokenOut: Asset, amountIn: number): Promise<SwapSimulation> {
    // Try on-chain quote first
    if (this.v4Client) {
      try {
        const quote = await this.v4Client.getQuote(tokenIn, tokenOut, amountIn);
        this.log.info("Using on-chain Uniswap v4 quote");
        return quote;
      } catch {
        this.log.warn("On-chain quote failed, falling back to local AMM");
      }
    }

    return this.simulateLocal(tokenIn, tokenOut, amountIn);
  }

  /**
   * Local constant-product AMM simulation.
   * Uses formula: (x + Δx)(y - Δy) = x·y after fee deduction on input.
   */
  simulateLocal(tokenIn: Asset, tokenOut: Asset, amountIn: number): SwapSimulation {
    const pairKey = `${tokenIn}/${tokenOut}`;
    const pool = POOL_RESERVES[pairKey];

    if (!pool) {
      throw new Error(`No liquidity pool found for pair ${pairKey}`);
    }

    this.log.info(`Simulating swap: ${amountIn} ${tokenIn} → ${tokenOut}`);

    // Apply fee to input
    const amountInAfterFee = amountIn * (1 - FEE_BPS / 10_000);

    // Constant product formula: Δy = (y · Δx) / (x + Δx)
    const { reserveA, reserveB } = pool;
    const amountOut =
      (reserveB * amountInAfterFee) / (reserveA + amountInAfterFee);

    // Calculate price impact
    const spotPrice = reserveB / reserveA;
    const executionPrice = amountOut / amountIn;
    const priceImpactBps = Math.round(
      Math.abs(1 - executionPrice / spotPrice) * 10_000,
    );

    const simulation: SwapSimulation = {
      tokenIn,
      tokenOut,
      amountIn,
      estimatedAmountOut: Number(amountOut.toFixed(8)),
      priceImpactBps,
      route: `${tokenIn} →[Uniswap v4 0.3%]→ ${tokenOut}`,
      estimatedGas: 0n, // off-chain = gasless
    };

    this.log.info("Simulation result", {
      amountOut: simulation.estimatedAmountOut,
      priceImpactBps: simulation.priceImpactBps,
      spotPrice: spotPrice.toFixed(8),
      executionPrice: executionPrice.toFixed(8),
      route: simulation.route,
    });

    if (priceImpactBps > 100) {
      this.log.warn(
        `High price impact: ${priceImpactBps} bps (${(priceImpactBps / 100).toFixed(2)}%)`,
      );
    }

    return simulation;
  }

  /**
   * Get the current spot price for a pair.
   * STUB: Uses mock prices. In production, query Uniswap v4 pool.
   */
  getSpotPrice(tokenIn: Asset, tokenOut: Asset): number {
    const priceIn = MOCK_PRICES[tokenIn];
    const priceOut = MOCK_PRICES[tokenOut];

    if (priceIn === undefined || priceOut === undefined) {
      throw new Error(`No price data for ${tokenIn} or ${tokenOut}`);
    }

    return priceIn / priceOut;
  }

  /**
   * Get the DEX identifier used by this simulator.
   */
  getDex(): string {
    return DEX.UNISWAP_V4;
  }
}
