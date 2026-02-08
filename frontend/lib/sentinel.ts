// ============================================================
// Sentinel Frontend – Core Engine (self-contained)
// Re-implements the core logic inline so Next.js API routes
// don't need cross-project ESM imports.
// ============================================================

import { createHash, randomUUID } from "node:crypto";

// ---- Types ----

export type Asset = "USDC" | "ETH";

export interface SessionBalance {
  asset: Asset;
  amount: number;
  initialAmount: number;
  pnl: number;
}

export interface SwapProposal {
  id: string;
  tokenIn: Asset;
  tokenOut: Asset;
  amountIn: number;
  estimatedAmountOut: number;
  maxSlippageBps: number;
  dex: string;
  timestamp: string;
}

export interface SwapResult {
  proposalId: string;
  success: boolean;
  amountIn: number;
  amountOut: number;
  executedPrice: number;
  executionType: "offchain" | "onchain";
  timestamp: string;
}

export interface PolicyRuleResult {
  ruleId: string;
  ruleName: string;
  passed: boolean;
  reason?: string;
  value: number | string;
  limit: number | string;
}

export interface PolicyDecision {
  approved: boolean;
  results: PolicyRuleResult[];
  evaluatedAt: string;
  policyHash: string;
}

export interface PolicyConfig {
  maxTradePercent: number;
  maxSlippageBps: number;
  allowedDexes: string[];
  allowedAssets: Asset[];
}

export type SessionStatus = "none" | "active" | "closing" | "settled";

export interface AuditEntry {
  id: string;
  type: "swap_approved" | "swap_rejected" | "swap_executed" | "session_opened" | "session_closed" | "session_settled" | "simulation";
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

export interface SwapSimulation {
  tokenIn: Asset;
  tokenOut: Asset;
  amountIn: number;
  estimatedAmountOut: number;
  priceImpactBps: number;
  route: string;
  policyApproved: boolean;
  policyDecision?: PolicyDecision;
}

// ---- Constants ----

const DEFAULT_POLICY: PolicyConfig = {
  maxTradePercent: 2,
  maxSlippageBps: 50,
  allowedDexes: ["uniswap-v4"],
  allowedAssets: ["USDC", "ETH"],
};

const MOCK_PRICES: Record<Asset, number> = { USDC: 1.0, ETH: 2500.0 };

const POOL_RESERVES: Record<string, { reserveA: number; reserveB: number }> = {
  "USDC/ETH": { reserveA: 2_500_000, reserveB: 1_000 },
  "ETH/USDC": { reserveA: 1_000, reserveB: 2_500_000 },
};

const FEE_BPS = 30;

// ---- Sentinel Engine (singleton) ----

class SentinelEngine {
  private policy: PolicyConfig;
  private policyHash: string;
  private balances: Map<Asset, SessionBalance> = new Map();
  private history: SwapResult[] = [];
  private audit: AuditEntry[] = [];
  private sessionId: string | null = null;
  private status: SessionStatus = "none";
  private openedAt: string | null = null;
  private closedAt: string | null = null;
  private settlementTxHash: string | null = null;

  constructor(policy: PolicyConfig = DEFAULT_POLICY) {
    this.policy = policy;
    this.policyHash = this.computePolicyHash();
  }

  // ---- Session ----

  openSession(depositUsdc: number = 1000): {
    sessionId: string;
    status: SessionStatus;
  } {
    if (this.status === "active") {
      throw new Error("A session is already active.");
    }

    this.sessionId = `session-${randomUUID().slice(0, 8)}`;
    this.status = "active";
    this.openedAt = new Date().toISOString();
    this.closedAt = null;
    this.settlementTxHash = null;
    this.history = [];

    this.balances = new Map<Asset, SessionBalance>([
      ["USDC", { asset: "USDC", amount: depositUsdc, initialAmount: depositUsdc, pnl: 0 }],
      ["ETH", { asset: "ETH", amount: 0, initialAmount: 0, pnl: 0 }],
    ]);

    this.addAudit("session_opened", `Session ${this.sessionId} opened with ${depositUsdc} USDC`, {
      depositUsdc,
    });

    return { sessionId: this.sessionId, status: this.status };
  }

  closeSession(): { sessionId: string; status: SessionStatus } {
    this.assertActive();
    this.status = "closing";

    this.addAudit("session_closed", `Session ${this.sessionId} closed`, {
      totalSwaps: this.history.length,
      finalBalances: this.getBalancesObj(),
    });

    // Auto-settle with mock tx hash
    const txHash = `0x${randomUUID().replace(/-/g, "")}`;
    this.status = "settled";
    this.closedAt = new Date().toISOString();
    this.settlementTxHash = txHash;

    this.addAudit("session_settled", `Session settled with tx ${txHash}`, {
      txHash,
    });

    return { sessionId: this.sessionId!, status: this.status };
  }

