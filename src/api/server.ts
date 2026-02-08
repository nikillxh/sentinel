// ============================================================
// Sentinel – Backend API Server
// Lightweight HTTP server wrapping the real PolicyEngine,
// SessionManager, SwapSimulator, ENS resolver, and Nitrolite
// channel. The frontend proxies all calls here.
//
// Port: 3001 (configurable via API_PORT env var)
// ============================================================

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { Logger } from "../shared/logger.js";
import { DEFAULT_POLICY, DEX } from "../shared/constants.js";
import type {
  Asset,
  SwapProposal,
  PolicyDecision,
  PolicyRuleResult,
  SwapResult,
  SessionBalance,
  AgentIdentity,
} from "../shared/types.js";
import { PolicyEngine } from "../policy-engine/engine.js";
import { SessionManager } from "../session/manager.js";
import { SwapSimulator } from "../mcp-server/swap-simulator.js";
import { createUniswapV4Client } from "../mcp-server/uniswap-client.js";
import { createNitroliteChannel, type NitroliteChannel } from "../session/channel.js";
import { createENSResolver, type ENSResolver } from "../shared/ens.js";
import { createSettlementClient, type SettlementClient } from "../contracts/index.js";
import { createAgent, type SentinelAgent, type ToolExecutor } from "../agent/index.js";

// Load env
config();

const log = new Logger("api");
const API_PORT = Number(process.env.API_PORT ?? 3001);

// ---- Initialize Real Services ----

const nitroliteChannel = createNitroliteChannel();
const policyEngine = new PolicyEngine(DEFAULT_POLICY);
const sessionManager = new SessionManager(nitroliteChannel);
const v4Client = createUniswapV4Client();
const swapSimulator = new SwapSimulator(v4Client);
const ensResolver = createENSResolver();
const settlementClient = createSettlementClient();

// ---- Initialize AI Agent ----

const agent = createAgent();

// Wire the agent's tool executor to real services
function createToolExecutor(): ToolExecutor {
  return {
    async getBalance(asset) {
      try {
        const balance = sessionManager.getBalance(asset);
        return { success: true, data: balance, timestamp: new Date().toISOString() };
      } catch (e) {
        return { success: false, error: (e as Error).message, timestamp: new Date().toISOString() };
      }
    },
    async simulateSwap(tokenIn, tokenOut, amount) {
      const simulation = await swapSimulator.simulate(tokenIn, tokenOut, amount);
      // Policy dry-run
      const proposal: SwapProposal = {
        id: `ai-sim-${randomUUID().slice(0, 8)}`,
        tokenIn, tokenOut, amountIn: amount,
        estimatedAmountOut: simulation.estimatedAmountOut,
        maxSlippageBps: 50, dex: DEX.UNISWAP_V4,
        timestamp: new Date().toISOString(),
      };
      let policyApproved = false;
      try {
        const decision = policyEngine.evaluate(proposal, sessionManager.getBalances());
        policyApproved = decision.approved;
      } catch { /* session not active */ }
      return {
        ...simulation,
        policyApproved,
        route: simulation.route,
      } as any;
    },
    async proposeSwap(tokenIn, tokenOut, amount) {
      const simulation = await swapSimulator.simulate(tokenIn, tokenOut, amount);
      const proposal: SwapProposal = {
        id: `ai-prop-${randomUUID().slice(0, 8)}`,
        tokenIn, tokenOut, amountIn: amount,
        estimatedAmountOut: simulation.estimatedAmountOut,
        maxSlippageBps: 50, dex: DEX.UNISWAP_V4,
        timestamp: new Date().toISOString(),
      };
      const decision = policyEngine.evaluate(proposal, sessionManager.getBalances());
      if (!decision.approved) {
        const reasons = decision.results.filter(r => !r.passed).map(r => `${r.rule.name}: ${r.reason}`).join("; ");
        addAudit("ai_swap_rejected", `AI swap rejected: ${reasons}`, { tokenIn, tokenOut, amount });
        return { success: false, error: `Policy rejected: ${reasons}`, policyDecision: decision, timestamp: new Date().toISOString() };
      }
      const result = await sessionManager.applySwap(tokenIn, tokenOut, amount, simulation.estimatedAmountOut, proposal.id);
      addAudit("ai_swap_executed", `AI executed ${amount} ${tokenIn} → ${result.amountOut} ${tokenOut}`, { proposalId: proposal.id, amountOut: result.amountOut });
      return { success: true, data: { swapResult: result, proposal }, policyDecision: decision, timestamp: new Date().toISOString() };
    },
    async closeSession() {
      const session = await sessionManager.close();
      let txHash: `0x${string}`;
      if (settlementClient) {
        const record = await settlementClient.settle(session);
        txHash = record.txHash;
      } else {
        txHash = `0x${randomUUID().replace(/-/g, "")}${randomUUID().replace(/-/g, "").slice(0, 32)}` as `0x${string}`;
      }
      sessionManager.markSettled(txHash);
      addAudit("ai_session_settled", `AI settled session: ${txHash}`, { txHash });
      return { success: true, data: { txHash }, timestamp: new Date().toISOString() };
    },
    getSessionSummary() {
      try {
        return { ...sessionManager.getSummary() };
      } catch {
        return { balances: { USDC: 0, ETH: 0 }, totalSwaps: 0, totalValueUsd: 0, status: "none" as any };
      }
    },
  };
}

