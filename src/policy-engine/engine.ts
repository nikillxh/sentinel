// ============================================================
// Sentinel – Policy Engine
// Hard rule enforcement for AI agent DeFi actions.
// Every swap MUST pass ALL rules or it is rejected.
// ============================================================

import { createHash } from "node:crypto";
import { Logger } from "../shared/logger.js";
import type {
  Asset,
  PolicyConfig,
  PolicyDecision,
  PolicyRule,
  PolicyRuleResult,
  SessionBalance,
  SwapProposal,
} from "../shared/types.js";
import { BPS_DENOMINATOR, DEFAULT_POLICY } from "../shared/constants.js";

// ---- Rule Definitions ----

const RULES: Record<string, PolicyRule> = {
  MAX_TRADE_SIZE: {
    id: "max-trade-size",
    name: "Maximum Trade Size",
    description: "Trade amount must not exceed configured % of session balance",
  },
  ALLOWED_DEX: {
    id: "allowed-dex",
    name: "Allowed DEX",
    description: "Trades may only be routed through whitelisted DEXes",
  },
  ALLOWED_ASSETS: {
    id: "allowed-assets",
    name: "Allowed Assets",
    description: "Only whitelisted assets may be traded",
  },
  MAX_SLIPPAGE: {
    id: "max-slippage",
    name: "Maximum Slippage",
    description: "Slippage tolerance must not exceed configured limit",
  },
} as const;

export class PolicyEngine {
  private config: PolicyConfig;
  private log: Logger;
  private policyHash: string;

  constructor(config: PolicyConfig = DEFAULT_POLICY) {
    this.config = config;
    this.log = new Logger("policy-engine");
    this.policyHash = this.computePolicyHash();
    this.log.info("Policy engine initialized", {
      maxTradePercent: config.maxTradePercent,
      maxSlippageBps: config.maxSlippageBps,
      allowedDexes: config.allowedDexes,
      allowedAssets: config.allowedAssets,
      policyHash: this.policyHash,
    });
  }

  // ---- Public API ----

  /**
   * Evaluate a swap proposal against ALL policy rules.
   * Returns a PolicyDecision with detailed results for every rule.
   * A proposal is approved only if ALL rules pass.
   */
  evaluate(
    proposal: SwapProposal,
    sessionBalances: Map<Asset, SessionBalance>,
  ): PolicyDecision {
    this.log.info(`Evaluating proposal ${proposal.id}`, {
      tokenIn: proposal.tokenIn,
      tokenOut: proposal.tokenOut,
      amountIn: proposal.amountIn,
      dex: proposal.dex,
      slippageBps: proposal.maxSlippageBps,
    });

    const results: PolicyRuleResult[] = [
      this.checkMaxTradeSize(proposal, sessionBalances),
      this.checkAllowedDex(proposal),
      this.checkAllowedAssets(proposal),
      this.checkMaxSlippage(proposal),
    ];

    const approved = results.every((r) => r.passed);
    const decision: PolicyDecision = {
      approved,
      results,
      evaluatedAt: new Date().toISOString(),
      policyHash: this.policyHash,
    };

    // Log each rule result
    for (const r of results) {
      if (r.passed) {
        this.log.debug(`  ✓ ${r.rule.name} passed`, r.details);
      } else {
        this.log.warn(`  ✗ ${r.rule.name} FAILED: ${r.reason}`, r.details);
      }
    }

    this.log.policyResult(
      approved,
      `Proposal ${proposal.id} — ${approved ? "all rules passed" : "one or more rules failed"}`,
    );

    return decision;
  }

  /** Get the hash of the current policy config (for ENS anchoring) */
  getPolicyHash(): string {
    return this.policyHash;
  }

  /** Get the active policy configuration */
  getConfig(): Readonly<PolicyConfig> {
    return this.config;
  }

  // ---- Rule Implementations ----

  /**
   * RULE 1: Max Trade Size
   * The trade amount must not exceed `maxTradePercent`% of the session balance
   * for the input token.
   */
  private checkMaxTradeSize(
    proposal: SwapProposal,
    sessionBalances: Map<Asset, SessionBalance>,
  ): PolicyRuleResult {
    const rule = RULES.MAX_TRADE_SIZE!;
    const balance = sessionBalances.get(proposal.tokenIn);

    if (!balance) {
      return {
        rule,
        passed: false,
        reason: `No session balance found for ${proposal.tokenIn}`,
        details: { value: proposal.amountIn, limit: 0 },
      };
    }

    const maxAllowed =
      (balance.amount * this.config.maxTradePercent) / 100;
    const passed = proposal.amountIn <= maxAllowed;

    return {
      rule,
      passed,
      reason: passed
        ? undefined
        : `Trade amount ${proposal.amountIn} exceeds ${this.config.maxTradePercent}% of balance (max: ${maxAllowed})`,
      details: {
        value: proposal.amountIn,
        limit: maxAllowed,
      },
    };
  }

  /**
   * RULE 2: Allowed DEX
   * Only whitelisted DEXes may be used for execution.
   */
  private checkAllowedDex(proposal: SwapProposal): PolicyRuleResult {
    const rule = RULES.ALLOWED_DEX!;
    const passed = this.config.allowedDexes.includes(proposal.dex);

    return {
      rule,
      passed,
      reason: passed
        ? undefined
        : `DEX "${proposal.dex}" is not whitelisted. Allowed: [${this.config.allowedDexes.join(", ")}]`,
      details: {
        value: proposal.dex,
        limit: this.config.allowedDexes.join(", "),
      },
    };
  }

  /**
   * RULE 3: Allowed Assets
   * Both tokenIn and tokenOut must be in the allowed assets list.
   */
  private checkAllowedAssets(proposal: SwapProposal): PolicyRuleResult {
    const rule = RULES.ALLOWED_ASSETS!;
    const allowed = this.config.allowedAssets;

    const tokenInAllowed = allowed.includes(proposal.tokenIn);
    const tokenOutAllowed = allowed.includes(proposal.tokenOut);
    const passed = tokenInAllowed && tokenOutAllowed;

    const violations: string[] = [];
    if (!tokenInAllowed) violations.push(`tokenIn=${proposal.tokenIn}`);
    if (!tokenOutAllowed) violations.push(`tokenOut=${proposal.tokenOut}`);

    return {
      rule,
      passed,
      reason: passed
        ? undefined
        : `Disallowed assets: ${violations.join(", ")}. Allowed: [${allowed.join(", ")}]`,
      details: {
        value: `${proposal.tokenIn}/${proposal.tokenOut}`,
        limit: allowed.join(", "),
      },
    };
  }

  /**
   * RULE 4: Max Slippage
   * The proposal's slippage tolerance must not exceed the configured maximum.
   */
  private checkMaxSlippage(proposal: SwapProposal): PolicyRuleResult {
    const rule = RULES.MAX_SLIPPAGE!;
    const passed = proposal.maxSlippageBps <= this.config.maxSlippageBps;

    return {
      rule,
      passed,
      reason: passed
        ? undefined
        : `Slippage ${proposal.maxSlippageBps} bps exceeds max ${this.config.maxSlippageBps} bps (${this.config.maxSlippageBps / BPS_DENOMINATOR * 100}%)`,
      details: {
        value: proposal.maxSlippageBps,
        limit: this.config.maxSlippageBps,
      },
    };
  }

  // ---- Utilities ----

  /** Compute a SHA-256 hash of the policy config for ENS anchoring */
  private computePolicyHash(): string {
    const serialized = JSON.stringify(this.config, Object.keys(this.config).sort());
    return "0x" + createHash("sha256").update(serialized).digest("hex");
  }
}
