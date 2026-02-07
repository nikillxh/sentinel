// ============================================================
// Sentinel – MCP Tool Definitions
// Defines all 4 MCP tools with Zod schemas, handlers,
// policy engine integration, and structured logging.
//
// Tools:
//   1. get_session_balance  – Read current off-chain balances
//   2. simulate_swap        – Simulate a Uniswap v4 swap
//   3. propose_swap         – Propose + execute a policy-checked swap
//   4. close_session_and_settle – Close session, trigger settlement
// ============================================================

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Logger } from "../shared/logger.js";
import { DEX } from "../shared/constants.js";
import type {
  Asset,
  PolicyDecision,
  SwapProposal,
  ToolResponse,
} from "../shared/types.js";
import { PolicyEngine } from "../policy-engine/engine.js";
import { SessionManager } from "../session/manager.js";
import { SwapSimulator } from "./swap-simulator.js";
import { type SettlementClient, createSettlementClient } from "../contracts/index.js";

// ---- Zod Schemas ----

const AssetSchema = z.enum(["USDC", "ETH"]);

export const schemas = {
  getSessionBalance: z.object({
    asset: AssetSchema.describe("The asset to check balance for (USDC or ETH)"),
  }),

  simulateSwap: z.object({
    tokenIn: AssetSchema.describe("The input token symbol"),
    tokenOut: AssetSchema.describe("The output token symbol"),
    amount: z.number().positive().describe("Amount of tokenIn to swap"),
  }),

  proposeSwap: z.object({
    tokenIn: AssetSchema.describe("The input token symbol"),
    tokenOut: AssetSchema.describe("The output token symbol"),
    amount: z.number().positive().describe("Amount of tokenIn to swap"),
  }),

  closeSessionAndSettle: z.object({}).describe("No parameters required"),
} as const;

// ---- Tool Handlers ----

export class ToolHandlers {
  private policyEngine: PolicyEngine;
  private sessionManager: SessionManager;
  private swapSimulator: SwapSimulator;
  private settlementClient: SettlementClient | null;
  private log = new Logger("mcp-server");

  constructor(
    policyEngine: PolicyEngine,
    sessionManager: SessionManager,
    swapSimulator: SwapSimulator,
    settlementClient?: SettlementClient | null,
  ) {
    this.policyEngine = policyEngine;
    this.sessionManager = sessionManager;
    this.swapSimulator = swapSimulator;
    this.settlementClient = settlementClient ?? createSettlementClient();

    if (this.settlementClient) {
      this.log.info("On-chain settlement: ENABLED (real transactions)");
    } else {
      this.log.info("On-chain settlement: DISABLED (mock mode — set RPC_URL, OPERATOR_PRIVATE_KEY, SENTINEL_WALLET_ADDRESS, POLICY_GUARD_ADDRESS to enable)");
    }
  }

  // ---- Tool 1: get_session_balance ----