agent.setToolExecutor(createToolExecutor());

// Track audit log in-memory (mirrors session lifecycle)
interface AuditEntry {
  id: string;
  type: string;
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

let auditLog: AuditEntry[] = [];
let agentIdentity: AgentIdentity | null = null;
let channelInfo: {
  channelId: string;
  status: string;
  stateUpdates: number;
  latestHash: string | null;
} | null = null;

function addAudit(type: string, message: string, details?: Record<string, unknown>): void {
  auditLog.push({
    id: `audit-${randomUUID().slice(0, 8)}`,
    type,
    message,
    details,
    timestamp: new Date().toISOString(),
  });
}

// ---- HTTP Helpers ----

function cors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  cors(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value,
  ));
}

function errorResp(res: ServerResponse, error: string, status = 400): void {
  json(res, { error }, status);
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const body = Buffer.concat(chunks).toString();
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

// Helper to serialize session balances (Map → Object)
function serializeBalances(balances: Map<Asset, SessionBalance>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [asset, bal] of balances) out[asset] = bal.amount;
  return out;
}

function serializePnl(balances: Map<Asset, SessionBalance>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [asset, bal] of balances) out[asset] = bal.pnl;
  return out;
}

// Serialize PolicyDecision to frontend-compatible format
function serializePolicyDecision(decision: PolicyDecision): Record<string, unknown> {
  return {
    approved: decision.approved,
    results: decision.results.map((r: PolicyRuleResult) => ({
      ruleId: r.rule.id,
      ruleName: r.rule.name,
      passed: r.passed,
      reason: r.reason,
      value: r.details?.value,
      limit: r.details?.limit,
    })),
    evaluatedAt: decision.evaluatedAt,
    policyHash: decision.policyHash,
  };
}

// ---- Route Handlers ----

