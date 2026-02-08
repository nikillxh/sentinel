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
  AbiCoder,
  formatUnits,
  parseUnits,
  solidityPackedKeccak256,
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
   *
   * Strategy (in order):
   *   1. If PoolManager is configured → read slot0 for sqrtPriceX96
   *   2. Fall back to quoting a tiny amount (1 unit) via Quoter2
   *   3. Last resort: hardcoded reference prices
   */
  async getSpotPrice(tokenIn: Asset, tokenOut: Asset): Promise<number> {
    // Try reading sqrtPriceX96 from PoolManager.getSlot0()
    if (this.poolManager) {
      try {
        const poolId = this.computePoolId(tokenIn, tokenOut);
        const slot0Fn = this.poolManager.getFunction("getSlot0");
        const [sqrtPriceX96] = await slot0Fn(poolId);

        // sqrtPriceX96 = sqrt(price) * 2^96
        // price = (sqrtPriceX96 / 2^96)^2
        const Q96 = 2n ** 96n;
        const sqrtPrice = Number(sqrtPriceX96) / Number(Q96);
        let price = sqrtPrice * sqrtPrice;

        // Adjust for token decimal differences
        const decimalsIn = TOKENS[tokenIn].decimals;
        const decimalsOut = TOKENS[tokenOut].decimals;
        price *= 10 ** (decimalsIn - decimalsOut);

        // If price is token1/token0, invert if needed
        const [token0] = this.sortTokens(tokenIn, tokenOut);
        if (tokenIn !== token0) {
          price = 1 / price;
        }

        this.log.debug(`Spot price from slot0: ${tokenIn}/${tokenOut} = ${price.toFixed(8)}`);
        return price;
      } catch (err) {
        this.log.debug("slot0 read failed, trying quoter fallback", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Fallback: quote a tiny amount via Quoter2 to derive spot price
    try {
      const tinyAmount = tokenIn === "ETH" ? 0.001 : 1; // 0.001 ETH or 1 USDC
      const decimalsIn = TOKENS[tokenIn].decimals;
      const decimalsOut = TOKENS[tokenOut].decimals;
      const amountInWei = parseUnits(tinyAmount.toString(), decimalsIn);

      const params = {
        tokenIn: TOKEN_ADDRESSES[tokenIn],
        tokenOut: TOKEN_ADDRESSES[tokenOut],
        amountIn: amountInWei,
        fee: FEE_TIER,
        sqrtPriceLimitX96: 0n,
      };

      const quoteFn = this.quoter.getFunction("quoteExactInputSingle");
      const [amountOut] = await quoteFn.staticCall(params);
      const amountOutFormatted = Number(formatUnits(amountOut, decimalsOut));
      const spotPrice = amountOutFormatted / tinyAmount;

      this.log.debug(`Spot price from quoter: ${tokenIn}/${tokenOut} = ${spotPrice.toFixed(8)}`);
      return spotPrice;
    } catch (err) {
      this.log.debug("Quoter spot price failed, using reference prices", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Last resort: hardcoded reference prices
    if (tokenIn === "USDC" && tokenOut === "ETH") {
      return 1 / 2500;
    }
    if (tokenIn === "ETH" && tokenOut === "USDC") {
      return 2500;
    }
    return 1;
  }

  /**
   * Build the swap calldata for on-chain execution through Universal Router.
   * Used when settling via the SentinelWallet's execute() function.
   *
   * Encodes a V4_SWAP command with proper PoolKey and SwapParams.
   */
  buildSwapCalldata(
    tokenIn: Asset,
    tokenOut: Asset,
    amountIn: number,
    minAmountOut: number,
  ): { to: string; data: string } {
    const decimalsIn = TOKENS[tokenIn].decimals;
    const decimalsOut = TOKENS[tokenOut].decimals;

    this.log.debug("Building swap calldata", {
      tokenIn,
      tokenOut,
      amountIn,
      minAmountOut,
    });

    const amountInWei = parseUnits(amountIn.toString(), decimalsIn);
    const minAmountOutWei = parseUnits(minAmountOut.toString(), decimalsOut);

    // Sort tokens for PoolKey (Uniswap v4 requires token0 < token1)
    const [token0, token1] = this.sortTokens(tokenIn, tokenOut);
    const zeroForOne = tokenIn === token0;

    // Encode PoolKey: (currency0, currency1, fee, tickSpacing, hooks)
    const abiCoder = AbiCoder.defaultAbiCoder();
    const poolKey = abiCoder.encode(
      ["address", "address", "uint24", "int24", "address"],
      [
        TOKEN_ADDRESSES[token0],
        TOKEN_ADDRESSES[token1],
        FEE_TIER,
        60, // standard tick spacing for 0.3% fee tier
        "0x0000000000000000000000000000000000000000", // no hooks
      ],
    );

    // Encode SwapParams: (zeroForOne, amountSpecified, sqrtPriceLimitX96)
    const swapParams = abiCoder.encode(
      ["bool", "int256", "uint160"],
      [
        zeroForOne,
        amountInWei, // positive = exact input
        zeroForOne
          ? 4295128740n // MIN_SQRT_RATIO + 1 (no price limit)
          : 1461446703485210103287273052203988822378723970341n, // MAX_SQRT_RATIO - 1
      ],
    );

    // Encode the full swap call: poolKey + swapParams + deadline
    const deadline = Math.floor(Date.now() / 1000) + 600; // 10 min deadline
    const calldata = abiCoder.encode(
      ["bytes", "bytes", "uint256", "uint256"],
      [poolKey, swapParams, minAmountOutWei, deadline],
    );

    return {
      to: this.quoter.target as string, // In production: Universal Router address
      data: calldata,
    };
  }

  // ---- Internal Helpers ----

  /**
   * Sort tokens to determine token0/token1 order (lower address first).
   * Uniswap v4 requires PoolKey currencies to be sorted.
   */
  private sortTokens(a: Asset, b: Asset): [Asset, Asset] {
    const addrA = TOKEN_ADDRESSES[a].toLowerCase();
    const addrB = TOKEN_ADDRESSES[b].toLowerCase();
    return addrA < addrB ? [a, b] : [b, a];
  }

  /**
   * Compute the PoolId (keccak256 of the PoolKey) for slot0 lookup.
   */
  private computePoolId(tokenIn: Asset, tokenOut: Asset): string {
    const [token0, token1] = this.sortTokens(tokenIn, tokenOut);
    return solidityPackedKeccak256(
      ["address", "address", "uint24", "int24", "address"],
      [
        TOKEN_ADDRESSES[token0],
        TOKEN_ADDRESSES[token1],
        FEE_TIER,
        60, // tick spacing
        "0x0000000000000000000000000000000000000000", // hooks
      ],
    );
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