  async getSessionBalance(
    args: z.infer<typeof schemas.getSessionBalance>,
  ): Promise<ToolResponse> {
    this.log.info(`Tool called: get_session_balance(${args.asset})`);

    try {
      const balance = this.sessionManager.getBalance(args.asset);
      const summary = this.sessionManager.getSummary();

      this.log.info(`Balance for ${args.asset}: ${balance.amount}`, {
        pnl: balance.pnl,
        totalValueUsd: summary.totalValueUsd,
      });

      return {
        success: true,
        data: {
          balance,
          sessionId: summary.sessionId,
          totalValueUsd: summary.totalValueUsd,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  }

  // ---- Tool 2: simulate_swap ----

  async simulateSwap(
    args: z.infer<typeof schemas.simulateSwap>,
  ): Promise<ToolResponse> {
    this.log.info(
      `Tool called: simulate_swap(${args.amount} ${args.tokenIn} → ${args.tokenOut})`,
    );

    try {
      this.validateSwapPair(args.tokenIn, args.tokenOut);
      const simulation = await this.swapSimulator.simulate(
        args.tokenIn,
        args.tokenOut,
        args.amount,
      );

      // Run policy check as a dry-run (informational only)
      const proposal = this.buildProposal(
        args.tokenIn,
        args.tokenOut,
        args.amount,
        simulation.estimatedAmountOut,
      );
      const policyDecision = this.policyEngine.evaluate(
        proposal,
        this.sessionManager.getBalances(),
      );

      this.log.info("Simulation complete", {
        estimatedOut: simulation.estimatedAmountOut,
        priceImpactBps: simulation.priceImpactBps,
        policyApproved: policyDecision.approved,
      });

      return {
        success: true,
        data: {
          simulation,
          wouldBeApproved: policyDecision.approved,
          policyNotes: policyDecision.results
            .filter((r) => !r.passed)
            .map((r) => r.reason),
        },
        policyDecision,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  }

  // ---- Tool 3: propose_swap ----

  async proposeSwap(
    args: z.infer<typeof schemas.proposeSwap>,
  ): Promise<ToolResponse> {
    this.log.separator(`SWAP PROPOSAL: ${args.amount} ${args.tokenIn} → ${args.tokenOut}`);
    this.log.info(
      `Tool called: propose_swap(${args.amount} ${args.tokenIn} → ${args.tokenOut})`,
    );

    try {
      this.validateSwapPair(args.tokenIn, args.tokenOut);

      // Step 1: Simulate to get expected output
      const simulation = await this.swapSimulator.simulate(
        args.tokenIn,
        args.tokenOut,
        args.amount,
      );

      // Step 2: Build the proposal
      const proposal = this.buildProposal(
        args.tokenIn,
        args.tokenOut,
        args.amount,
        simulation.estimatedAmountOut,
      );

      // Step 3: Policy check (HARD GATE — this is the safety layer)
      const policyDecision = this.policyEngine.evaluate(
        proposal,
        this.sessionManager.getBalances(),
      );

      if (!policyDecision.approved) {
        const reasons = policyDecision.results
          .filter((r) => !r.passed)
          .map((r) => `${r.rule.name}: ${r.reason}`);

        this.log.warn("Swap REJECTED by policy engine", { reasons });

        return {
          success: false,
          error: `Policy rejected: ${reasons.join("; ")}`,
          policyDecision,
          timestamp: new Date().toISOString(),
        };
      }

      // Step 4: Execute off-chain (instant, gasless)
      this.log.info("Policy approved — executing off-chain swap");
      const result = await this.sessionManager.applySwap(
        args.tokenIn,
        args.tokenOut,
        args.amount,
        simulation.estimatedAmountOut,
        proposal.id,
      );

      // Step 5: Return result with full audit trail
      const summary = this.sessionManager.getSummary();

      this.log.info("Swap completed successfully", {
        proposalId: proposal.id,
        amountIn: result.amountIn,
        amountOut: result.amountOut,
        executionType: result.executionType,
        newBalances: summary.balances,
      });

      return {
        success: true,
        data: {
          swapResult: result,
          proposal,
          updatedBalances: summary.balances,
          totalValueUsd: summary.totalValueUsd,
        },
        policyDecision,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  }

  // ---- Tool 4: close_session_and_settle ----

  async closeSessionAndSettle(): Promise<ToolResponse> {
    this.log.separator("SESSION CLOSE & SETTLEMENT");
    this.log.info("Tool called: close_session_and_settle()");

    try {
      // Step 1: Close the session
      const session = await this.sessionManager.close();

      // Step 2: Settle on-chain (real or mock)
      let txHash: `0x${string}`;
      let blockNumber: number | undefined;

      if (this.settlementClient) {
        // ---- REAL ON-CHAIN SETTLEMENT ----
        this.log.info("Submitting settlement to SentinelWallet contract...");
        const record = await this.settlementClient.settle(session);
        txHash = record.txHash;
        blockNumber = record.blockNumber;
        this.log.info("On-chain settlement confirmed", {
          txHash,
          blockNumber,
        });
      } else {
        // ---- MOCK SETTLEMENT (no env vars) ----
        this.log.info("Submitting final state for on-chain settlement...");
        this.log.debug("MOCK: Would create ERC-4337 UserOperation here");
        txHash =
          `0x${randomUUID().replace(/-/g, "")}${randomUUID().replace(/-/g, "").slice(0, 32)}` as `0x${string}`;
      }

      // Step 3: Mark as settled
      const settled = this.sessionManager.markSettled(txHash);
      const summary = this.sessionManager.getSummary();

      this.log.info("Settlement complete", {
        txHash,
        blockNumber: blockNumber ?? "mock",
        finalBalances: summary.balances,
        totalSwaps: summary.totalSwaps,
        totalValueUsd: summary.totalValueUsd,
      });

      return {
        success: true,
        data: {
          sessionId: settled.sessionId,
          status: settled.status,
          finalBalances: summary.balances,
          pnl: summary.pnl,
          totalSwaps: summary.totalSwaps,
          totalValueUsd: summary.totalValueUsd,
          settlementTxHash: txHash,
          ...(blockNumber !== undefined ? { blockNumber } : {}),
          onChain: this.settlementClient !== null,
          history: settled.history,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return this.errorResponse(error);
    }
  }

  // ---- Helpers ----

  private buildProposal(
    tokenIn: Asset,
    tokenOut: Asset,
    amountIn: number,
    estimatedAmountOut: number,
  ): SwapProposal {
    return {
      id: `prop-${randomUUID().slice(0, 8)}`,
      tokenIn,
      tokenOut,
      amountIn,
      estimatedAmountOut,
      maxSlippageBps: 50, // default 0.5%
      dex: DEX.UNISWAP_V4,
      timestamp: new Date().toISOString(),
    };
  }

  private validateSwapPair(tokenIn: Asset, tokenOut: Asset): void {
    if (tokenIn === tokenOut) {
      throw new Error(`Cannot swap ${tokenIn} to itself`);
    }
  }

  private errorResponse(error: unknown): ToolResponse {
    const message = error instanceof Error ? error.message : String(error);
    this.log.error("Tool error", { message });
    return {
      success: false,
      error: message,
      timestamp: new Date().toISOString(),
    };
  }
}