async function handleSession(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method;

  if (method === "GET") {
    try {
      const session = sessionManager.getSession();
      const summary = sessionManager.getSummary();
      json(res, {
        sessionId: session.sessionId,
        status: session.status,
        balances: serializeBalances(session.balances),
        pnl: serializePnl(session.balances),
        totalSwaps: session.history.length,
        totalValueUsd: sessionManager.getTotalValueUsd(),
        history: session.history,
        openedAt: session.openedAt,
        closedAt: session.closedAt ?? null,
        settlementTxHash: session.settlementTxHash ?? null,
        policyHash: policyEngine.getPolicyHash(),
        agentIdentity: agentIdentity ?? null,
        channelInfo: channelInfo ?? null,
      });
    } catch (e) {
      // No active session
      json(res, {
        sessionId: null,
        status: "none",
        balances: { USDC: 0, ETH: 0 },
        pnl: { USDC: 0, ETH: 0 },
        totalSwaps: 0,
        totalValueUsd: 0,
        history: [],
        openedAt: null,
        closedAt: null,
        settlementTxHash: null,
        policyHash: policyEngine.getPolicyHash(),
        agentIdentity: agentIdentity ?? null,
        channelInfo: channelInfo ?? null,
      });
    }
    return;
  }

  if (method === "POST") {
    try {
      const body = await readBody(req);
      const depositUsdc = (body.depositUsdc as number) ?? 1000;

      const session = await sessionManager.open(depositUsdc);

      // Resolve ENS identity if configured
      if (ensResolver) {
        const ensName = process.env.AGENT_ENS_NAME ?? "sentinel-agent.eth";
        try {
          agentIdentity = await ensResolver.resolveIdentity(ensName);
          log.info(`ENS identity resolved: ${ensName}`, {
            address: agentIdentity.resolvedAddress ?? "unresolved",
            policyHash: agentIdentity.policyHash ? `${agentIdentity.policyHash.slice(0, 16)}...` : "none",
          });
          addAudit("session_opened", `ENS identity resolved: ${ensName}`, {
            ensName,
            address: agentIdentity.resolvedAddress ?? "unresolved",
          });
        } catch (err) {
          log.warn("ENS resolution failed, continuing without identity", {
            error: err instanceof Error ? err.message : String(err),
          });
          agentIdentity = null;
        }
      }

      // Record Nitrolite channel info
      if (nitroliteChannel) {
        const ch = nitroliteChannel.getChannel();
        if (ch) {
          channelInfo = {
            channelId: ch.channelId,
            status: ch.status,
            stateUpdates: ch.stateHistory.length,
            latestHash: nitroliteChannel.getLatestStateHash(),
          };
        }
      }

      addAudit("session_opened", `Session ${session.sessionId} opened with ${depositUsdc} USDC`, {
        depositUsdc,
        nitrolite: nitroliteChannel !== null,
        ens: agentIdentity?.ensName ?? null,
      });

      json(res, {
        sessionId: session.sessionId,
        status: session.status,
        agentIdentity: agentIdentity ?? null,
        channelInfo: channelInfo ?? null,
      });
    } catch (e) {
      errorResp(res, (e as Error).message);
    }
    return;
  }

  if (method === "DELETE") {
    try {
      // Close the session
      const session = await sessionManager.close();
      const summary = sessionManager.getSummary();

      // On-chain settlement
      let txHash: `0x${string}`;
      let blockNumber: number | undefined;

      if (settlementClient) {
        log.info("Submitting on-chain settlement...");
        const record = await settlementClient.settle(session);
        txHash = record.txHash;
        blockNumber = record.blockNumber;
        log.info(`Settlement confirmed: ${txHash} (block ${blockNumber})`);
      } else {
        txHash = `0x${randomUUID().replace(/-/g, "")}${randomUUID().replace(/-/g, "").slice(0, 32)}` as `0x${string}`;
      }

      const settled = sessionManager.markSettled(txHash);

      addAudit("session_settled", `Session settled: ${txHash}`, {
        txHash,
        blockNumber: blockNumber ?? "mock",
        finalBalances: serializeBalances(session.balances),
        totalSwaps: summary.totalSwaps,
        onChain: settlementClient !== null,
      });

      // Update channel info
      if (nitroliteChannel) {
        const ch = nitroliteChannel.getChannel();
        if (ch) {
          channelInfo = {
            channelId: ch.channelId,
            status: ch.status,
            stateUpdates: ch.stateHistory.length,
            latestHash: nitroliteChannel.getLatestStateHash(),
          };
        }
      }

      json(res, {
        sessionId: settled.sessionId,
        status: settled.status,
        settlementTxHash: txHash,
        blockNumber: blockNumber ?? null,
        onChain: settlementClient !== null,
        channelInfo: channelInfo ?? null,
      });
    } catch (e) {
      errorResp(res, (e as Error).message);
    }
    return;
  }

  errorResp(res, "Method not allowed", 405);
}

