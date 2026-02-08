// ============================================================
// Sentinel Frontend – API Proxy
// Thin wrapper that proxies all calls to the real Sentinel
// backend API server running on port 3001. No logic here —
// the real PolicyEngine, SessionManager, SwapSimulator,
// Nitrolite channel, and ENS resolver live in src/.
// ============================================================

// ---- Types ----

export type Asset = "USDC" | "ETH";

export interface SessionBalance {
  asset: Asset;
  amount: number;
  initialAmount: number;
  pnl: number;
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
  policyHash: string;
}

export type SessionStatus = "none" | "active" | "closing" | "settled";

export interface AuditEntry {
  id: string;
  type: string;
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

export interface AgentIdentityInfo {
  ensName: string;
  resolvedAddress?: string;
  policyHash?: string;
  metadata?: Record<string, string>;
}

export interface ChannelInfo {
  channelId: string;
  status: string;
  stateUpdates: number;
  latestHash: string | null;
}

export interface SessionState {
  sessionId: string | null;
  status: SessionStatus;
  balances: Record<string, number>;
  pnl: Record<string, number>;
  totalSwaps: number;
  totalValueUsd: number;
  history: SwapResult[];
  openedAt: string | null;
  closedAt: string | null;
  settlementTxHash: string | null;
  policyHash: string;
  agentIdentity: AgentIdentityInfo | null;
  channelInfo: ChannelInfo | null;
}

export interface IntegrationStatus {
  policyEngine: string;
  sessionManager: string;
  swapSimulator: string;
  nitrolite: string;
  ens: string;
  settlement: string;
}

// ---- Backend API URL ----

const API_BASE =
  process.env.SENTINEL_API_URL ??
  process.env.NEXT_PUBLIC_SENTINEL_API_URL ??
  "http://localhost:3001";

// ---- Sentinel API Client ----

class SentinelClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE) {
    this.baseUrl = baseUrl;
  }

  // ---- Session ----

  async getSessionState(): Promise<SessionState> {
    const res = await fetch(`${this.baseUrl}/api/session`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error ?? "Failed to get session state");
    }
    return res.json();
  }

  async openSession(depositUsdc: number = 1000): Promise<{
    sessionId: string;
    status: SessionStatus;
    agentIdentity: AgentIdentityInfo | null;
    channelInfo: ChannelInfo | null;
  }> {
    const res = await fetch(`${this.baseUrl}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ depositUsdc }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error ?? "Failed to open session");
    }
    return res.json();
  }

  async closeSession(): Promise<{
    sessionId: string;
    status: SessionStatus;
    settlementTxHash: string;
    blockNumber: number | null;
    onChain: boolean;
    channelInfo: ChannelInfo | null;
  }> {
    const res = await fetch(`${this.baseUrl}/api/session`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error ?? "Failed to close session");
    }
    return res.json();
  }

  // ---- Swap Simulation ----

  async simulate(
    tokenIn: Asset,
    tokenOut: Asset,
    amountIn: number,
  ): Promise<SwapSimulation> {
    const res = await fetch(`${this.baseUrl}/api/simulate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokenIn, tokenOut, amountIn }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error ?? "Failed to simulate swap");
    }
    return res.json();
  }

  // ---- Swap Execution ----

  async executeSwap(
    tokenIn: Asset,
    tokenOut: Asset,
    amountIn: number,
    slippageBps: number = 50,
    dex: string = "uniswap-v4",
  ): Promise<{ result: SwapResult | null; policyDecision: PolicyDecision }> {
    const res = await fetch(`${this.baseUrl}/api/swap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokenIn, tokenOut, amountIn, slippageBps, dex }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error ?? "Failed to execute swap");
    }
    return res.json();
  }

  // ---- Policy ----

  async getPolicy(): Promise<PolicyConfig> {
    const res = await fetch(`${this.baseUrl}/api/policy`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error ?? "Failed to get policy");
    }
    return res.json();
  }

  // ---- Audit ----

  async getAuditLog(): Promise<AuditEntry[]> {
    const res = await fetch(`${this.baseUrl}/api/audit`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error ?? "Failed to get audit log");
    }
    return res.json();
  }

  // ---- Status ----

  async getIntegrationStatus(): Promise<{
    status: string;
    integrations: IntegrationStatus;
    policyHash: string;
    timestamp: string;
  }> {
    const res = await fetch(`${this.baseUrl}/api/status`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error ?? "Failed to get status");
    }
    return res.json();
  }
}

// ---- Global Singleton ----

const globalForSentinel = globalThis as unknown as { sentinel?: SentinelClient };

export function getSentinel(): SentinelClient {
  if (!globalForSentinel.sentinel) {
    globalForSentinel.sentinel = new SentinelClient();
  }
  return globalForSentinel.sentinel;
}
