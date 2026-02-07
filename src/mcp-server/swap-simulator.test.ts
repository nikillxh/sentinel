// ============================================================
// Sentinel – Swap Simulator Tests
// ============================================================

import { describe, it, expect } from "vitest";
import { SwapSimulator } from "./swap-simulator.js";

describe("SwapSimulator", () => {
  const simulator = new SwapSimulator();

  describe("simulate() — async with local fallback", () => {
    it("should simulate a USDC→ETH swap", async () => {
      const result = await simulator.simulate("USDC", "ETH", 20);

      expect(result.tokenIn).toBe("USDC");
      expect(result.tokenOut).toBe("ETH");
      expect(result.amountIn).toBe(20);
      expect(result.estimatedAmountOut).toBeGreaterThan(0);
      expect(result.estimatedAmountOut).toBeLessThan(0.01); // ~0.008 ETH for 20 USDC
      expect(result.priceImpactBps).toBeGreaterThanOrEqual(0);
      expect(result.route).toContain("Uniswap v4");
      expect(result.estimatedGas).toBe(0n);
    });

    it("should simulate an ETH→USDC swap", async () => {
      const result = await simulator.simulate("ETH", "USDC", 0.02);

      expect(result.estimatedAmountOut).toBeGreaterThan(0);
      expect(result.estimatedAmountOut).toBeLessThan(60); // ~50 USDC for 0.02 ETH
    });

    it("should have higher price impact for larger trades", async () => {
      const small = await simulator.simulate("USDC", "ETH", 100);
      const large = await simulator.simulate("USDC", "ETH", 100_000);

      expect(large.priceImpactBps).toBeGreaterThan(small.priceImpactBps);
    });

    it("should apply the 0.3% fee", async () => {
      // With no fee, 20 USDC should give exactly 0.008 ETH (2500000:1000 ratio)
      // With 0.3% fee, output should be slightly less
      const result = await simulator.simulate("USDC", "ETH", 20);
      const theoreticalNoFee = (1000 * 20) / (2_500_000 + 20);
      expect(result.estimatedAmountOut).toBeLessThan(theoreticalNoFee);
    });

    it("should throw for unsupported pairs", async () => {
      await expect(
        simulator.simulate("USDC" as any, "WBTC" as any, 100),
      ).rejects.toThrow("No liquidity pool");
    });
  });

  describe("simulateLocal() — sync direct access", () => {
    it("should return a SwapSimulation for USDC→ETH", () => {
      const result = simulator.simulateLocal("USDC", "ETH", 20);
      expect(result.estimatedAmountOut).toBeGreaterThan(0);
    });
  });

  describe("getSpotPrice()", () => {
    it("should return USDC/ETH spot price", () => {
      const price = simulator.getSpotPrice("USDC", "ETH");
      expect(price).toBeCloseTo(0.0004, 4); // 1/2500
    });

    it("should return ETH/USDC spot price", () => {
      const price = simulator.getSpotPrice("ETH", "USDC");
      expect(price).toBe(2500);
    });
  });

  describe("getDex()", () => {
    it("should return uniswap-v4", () => {
      expect(simulator.getDex()).toBe("uniswap-v4");
    });
  });
});