async function handleSimulate(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return errorResp(res, "Method not allowed", 405);

  try {
    const body = await readBody(req);
    const tokenIn = body.tokenIn as Asset;
    const tokenOut = body.tokenOut as Asset;
    const amountIn = body.amountIn as number;

    if (!tokenIn || !tokenOut || !amountIn) {
      return errorResp(res, "Missing tokenIn, tokenOut, or amountIn");
    }
    if (tokenIn === tokenOut) {
      return errorResp(res, `Cannot swap ${tokenIn} to itself`);
    }

    // Real simulation via SwapSimulator (uses Uniswap v4 or local AMM)
    const simulation = await swapSimulator.simulate(tokenIn, tokenOut, amountIn);

    // Policy dry-run
    const proposal: SwapProposal = {
      id: `sim-${randomUUID().slice(0, 8)}`,
      tokenIn,
      tokenOut,
      amountIn,
      estimatedAmountOut: simulation.estimatedAmountOut,
      maxSlippageBps: 50,
      dex: DEX.UNISWAP_V4,
      timestamp: new Date().toISOString(),
    };

    let policyDecision: PolicyDecision;
    try {
      policyDecision = policyEngine.evaluate(proposal, sessionManager.getBalances());
    } catch {
      // Session not active — use dummy balances for simulation
      const dummyBalances = new Map<Asset, SessionBalance>([
        ["USDC", { asset: "USDC", amount: 1000, initialAmount: 1000, pnl: 0 }],
        ["ETH", { asset: "ETH", amount: 0, initialAmount: 0, pnl: 0 }],
      ]);
      policyDecision = policyEngine.evaluate(proposal, dummyBalances);
    }

    addAudit("simulation", `Simulated ${amountIn} ${tokenIn} → ${tokenOut}`, {
      estimatedOut: simulation.estimatedAmountOut,
      priceImpactBps: simulation.priceImpactBps,
      route: simulation.route,
      policyApproved: policyDecision.approved,
      usingOnChainQuote: v4Client !== null,
    });

    json(res, {
      tokenIn,
      tokenOut,
      amountIn,
      estimatedAmountOut: simulation.estimatedAmountOut,
      priceImpactBps: simulation.priceImpactBps,
      route: simulation.route,
      policyApproved: policyDecision.approved,
      policyDecision: serializePolicyDecision(policyDecision),
    });
  } catch (e) {
    errorResp(res, (e as Error).message);
  }
}

async function handleSwap(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return errorResp(res, "Method not allowed", 405);

  try {
    const body = await readBody(req);
    const tokenIn = body.tokenIn as Asset;
    const tokenOut = body.tokenOut as Asset;
    const amountIn = body.amountIn as number;
    const slippageBps = (body.slippageBps as number) ?? 50;
    const dex = (body.dex as string) ?? DEX.UNISWAP_V4;

    if (!tokenIn || !tokenOut || !amountIn) {
      return errorResp(res, "Missing tokenIn, tokenOut, or amountIn");
    }

    // Step 1: Simulate
    const simulation = await swapSimulator.simulate(tokenIn, tokenOut, amountIn);

    // Step 2: Build proposal
    const proposal: SwapProposal = {
      id: `prop-${randomUUID().slice(0, 8)}`,
      tokenIn,
      tokenOut,
      amountIn,
      estimatedAmountOut: simulation.estimatedAmountOut,
      maxSlippageBps: slippageBps,
      dex,
      timestamp: new Date().toISOString(),
    };

    // Step 3: Policy gate
    const policyDecision = policyEngine.evaluate(proposal, sessionManager.getBalances());

    if (!policyDecision.approved) {
      const reasons = policyDecision.results
        .filter((r) => !r.passed)
        .map((r) => `${r.rule.name}: ${r.reason}`)
        .join("; ");

      addAudit("swap_rejected", `Swap rejected: ${reasons}`, {
        proposalId: proposal.id,
        tokenIn,
        tokenOut,
        amountIn,
        reasons,
      });

      json(res, {
        result: null,
        policyDecision: serializePolicyDecision(policyDecision),
      });
      return;
    }

    // Step 4: Execute off-chain
    const result = await sessionManager.applySwap(
      tokenIn,
      tokenOut,
      amountIn,
      simulation.estimatedAmountOut,
      proposal.id,
    );

    // Update channel info after swap
    if (nitroliteChannel) {
      const ch = nitroliteChannel.getChannel();
      if (ch) {
        channelInfo = {
          channelId: ch.channelId,
          status: ch.status,
          stateUpdates: ch.stateHistory.length,
          latestHash: nitroliteChannel.getLatestStateHash(),
        };
      }
    }

    addAudit("swap_executed", `Executed ${amountIn} ${tokenIn} → ${result.amountOut} ${tokenOut}`, {
      proposalId: proposal.id,
      amountIn,
      amountOut: result.amountOut,
      executedPrice: result.executedPrice,
      route: simulation.route,
      nitroliteStateHash: channelInfo?.latestHash ?? null,
    });

    json(res, {
      result: {
        proposalId: result.proposalId,
        success: result.success,
        amountIn: result.amountIn,
        amountOut: result.amountOut,
        executedPrice: result.executedPrice,
        executionType: result.executionType,
        timestamp: result.timestamp,
      },
      policyDecision: serializePolicyDecision(policyDecision),
    });
  } catch (e) {
    errorResp(res, (e as Error).message);
  }
}

