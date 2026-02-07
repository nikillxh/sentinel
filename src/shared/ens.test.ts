import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  ENSResolver,
  createENSResolver,
  type ENSConfig,
} from "./ens.js";
import { DEFAULT_POLICY, ENS as ENS_CONSTANTS } from "./constants.js";
import type { PolicyConfig } from "./types.js";

const TEST_CONFIG: ENSConfig = {
  rpcUrl: "http://127.0.0.1:8545",
};

describe("ENSResolver", () => {
  let resolver: ENSResolver;

  beforeEach(() => {
    resolver = new ENSResolver(TEST_CONFIG);
  });

  describe("constructor", () => {
    it("should instantiate with config", () => {
      expect(resolver).toBeInstanceOf(ENSResolver);
    });

    it("should use custom registry address if provided", () => {
      const custom = new ENSResolver({
        ...TEST_CONFIG,
        registryAddress: "0xaabbccddaabbccddaabbccddaabbccddaabbccdd",
      });
      expect(custom).toBeInstanceOf(ENSResolver);
    });
  });

  describe("computePolicyHash", () => {
    it("should produce a deterministic hash", () => {
      const hash1 = resolver.computePolicyHash(DEFAULT_POLICY);
      const hash2 = resolver.computePolicyHash(DEFAULT_POLICY);
      expect(hash1).toBe(hash2);
    });

    it("should produce 0x-prefixed SHA-256 hash", () => {
      const hash = resolver.computePolicyHash(DEFAULT_POLICY);
      expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it("should change if policy changes", () => {
      const modified: PolicyConfig = {
        ...DEFAULT_POLICY,
        maxTradePercent: 5, // Changed from 2
      };
      const h1 = resolver.computePolicyHash(DEFAULT_POLICY);
      const h2 = resolver.computePolicyHash(modified);
      expect(h1).not.toBe(h2);
    });

    it("should be order-independent for arrays", () => {
      const policy1: PolicyConfig = {
        ...DEFAULT_POLICY,
        allowedAssets: ["USDC", "ETH"],
      };
      const policy2: PolicyConfig = {
        ...DEFAULT_POLICY,
        allowedAssets: ["ETH", "USDC"],
      };
      // Both should produce same hash since we sort internally
      expect(resolver.computePolicyHash(policy1)).toBe(
        resolver.computePolicyHash(policy2),
      );
    });
  });

  describe("resolveIdentity", () => {
    it("should return fallback identity when RPC is unreachable", async () => {
      const identity = await resolver.resolveIdentity("sentinel-agent.eth");

      expect(identity.ensName).toBe("sentinel-agent.eth");
      // Should gracefully degrade to fallback
      expect(identity.metadata).toBeDefined();
      expect(identity.metadata.description).toContain("sentinel-agent.eth");
    });

    it("should cache resolved identities", async () => {
      const id1 = await resolver.resolveIdentity("test.eth");
      const id2 = await resolver.resolveIdentity("test.eth");

      // Same reference from cache
      expect(id1).toBe(id2);
    });

    it("should clear cache when requested", async () => {
      await resolver.resolveIdentity("test.eth");
      resolver.clearCache();
      const id2 = await resolver.resolveIdentity("test.eth");
      // New object after cache clear
      expect(id2.ensName).toBe("test.eth");
    });
  });

  describe("verifyPolicyIntegrity", () => {
    it("should report invalid when no on-chain hash", async () => {
      const result = await resolver.verifyPolicyIntegrity(
        "nonexistent.eth",
        DEFAULT_POLICY,
      );

      expect(result.valid).toBe(false);
      expect(result.localHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(result.onChainHash).toBeUndefined();
    });
  });

  describe("ENS constants", () => {
    it("should reference the correct policy text key", () => {
      expect(ENS_CONSTANTS.policyTextKey).toBe("com.sentinel.policyHash");
    });

    it("should reference the correct agent name", () => {
      expect(ENS_CONSTANTS.agentName).toBe("sentinel-agent.eth");
    });
  });
});

describe("createENSResolver factory", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("should return null when env vars are missing", () => {
    delete process.env.ENS_RPC_URL;
    delete process.env.ETHEREUM_RPC_URL;
    expect(createENSResolver()).toBeNull();
  });

  it("should return a resolver with ENS_RPC_URL", () => {
    process.env.ENS_RPC_URL = "http://localhost:8545";
    const r = createENSResolver();
    expect(r).toBeInstanceOf(ENSResolver);
  });

  it("should fall back to ETHEREUM_RPC_URL", () => {
    delete process.env.ENS_RPC_URL;
    process.env.ETHEREUM_RPC_URL = "http://localhost:8545";
    const r = createENSResolver();
    expect(r).toBeInstanceOf(ENSResolver);
  });
});
