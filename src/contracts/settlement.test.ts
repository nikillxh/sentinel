// ============================================================
// Sentinel – Settlement Client Tests
// Tests the SettlementClient factory, ABI exports,
// and the integration surface (without hitting a real chain).
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  SENTINEL_WALLET_ABI,
  POLICY_GUARD_ABI,
  ERC20_ABI,
} from "./abis.js";
import { createSettlementClient } from "./settlement.js";

// ---- ABI Sanity Checks ----

describe("Contract ABIs", () => {
  it("exports SentinelWallet ABI with expected functions", () => {
    expect(SENTINEL_WALLET_ABI).toBeDefined();
    expect(SENTINEL_WALLET_ABI.length).toBeGreaterThan(0);

    const abiStr = SENTINEL_WALLET_ABI.join("\n");
    expect(abiStr).toContain("settleSession");
    expect(abiStr).toContain("execute");
    expect(abiStr).toContain("executeBatch");
    expect(abiStr).toContain("validateUserOp");
    expect(abiStr).toContain("getNonce");
    expect(abiStr).toContain("SessionSettled");
    expect(abiStr).toContain("UserOpExecuted");
    expect(abiStr).toContain("Executed");
  });

  it("exports PolicyGuard ABI with expected functions", () => {
    expect(POLICY_GUARD_ABI).toBeDefined();
    expect(POLICY_GUARD_ABI.length).toBeGreaterThan(0);

    const abiStr = POLICY_GUARD_ABI.join("\n");
    expect(abiStr).toContain("validateSettlement");
    expect(abiStr).toContain("markSettled");
    expect(abiStr).toContain("updatePolicy");
    expect(abiStr).toContain("getPolicy");
    expect(abiStr).toContain("isTokenAllowed");
    expect(abiStr).toContain("SettlementApproved");
    expect(abiStr).toContain("PolicyUpdated");
  });

  it("exports ERC20 ABI with standard functions", () => {
    expect(ERC20_ABI).toBeDefined();
    const abiStr = ERC20_ABI.join("\n");
    expect(abiStr).toContain("balanceOf");
    expect(abiStr).toContain("transfer");
    expect(abiStr).toContain("approve");
    expect(abiStr).toContain("allowance");
  });
});

// ---- Factory Tests ----

describe("createSettlementClient()", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset env before each test
    process.env = { ...originalEnv };
    delete process.env.RPC_URL;
    delete process.env.OPERATOR_PRIVATE_KEY;
    delete process.env.SENTINEL_WALLET_ADDRESS;
    delete process.env.POLICY_GUARD_ADDRESS;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns null when env vars are missing", () => {
    const client = createSettlementClient();
    expect(client).toBeNull();
  });

  it("returns null when only some env vars are set", () => {
    process.env.RPC_URL = "https://sepolia.base.org";
    const client = createSettlementClient();
    expect(client).toBeNull();
  });

  it("returns null when env vars contain placeholders", () => {
    process.env.RPC_URL = "https://sepolia.base.org";
    process.env.OPERATOR_PRIVATE_KEY = "0x...placeholder";
    process.env.SENTINEL_WALLET_ADDRESS = "0x...placeholder";
    process.env.POLICY_GUARD_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";

    const client = createSettlementClient();
    expect(client).toBeNull();
  });

  it("creates a client when all valid env vars are present", () => {
    process.env.RPC_URL = "https://sepolia.base.org";
    process.env.OPERATOR_PRIVATE_KEY =
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // Hardhat #0
    process.env.SENTINEL_WALLET_ADDRESS =
      "0x1234567890abcdef1234567890abcdef12345678";
    process.env.POLICY_GUARD_ADDRESS =
      "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";

    const client = createSettlementClient();
    expect(client).not.toBeNull();
  });
});

// ---- SettlementClient unit tests (mocked provider) ----

describe("SettlementClient", () => {
  it("can be instantiated with valid config", async () => {
    // This just tests construction doesn't throw
    const { SettlementClient } = await import("./settlement.js");
    const client = new SettlementClient({
      rpcUrl: "http://localhost:8545",
      operatorPrivateKey:
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
      policyGuardAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    });
    expect(client).toBeDefined();
  });
});
