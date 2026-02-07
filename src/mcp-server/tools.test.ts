// ============================================================
// Sentinel – MCP Tool Handler Tests
// Tests the complete flow through the tool interface
// ============================================================

import { describe, it, expect, beforeEach } from "vitest";
import { ToolHandlers } from "./tools.js";
import { PolicyEngine } from "../policy-engine/engine.js";
import { SessionManager } from "../session/manager.js";
import { SwapSimulator } from "./swap-simulator.js";
import { DEFAULT_POLICY } from "../shared/constants.js";

describe("ToolHandlers", () => {
  let handlers: ToolHandlers;
  let sessionManager: SessionManager;

  beforeEach(async () => {
    const policyEngine = new PolicyEngine(DEFAULT_POLICY);
    sessionManager = new SessionManager();
    const swapSimulator = new SwapSimulator();
    handlers = new ToolHandlers(policyEngine, sessionManager, swapSimulator);

    // Open a session for tests
    await sessionManager.open(1000);
  });

  describe("getSessionBalance", () => {
    it("should return USDC balance", async () => {
      const result = await handlers.getSessionBalance({ asset: "USDC" });
      expect(result.success).toBe(true);
      expect((result.data as any).balance.amount).toBe(1000);
    });

    it("should return ETH balance (initially 0)", async () => {
      const result = await handlers.getSessionBalance({ asset: "ETH" });
      expect(result.success).toBe(true);
      expect((result.data as any).balance.amount).toBe(0);
    });

    it("should return error when no session exists", async () => {
      const freshHandlers = new ToolHandlers(
        new PolicyEngine(DEFAULT_POLICY),
        new SessionManager(),
        new SwapSimulator(),
      );
      const result = await freshHandlers.getSessionBalance({ asset: "USDC" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("No active session");
    });
  });

  describe("simulateSwap", () => {
    it("should simulate a USDC→ETH swap", async () => {
      const result = await handlers.simulateSwap({
        tokenIn: "USDC",
        tokenOut: "ETH",
        amount: 20,
      });

      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.simulation.tokenIn).toBe("USDC");
      expect(data.simulation.tokenOut).toBe("ETH");
      expect(data.simulation.estimatedAmountOut).toBeGreaterThan(0);
      expect(data.wouldBeApproved).toBe(true);
    });

    it("should flag violations in simulation", async () => {
      const result = await handlers.simulateSwap({
        tokenIn: "USDC",
        tokenOut: "ETH",
        amount: 100, // 10% of balance — too large
      });

      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.wouldBeApproved).toBe(false);
      expect(data.policyNotes.length).toBeGreaterThan(0);
    });

    it("should reject swapping same token", async () => {
      const result = await handlers.simulateSwap({
        tokenIn: "USDC",
        tokenOut: "USDC",
        amount: 10,
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("itself");
    });
  });

  describe("proposeSwap", () => {
    it("should execute an approved swap", async () => {
      const result = await handlers.proposeSwap({
        tokenIn: "USDC",
        tokenOut: "ETH",
        amount: 20, // 2% of 1000 — exactly at limit
      });

      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.swapResult.success).toBe(true);
      expect(data.swapResult.executionType).toBe("offchain");
      expect(data.updatedBalances.USDC).toBe(980);
      expect(data.updatedBalances.ETH).toBeGreaterThan(0);
      expect(result.policyDecision?.approved).toBe(true);
    });

    it("should reject a swap exceeding max trade size", async () => {
      const result = await handlers.proposeSwap({
        tokenIn: "USDC",
        tokenOut: "ETH",
        amount: 50, // 5% — exceeds 2% limit
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Policy rejected");
      expect(result.policyDecision?.approved).toBe(false);

      // Balance should NOT have changed
      const bal = await handlers.getSessionBalance({ asset: "USDC" });
      expect((bal.data as any).balance.amount).toBe(1000);
    });

    it("should allow multiple successive swaps", async () => {
      // First swap: 20 USDC → ETH
      const r1 = await handlers.proposeSwap({
        tokenIn: "USDC",
        tokenOut: "ETH",
        amount: 20,
      });
      expect(r1.success).toBe(true);

      // Second swap: 19.6 USDC → ETH (2% of 980)
      const r2 = await handlers.proposeSwap({
        tokenIn: "USDC",
        tokenOut: "ETH",
        amount: 19.6,
      });
      expect(r2.success).toBe(true);

      const bal = await handlers.getSessionBalance({ asset: "USDC" });
      expect((bal.data as any).balance.amount).toBeCloseTo(960.4, 1);
    });
  });

  describe("closeSessionAndSettle", () => {
    it("should close session and return settlement data", async () => {
      // Do a swap first
      await handlers.proposeSwap({
        tokenIn: "USDC",
        tokenOut: "ETH",
        amount: 20,
      });

      const result = await handlers.closeSessionAndSettle();
      expect(result.success).toBe(true);

      const data = result.data as any;
      expect(data.status).toBe("settled");
      expect(data.settlementTxHash).toMatch(/^0x/);
      expect(data.totalSwaps).toBe(1);
      expect(data.finalBalances.USDC).toBe(980);
      expect(data.finalBalances.ETH).toBeGreaterThan(0);
      expect(data.history).toHaveLength(1);
    });

    it("should close session with no swaps", async () => {
      const result = await handlers.closeSessionAndSettle();
      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.totalSwaps).toBe(0);
      expect(data.finalBalances.USDC).toBe(1000);
    });
  });

  describe("full demo flow", () => {
    it("should execute the complete demo scenario", async () => {
      // 1. Check initial balance
      const bal1 = await handlers.getSessionBalance({ asset: "USDC" });
      expect((bal1.data as any).balance.amount).toBe(1000);

      // 2. Simulate the swap
      const sim = await handlers.simulateSwap({
        tokenIn: "USDC",
        tokenOut: "ETH",
        amount: 20,
      });
      expect(sim.success).toBe(true);
      expect((sim.data as any).wouldBeApproved).toBe(true);

      // 3. Execute the swap
      const swap = await handlers.proposeSwap({
        tokenIn: "USDC",
        tokenOut: "ETH",
        amount: 20,
      });
      expect(swap.success).toBe(true);
      expect(swap.policyDecision?.approved).toBe(true);

      // 4. Check updated balance
      const bal2 = await handlers.getSessionBalance({ asset: "USDC" });
      expect((bal2.data as any).balance.amount).toBe(980);

      // 5. Do another swap
      const swap2 = await handlers.proposeSwap({
        tokenIn: "USDC",
        tokenOut: "ETH",
        amount: 19.6, // 2% of 980
      });
      expect(swap2.success).toBe(true);

      // 6. Close and settle
      const settle = await handlers.closeSessionAndSettle();
      expect(settle.success).toBe(true);
      expect((settle.data as any).status).toBe("settled");
      expect((settle.data as any).totalSwaps).toBe(2);
      expect((settle.data as any).settlementTxHash).toMatch(/^0x/);
    });
  });
});