  getSessionState() {
    return {
      sessionId: this.sessionId,
      status: this.status,
      balances: this.getBalancesObj(),
      pnl: this.getPnlObj(),
      totalSwaps: this.history.length,
      totalValueUsd: this.getTotalValueUsd(),
      history: this.history,
      openedAt: this.openedAt,
      closedAt: this.closedAt,
      settlementTxHash: this.settlementTxHash,
      policyHash: this.policyHash,
    };
  }

  getBalance(asset: Asset): SessionBalance | null {
    return this.balances.get(asset) ?? null;
  }

  // ---- Swap Simulation ----

  simulate(tokenIn: Asset, tokenOut: Asset, amountIn: number): SwapSimulation {
    const pairKey = `${tokenIn}/${tokenOut}`;
    const pool = POOL_RESERVES[pairKey];
    if (!pool) throw new Error(`No pool for ${pairKey}`);

    const amountInAfterFee = amountIn * (1 - FEE_BPS / 10_000);
    const { reserveA, reserveB } = pool;
    const amountOut = (reserveB * amountInAfterFee) / (reserveA + amountInAfterFee);
    const spotPrice = reserveB / reserveA;
    const executionPrice = amountOut / amountIn;
    const priceImpactBps = Math.round(Math.abs(1 - executionPrice / spotPrice) * 10_000);

    // Build a mock proposal to evaluate policy
    const proposal: SwapProposal = {
      id: `sim-${randomUUID().slice(0, 8)}`,
      tokenIn,
      tokenOut,
      amountIn,
      estimatedAmountOut: Number(amountOut.toFixed(8)),
      maxSlippageBps: 50,
      dex: "uniswap-v4",
      timestamp: new Date().toISOString(),
    };

    const decision = this.evaluatePolicy(proposal);

    this.addAudit("simulation", `Simulated ${amountIn} ${tokenIn} → ${tokenOut}`, {
      estimatedOut: Number(amountOut.toFixed(8)),
      priceImpactBps,
      policyApproved: decision.approved,
    });

    return {
      tokenIn,
      tokenOut,
      amountIn,
      estimatedAmountOut: Number(amountOut.toFixed(8)),
      priceImpactBps,
      route: `${tokenIn} →[Uniswap v4 0.3%]→ ${tokenOut}`,
      policyApproved: decision.approved,
      policyDecision: decision,
    };
  }

  // ---- Swap Execution ----

  executeSwap(
    tokenIn: Asset,
    tokenOut: Asset,
    amountIn: number,
    slippageBps: number = 50,
    dex: string = "uniswap-v4",
  ): { result?: SwapResult; policyDecision: PolicyDecision } {
    this.assertActive();

    // Simulate
    const pairKey = `${tokenIn}/${tokenOut}`;
    const pool = POOL_RESERVES[pairKey];
    if (!pool) throw new Error(`No pool for ${pairKey}`);

    const amountInAfterFee = amountIn * (1 - FEE_BPS / 10_000);
    const amountOut =
      (pool.reserveB * amountInAfterFee) / (pool.reserveA + amountInAfterFee);

    // Build proposal
    const proposal: SwapProposal = {
      id: `prop-${randomUUID().slice(0, 8)}`,
      tokenIn,
      tokenOut,
      amountIn,
      estimatedAmountOut: Number(amountOut.toFixed(8)),
      maxSlippageBps: slippageBps,
      dex,
      timestamp: new Date().toISOString(),
    };

    // Policy check
    const decision = this.evaluatePolicy(proposal);

    if (!decision.approved) {
      const reasons = decision.results
        .filter((r) => !r.passed)
        .map((r) => `${r.ruleName}: ${r.reason}`)
        .join("; ");

      this.addAudit("swap_rejected", `Swap rejected: ${reasons}`, {
        proposalId: proposal.id,
        tokenIn,
        tokenOut,
        amountIn,
        reasons,
      });

      return { policyDecision: decision };
    }

    // Execute off-chain
    const balIn = this.balances.get(tokenIn)!;
    const balOut = this.balances.get(tokenOut)!;

    if (balIn.amount < amountIn) {
      throw new Error(`Insufficient ${tokenIn}: have ${balIn.amount}, need ${amountIn}`);
    }

    balIn.amount -= amountIn;
    balIn.pnl = balIn.amount - balIn.initialAmount;
    balOut.amount += Number(amountOut.toFixed(8));
    balOut.pnl = balOut.amount - balOut.initialAmount;

    const result: SwapResult = {
      proposalId: proposal.id,
      success: true,
      amountIn,
      amountOut: Number(amountOut.toFixed(8)),
      executedPrice: Number(amountOut.toFixed(8)) / amountIn,
      executionType: "offchain",
      timestamp: new Date().toISOString(),
    };

    this.history.push(result);

    this.addAudit("swap_executed", `Executed ${amountIn} ${tokenIn} → ${result.amountOut} ${tokenOut}`, {
      proposalId: proposal.id,
      amountIn,
      amountOut: result.amountOut,
      executedPrice: result.executedPrice,
    });

    return { result, policyDecision: decision };
  }