function handlePolicy(_req: IncomingMessage, res: ServerResponse): void {
  const config = policyEngine.getConfig();
  json(res, {
    maxTradePercent: config.maxTradePercent,
    maxSlippageBps: config.maxSlippageBps,
    allowedDexes: config.allowedDexes,
    allowedAssets: config.allowedAssets,
    policyHash: policyEngine.getPolicyHash(),
  });
}

function handleAudit(_req: IncomingMessage, res: ServerResponse): void {
  json(res, auditLog);
}

async function handleAgent(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === "GET") {
    // Return conversation history
    json(res, {
      history: agent.getHistory(),
      provider: process.env.AI_PROVIDER ?? "heuristic",
      hasApiKey: !!(process.env.AI_API_KEY ?? process.env.OPENAI_API_KEY ?? process.env.ANTHROPIC_API_KEY),
    });
    return;
  }

  if (req.method === "POST") {
    try {
      const body = await readBody(req);
      const message = body.message as string;

      if (!message || typeof message !== "string") {
        return errorResp(res, "Missing 'message' field");
      }

      // Re-wire tool executor in case session changed
      agent.setToolExecutor(createToolExecutor());

      log.info(`AI agent received: "${message.slice(0, 100)}"`);
      const responses = await agent.chat(message);

      addAudit("ai_chat", `User: ${message.slice(0, 100)}`, {
        responseCount: responses.length,
        toolCalls: responses.filter(r => r.toolCall).map(r => r.toolCall?.name),
      });

      json(res, { responses });
    } catch (e) {
      errorResp(res, (e as Error).message);
    }
    return;
  }

  if (req.method === "DELETE") {
    agent.resetConversation();
    json(res, { cleared: true });
    return;
  }

  errorResp(res, "Method not allowed", 405);
}

function handleStatus(_req: IncomingMessage, res: ServerResponse): void {
  json(res, {
    status: "running",
    integrations: {
      policyEngine: "real",
      sessionManager: "real",
      swapSimulator: v4Client ? "uniswap-v4-on-chain" : "local-amm",
      nitrolite: nitroliteChannel ? "real-ecdsa" : "not-configured",
      ens: ensResolver ? "real" : "not-configured",
      settlement: settlementClient ? "on-chain" : "mock",
      aiAgent: process.env.AI_API_KEY ? (process.env.AI_PROVIDER ?? "openai") : "heuristic",
    },
    policyHash: policyEngine.getPolicyHash(),
    timestamp: new Date().toISOString(),
  });
}

// ---- Router ----

async function router(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ?? "/";

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (url === "/api/session" || url === "/api/session/") {
      return await handleSession(req, res);
    }
    if (url === "/api/simulate" || url === "/api/simulate/") {
      return await handleSimulate(req, res);
    }
    if (url === "/api/swap" || url === "/api/swap/") {
      return await handleSwap(req, res);
    }
    if (url === "/api/policy" || url === "/api/policy/") {
      return handlePolicy(req, res);
    }
    if (url === "/api/audit" || url === "/api/audit/") {
      return handleAudit(req, res);
    }
    if (url === "/api/agent" || url === "/api/agent/") {
      return await handleAgent(req, res);
    }
    if (url === "/api/status" || url === "/api/status/") {
      return handleStatus(req, res);
    }

    errorResp(res, "Not found", 404);
  } catch (e) {
    log.error("Unhandled error", { error: (e as Error).message });
    errorResp(res, "Internal server error", 500);
  }
}

// ---- Start Server ----

const server = createServer(router);

server.listen(API_PORT, () => {
  log.info(`Sentinel API server running on http://localhost:${API_PORT}`);
  log.info("Integration status:", {
    policyEngine: "✓ real",
    sessionManager: "✓ real",
    swapSimulator: v4Client ? "✓ Uniswap v4 on-chain" : "✓ local AMM",
    nitrolite: nitroliteChannel ? "✓ real ECDSA" : "⚠ not configured",
    ens: ensResolver ? "✓ real" : "⚠ not configured",
    settlement: settlementClient ? "✓ on-chain" : "⚠ mock",
  });
  log.info("Endpoints:", {
    session: `GET/POST/DELETE /api/session`,
    simulate: `POST /api/simulate`,
    swap: `POST /api/swap`,
    policy: `GET /api/policy`,
    audit: `GET /api/audit`,
    agent: `GET/POST/DELETE /api/agent`,
    status: `GET /api/status`,
  });
});
