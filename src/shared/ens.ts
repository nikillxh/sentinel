// ============================================================
// Sentinel – ENS Identity Resolver
// Resolves agent identity from ENS names, reads text records
// for policy hashes, and verifies policy integrity.
//
// The agent's ENS name (e.g., "sentinel-agent.eth") stores:
//   - Standard records (address, avatar, description)
//   - Custom text record: "com.sentinel.policyHash" → SHA-256
//     hash of the policy config, allowing on-chain verification
//     that the agent's policy hasn't been tampered with.
//
// Docs: https://docs.ens.domains/
// ============================================================

import { JsonRpcProvider, namehash, isAddress } from "ethers";
import { createHash } from "node:crypto";
import { Logger } from "./logger.js";
import { ENS, CHAIN } from "./constants.js";
import type { AgentIdentity, PolicyConfig } from "./types.js";

// ---- ENS Resolver ABI (subset) ----

const ENS_RESOLVER_ABI = [
  "function addr(bytes32 node) external view returns (address)",
  "function text(bytes32 node, string key) external view returns (string)",
  "function name(bytes32 node) external view returns (string)",
] as const;

const ENS_REGISTRY_ABI = [
  "function resolver(bytes32 node) external view returns (address)",
] as const;

// ---- ENS Config ----

export interface ENSConfig {
  /** RPC URL for ENS resolution (Ethereum mainnet or L2 with CCIP-Read) */
  rpcUrl: string;
  /** ENS Registry address (defaults to mainnet) */
  registryAddress?: string;
}

// ---- Resolver Class ----

export class ENSResolver {
  private provider: JsonRpcProvider;
  private log = new Logger("ens");
  private config: ENSConfig;
  private cache = new Map<string, AgentIdentity>();

  /** Standard ENS Registry on Ethereum mainnet */
  static readonly ENS_REGISTRY =
    "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";

  constructor(config: ENSConfig) {
    this.config = config;
    this.provider = new JsonRpcProvider(config.rpcUrl);
    this.log.info("ENS resolver initialized", {
      registryAddress:
        config.registryAddress ?? ENSResolver.ENS_REGISTRY,
    });
  }

  /**
   * Resolve a full AgentIdentity from an ENS name.
   *
   * Steps:
   *   1. Compute namehash
   *   2. Look up resolver via Registry
   *   3. Resolve address via resolver.addr()
   *   4. Read text record for policy hash
   *   5. Optionally read description/avatar
   */
  async resolveIdentity(ensName: string): Promise<AgentIdentity> {
    // Check cache
    const cached = this.cache.get(ensName);
    if (cached) {
      this.log.debug(`Cache hit for ${ensName}`);
      return cached;
    }

    this.log.info(`Resolving identity for ${ensName}...`);

    try {
      const node = namehash(ensName);

      // Step 1: Get resolver address from registry
      const resolverAddress = await this.getResolverAddress(node);

      if (!resolverAddress || resolverAddress === "0x" + "0".repeat(40)) {
        this.log.warn(`No resolver found for ${ensName}`);
        const fallback = this.buildFallbackIdentity(ensName);
        this.cache.set(ensName, fallback);
        return fallback;
      }

      // Step 2: Resolve the address
      const { Contract } = await import("ethers");
      const resolver = new Contract(
        resolverAddress,
        ENS_RESOLVER_ABI,
        this.provider,
      );

      const addrFn = resolver.getFunction("addr");
      const textFn = resolver.getFunction("text");

      const address = await addrFn(node).catch(() => null);

      // Step 3: Read policy hash text record
      const policyHash = await textFn(
        node,
        ENS.policyTextKey,
      ).catch(() => null);

      // Step 4: Read metadata
      const description = await textFn(
        node,
        "description",
      ).catch(() => null);

      const identity: AgentIdentity = {
        ensName,
        resolvedAddress:
          address && isAddress(address)
            ? (address as `0x${string}`)
            : undefined,
        policyHash: policyHash || undefined,
        metadata: {
          description: description || `Sentinel agent: ${ensName}`,
          registeredAt: new Date().toISOString(),
        },
      };

      this.cache.set(ensName, identity);
      this.log.info(`Resolved identity for ${ensName}`, {
        address: identity.resolvedAddress ?? "unset",
        policyHash: identity.policyHash
          ? `${identity.policyHash.slice(0, 16)}...`
          : "none",
      });

      return identity;
    } catch (err) {
      this.log.warn(`ENS resolution failed for ${ensName}`, {
        error: err instanceof Error ? err.message : String(err),
      });
      const fallback = this.buildFallbackIdentity(ensName);
      this.cache.set(ensName, fallback);
      return fallback;
    }
  }

  /**
   * Verify that the on-chain policy hash matches the local policy config.
   * Returns true if the hashes match (policy hasn't been tampered with).
   */
  async verifyPolicyIntegrity(
    ensName: string,
    localPolicy: PolicyConfig,
  ): Promise<{ valid: boolean; localHash: string; onChainHash?: string }> {
    const localHash = this.computePolicyHash(localPolicy);
    const identity = await this.resolveIdentity(ensName);

    if (!identity.policyHash) {
      this.log.warn(
        "No on-chain policy hash found — cannot verify integrity",
      );
      return { valid: false, localHash };
    }

    const valid = identity.policyHash === localHash;

    this.log.info("Policy integrity check", {
      valid,
      localHash: `${localHash.slice(0, 16)}...`,
      onChainHash: `${identity.policyHash.slice(0, 16)}...`,
    });

    return {
      valid,
      localHash,
      onChainHash: identity.policyHash,
    };
  }

  /**
   * Compute a deterministic SHA-256 hash of a PolicyConfig.
   * This is the same format stored in the ENS text record.
   */
  computePolicyHash(policy: PolicyConfig): string {
    const normalized = JSON.stringify({
      maxTradePercent: policy.maxTradePercent,
      maxSlippageBps: policy.maxSlippageBps,
      allowedDexes: [...policy.allowedDexes].sort(),
      allowedAssets: [...policy.allowedAssets].sort(),
    });
    return `0x${createHash("sha256").update(normalized).digest("hex")}`;
  }

  /**
   * Clear the resolution cache.
   */
  clearCache(): void {
    this.cache.clear();
  }

  // ---- Internal ----

  private async getResolverAddress(node: string): Promise<string | null> {
    try {
      const { Contract } = await import("ethers");
      const registry = new Contract(
        this.config.registryAddress ?? ENSResolver.ENS_REGISTRY,
        ENS_REGISTRY_ABI,
        this.provider,
      );
      const resolverFn = registry.getFunction("resolver");
      return await resolverFn(node);
    } catch {
      return null;
    }
  }

  private buildFallbackIdentity(ensName: string): AgentIdentity {
    return {
      ensName,
      resolvedAddress: undefined,
      policyHash: undefined,
      metadata: {
        description: `Sentinel agent (unresolved): ${ensName}`,
        registeredAt: new Date().toISOString(),
      },
    };
  }
}

// ---- Factory ----

/**
 * Create an ENSResolver from environment variables.
 * Returns null if required env vars are missing.
 */
export function createENSResolver(): ENSResolver | null {
  const rpcUrl = process.env.ENS_RPC_URL ?? process.env.ETHEREUM_RPC_URL;

  if (!rpcUrl) {
    return null;
  }

  return new ENSResolver({
    rpcUrl,
    registryAddress: process.env.ENS_REGISTRY_ADDRESS,
  });
}