  // ---- Policy ----

  evaluatePolicy(proposal: SwapProposal): PolicyDecision {
    const results: PolicyRuleResult[] = [];

    // Rule 1: Max Trade Size
    const balance = this.balances.get(proposal.tokenIn);
    const maxAllowed = balance ? (balance.amount * this.policy.maxTradePercent) / 100 : 0;
    const tradeSizePassed = proposal.amountIn <= maxAllowed;
    results.push({
      ruleId: "max-trade-size",
      ruleName: "Maximum Trade Size",
      passed: tradeSizePassed,
      reason: tradeSizePassed ? undefined : `Trade amount ${proposal.amountIn} exceeds ${this.policy.maxTradePercent}% of balance (max: ${maxAllowed.toFixed(2)})`,
      value: proposal.amountIn,
      limit: Number(maxAllowed.toFixed(2)),
    });

    // Rule 2: Allowed DEX
    const dexPassed = this.policy.allowedDexes.includes(proposal.dex);
    results.push({
      ruleId: "allowed-dex",
      ruleName: "Allowed DEX",
      passed: dexPassed,
      reason: dexPassed ? undefined : `DEX "${proposal.dex}" not whitelisted`,
      value: proposal.dex,
      limit: this.policy.allowedDexes.join(", "),
    });

    // Rule 3: Allowed Assets
    const assetsOk =
      this.policy.allowedAssets.includes(proposal.tokenIn) &&
      this.policy.allowedAssets.includes(proposal.tokenOut);
    results.push({
      ruleId: "allowed-assets",
      ruleName: "Allowed Assets",
      passed: assetsOk,
      reason: assetsOk ? undefined : `Asset not whitelisted`,
      value: `${proposal.tokenIn}/${proposal.tokenOut}`,
      limit: this.policy.allowedAssets.join(", "),
    });

    // Rule 4: Max Slippage
    const slipOk = proposal.maxSlippageBps <= this.policy.maxSlippageBps;
    results.push({
      ruleId: "max-slippage",
      ruleName: "Maximum Slippage",
      passed: slipOk,
      reason: slipOk ? undefined : `Slippage ${proposal.maxSlippageBps}bps exceeds max ${this.policy.maxSlippageBps}bps`,
      value: proposal.maxSlippageBps,
      limit: this.policy.maxSlippageBps,
    });

    return {
      approved: results.every((r) => r.passed),
      results,
      evaluatedAt: new Date().toISOString(),
      policyHash: this.policyHash,
    };
  }

  getPolicy(): PolicyConfig & { policyHash: string } {
    return { ...this.policy, policyHash: this.policyHash };
  }

  // ---- Audit ----

  getAuditLog(): AuditEntry[] {
    return [...this.audit];
  }

  // ---- Helpers ----

  private assertActive() {
    if (this.status !== "active") {
      throw new Error(`Session not active (current: "${this.status}")`);
    }
  }

  private getTotalValueUsd(): number {
    let total = 0;
    for (const [asset, bal] of this.balances) {
      total += bal.amount * (MOCK_PRICES[asset] ?? 0);
    }
    return Number(total.toFixed(4));
  }

  private getBalancesObj(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [asset, bal] of this.balances) out[asset] = bal.amount;
    return out;
  }

  private getPnlObj(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [asset, bal] of this.balances) out[asset] = bal.pnl;
    return out;
  }

  private addAudit(type: AuditEntry["type"], message: string, details?: Record<string, unknown>) {
    this.audit.push({
      id: `audit-${randomUUID().slice(0, 8)}`,
      type,
      message,
      details,
      timestamp: new Date().toISOString(),
    });
  }

  private computePolicyHash(): string {
    const serialized = JSON.stringify(this.policy, Object.keys(this.policy).sort());
    return "0x" + createHash("sha256").update(serialized).digest("hex");
  }
}

// ---- Global Singleton ----
// Next.js API routes can be re-initialized on hot reload; use globalThis to persist state.

const globalForSentinel = globalThis as unknown as { sentinel?: SentinelEngine };

export function getSentinel(): SentinelEngine {
  if (!globalForSentinel.sentinel) {
    globalForSentinel.sentinel = new SentinelEngine();
  }
  return globalForSentinel.sentinel;
}
