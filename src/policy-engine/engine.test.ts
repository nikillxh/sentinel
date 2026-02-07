// ============================================================
// Sentinel – Policy Engine Tests
// Covers all 4 hard rules + edge cases
// ============================================================

import { describe, it, expect, beforeEach } from "vitest";
import { PolicyEngine } from "./engine.js";
import type {
  Asset,
  PolicyConfig,
  SessionBalance,
  SwapProposal,
} from "../shared/types.js";
import { DEFAULT_POLICY } from "../shared/constants.js";

// ---- Test Helpers ----

function makeBalances(
  usdcAmount = 1000,
  ethAmount = 1,
): Map<Asset, SessionBalance> {
  const balances = new Map<Asset, SessionBalance>();
  balances.set("USDC", {
    asset: "USDC",
    amount: usdcAmount,
    initialAmount: usdcAmount,
    pnl: 0,
  });
  balances.set("ETH", {
    asset: "ETH",
    amount: ethAmount,
    initialAmount: ethAmount,
    pnl: 0,
  });
  return balances;
}

function makeProposal(overrides: Partial<SwapProposal> = {}): SwapProposal {
  return {
    id: "test-001",
    tokenIn: "USDC",
    tokenOut: "ETH",
    amountIn: 20, // exactly 2% of 1000 USDC
    estimatedAmountOut: 0.008,
    maxSlippageBps: 50, // 0.5%
    dex: "uniswap-v4",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// ---- Tests ----

describe("PolicyEngine", () => {
  let engine: PolicyEngine;

  beforeEach(() => {
    engine = new PolicyEngine(DEFAULT_POLICY);
  });

  describe("initialization", () => {
    it("should initialize with default policy", () => {
      const config = engine.getConfig();
      expect(config.maxTradePercent).toBe(2);
      expect(config.maxSlippageBps).toBe(50);
      expect(config.allowedDexes).toContain("uniswap-v4");
      expect(config.allowedAssets).toEqual(["USDC", "ETH"]);
    });

    it("should compute a deterministic policy hash", () => {
      const hash1 = engine.getPolicyHash();
      const engine2 = new PolicyEngine(DEFAULT_POLICY);
      const hash2 = engine2.getPolicyHash();
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^0x[a-f0-9]{64}$/);
    });

    it("should produce different hash for different config", () => {
      const custom: PolicyConfig = {
        ...DEFAULT_POLICY,
        maxTradePercent: 5,
      };
      const customEngine = new PolicyEngine(custom);
      expect(customEngine.getPolicyHash()).not.toBe(engine.getPolicyHash());
    });
  });

  describe("valid proposals (all rules pass)", () => {
    it("should approve a valid 2% USDC->ETH swap on Uniswap v4", () => {
      const proposal = makeProposal();
      const balances = makeBalances();
      const decision = engine.evaluate(proposal, balances);

      expect(decision.approved).toBe(true);
      expect(decision.results).toHaveLength(4);
      expect(decision.results.every((r) => r.passed)).toBe(true);
      expect(decision.policyHash).toMatch(/^0x/);
    });

    it("should approve a swap below the max trade size", () => {
      const proposal = makeProposal({ amountIn: 10 }); // 1% of 1000
      const decision = engine.evaluate(proposal, makeBalances());
      expect(decision.approved).toBe(true);
    });

    it("should approve exactly at the boundary (2% of balance)", () => {
      const proposal = makeProposal({ amountIn: 20 }); // exactly 2%
      const decision = engine.evaluate(proposal, makeBalances());
      expect(decision.approved).toBe(true);
    });

    it("should approve ETH->USDC swap direction", () => {
      const proposal = makeProposal({
        tokenIn: "ETH",
        tokenOut: "USDC",
        amountIn: 0.02, // 2% of 1 ETH
        estimatedAmountOut: 50,
      });
      const decision = engine.evaluate(proposal, makeBalances());
      expect(decision.approved).toBe(true);
    });
  });

  describe("Rule 1: Max Trade Size", () => {
    it("should reject trade exceeding 2% of session balance", () => {
      const proposal = makeProposal({ amountIn: 21 }); // 2.1% of 1000
      const decision = engine.evaluate(proposal, makeBalances());

      expect(decision.approved).toBe(false);
      const tradeRule = decision.results.find(
        (r) => r.rule.id === "max-trade-size",
      );
      expect(tradeRule?.passed).toBe(false);
      expect(tradeRule?.reason).toContain("exceeds");
    });

    it("should reject trade when no balance exists for input token", () => {
      const balances = new Map<Asset, SessionBalance>();
      // Only ETH balance, no USDC
      balances.set("ETH", {
        asset: "ETH",
        amount: 1,
        initialAmount: 1,
        pnl: 0,
      });

      const proposal = makeProposal({ tokenIn: "USDC", amountIn: 10 });
      const decision = engine.evaluate(proposal, balances);

      expect(decision.approved).toBe(false);
      const tradeRule = decision.results.find(
        (r) => r.rule.id === "max-trade-size",
      );
      expect(tradeRule?.passed).toBe(false);
      expect(tradeRule?.reason).toContain("No session balance");
    });

    it("should scale max trade with balance size", () => {
      // 2% of 5000 = 100, so 100 should pass
      const proposal = makeProposal({ amountIn: 100 });
      const decision = engine.evaluate(proposal, makeBalances(5000));
      expect(decision.approved).toBe(true);

      // But 101 should fail
      const proposal2 = makeProposal({ amountIn: 101 });
      const decision2 = engine.evaluate(proposal2, makeBalances(5000));
      expect(decision2.approved).toBe(false);
    });
  });

  describe("Rule 2: Allowed DEX", () => {
    it("should reject trades on non-whitelisted DEXes", () => {
      const proposal = makeProposal({ dex: "sushiswap" });
      const decision = engine.evaluate(proposal, makeBalances());

      expect(decision.approved).toBe(false);
      const dexRule = decision.results.find(
        (r) => r.rule.id === "allowed-dex",
      );
      expect(dexRule?.passed).toBe(false);
      expect(dexRule?.reason).toContain("sushiswap");
      expect(dexRule?.reason).toContain("not whitelisted");
    });

    it("should reject unknown DEX identifiers", () => {
      const proposal = makeProposal({ dex: "uniswap-v3" }); // v3 not v4
      const decision = engine.evaluate(proposal, makeBalances());
      expect(decision.approved).toBe(false);
    });
  });

  describe("Rule 3: Allowed Assets", () => {
    it("should reject if tokenIn is not whitelisted", () => {
      const proposal = makeProposal({
        tokenIn: "DAI" as Asset,
        amountIn: 10,
      });
      const decision = engine.evaluate(proposal, makeBalances());

      expect(decision.approved).toBe(false);
      const assetRule = decision.results.find(
        (r) => r.rule.id === "allowed-assets",
      );
      expect(assetRule?.passed).toBe(false);
      expect(assetRule?.reason).toContain("DAI");
    });

    it("should reject if tokenOut is not whitelisted", () => {
      const proposal = makeProposal({ tokenOut: "WBTC" as Asset });
      const decision = engine.evaluate(proposal, makeBalances());

      expect(decision.approved).toBe(false);
      const assetRule = decision.results.find(
        (r) => r.rule.id === "allowed-assets",
      );
      expect(assetRule?.passed).toBe(false);
      expect(assetRule?.reason).toContain("WBTC");
    });

    it("should reject if both tokens are not whitelisted", () => {
      const proposal = makeProposal({
        tokenIn: "DAI" as Asset,
        tokenOut: "WBTC" as Asset,
        amountIn: 10,
      });
      const decision = engine.evaluate(proposal, makeBalances());

      const assetRule = decision.results.find(
        (r) => r.rule.id === "allowed-assets",
      );
      expect(assetRule?.passed).toBe(false);
      expect(assetRule?.reason).toContain("DAI");
      expect(assetRule?.reason).toContain("WBTC");
    });
  });

  describe("Rule 4: Max Slippage", () => {
    it("should reject slippage above 0.5% (50 bps)", () => {
      const proposal = makeProposal({ maxSlippageBps: 51 });
      const decision = engine.evaluate(proposal, makeBalances());

      expect(decision.approved).toBe(false);
      const slippageRule = decision.results.find(
        (r) => r.rule.id === "max-slippage",
      );
      expect(slippageRule?.passed).toBe(false);
      expect(slippageRule?.reason).toContain("51 bps");
    });

    it("should approve slippage at exactly 50 bps", () => {
      const proposal = makeProposal({ maxSlippageBps: 50 });
      const decision = engine.evaluate(proposal, makeBalances());

      const slippageRule = decision.results.find(
        (r) => r.rule.id === "max-slippage",
      );
      expect(slippageRule?.passed).toBe(true);
    });

    it("should reject extreme slippage values", () => {
      const proposal = makeProposal({ maxSlippageBps: 500 }); // 5%
      const decision = engine.evaluate(proposal, makeBalances());
      expect(decision.approved).toBe(false);
    });
  });

  describe("multiple violations", () => {
    it("should report all failing rules when multiple rules are violated", () => {
      const proposal = makeProposal({
        amountIn: 100, // 10% — too high
        dex: "curve", // not allowed
        maxSlippageBps: 200, // too high
        tokenOut: "WBTC" as Asset, // not allowed
      });
      const decision = engine.evaluate(proposal, makeBalances());

      expect(decision.approved).toBe(false);
      const failures = decision.results.filter((r) => !r.passed);
      expect(failures.length).toBe(4); // all rules fail
    });
  });

  describe("custom policy config", () => {
    it("should respect a custom maxTradePercent", () => {
      const custom: PolicyConfig = {
        ...DEFAULT_POLICY,
        maxTradePercent: 10,
      };
      const customEngine = new PolicyEngine(custom);

      // 10% of 1000 = 100, so 100 should pass
      const proposal = makeProposal({ amountIn: 100 });
      const decision = customEngine.evaluate(proposal, makeBalances());
      expect(decision.approved).toBe(true);
    });

    it("should respect a custom slippage limit", () => {
      const custom: PolicyConfig = {
        ...DEFAULT_POLICY,
        maxSlippageBps: 100, // 1%
      };
      const customEngine = new PolicyEngine(custom);

      const proposal = makeProposal({ maxSlippageBps: 100 });
      const decision = customEngine.evaluate(proposal, makeBalances());
      expect(decision.approved).toBe(true);
    });
  });

  describe("decision metadata", () => {
    it("should include timestamp in ISO format", () => {
      const decision = engine.evaluate(makeProposal(), makeBalances());
      expect(decision.evaluatedAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      );
    });

    it("should include a valid policy hash", () => {
      const decision = engine.evaluate(makeProposal(), makeBalances());
      expect(decision.policyHash).toMatch(/^0x[a-f0-9]{64}$/);
    });

    it("should always return exactly 4 rule results", () => {
      const decision = engine.evaluate(makeProposal(), makeBalances());
      expect(decision.results).toHaveLength(4);
    });
  });
});
