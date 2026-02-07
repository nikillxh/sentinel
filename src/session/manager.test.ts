// ============================================================
// Sentinel – Session Manager Tests
// ============================================================

import { describe, it, expect, beforeEach } from "vitest";
import { SessionManager } from "./manager.js";

describe("SessionManager", () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager();
  });

  describe("open()", () => {
    it("should open a session with default USDC deposit", async () => {
      const session = await manager.open();
      expect(session.status).toBe("active");
      expect(session.balances.get("USDC")?.amount).toBe(1000);
      expect(session.balances.get("ETH")?.amount).toBe(0);
      expect(session.sessionId).toMatch(/^session-/);
    });

    it("should open a session with custom deposit", async () => {
      const session = await manager.open(5000);
      expect(session.balances.get("USDC")?.amount).toBe(5000);
    });

    it("should throw if a session is already active", async () => {
      await manager.open();
      await expect(manager.open()).rejects.toThrow("already active");
    });
  });

  describe("getBalance()", () => {
    it("should return the balance for a valid asset", async () => {
      await manager.open(1000);
      const bal = manager.getBalance("USDC");
      expect(bal.amount).toBe(1000);
      expect(bal.pnl).toBe(0);
    });

    it("should throw if no session is active", () => {
      expect(() => manager.getBalance("USDC")).toThrow("No active session");
    });
  });

  describe("applySwap()", () => {
    it("should update balances correctly for USDC→ETH swap", async () => {
      await manager.open(1000);
      const result = await manager.applySwap("USDC", "ETH", 20, 0.008, "test-prop");

      expect(result.success).toBe(true);
      expect(result.amountIn).toBe(20);
      expect(result.amountOut).toBe(0.008);
      expect(result.executionType).toBe("offchain");

      expect(manager.getBalance("USDC").amount).toBe(980);
      expect(manager.getBalance("ETH").amount).toBe(0.008);
    });

    it("should update PnL correctly", async () => {
      await manager.open(1000);
      await manager.applySwap("USDC", "ETH", 20, 0.008, "test-prop");

      expect(manager.getBalance("USDC").pnl).toBe(-20);
      expect(manager.getBalance("ETH").pnl).toBe(0.008);
    });

    it("should track swap history", async () => {
      await manager.open(1000);
      await manager.applySwap("USDC", "ETH", 20, 0.008, "prop-1");
      await manager.applySwap("USDC", "ETH", 10, 0.004, "prop-2");

      const session = manager.getSession();
      expect(session.history).toHaveLength(2);
      expect(session.history[0]?.proposalId).toBe("prop-1");
      expect(session.history[1]?.proposalId).toBe("prop-2");
    });

    it("should throw on insufficient balance", async () => {
      await manager.open(100);
      await expect(
        manager.applySwap("USDC", "ETH", 200, 0.08, "test-prop"),
      ).rejects.toThrow("Insufficient USDC balance");
    });

    it("should throw if session is not active", async () => {
      await expect(
        manager.applySwap("USDC", "ETH", 20, 0.008, "test-prop"),
      ).rejects.toThrow("No active session");
    });
  });

  describe("close()", () => {
    it("should transition session to closing", async () => {
      await manager.open(1000);
      await manager.applySwap("USDC", "ETH", 20, 0.008, "prop-1");
      const session = await manager.close();

      expect(session.status).toBe("closing");
    });

    it("should include session summary", async () => {
      await manager.open(1000);
      await manager.applySwap("USDC", "ETH", 20, 0.008, "prop-1");
      await manager.close();

      const summary = manager.getSummary();
      expect(summary.status).toBe("closing");
      expect(summary.totalSwaps).toBe(1);
      expect(summary.balances["USDC"]).toBe(980);
    });

    it("should throw if session is not active", async () => {
      await expect(manager.close()).rejects.toThrow("No active session");
    });
  });

  describe("markSettled()", () => {
    it("should mark a closing session as settled", async () => {
      await manager.open(1000);
      await manager.close();
      const session = manager.markSettled("0xabc123" as `0x${string}`);

      expect(session.status).toBe("settled");
      expect(session.settlementTxHash).toBe("0xabc123");
      expect(session.closedAt).toBeTruthy();
    });

    it("should throw if session is not in closing state", async () => {
      await manager.open(1000);
      expect(() =>
        manager.markSettled("0xabc123" as `0x${string}`),
      ).toThrow('Must be "closing"');
    });
  });

  describe("getTotalValueUsd()", () => {
    it("should calculate total value using mock prices", async () => {
      await manager.open(1000);
      // 1000 USDC * $1 + 0 ETH * $2500 = $1000
      expect(manager.getTotalValueUsd()).toBe(1000);
    });

    it("should update after swaps", async () => {
      await manager.open(1000);
      // Swap 20 USDC for 0.008 ETH
      // 980 USDC * $1 + 0.008 ETH * $2500 = $980 + $20 = $1000
      await manager.applySwap("USDC", "ETH", 20, 0.008, "prop-1");
      expect(manager.getTotalValueUsd()).toBe(1000);
    });
  });

  describe("with NitroliteChannel", () => {
    it("should work without channel (backward compat)", async () => {
      const mgr = new SessionManager();
      const session = await mgr.open(500);
      expect(session.status).toBe("active");
    });

    it("should work with null channel", async () => {
      const mgr = new SessionManager(null);
      const session = await mgr.open(500);
      expect(session.status).toBe("active");
    });
  });
});
